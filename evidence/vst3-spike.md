# Milestone 1 spike — MBIRA direct VST3 plugin

Verified 2026-11-06 on Windows/MinGW (winlibs gcc 16.2.0, CMake 4.4.3 + Ninja).

## What was built
- `src/vst3/MbiraPlugin.cpp` — minimal VST3 instrument: component (1 stereo out
  bus + 1 event input bus), edit controller (no editor/params), plugin factory.
  Reuses the Engine struct from `src/native/main.cpp` (copied verbatim into
  `src/vst3/mbira_engine.h` with two additions: `loadBundleFromString` and an
  `EventBridge` = bounded event queue + service thread so JS never runs on the
  audio thread; same pattern as the standalone host's live mode).
- `src/vst3/dsp_bundle.h.in` — template; CMake embeds `build/dsp-bundle.js`
  into the binary as a raw string (generated at
  `build-vst3/generated/dsp_bundle.h`), so the plugin needs no side files.
- `src/vst3/SmokeHost.cpp` — offline smoke-test host: LoadLibrary the .vst3,
  GetPluginFactory, instantiate component+controller, note-on MIDI event,
  process 1 s @ 48 kHz/256, assert non-silent output.

## Build
```
cmake -B build-vst3 -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build-vst3 --target mbira_vst3 validator mbira_vst3_smoke
```
(winlibs mingw64 bin on PATH). Outputs:
- `build-vst3/vst3/MBIRA.vst3/Contents/x86_64-win/MBIRA.vst3` (the module DLL)
- `build-vst3/bin/validator.exe` (VST3 SDK validator)
- `build-vst3/mbira_vst3_smoke.exe`

## Results (real output, not assertions)
- Validator: **47 tests passed, 0 failed**.
- Smoke host: `{"smoke":"vst3","peak":0.291166,"peak_dbfs":-10.72,"ok":true}` —
  a note-on through the VST3 produces real audio from the embedded engine.

## SDK patches (deps/extract/vst3sdk, MinGW compatibility)
- `public.sdk/source/vst/utility/alignedalloc.h`: use `_aligned_malloc/_aligned_free`
  under `__MINGW32__` (MinGW libc lacks `std::aligned_alloc`).
- `validator` needs `-municode` (it uses `wmain`) — added in CMakeLists.
- SDK submodules (public.sdk, pluginterfaces, vstgui4) were initialized via
  `git submodule update --init`.

## Known simplifications (spike scope)
- No parameters / editor / state persistence (getState/setState kNotImplemented).
- Note events are queued and applied by a 1 ms service thread (~48-sample
  worst-case event latency at 48 kHz); sample-accurate event offsets not wired.
- Only 32-bit float processing (canProcessSampleSize kSample32).
- No IMidiMapping (validator's MIDI-mapping test passes trivially without it).
