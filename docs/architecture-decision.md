# MBIRA — Architecture Decision Record

## Milestone 0 feasibility verdict: **GO WITH CONSTRAINTS** *(pending first native build — see constraint C1)*

**Version under investigation:** `elemaudio/elementary` at commit `60e7234` ("Merge web/offline v4.0.3", 2023-ish line of development; js packages `@elemaudio/core@4.0.1`, `@elemaudio/web-renderer@4.0.3`, `@elemaudio/offline-renderer@4.0.3`; native CMake declares project version `0.11.5`). Licence: **MIT** (LICENSE.md, "MIT License — Copyright (c) 2023 Nick Thompson"). All findings below read directly from that source tree at `thirdparty/elementary`.

### 2.0 Feasibility gate findings

**Native runtime API surface present at this commit** (`runtime/elem/Runtime.h`, header-only INTERFACE library):

- `Runtime(double sampleRate, int blockSize)` — templated on `float`/`double`.
- `applyInstructions(js::Array const& batch)` — accepts instruction batches (CREATE_NODE, SET_PROPERTY, APPEND_CHILD, ACTIVATE_ROOTS, COMMIT_UPDATES).
- `process(inputCh*, numIn, outputCh*, numOut, numSamples, userData)` — the audio-thread call.
- `processQueuedEvents(callback)` — drains graph events (analysis nodes, errors) on the main thread.
- `reset()`, `gc()` (returns pruned NodeIds to feed back to the JS Renderer), `addSharedResource`/`pruneSharedResources` (shared-resource support is present — relevant to 4.5's shared soundboard).
- `registerNodeType` for custom native nodes.
- `elem::js::parseJSON(std::string)` utility for deserialising batches.

**JS renderer emits compatible instructions:** the `Renderer` class in `@elemaudio/core` takes a callback receiving the instruction batch; the repo's own CLI (`cli/examples/00_HelloSine.js`) renders through `Renderer` and ships it to the native runtime via `__postNativeMessage__(JSON.stringify(batch))`. Both sides live in the same repo at the same commit — this is the release-pairing the spec requires. **Constraint C0:** the CLI's own `package.json` pins `@elemaudio/core ^3.2` (stale relative to the repo's js/ tree at 4.0.1); we will use the js/ tree at the pinned commit, not the CLI's npm pin, and record exact versions in `deps/manifest.json`.

**JS execution model used by the official native example (A2):** `choc::javascript::createQuickJSContext()` — CHOC's single-header QuickJS wrapper, vendored under `cli/choc/`. Audio I/O in the example is miniaudio (we are told to prefer RtAudio; RtAudio is the substitute host adapter, DSP path identical). **Decision: embed CHOC/QuickJS as the DSP JS context, exactly as the official CLI does.** No additional runtime adopted.

### 1.2 Threading analysis (from source, one investigation per §2.0/§1.2)

| Operation | Thread | Evidence |
|---|---|---|
| Graph construction (JS render → instructions) | DSP JS thread (QuickJS, non-RT) | Renderer callback runs in JS; `applyInstructions` comment + `setProperty` comment: "intentionally called on the non-realtime thread" |
| `applyInstructions` | non-RT thread | mutates `nodeTable` freely; on COMMIT_UPDATES builds a new render sequence and pushes to `rseqQueue` |
| Render-sequence handoff | lock-free SPSC: `rseqQueue` (`SingleWriterSingleReaderQueue.h`) producer → `process()` consumer | `Runtime::process` pops and swaps `rtRenderSeq` shared_ptr; assignment thread-safe via atomic refcount (explicit comment at Runtime.h ~line 440) |
| `process()` | audio thread only | touches only `rtRenderSeq` + pooled buffers; bufferAllocator preallocates per-block buffers |
| Parameter updates (continuous) | non-RT `setProperty` → node-internal `std::atomic` | `Core.h` `ConstNode`: `static_assert(std::atomic<FloatType>::is_always_lock_free); std::atomic<FloatType> value;` — nodes are required to make `setProperty` vs `process` safe themselves |
| `gc()` / `prune()` | non-RT only | uses `use_count()==1` on pooled render sequences to decide safety — only correct when called off the audio thread |

**Real-time safety conclusion:** graph changes never lock the audio thread; the audio callback takes no mutex in `process()` (SPSC pop + shared_ptr atomic swap only). Continuous parameters must go through node `setProperty` on lock-free-atomic nodes (`el.const` feeding `el.sm`-style smoothing), NOT through re-rendering the graph per value. Allocation, node creation, `gc`, `prune` all happen off-thread; destruction of retired nodes is deferred by the refcount pool. This satisfies spec §1.2/§1.3 with no unsafe synchronization and no double-buffer workaround needed — the runtime is already double-buffered at the render-sequence level.

### Constraints

- **C1 (until proven):** no compiler on this machine at session start. Verdict becomes unconditional GO when the C++ host builds and renders audio. If WinLibs MinGW proves incompatible with the Elementary runtime, fall back: (a) WinLibs GCC version change, (b) LLVM-MinGW, (c) VS Build Tools — before declaring NO-GO.
- **C2:** the js/ tree (core 4.0.1) and native runtime must be used from the same commit; do not mix with npm-published versions pinned elsewhere (CLI example's `^3.2` is stale).
- **C3:** `applyInstructions` is *not* transactional (explicit TODO in source: failed batch may leave partial node state; setProperty/appendChild on failure do not revert). Our host must therefore apply whole-graph rebuild batches and treat a failed batch as fatal to that graph version, re-rendering from JS.
- **C4:** `el.sm` is a JS-side macro (no native "sm" node); smoothing happens in-graph around `el.const`. Verified acceptable; 100 ms ramps live in the DSP graph.

### A1 — Instrument ID

`mbira-dzavadzimu` (correcting the brief's typo `mbira-dzavdzimu`). Applied to filenames, `instrument.id`, state, and tests.

### A2 — JS execution model

CHOC QuickJS (vendored by the official CLI example). Verified in source above.

### Licences verified so far (never guess)

- Elementary: MIT — read from `thirdparty/elementary/LICENSE.md`.
- Remaining (CHOC, QuickJS, RtAudio, RtMidi, VST3 SDK): to be verified from actual licence files at pin time; recorded in `deps/manifest.json` and `LICENSES.md`.

### VST3 decision

Not yet attempted — Milestone 1 spike, bounded by §2.2 exit conditions (4.4).
