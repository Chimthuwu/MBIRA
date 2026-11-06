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
// Events

struct Event {
  enum Kind { NoteOn, NoteOff, Param, AllDamp, Sustain, Raw } kind;
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

static int runLive(Engine& eng, bool withUi, double autoQuitS) {
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
    for (size_t i = 0; i < nFrames; ++i) {
      out[2 * i] = L[i];
      out[2 * i + 1] = R[i];
    }
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
    std::lock_guard<std::mutex> lk(*b->m);
    if (b->q->size() < 1024) b->q->push_back(ev); // bounded; PoC drops newest on overflow
  }, &bridge);
  try {
    midi.openPort(0);
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
    mbira_ui::run(uiState, sink, paramSink, autoQuitS);   // returns when the window is closed
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
    bool noUi = false; double quitS = 0;
    for (int i = 2; i < argc; ++i) {
      if (!strcmp(argv[i], "--no-ui")) noUi = true;
      else if (!strcmp(argv[i], "--quit-after") && i + 1 < argc) quitS = atof(argv[++i]);
    }
    return runLive(eng, !noUi, quitS);
  }

  fprintf(stderr, "unknown mode %s\n", mode.c_str());
  return 2;
}
