// MBIRA VST3 — engine adapter.
//
// The Engine struct is reused verbatim from src/native/main.cpp (choc QuickJS
// context + elem::Runtime<float> + __postNativeMessage__ bridge). The only
// additions: loadBundleFromString (the VST3 binary embeds the bundle, so it
// needs no filesystem access), and a thread-safe event queue.
//
// IMPORTANT (threading): every call into the JS DSP bundle (note on/off,
// instrument load) runs through eng->call -> __postNativeMessage__ ->
// runtime->applyInstructions, which mutates the elem graph. That graph is read
// by runtime->process() on the audio thread. So ALL such calls MUST happen on
// the audio thread. The bridge therefore does NOT use a service thread: process()
// pushes host events, then calls EventBridge::drain() on the audio thread to
// evaluate them immediately before rendering. Evaluating JS on a separate
// thread (the earlier design) raced with runtime->process() and silently
// dropped voices.
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "choc_JSON.h"
#include "choc_javascript.h"
#include "choc_javascript_QuickJS.h"

#include "elem/Runtime.h"
#include "instrument_default.h"

// Replicates src/native/main.cpp jsStringLiteral: safely quote a JSON string
// into a JS string literal for __mbira.loadInstrument(...).
static std::string jsStringLiteral(const std::string& s) {
  std::string o = "\"";
  for (char ch : s) {
    switch (ch) {
      case '\\': o += "\\\\"; break;
      case '"':  o += "\\\""; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:   o += ch;
    }
  }
  o += "\"";
  return o;
}

struct MbiraEvent {
  enum Kind { NoteOn, NoteOff, Param, AllDamp, LoadInstrument } kind;
  int note = 0, vel = 0, mode = 0;
  float value = 0;
  std::string text;  // instrument JSON for LoadInstrument
};

struct Engine {
  choc::javascript::Context js;
  std::unique_ptr<elem::Runtime<float>> runtime;
  double sampleRate = 48000.0;
  int blockSize = 256;
  std::vector<float> liveScratch; // preallocated deinterleave planes
  std::string lastError;
  std::string jsLastError;

  Engine(double sr, int bs)
    : js(choc::javascript::createQuickJSContext()),
      runtime(std::make_unique<elem::Runtime<float>>(sr, bs)),
      sampleRate(sr), blockSize(bs) {
    liveScratch.assign(2 * (size_t) bs, 0.0f);

    js.registerFunction("__postNativeMessage__", [&](choc::javascript::ArgumentList args) {
      auto text = args[0]->toString();
      auto rc = runtime->applyInstructions(elem::js::parseJSON(text));
      if (rc != 0 || getenv("MBIRA_TRACE"))
        fprintf(stderr, "[mbira-vst3] batch len=%zu rc=%d\n", text.size(), rc);
      return choc::value::Value();
    });

    js.registerFunction("__log__", [&](choc::javascript::ArgumentList args) {
      for (size_t i = 0; i < args.numArgs; ++i)
        fprintf(stderr, "[mbira-dsp] %s\n", args[i]->toString().c_str());
      return choc::value::Value();
    });

    (void) js.evaluate("(function(){ if (typeof globalThis.console === 'undefined') { globalThis.console = { log: (...a) => __log__('[log]', ...a), warn: (...a) => __log__('[warn]', ...a), error: (...a) => __log__('[error]', ...a) }; } })()");
  }

  bool loadBundleFromString(const std::string& contents) {
    try { (void) js.evaluate(contents); }
    catch (const choc::javascript::Error& e) { lastError = std::string("JS error: ") + e.what(); return false; }
    return true;
  }

  // Calls into the exposed __mbira API. MUST run on the audio thread (see note
  // above) — never from a background service thread.
  bool call(const std::string& expr) {
    try { (void) js.evaluate(expr); }
    catch (const choc::javascript::Error& e) { lastError = std::string("JS error: ") + e.what(); return false; }
    return true;
  }

  // Loads an instrument from JSON text (mirrors the standalone applyInstrumentText).
  bool loadInstrumentText(const std::string& jsonText) {
    return call(std::string("__mbira.loadInstrument(") + jsStringLiteral(jsonText) + ")");
  }
  // Loads the embedded default instrument (dzaVadzimu) — no filesystem needed.
  bool loadDefaultInstrument() { return loadInstrumentText(getMbiraDzaJson()); }
  // Loads an embedded instrument by id (mirrors standalone resolveInstrumentPath).
  bool loadInstrumentById(const std::string& id) {
    return loadInstrumentText(id == "nyunga-nyunga" ? getMbiraNyungaJson() : getMbiraDzaJson());
  }

  // Audio-thread work. runtime.process() applies the queued graph instructions
  // (posted by call()/applyInstructions) and renders. No JS, no locks.
  void processAudio(float** deinterleaved, size_t numChannels, size_t numFrames) {
    runtime->process(nullptr, 0, deinterleaved, numChannels, numFrames, nullptr);
  }
};

// ---------------------------------------------------------------------------
// Thread-safe event queue. process() (audio thread) pushes host events (note
// on/off, instrument switches) and then calls drain() on the SAME audio thread
// before rendering. No service thread — see the threading note at the top.

struct EventBridge {
  std::mutex qMutex;
  std::deque<MbiraEvent> q;

  // Kept for API symmetry; no background thread is used.
  void start(Engine*) {}
  void stop() { std::lock_guard<std::mutex> lk(qMutex); q.clear(); }

  void push(const MbiraEvent& ev) {
    std::lock_guard<std::mutex> lk(qMutex);
    if (q.size() < 1024) q.push_back(ev);  // bounded; drops newest on overflow
  }

  // Drains and evaluates queued events ON THE CALLING (audio) THREAD. Must be
  // called from process() before engine->processAudio(), so all graph mutation
  // happens on the same thread that renders.
  void drain(Engine* eng) {
    if (!eng) return;
    std::deque<MbiraEvent> batch;
    { std::lock_guard<std::mutex> lk(qMutex); if (q.empty()) return; std::swap(batch, q); }
    for (auto& ev : batch) {
      try {
        switch (ev.kind) {
          case MbiraEvent::NoteOn:  if (!eng->call("__mbira.noteOn(" + std::to_string(ev.note) + "," + std::to_string(ev.vel) + ")"))
                                       fprintf(stderr, "[mbira-vst3] ERROR: %s\n", eng->lastError.c_str()); break;
          case MbiraEvent::NoteOff: if (!eng->call("__mbira.noteOff(" + std::to_string(ev.note) + ")"))
                                       fprintf(stderr, "[mbira-vst3] ERROR: %s\n", eng->lastError.c_str()); break;
          case MbiraEvent::Param:   if (!eng->call("__mbira.setModeGain(" + std::to_string(ev.mode) + "," + std::to_string(ev.value) + ")"))
                                       fprintf(stderr, "[mbira-vst3] ERROR: %s\n", eng->lastError.c_str()); break;
          case MbiraEvent::AllDamp: if (!eng->call("__mbira.allNotesDamp()"))
                                       fprintf(stderr, "[mbira-vst3] ERROR: %s\n", eng->lastError.c_str()); break;
          case MbiraEvent::LoadInstrument: if (!eng->loadInstrumentText(ev.text))
                                       fprintf(stderr, "[mbira-vst3] ERROR loading instrument: %s\n", eng->lastError.c_str()); break;
        }
      } catch (const std::exception& ex) {
        fprintf(stderr, "[mbira-vst3] bridge event error: %s\n", ex.what());
      }
    }
  }
};
