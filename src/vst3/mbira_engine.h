// MBIRA VST3 — engine adapter.
//
// The Engine struct is reused verbatim from src/native/main.cpp (choc QuickJS
// context + elem::Runtime<float> + __postNativeMessage__ bridge). The only
// additions: loadBundleFromString (the VST3 binary embeds the bundle, so it
// needs no filesystem access) and a thread-safe event queue + service thread
// so JS graph work never runs on the audio thread (same pattern as the
// host's `live` mode service thread).
#pragma once

#include <algorithm>
#include <atomic>
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

#include "choc_JSON.h"
#include "choc_javascript.h"
#include "choc_javascript_QuickJS.h"

#include "elem/Runtime.h"

struct MbiraEvent {
  enum Kind { NoteOn, NoteOff, Param, AllDamp } kind;
  int note = 0, vel = 0, mode = 0;
  float value = 0;
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

  // Calls into the exposed __mbira API. Must run on a NON-audio thread.
  bool call(const std::string& expr) {
    try { (void) js.evaluate(expr); }
    catch (const choc::javascript::Error& e) { lastError = std::string("JS error: ") + e.what(); return false; }
    return true;
  }

  // Audio-thread work. runtime.process() uses a lock-free SPSC queue +
  // atomic shared_ptr swap; no JS, no locks, no allocation.
  void processAudio(float** deinterleaved, size_t numChannels, size_t numFrames) {
    runtime->process(nullptr, 0, deinterleaved, numChannels, numFrames, nullptr);
  }
};

// ---------------------------------------------------------------------------
// Bounded event queue + service thread (mirrors the host live-mode pattern).
// process() (audio thread) only pushes; the service thread drains and runs JS.

struct EventBridge {
  std::mutex qMutex;
  std::deque<MbiraEvent> q;
  std::atomic<bool> running { false };
  std::thread service;
  Engine* eng = nullptr;

  void start(Engine* e) {
    eng = e;
    running.store(true);
    service = std::thread([this]() {
      while (running.load()) {
        std::deque<MbiraEvent> batch;
        { std::lock_guard<std::mutex> lk(qMutex); batch.swap(q); }
        for (auto& ev : batch) {          switch (ev.kind) {
            case MbiraEvent::NoteOn:  if (!eng->call("__mbira.noteOn(" + std::to_string(ev.note) + "," + std::to_string(ev.vel) + ")"))
                                   fprintf(stderr, "[mbira-vst3] ERROR: %s\n", eng->lastError.c_str()); break;
            case MbiraEvent::NoteOff: if (!eng->call("__mbira.noteOff(" + std::to_string(ev.note) + ")"))
                                   fprintf(stderr, "[mbira-vst3] ERROR: %s\n", eng->lastError.c_str()); break;
            case MbiraEvent::Param:   if (!eng->call("__mbira.setModeGain(" + std::to_string(ev.mode) + "," + std::to_string(ev.value) + ")"))
                                   fprintf(stderr, "[mbira-vst3] ERROR: %s\n", eng->lastError.c_str()); break;
            case MbiraEvent::AllDamp: if (!eng->call("__mbira.allNotesDamp()"))
                                   fprintf(stderr, "[mbira-vst3] ERROR: %s\n", eng->lastError.c_str()); break;
          }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
      }
    });
  }

  void stop() {
    running.store(false);
    if (service.joinable()) service.join();
    std::lock_guard<std::mutex> lk(qMutex);
    q.clear();
  }

  void push(const MbiraEvent& ev) {
    std::lock_guard<std::mutex> lk(qMutex);
    if (q.size() < 1024) q.push_back(ev); // bounded; drops newest on overflow
  }
};
