// MBIRA Milestone 1 — native proof-of-concept host.
//
// Two modes:
//   mbira-poc render <out.wav> <events.json> [--duration s] [--block N] [--rate SR]
//     Deterministic offline render through the REAL native Elementary runtime
//     (elem::Runtime<float>) fed by the same QuickJS DSP bundle used live.
//     Prints a metrics JSON line: software latency (event accept sample ->
//     first non-zero output sample, per note) and audio-render-loop CPU.
//   mbira-poc live [--block N] [--rate SR]
//     RtAudio (WinMM/MME) playback + RtMidi input. MIDI events are queued
//     (bounded) and drained by a non-audio service thread which runs the JS
//     renderer; the audio callback only calls runtime.process().
//
// Threading (mirrors the Runtime.h analysis in docs/architecture-decision.md):
//   - JS graph construction + applyInstructions: non-audio threads only.
//   - audio callback: runtime.process() exclusively; lock-free render-sequence
//     swap inside the runtime; no JS, no locks, no allocation.
//   - MIDI/service threads: bounded queues only.

#include <algorithm>
#include <atomic>
#include <chrono>
#include <map>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "choc_Files.h"
#include "choc_JSON.h"
#include "choc_javascript.h"
#include "choc_javascript_QuickJS.h"

#include "elem/Runtime.h"

// RtAudio/RtMidi: WinMM backends on Windows (link winmm)
#include "RtAudio.h"
#include "RtMidi.h"
#include "ui.h"
#include "webview_ui.h"

// ---------------------------------------------------------------------------
// WAV writer (16-bit PCM stereo)

static void writeWav16(const char* path, const float* interleaved, size_t numFrames, int numChannels, double sr) {
  std::vector<int16_t> pcm(numFrames * numChannels);
  for (size_t i = 0; i < pcm.size(); ++i) {
    float s = interleaved[i];
    if (s > 1.0f) s = 1.0f;
    if (s < -1.0f) s = -1.0f;
    pcm[i] = (int16_t) std::lrint(s * 32767.0f);
  }
  FILE* f = fopen(path, "wb");
  if (!f) { fprintf(stderr, "ERROR: cannot open %s for writing\n", path); exit(1); }
  uint32_t dataSize = (uint32_t) (pcm.size() * 2);
  uint32_t chunkSize = 36 + dataSize;
  uint32_t fmtSize = 16;
  uint32_t srU = (uint32_t) sr, byteRate = (uint32_t)(sr * numChannels * 2);
  uint16_t bits = 16, ch16 = (uint16_t) numChannels, align16 = (uint16_t)(numChannels * 2), fmt16 = 1;
  fwrite("RIFF", 1, 4, f); fwrite(&chunkSize, 4, 1, f); fwrite("WAVE", 1, 4, f);
  // fmt chunk: fmtTag(2) channels(2) sampleRate(4) byteRate(4) blockAlign(2) bits(2) = 16 bytes
  fwrite("fmt ", 1, 4, f); fwrite(&fmtSize, 4, 1, f);
  fwrite(&fmt16, 2, 1, f); fwrite(&ch16, 2, 1, f); fwrite(&srU, 4, 1, f);
  fwrite(&byteRate, 4, 1, f); fwrite(&align16, 2, 1, f); fwrite(&bits, 2, 1, f);
  fwrite("data", 1, 4, f); fwrite(&dataSize, 4, 1, f);
  fwrite(pcm.data(), 2, pcm.size(), f);
  fclose(f);
}

// ---------------------------------------------------------------------------
// Engine: QuickJS DSP context + native Elementary runtime

struct Engine {
  choc::javascript::Context js;
  std::unique_ptr<elem::Runtime<float>> runtime;
  double sampleRate = 48000.0;
  int blockSize = 256;
  std::vector<float> liveScratch; // preallocated deinterleave planes for live mode
  std::string lastError;

  Engine(double sr, int bs)
    : js(choc::javascript::createQuickJSContext()),
      runtime(std::make_unique<elem::Runtime<float>>(sr, bs)),
      sampleRate(sr), blockSize(bs) {
    liveScratch.assign(2 * (size_t) bs, 0.0f);

    js.registerFunction("__postNativeMessage__", [&](choc::javascript::ArgumentList args) {
      auto text = args[0]->toString();
      auto rc = runtime->applyInstructions(elem::js::parseJSON(text));
      if (rc != 0 || getenv("MBIRA_TRACE"))
        fprintf(stderr, "[native] batch len=%zu rc=%d\n", text.size(), rc);
      return choc::value::Value();
    });

    js.registerFunction("__log__", [&](choc::javascript::ArgumentList args) {
      for (size_t i = 0; i < args.numArgs; ++i)
        fprintf(stderr, "[dsp] %s\n", args[i]->toString().c_str());
      return choc::value::Value();
    });

    (void) js.evaluate("(function(){ if (typeof globalThis.console === 'undefined') { globalThis.console = { log: (...a) => __log__('[log]', ...a), warn: (...a) => __log__('[warn]', ...a), error: (...a) => __log__('[error]', ...a) }; } })()");
  }

  bool loadBundle(const std::string& path) {
    auto contents = choc::file::loadFileAsString(path);
    if (contents.empty()) { lastError = "cannot read bundle: " + path; return false; }
    try { (void) js.evaluate(contents); }
    catch (const choc::javascript::Error& e) { lastError = std::string("JS error: ") + e.what(); return false; }
    return true;
  }

  // Calls into the exposed __mbira API. Must run on a NON-audio thread.
  bool call(const std::string& expr) {
    try { (void) js.evaluate(expr); }
    catch (const choc::javascript::Error& e) { lastError = std::string("JS error: ") + e.what(); return false; }
    return true;
  }

  // Audio-thread-equivalent work. runtime.process() uses a lock-free SPSC
  // queue + atomic shared_ptr swap (see Runtime.h analysis); no JS, no locks.
  void processAudio(float** deinterleaved, size_t numChannels, size_t numFrames) {
    runtime->process(nullptr, 0, deinterleaved, numChannels, numFrames, nullptr);
  }
};

// ---------------------------------------------------------------------------
// Instrument definitions (spec section 4)

static std::vector<mbira_ui::KeyGeom> g_geom;
static float g_canvasW = 800.0f, g_canvasH = 300.0f;
static std::string g_instrumentName;
static std::string g_instGeom;   // WebView2 instrument envelope (empty = not loaded)

static std::string jsStringLiteral(const std::string& s) {
  std::string o = "\"";
  for (char ch : s) {
    switch (ch) {
      case '\\': o += "\\\\"; break;
      case '"':  o += "\\\""; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default: o += ch;
    }
  }
  o += "\"";
  return o;
}

// Builds the schematic geometry (g_geom) + WebView2 envelope (g_instGeom) from
// instrument JSON text. Shared by startup load and runtime instrument.select.
static bool applyInstrumentGeometry(const std::string& text) {
  choc::value::Value root;
  try {
    root = choc::json::parse(text);
    g_geom.clear();
    auto keys = root["keys"];
    for (size_t i = 0; i < keys.size(); ++i) {
      auto k = keys[(int) i];
      mbira_ui::KeyGeom kg;
      kg.note = (int) k["note"].get<int64_t>();
      kg.x = (float) k["x"].get<double>();
      kg.y = (float) k["y"].get<double>();
      kg.len = (float) k["lengthPx"].get<double>();
      g_geom.push_back(kg);
    }
    g_canvasW = (float) root["canvas"]["width"].get<double>();
    g_canvasH = (float) root["canvas"]["height"].get<double>();
    g_instrumentName = root["name"].toString();
  }
  catch (const choc::json::ParseError& e) { fprintf(stderr, "ERROR: bad instrument JSON: %s\n", e.what()); g_geom.clear(); return false; }
  catch (const std::exception& e) { fprintf(stderr, "ERROR: bad instrument JSON geometry: %s\n", e.what()); g_geom.clear(); return false; }
  // Compact geometry envelope for the WebView2 UI (posted on ui.ready and on a
  // runtime instrument.select): {v:1,type:"instrument",payload:{id,name,keys:[...]}}
  {
    std::string o = "{\"v\":1,\"type\":\"instrument\",\"payload\":{\"id\":\"";
    o += root["id"].toString(); o += "\",\"name\":\"";
    for (char c : g_instrumentName) o += (c == '"' ? '_' : c);
    o += "\",\"keys\":[";
    auto keys = root["keys"];
    for (size_t i = 0; i < keys.size(); ++i) {
      auto k = keys[(int) i];
      char row[160];
      snprintf(row, sizeof row, "%s{\"note\":%lld,\"name\":\"%.8s\",\"rank\":%lld,\"x\":%.1f,\"y\":%.1f,\"len\":%.1f}",
               i ? "," : "",
               (long long) k["note"].get<int64_t>(),
               k["name"].toString().c_str(),
               (long long) k["rank"].get<int64_t>(),
               (float) k["x"].get<double>(), (float) k["y"].get<double>(),
               (float) k["lengthPx"].get<double>());
      o += row;
    }
    o += "]}}";
    g_instGeom = std::move(o);
  }
  return true;
}

// Resolves an instrument id ("mbira-dzavadzimu") to its JSON path, or passes a
// literal path through unchanged. Keep in sync with src/instruments/*.json ids.
static std::string resolveInstrumentPath(const std::string& idOrPath) {
  static const std::map<std::string, std::string> kRegistry = {
    { "mbira-dzavadzimu", "src/instruments/mbira-dzavadzimu.json" },
    { "nyunga-nyunga",    "src/instruments/nyunga-nyunga.json" },
  };
  auto it = kRegistry.find(idOrPath);
  return it != kRegistry.end() ? it->second : idOrPath;
}

// Loads instrument text into the DSP (voice pool rebuild + body config) and
// rebuilds the schematic geometry. Returns false if the DSP rejects the JSON.
static bool applyInstrumentText(Engine& eng, const std::string& text) {
  if (!eng.call("__mbira.loadInstrument(" + jsStringLiteral(text) + ")")) {
    fprintf(stderr, "ERROR: %s\n", eng.lastError.c_str());
    return false;
  }
  return applyInstrumentGeometry(text);
}

// Reads the instrument JSON named by MBIRA_INSTRUMENT (or the default), loads it
// into the DSP and records the schematic geometry for the UI. Returns false if
// no file is found (default 64-note pool stays).
static bool loadInstrumentFromDisk(Engine& eng) {
  const char* envp = getenv("MBIRA_INSTRUMENT");
  std::string path = envp ? envp : "src/instruments/mbira-dzavadzimu.json";
  // N-6 fix: a missing/unreadable file used to throw out of loadFileAsString
  // and crash the host. Any failure here falls back to the default pool.
  std::string text;
  try { text = choc::file::loadFileAsString(path); }
  catch (const std::exception& e) {
    fprintf(stderr, "NOTE: instrument JSON not readable (%s: %s) - using default 64-note pool\n",
            path.c_str(), e.what());
    return false;
  } catch (...) {
    fprintf(stderr, "NOTE: instrument JSON not readable (%s) - using default 64-note pool\n", path.c_str());
    return false;
  }
  if (text.empty()) {
    fprintf(stderr, "NOTE: instrument JSON not found (%s) - using default 64-note pool\n", path.c_str());
    return false;
  }
  if (!applyInstrumentText(eng, text)) return false;
  fprintf(stderr, "Instrument: %s (%d keys) from %s\n", g_instrumentName.c_str(), (int) g_geom.size(), path.c_str());
  return true;
}

// ---------------------------------------------------------------------------
// Events

struct Event {
  enum Kind { NoteOn, NoteOff, Param, AllDamp, Sustain, Raw, LoadInstrument } kind;
  double t = 0;      // schedule time (seconds) in render mode
  int note = 0, vel = 0, mode = 0;
  float value = 0;
  std::string name;  // param name for named-parameter events
};

static bool dispatchEvent(Engine& eng, const Event& ev) {
  switch (ev.kind) {
    case Event::NoteOn:  return eng.call("__mbira.noteOn(" + std::to_string(ev.note) + "," + std::to_string(ev.vel) + ")");
    case Event::NoteOff: return eng.call("__mbira.noteOff(" + std::to_string(ev.note) + ")");
    case Event::Param:
      if (!ev.name.empty())
        return eng.call("__mbira.setParam('" + ev.name + "'," + std::to_string(ev.value) + ")");
      return eng.call("__mbira.setModeGain(" + std::to_string(ev.mode) + "," + std::to_string(ev.value) + ")");
    case Event::Sustain: return eng.call("__mbira.sustain(" + std::string(ev.value > 0.5f ? "true" : "false") + ")");
    case Event::AllDamp: return ev.note == -1 ? eng.call("__mbira.trigger()") : eng.call("__mbira.allNotesDamp()");
    case Event::Raw:     return eng.call(ev.name); // pre-built JS expression (UI params)
    case Event::LoadInstrument:
      if (!applyInstrumentText(eng, ev.name)) return false;
      mbira_wv2::wvSetInstrument(g_instGeom);
      mbira_wv2::wvMarkInstrumentRepost();
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Render mode

static void runRender(Engine& eng, const std::string& wavPath,
                      const std::string& eventsJsonText, double durationS) {
  choc::value::Value root;
  try { root = choc::json::parse(eventsJsonText); }
  catch (const choc::json::ParseError& e) { fprintf(stderr, "ERROR: bad events JSON: %s\n", e.what()); exit(1); }

  std::vector<Event> events;
  auto eventsArr = root["events"];
  for (size_t i = 0; i < eventsArr.size(); ++i) {
    auto e = eventsArr[(int) i];
    Event ev;
    std::string type = e["type"].toString();
    ev.t = e["t"].get<double>();
    if (type == "on") { ev.kind = Event::NoteOn; ev.note = e["note"].get<int64_t>(); ev.vel = e["vel"].get<int64_t>(); }
    else if (type == "off") { ev.kind = Event::NoteOff; ev.note = e["note"].get<int64_t>(); }
    else if (type == "param") {
      ev.kind = Event::Param;
      if (!e["name"].isVoid() && e["name"].isString()) ev.name = e["name"].toString();
      else ev.mode = e["mode"].get<int64_t>(); // legacy: mode-gain events
      ev.value = (float) e["value"].get<double>();
    }
    else if (type == "sustain") { ev.kind = Event::Sustain; ev.value = (float) e["value"].get<double>(); }
    else if (type == "alldamp") { ev.kind = Event::AllDamp; }
    else if (type == "trigger") { ev.kind = Event::AllDamp; ev.note = -1; } // debug: calls __mbira.trigger()
    else { fprintf(stderr, "ERROR: unknown event type %s\n", type.c_str()); exit(1); }
    events.push_back(ev);
  }

  const size_t block = (size_t) eng.blockSize;
  const double sr = eng.sampleRate;
  const size_t numSamples = (size_t)(durationS * sr);
  std::vector<float> planes(2 * numSamples, 0.0f);

  std::vector<double> latenciesMs;
  std::vector<size_t> pending; // start positions of note-on latency scans
  size_t evIdx = 0;
  double audioLoopMs = 0.0;
  size_t pos = 0;

  while (pos < numSamples) {
    size_t n = std::min(block, numSamples - pos);
    double nowS = pos / sr;

    // Events scheduled in [nowS, nowS + n/sr) are accepted at the START of
    // this block (sample index pos) — that is the "event accept" timestamp.
    while (evIdx < events.size() && events[evIdx].t <= nowS + n / sr) {
      Event& ev = events[evIdx];
      if (!dispatchEvent(eng, ev)) { fprintf(stderr, "ERROR: %s\n", eng.lastError.c_str()); exit(1); }
      if (ev.kind == Event::NoteOn) pending.push_back(pos);
      ++evIdx;
    }

    auto t0 = std::chrono::steady_clock::now();
    // elem::Runtime::process always writes at offset 0 of each channel buffer
    // (verified against cli/Realtime.cpp), so pass offset pointers per block.
    float* chans[2] { planes.data() + pos, planes.data() + numSamples + pos };
    eng.processAudio(chans, 2, n);
    auto t1 = std::chrono::steady_clock::now();
    audioLoopMs += std::chrono::duration<double, std::milli>(t1 - t0).count();

    if (getenv("MBIRA_TRACE")) {
      float mx = 0;
      for (size_t i = 0; i < n; ++i) mx = std::max(mx, std::abs(planes[pos + i]));
      fprintf(stderr, "[trace] block@%zu max=%.6f\n", pos, mx);
    }

    const float* L = planes.data();
    for (auto it = pending.begin(); it != pending.end();) {
      bool found = false;
      for (size_t i = it[0]; i < pos + n && i < numSamples; ++i) {
        if (std::abs(L[i]) > 1e-4f) {
          latenciesMs.push_back((i - it[0]) * 1000.0 / sr);
          found = true;
          break;
        }
      }
      if (found) it = pending.erase(it); else ++it;
    }

    pos += n;
  }

  // Interleave and write
  std::vector<float> interleaved(numSamples * 2);
  for (size_t i = 0; i < numSamples; ++i) {
    interleaved[2 * i] = planes[i];
    interleaved[2 * i + 1] = planes[numSamples + i];
  }
  writeWav16(wavPath.c_str(), interleaved.data(), numSamples, 2, eng.sampleRate);

  double med = 0, worst = 0, mean = 0;
  if (!latenciesMs.empty()) {
    auto v = latenciesMs;
    std::sort(v.begin(), v.end());
    med = v[v.size() / 2];
    worst = v.back();
    for (double x : v) mean += x;
    mean /= v.size();
  }
  double cpuPercent = 100.0 * audioLoopMs / (durationS * 1000.0);

  printf("{\"mode\":\"render\",\"wav\":\"%s\",\"rate\":%.0f,\"block\":%d,\"duration_s\":%.2f,"
         "\"latency_ms\":{\"median\":%.4f,\"mean\":%.4f,\"worst\":%.4f,\"n\":%zu},"
         "\"audio_loop_cpu_percent\":%.3f}\n",
         wavPath.c_str(), eng.sampleRate, eng.blockSize, durationS,
         med, mean, worst, latenciesMs.size(), cpuPercent);

  double peak = 0;
  for (float x : interleaved) peak = std::max(peak, (double) std::abs(x));
  fprintf(stderr, "peak_dbfs=%.2f\n", 20.0 * std::log10(std::max(peak, 1e-9)));
}

// ---------------------------------------------------------------------------
// Live mode

static std::atomic<unsigned> g_xruns { 0 }; // RtAudio under/overflow flags
static std::atomic<float> g_peakL { 0.0f }, g_peakR { 0.0f }; // last-block meter peaks

// Scope ring: the audio thread appends the mono bus here (lock-free, no
// allocation); the UI thread copies the newest window on its 30 Hz tick.
static constexpr unsigned kScopeN = 4096;         // power of two
static float g_scope[kScopeN] = { 0.0f };
static std::atomic<unsigned> g_scopeW { 0 };      // total samples written (monotonic)

static int readScopeWave(float* dst, int maxN) {
  int n = maxN < (int)(kScopeN / 2) ? maxN : (int)(kScopeN / 2);
  unsigned w = g_scopeW.load(std::memory_order_acquire);
  for (int i = 0; i < n; ++i) dst[i] = g_scope[(w - (unsigned) n + (unsigned) i) & (kScopeN - 1)];
  return n;
}

static int runLive(Engine& eng, bool withUi, bool webviewUi, double autoQuitS) {
  RtAudio dac;
  if (dac.getDeviceCount() < 1) { fprintf(stderr, "ERROR: no audio devices found\n"); return 1; }

  unsigned int outDev = dac.getDefaultOutputDevice();
  fprintf(stderr, "Audio device: %s\n", dac.getDeviceInfo(outDev).name.c_str());

  RtAudio::StreamParameters params;
  params.deviceId = outDev;
  params.nChannels = 2;
  params.firstChannel = 0;

  auto audioCb = [](void* outputBuffer, void*, unsigned int nFrames, double, RtAudioStreamStatus status, void* userData) -> int {
    auto* e = (Engine*) userData;
    if (status) g_xruns++;
    if (nFrames > (unsigned) e->blockSize) nFrames = (unsigned) e->blockSize; // scratch sized for one block
    float* L = e->liveScratch.data();
    float* R = e->liveScratch.data() + nFrames;
    float* chans[2] { L, R };
    e->processAudio(chans, 2, nFrames);
    float* out = (float*) outputBuffer;
    float pl = 0.0f, pr = 0.0f;
    for (size_t i = 0; i < nFrames; ++i) {
      out[2 * i] = L[i]; out[2 * i + 1] = R[i];
      if (L[i] > pl || -L[i] > pl) pl = (L[i] > 0 ? L[i] : -L[i]);
      if (R[i] > pr || -R[i] > pr) pr = (R[i] > 0 ? R[i] : -R[i]);
    }
    g_peakL.store(pl); g_peakR.store(pr);
    unsigned w = g_scopeW.load(std::memory_order_relaxed);
    for (size_t i = 0; i < nFrames; ++i)
      g_scope[(w + (unsigned) i) & (kScopeN - 1)] = 0.5f * (L[i] + R[i]);
    g_scopeW.store(w + (unsigned) nFrames, std::memory_order_release);
    return 0;
  };

  // Service thread: drains the bounded event queue and runs the JS renderer.
  std::mutex qMutex;
  std::deque<Event> q;
  std::atomic<bool> running { true };

  std::thread service([&]() {
    while (running.load()) {
      std::deque<Event> batch;
      { std::lock_guard<std::mutex> lk(qMutex); batch.swap(q); }
      for (auto& ev : batch)
        if (!dispatchEvent(eng, ev))
          fprintf(stderr, "ERROR: %s\n", eng.lastError.c_str());
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
  });

  RtMidiIn midi;
  mbira_ui::State uiState;
  uiState.geom = g_geom;           // instrument-driven keyboard layout (may be empty)
  uiState.canvasW = g_canvasW;
  uiState.canvasH = g_canvasH;
  struct MidiBridge { std::mutex* m; std::deque<Event>* q; mbira_ui::State* ui; };
  MidiBridge bridge { &qMutex, &q, &uiState };
  midi.setCallback([](double, std::vector<unsigned char>* msg, void* userData) {
    if (msg->size() < 2) return;
    auto* b = (MidiBridge*) userData;
    unsigned char status = (*msg)[0] & 0xF0;
    Event ev;
    if (status == 0x90 && (*msg)[2] > 0) { ev.kind = Event::NoteOn; ev.note = (*msg)[1]; ev.vel = (*msg)[2]; }
    else if (status == 0x80 || (status == 0x90 && (*msg)[2] == 0)) { ev.kind = Event::NoteOff; ev.note = (*msg)[1]; }
    else return;
    if (ev.kind == Event::NoteOn) b->ui->noteOn(ev.note); else b->ui->noteOff(ev.note);
    // Forward to WebView2 so tines light + voice count updates (guarded:
    // queue is a no-op cost when GDI/--no-ui is in use).
    mbira_wv2::wvEnqueueNote(ev.note, ev.kind == Event::NoteOn, ev.vel);
    std::lock_guard<std::mutex> lk(*b->m);
    if (b->q->size() < 1024) b->q->push_back(ev); // bounded; PoC drops newest on overflow
  }, &bridge);
  try {
    midi.openPort(0);
    mbira_wv2::wvMarkMidiSeen();
    fprintf(stderr, "MIDI: port 0 = %s\n", midi.getPortName(0).c_str());
  } catch (RtMidiError& e) {
    fprintf(stderr, "MIDI: no input device (%s). The rendered WAVs do not need MIDI.\n", e.getMessage().c_str());
  }

  RtAudio::StreamOptions opts;
  // Glitch fix: DirectSound + MINIMIZE_LATENCY + default buffers underran.
  // 4 buffers (MBIRA_BUFFERS overrides), no MINIMIZE_LATENCY. See docs.
  opts.flags = 0;
  opts.numberOfBuffers = getenv("MBIRA_BUFFERS") ? atoi(getenv("MBIRA_BUFFERS")) : 4;
  unsigned int frames = (unsigned int) eng.blockSize;

  if (dac.openStream(&params, nullptr, RTAUDIO_FLOAT32, (unsigned int) eng.sampleRate, &frames, audioCb, &eng, &opts)) {
    fprintf(stderr, "ERROR: dac.openStream: %s\n", dac.getErrorText().c_str());
    return 1;
  }
  dac.startStream();
  fprintf(stderr, "LIVE: %.0f Hz, block %u frames. Play your MIDI controller. Ctrl+C to quit.\n",
          eng.sampleRate, frames);

  auto sink = [&](int note, bool on) {
    Event ev; ev.kind = on ? Event::NoteOn : Event::NoteOff; ev.note = note; ev.vel = 100;
    std::lock_guard<std::mutex> lk(qMutex);
    if (q.size() < 1024) q.push_back(ev);
  };
  if (withUi) {
    // UI parameter changes go through the same bounded queue as MIDI, so the
    // service thread (never the UI thread) runs the JS renderer.
    auto paramSink = [&](const std::string& expr) {
      Event ev; ev.kind = Event::Raw; ev.name = expr;
      std::lock_guard<std::mutex> lk(qMutex);
      if (q.size() < 1024) q.push_back(ev);
    };
    auto instrumentSink = [&](const std::string& idOrPath) {
      std::string path = resolveInstrumentPath(idOrPath);
      std::string text;
      try { text = choc::file::loadFileAsString(path); }
      catch (const std::exception& e) { fprintf(stderr, "instrument.select load failed (%s: %s)\n", path.c_str(), e.what()); return; }
      if (text.empty()) { fprintf(stderr, "instrument.select: no text at %s\n", path.c_str()); return; }
      Event ev; ev.kind = Event::LoadInstrument; ev.name = text;
      std::lock_guard<std::mutex> lk(qMutex);
      if (q.size() < 1024) q.push_back(ev);
    };
    if (webviewUi) {
      // Write the UI dir as an absolute path (virtual-host mapping needs it).
      wchar_t absBuf[512]; DWORD n = GetFullPathNameW(L"ui", 512, absBuf, nullptr);
      std::wstring uiDirW = n ? absBuf : L"ui";
      std::string uiDir(uiDirW.begin(), uiDirW.end());
      auto peakFn = [&](float* L, float* R) { *L = g_peakL.load(); *R = g_peakR.load(); };
      auto waveFn = [&](float* dst, int maxN) { return readScopeWave(dst, maxN); };
      mbira_wv2::wvSetInstrument(g_instGeom);   // UI asks for it on ui.ready
      fprintf(stderr, "WebView2 UI: %s\n", uiDir.c_str());
      mbira_wv2::runWebView2(sink, paramSink, instrumentSink, peakFn, waveFn, eng.sampleRate,
                             uiDir,
                             std::string("Z:/GITHUB/MBIRA/build/wv2-userdata"),
                             std::string("Z:/GITHUB/MBIRA/build/liveui.log"),
                             /*enableCdp=*/getenv("MBIRA_CDP") != nullptr);
    } else {
      mbira_ui::run(uiState, sink, paramSink, autoQuitS);   // returns when the window is closed
    }
  } else {
    auto t0 = std::chrono::steady_clock::now();
    while (autoQuitS <= 0 || std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() < autoQuitS)
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  fprintf(stderr, "xruns=%u\n", g_xruns.load());
  running = false;
  service.join();
  dac.stopStream();
  if (dac.isStreamOpen()) dac.closeStream();
  return 0;
}

// ---------------------------------------------------------------------------

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage:\n"
                    "  mbira-poc render <out.wav> <events.json> [--duration s] [--block N] [--rate SR]\n"
                    "  mbira-poc live [--block N] [--rate SR]\n");
    return 2;
  }

  std::string mode = argv[1];
  std::string wavPath, eventsPath;
  double duration = 10.0, rate = 48000.0;
  int block = 256;

  for (int i = 2; i < argc; ++i) {
    if (!strcmp(argv[i], "--duration") && i + 1 < argc) duration = atof(argv[++i]);
    else if (!strcmp(argv[i], "--block") && i + 1 < argc) block = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--rate") && i + 1 < argc) rate = atof(argv[++i]);
    else if (mode == "render" && wavPath.empty()) wavPath = argv[i];
    else if (mode == "render" && eventsPath.empty()) eventsPath = argv[i];
  }

  Engine eng(rate, block);

  std::string bundle = getenv("MBIRA_BUNDLE") ? getenv("MBIRA_BUNDLE") : "build/dsp-bundle.js";
  if (!eng.loadBundle(bundle)) {
    fprintf(stderr, "ERROR: %s (run: npm run build:dsp from the repo root)\n", eng.lastError.c_str());
    return 1;
  }
  loadInstrumentFromDisk(eng); // MBIRA_INSTRUMENT env overrides; default: dzavadzimu

  if (mode == "render") {
    if (wavPath.empty() || eventsPath.empty()) { fprintf(stderr, "render requires <out.wav> <events.json>\n"); return 2; }
    auto text = choc::file::loadFileAsString(eventsPath);
    if (text.empty()) { fprintf(stderr, "ERROR: cannot read %s\n", eventsPath.c_str()); return 1; }
    if (int voices = 0; (voices = getenv("MBIRA_VOICES") ? atoi(getenv("MBIRA_VOICES")) : 0) > 0)
      if (!eng.call("__mbira.configurePool(" + std::to_string(voices) + ")")) {
        fprintf(stderr, "ERROR: %s\n", eng.lastError.c_str()); return 1;
      }
    if (const char* rs = getenv("MBIRA_RATIOSET"))
      if (!eng.call(std::string("__mbira.setRatioSet('") + rs + "')")) {
        fprintf(stderr, "ERROR: %s\n", eng.lastError.c_str()); return 1;
      }
    runRender(eng, wavPath, text, duration);
    return 0;
  }

  if (mode == "live") {
    bool noUi = false; bool webviewUi = true; double quitS = 0;
    for (int i = 2; i < argc; ++i) {
      if (!strcmp(argv[i], "--no-ui")) noUi = true;
      else if (!strcmp(argv[i], "--ui") && i + 1 < argc) webviewUi = !strcmp(argv[++i], "webview");
      else if (!strcmp(argv[i], "--quit-after") && i + 1 < argc) quitS = atof(argv[++i]);
    }
    return runLive(eng, !noUi, webviewUi, quitS);
  }

  fprintf(stderr, "unknown mode %s\n", mode.c_str());
  return 2;
}
