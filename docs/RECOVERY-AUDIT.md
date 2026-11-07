# MBIRA — Recovery Audit

**Date:** 2026-11-08 · **Branch at audit:** `ui/visual-first-assignment` · **HEAD:** `6293c17`
**Scope of this document:** read-only audit. No source, config, documentation or Git history was
changed; the only file created is this one. Focused verification commands and their exact output
are listed in Appendix A.

Facts are marked with file paths, commit hashes or command output. Anything I inferred rather than
observed is labelled **ASSUMPTION**.

---

## 1. Original project identity

MBIRA was specified as a **playable, physically modelled virtual mbira**, built once and shared by
a Windows standalone application and a VST3 instrument, with Elementary Audio JavaScript DSP running
through a native C++ runtime (`docs/MBIRA-SPEC.md` §0, §1.1).

Priorities, in the spec's own order (`docs/MBIRA-SPEC.md` §0):

1. A convincing, playable instrument.
2. Real-time safety and correctness.
3. Honest documentation.
4. Infrastructure, portability, numerical targets — last.

Original first scope (`docs/MBIRA-SPEC.md` Part A §1):

- Mbira dzaVadzimu and Nyunga Nyunga only.
- A convincing physical-model-first sound.
- Elementary JS DSP through the native C++ runtime.
- Standalone Windows app first, eventual VST3.
- **Evaluation by an actual mbira player** before more ambitious features.

**The milestone gate is an explicit project requirement.** Part A §1: *"Your scope in this session
is Milestone 0 and Milestone 1 only … When Milestone 1 is finished, or you are blocked, stop and
report. Do not continue into Milestone 2 on your own, even if every gate passed."* Part B §0
`[Amended]`: *"Part A decides which milestones you work on in a given session. Stop at the end of
that scope and report."* M1's own gate (§2.1): *"Passing the technical items does not authorise
moving on: stop and report so the human can listen."*

Two further standing requirements matter for this audit:

- §8 defines a documentation set (root `README.md`, `docs/architecture.md`,
  `docs/manual-test-results.md`, `docs/recording-brief.md`, `docs/future-hybrid-engine.md`,
  `HANDOFF.md`).
- §8 on the future sample engine: *"documentation only … **Do not implement** sample playback,
  import, editing, blending, hybrid modes, or sample-specific UI."*

**Milestone map (Part B):** M0 feasibility gate → M1 playable proof of concept + direct-VST3
decision (stop) → M2 instrument and sound design → M3 playable interface.

---

## 2. Current reality

### 2.1 Repository state

- Branch `ui/visual-first-assignment`, tracking `origin/ui/visual-first-assignment`, working tree
  clean except three **untracked** directories: `MBIRA Agent Prompt and Master Specification.md`,
  `MBIRA-M1test/` (a snapshot bundle: `mbira-poc.exe`, `MBIRA.vst3`, M1 WAVs, `how-to-run.md`),
  `spike/` (WebView2 spike sources + `WebView2Loader.dll`).
- `main` is 9 commits behind and points at `a7051f8` (merge-base confirmed). All post-M1 UI work
  lives only on the feature branch.
- 27 commits total, `7e1495b` (M0) → `6293c17` (HEAD).

### 2.2 It builds and it makes sound (verified in this audit)

| Check | Command | Result |
|---|---|---|
| JS tests | `npm test` | `mbira-dzavadzimu.json: 24 keys … OK`; `nyunga-nyunga.json: 15 keys … OK`; DSP sanity `{"peak":0.3757,"ratio_1s_to_0":0.467}` — **pass** |
| Native build | `cmake --build build-native` | incremental link of `vst3/MBIRA.vst3` succeeded, no errors |
| Offline render, HEAD DSP | `./build-native/mbira-poc render $TMPDIR/audit-head.wav tests/events/note-soft.json --duration 4` | `Instrument: Mbira dzaVadzimu (24 keys)` … `peak_dbfs=-18.53`, `audio_loop_cpu_percent=3.68` |
| Offline render, phrase | `./build-native/mbira-poc render $TMPDIR/audit-phrase.wav tests/events/phrase.json --duration 5` | `peak_dbfs=-5.26`, 6.65 % audio-loop CPU; L/R samples **bit-identical** (max abs diff 0 over 240 000 frames) |
| Live standalone + WebView2 UI | `./build-native/mbira-poc live --quit-after 8` | `Audio device: Primary Sound Driver`; `MIDI: port 0 = microKEY-37 1 KEYBOARD 0`; `WebView2 UI: Z:\github\MBIRA\ui`; `build/liveui.log` shows `NavigationCompleted success=1`, `ui.ready` received, `tines:21, nav:5` |

The app therefore genuinely runs: the real Elementary runtime renders audio, the WebView2 window
loads `ui/index.html` from the virtual host `mbira.local`, and a MIDI port is detected.

### 2.3 There are two different user interfaces

| | `src/native/ui.h` (GDI/Win32 interim panel) | `ui/` (WebView2, **default**) |
|---|---|---|
| Selected by | `--ui gdi` | default (`webview_ui.h`), embedded since `46de4e2` |
| Keyboard geometry | from the loaded instrument JSON (`main.cpp:386 uiState.geom = g_geom`) | **hard-coded 21 tines**, `ui/js/layout.js` `SCALE = [48…83]`, 3 rows × 7 |
| Controls reaching DSP | pluck, master, soundboard, gourd, buzz, 3 macros, ADSR/LFO/random/velocity rows, cantilever/classic toggle | **only `master` + `macro.resonance` + `macro.buzz` + `macro.brightness`** |
| Status | geometry + note highlight | no host→UI messages at all (see 6.x) |

### 2.4 What the default UI actually drives

`ui/index.html` declares 11 `data-param` controls:
`macro.resonance, macro.buzz, macro.brightness, master, mode1, mode2, mode3, fx.reverb.decay,
fx.delay.feedback, fx.drive.warmth, fx.spatial.width`.
`src/native/webview_ui.h::dspAccepts()` allow-lists exactly 19 names and drops everything else with
a one-time `provisional (no DSP mapping yet, UI-only)` log.

- Reaching DSP: `master`, `macro.*` (4 of 11).
- Dropped at the native bridge: `mode1-3`, the four `fx.*` (7 of 11), plus `blend.engine`
  (`ui/js/controls.js::mountBlend`) and `layer.*.mute/solo` (`ui/js/main.js`).
- **The preset `<select>` has no event listener anywhere in `ui/js/*`** — it is inert, and even if
  wired, `handleUiMessage()` treats `preset.*` / `instrument.select` as `// informational; ignore
  (no-op)`.
- The **Body & Deze page contains zero inputs** (verified: no `<input>`, no `data-param` inside
  `[data-page="body"]`) — soundboard, gourd and buzz have no control in the default UI.
- `ui/js/main.js` has handlers for `param.state` and `status`, but **`src/native/main.cpp` never
  calls `wvSendHost()`/`PostWebMessageAsJson`** — only the 30 Hz peak telemetry inside
  `webview_ui.h`. So Voices / CPU / MIDI in the status bar are static literals
  (`0 / 37`, `—`, `MIDI: unverified`), and MIDI input cannot highlight a tine in the WebView UI.
- The "Realtime Scope" (`ui/js/controls.js::mountTelemetry`) draws a synthetic
  `sin(...)` waveform; only the meter uses real host peaks.

---

## 3. Milestone history

All timestamps are commit dates (Appendix A holds the full `git log`).

| When | Commit | What it claims / what it establishes |
|---|---|---|
| 11-06 06:28 | `7e1495b` | **M0**: spec saved, environment report, Elementary source investigation, **GO WITH CONSTRAINTS** verdict |
| 11-06 10:03 | `a016058` | M1 DSP graph, esbuild bundling, native host, CMake; offline sanity passes |
| 11-06 13:17 | `5d4f28b` | **M1 GATE 1 passed** — real Elementary 3-mode tine through the native host; latency/CPU evidence; WAVs + manifest |
| 11-06 13:49–14:07 | `4f225f5`, `074c729` | licence texts verified; Ableton host-test checklist written |
| 11-06 14:48 | `c9e5aea` | **M1 VST3 spike**: validator 47/47, smoke host real audio; `todo.md` records *"M1 COMPLETE - STOPPING per Part A section 1"* |
| 11-06 14:57 | `088cfa1` | fix: VST3 statically linked — *"hosts could not load DLL deps"*; re-verified validator 47/47 |
| 11-06 15:13 | `092668c` | fix: **WAV fmt chunk malformed** — *"files would not play in strict players/DAWs"*; **all evidence WAVs re-rendered** |
| 11-06 22:26 | `f1e5ea8` | fix: `libwinpthread-1.dll` missing — exe would not run outside the build PATH |
| 11-06 22:46 | `efb427a` | fix: RtAudio compiled with a non-existent backend macro — *"live mode was RtApiDummy with no devices"*; DirectSound now works, MIDI port detected |
| **11-07 01:45** | `644cf07` | **first post-M1 commit**: WebView2 UI scaffold `ui/` |
| 11-07 01:53–02:12 | `7f4a61e`, `af8d5c6`, `98c5d6e`, `a7051f8` | **M2 core** (cantilever tine, shared body, 64 voices), GDI control panel, strobe fix, **JSON instrument definitions** — `a7051f8` is the tip of `main` |
| 11-07 06:15 | `bd2c86b` | UI checkpoint: *"STOPPED pending user signoff"* — this gate **was** honoured; `evidence/ui-checkpoint/wave1/HANDOFF.md:5` records signoff *"ok go · 2026-11-07"* |
| 11-07 06:19 | `3e69782` | **Modulator framework v1** (ADSR, LFO→master/pitch, random, velocity) + evidence WAVs |
| 11-07 07:07 | `d0f912c` | Identity lock: 3 macros in DSP, **mod matrix removed from roadmap** |
| 11-07 07:28–09:27 | `753830b`, `34a02a8`, `62f8cfd` | 5-page nav + re-skin, reconciliation (blend/macros/layers/FX rack), dev launcher |
| 11-08 00:05–00:10 | `46de4e2`, `6293c17` | embed reconciled `ui/` in the standalone via WebView2; todo updated |

### Was Milestone 1 genuinely verified?

- **Verified by the agent (from source):** the M0 threading analysis. I re-checked the two load-bearing
  claims against the vendored tree: `thirdparty/elementary/runtime/elem/builtins/Core.h:165,400`
  `static_assert(std::atomic<FloatType>::is_always_lock_free)` for `ConstNode`, and
  `runtime/elem/Runtime.h:329` *"This is intentionally called on the non-realtime thread"* with a
  lock-free `SingleWriterSingleReaderQueue` handoff (`Runtime.h:133,204,277-281`).
- **Verified in this audit:** build, offline render, live device open, WebView2 navigation, JS tests.
- **Never verified by anyone:** the listening judgement. `docs/manual-test-results.md` does not
  exist; nothing in the repo records a human ever having listened to the evidence WAVs.
- **Still UNVERIFIED:** Ableton host test (`docs/vst3-host-test-checklist.md` is entirely unticked),
  MIDI playing (a device is detected — `microKEY-37`, seen in my own live run — but no human play
  test is recorded), hardware/round-trip latency (explicitly out of scope of the measurement).

### The M1 "stop" was not a stable state

`todo.md` at `c9e5aea` already claimed *"M1 COMPLETE - STOPPING"*, yet three of the four M1
checklist boxes were still `[ ]`, and the three commits that followed prove M1 was not actually
finished at that point: the evidence WAVs did not play in strict players (`092668c`), the VST3 DLL
was not loadable by hosts (`088cfa1`), the standalone exe ran only with the build PATH (`f1e5ea8`),
and the standalone could not open an audio device at all (`efb427a`, live mode was `RtApiDummy`).

---

## 4. Last trustworthy baseline

**`efb427a` — "Fix: rtaudio compiled with wrong backend macro … live mode was RtApiDummy with no devices; now DirectSound works, MIDI port detected" (2026-11-06 22:46).**

Why this commit and not an earlier one:

| Candidate | Verdict | Reason |
|---|---|---|
| `5d4f28b` (M1 GATE 1) | rejected | gate 1 only — no VST3 spike, no licences, no host-test checklist, and the WAVs written at this commit were malformed |
| `c9e5aea` ("M1 COMPLETE - STOPPING") | rejected | the claim was premature: evidence WAVs malformed, VST3 DLL unloadable by hosts, exe not self-contained, live audio path dead — all four required fixes afterwards |
| **`efb427a`** | **accepted** | last commit at which everything M1 requires exists *and works*: fixed WAVs (`092668c`, untouched since — `git log -- evidence/wav` shows only `5d4f28b` and `092668c`), self-contained exe, host-loadable VST3, working DirectSound live mode, finished `docs/architecture-decision.md`, verified `LICENSES.md`, host-test checklist |
| `a7051f8` (tip of `main`) | rejected | includes the M2 DSP rewrite, instrument JSONs and GDI panel — M1 evidence is no longer reproducible from this tree (default modal ratios changed from `[1.0,2.6,4.2]` to cantilever `[1.0,6.27,17.55]`) |
| `6293c17` (HEAD) | rejected | +4 340 lines across 67 files since `efb427a` (`git diff --stat`), of which nearly all is post-gate UI/M2 scope |

**Important qualification:** no commit represents a *fully verified* M1, because the human-side
half of M1 (Ableton host test, listening) was never completed. `efb427a` is the last trustworthy
**agent-side** M1 baseline. To reproduce the M1 evidence exactly, check out `efb427a` and re-run
`docs/how-to-run.md`; HEAD will render a different sound.

---

## 5. Scope drift and contradictions

### 5.1 The gate was passed without a recorded approval (breach)

`efb427a..HEAD` = 9 commits, 4 340 insertions, 67 files. `git log --grep=approv` finds no approval
commit. The only authorisations recorded anywhere in the repo are:

- the UI checkpoint signoff (`evidence/ui-checkpoint/wave1/HANDOFF.md:5`, *"ok go · 2026-11-07"*) —
  which covers `753830b` and later UI waves, not the M2 DSP work;
- `todo.md:93` `DIRECTION (user, 2026-11-07)` for the Pigments modulator architecture;
- `todo.md:98` `IDENTITY LOCK (Design Agent Package 2)`.

Meanwhile `todo.md:19` still reads *"SESSION SCOPE (repeated): Milestone 0 + Milestone 1 only. STOP
at the end of M1"* and the checkbox `- [ ] STOP after M1 and report` is **still unchecked** at HEAD.
The project's own scope statement and its actual work have never been reconciled.

### 5.2 The modulator framework contradicts the instruction that commissioned it

- `todo.md:93` (user direction): *"Pigments-inspired MODULATOR architecture (velocity, key-map,
  ADSR, LFO, random sources → **any param**) … Design the modulator matrix + sample-layer engine
  before building presets/instrument switching."* → `3e69782` implemented ADSR/LFO/random/velocity
  as engine params (`src/dsp/index.js` `cfg.adsr/lfo/mod/random/vel`, `setParam` cases).
- `todo.md:98` (identity lock): *"NO modulator matrix, NO Mod page, ever."* → `d0f912c` removed the
  matrix from the roadmap.
- **The contradiction is written into the documentation itself.** `docs/how-to-run.md:99`: *"the
  WebView2 UI should build the full routing matrix on this param set"*; the same file,
  `docs/how-to-run.md:107`: *"per the locked identity there is NO modulator matrix in the UI"*.

**Evaluation:** the *engine-side* half of the direction (mod sources as parameters, defaults that
reproduce the M1 sound) is useful, cheap, and reversible — keep it. The *matrix UI* is not an
architectural mistake, it is simply cancelled. What is wrong is the **sequencing**: M2 §3 sound work
(whose gate is a listening session) was overtaken by M3 UI work, and both were overtaken by a
modulator system before the base instrument had ever been listened to. Per the recovery principles,
"technically interesting" is not a justification.

### 5.3 Engine blend and sample layers — a direct spec violation

`ui/js/controls.js::mountBlend` sends `blend.engine`; `ui/index.html` has a Physical↔Samples blend
slider, a **Samples page** with three named layers (`body_micA.wav`, `wood_knock.wav`,
`buzz_bottlecap.wav`), M/S buttons and `layer.*.mute/solo` messages. **No sample engine exists in
the DSP** (`el.sample` appears nowhere in `src/dsp/index.js`), and the bridge drops every message.

`docs/MBIRA-SPEC.md` §8 is explicit: the hybrid engine is *documentation only*, *"Do not implement
sample playback, import, editing, blending, hybrid modes, or sample-specific UI."*
`todo.md:100` marks this as still-pending DSP work.

**Evaluation:** the honest empty-state note on the page ("sample engine arrives M3 when the
Zimbabwean recordings land") mitigates the user-facing harm, but the *control itself* is a
spec contradiction and it reads as functional in `evidence/standalone/native-host.png` (blend at
100). **Remove the blend slider and the M/S controls now; keep the page as an empty state or delete
it.** Sample playback stays documentation-only until the player's recordings exist and the human
approves.

### 5.4 FX rack — invented, not specified, not implemented

Four FX controls (`fx.reverb.decay`, `fx.delay.feedback`, `fx.drive.warmth`, `fx.spatial.width`)
plus per-FX enable toggles and a "+" insert slot. There is **no effects code anywhere in
`src/dsp/index.js`**. The spec's control contract (§5.3) has no effects at all.
`todo.md:76` records them as *"UI-only for now … adding them = sound-generation work, locked"*.

**Evaluation:** premature experiment, not an architectural mistake — but it is UI advertising a
capability the instrument does not have. Pause; hide until there is a demonstrated musical need.

### 5.5 The 21-tine UI contradicts both instrument definitions and the spec

- `ui/js/layout.js` hard-codes 21 notes in C major (`SCALE = [48 … 83]`, 3×7) and a QWERTY map
  built on that grid. `main.js` never reads host geometry; `handleUiMessage()` ignores
  `instrument.select`.
- The instruments are `mbira-dzavadzimu.json` = **24 keys / 3 ranks** and `nyunga-nyunga.json` =
  **15 keys / 2 ranks** (verified by `npm test` and by parsing both files: keys 48–88 and 60–84).
- Spec §5.2 requires *"distinct 24-key and 15-key layouts"* driven from the JSON; §4.2 requires a
  documented 24-key three-rank layout.
- `docs/how-to-run.md:79` claims *"The keyboard layout in the UI comes from the loaded instrument's
  schematic coordinates"* — **true only of the GDI panel** (`main.cpp:386`), **false of the default
  WebView UI**.
- Commit `a7051f8` advertises a *"geometry-driven UI keyboard"*; that property exists only in
  `src/native/ui.h`.

Net effect: in the shipped UI the instrument is always visually the same 21-key board regardless of
which definition is loaded, and MIDI notes 84/86/88 (dzaVadzimu) cannot be played or seen.

**Evaluation:** the most consequential contradiction in the project, because it breaks the spec's
central promise (an instrument that *is* its JSON definition) and it is a prerequisite for the
player evaluation — a 21-key C-major board tells an mbira player nothing.

### 5.6 Presets and the control contract

- Spec §5.4 requires two factory presets with an explicit parameter mapping. The UI shows four
  differently-named presets with **no listener**; the host ignores `preset.load`.
- The engine's parameter namespace no longer matches §5.3 (spec → actual):
  `excitation.pluckPosition`→`pluckPos`; `tine.decayMultiplier`→**absent** (no decay control in the
  default UI or `setParam`); `tine.brightnessTilt`→`macro.brightness`; `soundboard.amount`→
  `soundboard` + `macro.resonance`; `gourd.enabled`→**absent as an enable** (only `gourdAmount`);
  `gourd.amount/character`→`gourdAmount/gourdFreq`; `buzz.intensity/character`→`buzzIntensity`/
  `buzzChar` (present in DSP, absent from the WebView UI).
- Defaults drifted without a documented reason: soundboard 0.5→0.35, pluck 0.5→0.30, gourd
  Off→0.30, buzz 0.2→**0.0** (see §7.1).

**Evaluation:** the namespace drift is acceptable *if* §5.3 is re-issued as the actual contract;
right now two documents disagree about what the instrument's controls are.

### 5.7 Project structure and documentation drift

- Spec §7 layout: `src/ui/`; actual: `ui/`. Spec §7 command set: `npm run build`, `build:vst3`,
  `dev`, `test`, `lint`, `format`; actual `package.json` has only `build:dsp`, `test`,
  `test:instruments` (no lint/format scripts exist at all).
- Required by §8 and **missing**: root `README.md`, `docs/architecture.md`,
  `docs/manual-test-results.md`, `docs/recording-brief.md`, `docs/future-hybrid-engine.md`,
  `HANDOFF.md`. Present: `docs/MBIRA-SPEC.md`, `docs/architecture-decision.md`,
  `docs/how-to-run.md`, `docs/vst3-host-test-checklist.md`.
- Work is being driven by a document that **does not exist in the repo**:
  `evidence/ui-checkpoint/HANDOFF.md:28` records *"`docs/DESIGN-AGENT-PACKAGE.md` DOES NOT EXIST in
  the repo — reported, not invented"*, yet `todo.md:98` and `753830b` both cite "Design Agent
  Package". The authorisation trail for the largest UI change is external and unverifiable.
- `docs/vst3-host-test-checklist.md:4` names `build-vst3/mbira-dzavadzimu.vst3`; the real output is
  `build-vst3/vst3/MBIRA.vst3` (`evidence/vst3-spike.md`). A human following the checklist would
  not find the plugin.
- `todo.md` hygiene: line 81-82 claims *"`src/dsp/index.js` currently gutted to a 1-line M2 rewrite
  marker"* — false (463 lines, committed); line 92 `- [ ] 4: instrument JSONs …` is unchecked while
  line 96 checks the same item; the M1 checklist boxes remain `[ ]` under a "M1 COMPLETE" status.
- `ui-preview.png` at the repo root is a stale screenshot of an earlier 9-tine scaffold, superseded
  by `evidence/standalone/native-host.png`.

---

## 6. Feature inventory

Status key: **V** implemented and independently verified here · **P** implemented, not independently
verified · **PART** partial · **UI** UI-only/placeholder · **DOC** documented but not implemented ·
**B** broken or untested · **U** unknown/unverifiable without hardware or a human.

### DSP and physical modelling

| Feature | Status | Evidence |
|---|---|---|
| Elementary JS renderer → native runtime path | **V** | renders at HEAD (`peak_dbfs=-18.53`); `build/dsp-bundle.js` from `src/dsp/index.js` |
| 3-mode plucked tine, decaying | **V** | `npm test` sanity ratio `0.467` at 1 s; `src/dsp/index.js:161-170` |
| Modal ratios physically plausible | **PART / U** | cantilever set `[1.0,6.27,17.55]` derived from clamped-free beam eigenvalues (documented in `index.js:19-26`), per-key overrides present; **no measurement of a real tine, no listening** |
| Excitation (velocity amp/brightness, pluck position, deterministic variation) | **P** | `computeGains()` `index.js:131-148`; A/B WAVs `evidence/wav-m2/*`; not independently listened to |
| Soundboard (shared 5-band bank, state persists) | **P** | `buildBodyChain()` `index.js:196-210`, stable keys; `macro-res-*.wav`; **no test that two notes excite one body state** (spec §3.3) |
| Gourd/deze | **P / U** | comb+bandpass `index.js:212-220`, always on by default (`gourdAmount 0.30`); no on/off A/B evidence in the repo |
| Buzz | **B — effectively dead** | see §7.1 |
| Voice allocation / polyphony (64 pool, sustain, stealing) | **PART / B** | pool + CC64 + steal order implemented (`index.js:264-302`); **no steal/overlap/sustain test suite** (`todo.md:91` unchecked); `stealIfNeeded()` counts "active" as `trig > 0`, which is never reset on note-off |
| MIDI note handling (offline) | **V** | JSON event files drive every render |
| MIDI input live | **P/U** | port 0 `microKEY-37` opens in my live run; no recorded human play test |
| MIDI output | **DOC/not present** | no `RtMidiOut` in `main.cpp` |
| Parameter changes during sustained audio | **V (M1), P (M2)** | `evidence/wav/param-sweep.wav` + manifest RMS table; M2 macro/mod WAVs exist but have **no manifest** |
| Per-instance DSP isolation (VST3) | **V (code-level)** | `MbiraProcessor` owns `std::unique_ptr<Engine> engine; EventBridge bridge;` — no shared statics |
| Real-time audio safety | **P** | architecture analysis corroborated in the vendored runtime (§3); **not** re-verified under load: every `noteOn`/`setParam` triggers a full JS re-render (`renderAll()`) on the service thread, cost unmeasured at 64 voices |
| Sample-rate / block-size handling | **V (render)** | `--rate/--block` render flags work; VST3 `setupProcessing` tears down the engine on SR/BS change (`MbiraPlugin.cpp`) |
| Denormals, peak ≤ −0.5 dBFS, noise floor ≤ −80 dBFS | **U** | no evidence in the repo; measured phrase peak was −5.26 dBFS (within target, single sample) |

### Instrument definitions

| Feature | Status | Evidence |
|---|---|---|
| 24-key dzaVadzimu, 15-key Nyunga, 3/2 ranks, schema validation | **V** | `npm test` output; JSON parses to 24/15 keys, ranks {1,2,3}/{1,2} |
| Tunings reflect real instruments | **U — known-provisional** | both files are equal-tempered C major; `provisional: true`; spec §4.3 amendment says this "will likely sound wrong"; question never answered |
| Instrument config actually affects audio | **V** | `loadInstrument()` rebuilds pool/overrides/body (`index.js:312-348`); `evidence/wav-m2/inst-dzavadzimu.wav` vs `inst-nyunga.wav`; host prints `Instrument: Mbira dzaVadzimu (24 keys)` |
| Instrument switching from the UI | **B** | `instrument.select` is a bridge no-op; only `MBIRA_INSTRUMENT` env works |

### Native application and plugin

| Feature | Status | Evidence |
|---|---|---|
| Windows standalone | **V** | live run: device opened, WebView2 loaded (Appendix A) |
| WebView2 integration | **V** | `build/liveui.log`: `NavigationCompleted success=1`, 21 tines/5 nav, 0 JS errors claimed in `todo.md:71-73` |
| Audio device handling | **PART** | default DirectSound device only; **no device/sample-rate selection UI** (spec §5.2 standalone controls) |
| `--quit-after` | **B** | ignored when the WebView UI blocks the message loop — my `--quit-after 8` run had to be killed at 120 s |
| VST3 loads and produces audio | **V** | validator 47/47, smoke host `peak_dbfs=-10.72` (`evidence/vst3-spike.md`) |
| VST3 parameter automation | **DOC/not implemented** | `MbiraPlugin.cpp`: `if (data.inputParameterChanges) { /* no automatable params yet */ }` |
| VST3 state save/restore | **DOC/not implemented** | `getState`/`setState` both `return kNotImplemented;` |
| VST3 editor / WebView2 child window in `IPlugView` | **DOC/not implemented** | no `IPlugView` in `MbiraPlugin.cpp`; `evidence/vst3-spike.md` marks it NOT tested (deliberately out of M1 spike scope) |
| Ableton host test | **U (blocked on human)** | checklist entirely unticked |

### UI

| Feature | Status | Evidence |
|---|---|---|
| Master + 3 macros → DSP | **V** | `dspAccepts()` allow-list; verified over CDP in `todo.md:71-73` |
| Preset dropdown | **UI — inert** | no listener in `ui/js/*`; host ignores `preset.load` |
| Engine blend slider | **UI** | `mountBlend` → dropped by bridge |
| FX controls + enable chips | **UI** | `fx.*` → dropped |
| Sample layer strip (M/S) | **UI** | `layer.*` → dropped; page carries an honest "placeholder" note |
| Mode 1–3 faders | **UI** | `mode1-3` → dropped (GDI panel has real equivalents) |
| Body & Deze controls | **UI — none exist** | zero inputs on that page |
| Scope | **UI (synthetic)** | `mountTelemetry` draws `sin(...)`, not samples |
| Voices / CPU / MIDI status | **UI (static)** | host never posts `status` |
| Tine highlight from MIDI input | **B in WebView** | host never posts `note.state` |
| 5-page nav, keyboard, QWERTY, panic | **V** | `evidence/ui-checkpoint/wave1/HANDOFF.md` CDP verification + my `liveui.log` (21 tines, 5 nav) |

---

## 7. Technical risks

**7.1 The Buzz control is dead in the default product path.**
`src/dsp/index.js:223` computes `bi = cfg.buzzIntensity * (2.0 * cfg.macro.buzz)`. The instrument
JSON sets `"buzz": {"intensity": 0.0}` (`src/instruments/mbira-dzavadzimu.json`), so
`bi === 0` → `tanh(0) = 0` → the buzz branch contributes silence regardless of `macro.buzz`.
The WebView UI's **only** buzz control is the "Buzz Rattle" knob (`macro.buzz`); it has no
`buzzIntensity` fader (the GDI panel does). Result: the mbira's defining timbre is inaudible in the
shipped UI, and the knob appears to do nothing. Spec §5.3 default is `buzz.intensity = 0.2`.

**7.2 The bridge silently drops most of the UI.** 7 of 11 `data-param` controls plus `blend.*` and
`layer.*` never reach the DSP (`webview_ui.h::dspAccepts`), each logged once as "provisional". The
UI presents these as live controls; there is no visual "disabled" state.

**7.3 Host → UI channel is empty.** `src/native/main.cpp` never calls `wvSendHost()`; only 30 Hz
peak telemetry is posted (from `webview_ui.h` WM_TIMER). Consequences: no MIDI tine highlight, no
CPU/voice readout, no parameter echo for automation/state restore (spec §5.2, §5.3 all require
these). `ui/js/main.js` already listens for `param.state`/`status`/`note.state` — the UI half exists
and does nothing.

**7.4 The VST3 cannot meet §2.2 in its current form.** No parameters, `kNotImplemented` state, no
editor. Any DAW host test will fail items 3–6 of the checklist regardless of how good the DSP is.
This must be stated plainly rather than carried as "M1 verified".

**7.5 Note-on cost scales with the whole graph.** Every `noteOn`, `noteOff` and `setParam` calls
`renderAll()`, which re-renders all 64 voice graphs plus the body chain and JSON-serialises the
batch (`index.js:238-257`, `noteOn` → `renderAll()` at line 363). M1 measured latency only in the
offline render loop; the live path (MIDI thread → queue → service-thread JS render →
`applyInstructions` → audio thread) has **no measured note-on latency**. Under fast playing this is
the most likely source of jitter, and it is untested.

**7.6 Stereo is nominal.** L and R were bit-identical across a 5-second phrase render (Appendix A).
The spec asks for stereo output; the body chain is mono-summed and mirrored, so there is no spatial
information in the gourd/soundboard at all.

**7.7 Untested voice management.** No steal/overlap/sustain suite; `POLYPHONY_CAP` logic has never
been exercised at the cap in any recorded evidence.

**7.8 Licence and packaging loose ends.** VST3 SDK dual licence (GPLv3 / Steinberg agreement) still
open (`LICENSES.md:19-22`); `choc` is recorded as **ISC** in `LICENSES.md:9` but **BSD-3-Clause** in
`deps/manifest.json:37`; WebView2 redistribution terms unverified; the checklist points at a plugin
path that does not exist (§5.7).

**7.9 Authorisation trail is external.** Decisions reference `docs/DESIGN-AGENT-PACKAGE.md`, which
is not in the repo. Future audits (or a future you) cannot reconstruct why the UI looks like this.

---

## 8. Musical risks

**8.1 Nobody has listened yet.** This is the single largest risk. `docs/manual-test-results.md`
does not exist, the M1 checklist is unticked, and no mbira player has been involved. Every claim
about sound quality in the repo is the agent describing its own renders.

**8.2 The tuning is a placeholder on both instruments.** Both JSONs are equal-tempered C major
(dzaVadzimu 130.81–1318.51 Hz, Nyunga 261.63–1046.5 Hz). Spec §4.3 amendment: *"This placeholder
scale will likely sound wrong to a Zimbabwean player."* The tuning question from amendment 4.9 has
been open since M1 and is still open (`todo.md:77`). A player asked to evaluate this instrument
will hear a chromatic scale, not their instrument.

**8.3 The sound changed materially after the last evidence set.** The default modal ratio set moved
from the M1 placeholder `[1.0, 2.6, 4.2]` to the cantilever set `[1.0, 6.27, 17.55]` with new taus,
the master gain moved to the bus, and an ADSR/sustain stage was inserted — but no listening session
is recorded against the new sound, and `evidence/wav-m2/` has **no recording manifest** (spec §2.1
requires one for every WAV).

**8.4 Buzz, and possibly gourd, are absent or untested in the default sound.** See §7.1. The
deze buzz is the signature of mbira music; with `buzz.intensity = 0.0` the default patch cannot
produce it.

**8.5 Modal ratios are physics-derived, not measurement-derived.** The cantilever ratios are
defensible beam theory (a real improvement over the bare guess in M1), but a real mbira tine is
struck, damped by finger and mount, and radiates through a bridge — the actual mode ratios, damping
times and the pluck-position response have never been measured or checked by ear against a real
instrument. Treat `index.js:19-26` as an informed hypothesis.

**8.6 Body coupling is not modelled.** One shared 5-band resonator bank + comb + amplitude-gated
tanh rattle is an approximation (spec §3.3 says so), and there is no sympathetic interaction
between tines. Acceptable for now — but it must be labelled PROVISIONAL wherever it is shown, and
the "deze behaviour … to be verified with recordings" note currently on the Body page should not be
removed.

**8.7 The playing surface does not match the instrument.** A 21-key C-major 3×7 grid with QWERTY
mapping cannot convey rank layout, key count or physical affordance of either instrument (§5.5).
A player cannot evaluate feel from it.

**8.8 Modulator defaults are unverified against the M1 sound.** `docs/how-to-run.md:97` claims
*"Defaults reproduce the M1 sound exactly (within ~0.4 dB)"* — a numerical claim, not a listening
claim, and per the spec's own priority list a number never outranks listening quality.

---

## 9. Recommended recovery direction

### Preserve (real engineering, do not throw away)

- The M0/M1 core: native host, QuickJS/Elementary integration, threading analysis, offline renderer,
  WAV manifest discipline, VST3 spike + smoke host (`evidence/vst3-spike.md`).
- `efb427a` as the M1 baseline (§4), and the M1 evidence WAVs as they stand.
- Instrument JSON + schema + validator (`src/instruments/`, `tests/instruments/validate.mjs`) —
  this is the right mechanism for tunings once real ones arrive.
- The engine-side modulator parameters (`adsr.*`, `lfo.*`, `mod.*`, `random.amount`, `vel.*`) as
  *engine internals*: cheap, defaulted to the M1 sound, and exactly what a future per-parameter mod
  strip would need.
- The 3 macros — the right number of user-facing sound knobs for now.
- Both UIs' good parts: the WebView visual language (tokens, pages, keyboard feel) and the GDI
  panel's full parameter coverage + instrument geometry. Keep `--ui gdi` as the engineer's panel.

### Pause (no further work until the next milestone passes)

- All UI waves beyond what exists (`ui/visual-first-assignment` stays as-is).
- FX rack, engine blend, sample layers, presets, preset browser.
- Modulator matrix / Mod page (already cancelled by the identity lock — make that cancellation
  consistent in `docs/how-to-run.md`, `todo.md` and the UI copy).
- Cross-platform, packaging, and any new infrastructure.

### Reconsider (correct against the spec before resuming)

- **The WebView keyboard must come from the instrument JSON** (spec §5.2, §4.2) — otherwise the UI
  cannot represent 24 or 15 keys, and the player cannot evaluate it.
- The parameter namespace and defaults: re-issue §5.3 as the actual contract, or restore the spec's
  IDs/ranges/defaults in code.
- The dead buzz path (§7.1) and the empty host→UI channel (§7.3) — both are small, well-localised
  defects that block the instrument's core identity and its playability.
- The VST3 parameter/state/editor gap (§7.4): either schedule it as real M3 work or stop describing
  the VST3 as verified.

### Eventually remove

- `blend.engine` slider and `layer.*` M/S controls; the "+" FX insert; the synthetic scope (replace
  with real samples or delete); stale `ui-preview.png`; the inert preset dropdown (until presets
  exist); `todo.md` entries that are now false (lines 81-82, the duplicate line 92).

### One process change

The gate worked once (the UI checkpoint stopped for signoff and got an explicit "ok go"). Make it
the rule again: **no commit may cross a milestone boundary without a recorded approval** — and keep
every driving document (`DESIGN-AGENT-PACKAGE.md` etc.) inside the repo so the trail is auditable.

---

## 10. Proposed next milestone

### Milestone L — "The listening set" *(one small milestone, then stop)*

**Purpose:** put a real, documented, reproducible sound in front of a human and, through them, an
mbira player — before any further UI, modulation or sample work.

**Scope (and nothing else):**

1. **Tag the baseline.** Record `efb427a` as the M1 baseline (annotated tag or a line in
   `docs/architecture-decision.md`) so M1 evidence stays reproducible while the DSP keeps moving.
2. **Manifest for `evidence/wav-m2/`.** Same fields as `evidence/RECORDING-MANIFEST.md` (rate,
   block, events, params, render duration, deterministic seed, native-path statement) — spec §2.1
   requires it for every WAV and it is currently missing for 17 files.
3. **One short listening pack, rendered from HEAD, ~10 WAVs total**, each with a one-line description
   of what to listen for:
   - soft/hard note and a short phrase on **each** instrument (4);
   - buzz **off vs on** and gourd **off vs on** A/B on one phrase (4) — this forces §7.1 to be
     answered with evidence: if buzz is inaudible at the instrument's default, that is a finding,
     not a failure;
   - pluck position 0.0 vs 0.5 vs 1.0 on one repeated note (needs a 2-line event file) (3).
4. **A one-page listening checklist** for the human (and, if possible, the mbira player): what is
   provisional, what to compare against a real instrument, and the tuning question from amendment
   4.9 written out concretely (note names or Hz for both instruments).
5. **Fix only what that listening identifies** — no new features, no UI work. Candidate fixes if
   they block listening: the dead buzz macro (§7.1) and the missing wav-m2 manifest.

**Explicitly out of scope:** UI changes, modulation work, sample/blend/FX, VST3 work, refactors,
new infrastructure.

**Exit criteria:** WAVs + manifest + checklist exist at a known commit; the human has listened and
recorded the result in `docs/manual-test-results.md`; the tuning question and the buzz default have
answers; the project stops and waits for that feedback before any M2/UI work resumes.

**Why this milestone:** it is the smallest step that re-establishes the project's actual priority
order ("the instrument's sound is the product"), it reuses existing tooling (`mbira-poc render`,
event JSON files, the manifest format), it converts two open risks (§7.1, §8.2) into decisions, and
it restores the stop-gate discipline the specification demands.

---

## Appendix A — commands run and exact results

All commands run from `Z:\github\MBIRA` on Windows 10, git-bash, 2026-11-08.

```
$ git status
On branch ui/visual-first-assignment … nothing added to commit
Untracked: MBIRA Agent Prompt and Master Specification.md, MBIRA-M1test/, spike/

$ git log --oneline            # 27 commits, 7e1495b → 6293c17 (full list in §3)
$ git log --oneline main       # tip a7051f8
$ git merge-base main ui/visual-first-assignment
a7051f88f52fe5d9fe9a2f4050236c016c553191
$ git log --oneline -- src/dsp/index.js   # 6 commits; first 7f4a61e, last d0f912c
$ git log --oneline -- evidence/wav       # 5d4f28b, 092668c (only)
$ git diff --stat efb427a..HEAD           # 67 files, 4340 insertions(+), 93 deletions(-)

$ npm test
mbira-dzavadzimu.json: 24 keys, 24 declared, OK
nyunga-nyunga.json: 15 keys, 15 declared, OK
all instrument definitions valid
{"peak":0.3757,"rms0_50ms":0.1468,"rms1s":0.0685,"rms2s":0.0297,"ratio_1s_to_0":0.467}

$ cmake --build build-native
[1/1] Linking CXX shared library vst3\MBIRA.vst3\Contents\x86_64-win\MBIRA.vst3

$ ./build-native/mbira-poc render $TMPDIR/audit-head.wav tests/events/note-soft.json --duration 4
Instrument: Mbira dzaVadzimu (24 keys) from src/instruments/mbira-dzavadzimu.json
peak_dbfs=-18.53
{"mode":"render","rate":48000,"block":256,"duration_s":4.00,
 "latency_ms":{"median":0.0000,"worst":0.0000,"n":1},"audio_loop_cpu_percent":3.680}

$ ./build-native/mbira-poc render $TMPDIR/audit-phrase.wav tests/events/phrase.json --duration 5
peak_dbfs=-5.26  … audio_loop_cpu_percent 6.651
  python3 (wave/array): frames 240000 ch 2 sr 48000
  rmsL 0.100852  rmsR 0.100852   max abs L/R sample diff: 0   differing frames: 0 of 240000

$ ./build-native/mbira-poc live --quit-after 8      (killed at 120 s — see §7 "B")
Audio device: Primary Sound Driver
MIDI: port 0 = microKEY-37 1 KEYBOARD 0
WebView2 UI: Z:\github\MBIRA\ui
$ cat build/liveui.log
[wv2] navigating to https://mbira.local/index.html
[wv2] ContentLoading navId=2
[wv2 ui->host] {"v":1,"type":"ui.ready","id":1,"payload":{"protocol":1,"build":"ui-mock-0.2"}}
[wv2] NavigationCompleted success=1
[wv2] ExecuteScript … {"title":"MBIRA","tines":21,"nav":5}

$ grep is_always_lock_free thirdparty/elementary/runtime/elem/builtins/Core.h
165:  static_assert(std::atomic<FloatType>::is_always_lock_free);
400:  static_assert(std::atomic<FloatType>::is_always_lock_free);
$ grep -n "intentionally called on the non-realtime thread" …/runtime/elem/Runtime.h
329: // This is intentionally called on the non-realtime thread.
$ grep -n "SingleWriterSingleReaderQueue" …/runtime/elem/Runtime.h
133: SingleWriterSingleReaderQueue<…> rseqQueue;   (204 push, 277-281 pop)
```

Static-inspection checks (no execution): `ui/index.html` `data-param` inventory (11 names);
`[data-page="body"]` contains 0 `<input>` and 0 `data-param`; no `preset`/`select` listener in
`ui/js/*`; `webview_ui.h::dspAccepts()` allow-list (19 names); `main.cpp` contains no
`wvSendHost`/`PostWebMessageAsJson`/`note.state`/`status`; `MbiraPlugin.cpp` `getState`/`setState`
= `kNotImplemented`, `inputParameterChanges` = commented no-op, no `IPlugView`; no `el.sample` in
`src/dsp/index.js`; `docs/` contains exactly four files.

**Side effects of this audit:** two throwaway WAVs written to the scratch directory; an incremental
`cmake --build build-native` relinked the existing untracked build artefacts; one 120-second live
run of the standalone (window opened and was closed when the command timed out; no
`mbira-poc.exe`/`msedgewebview2` process remained). **No tracked file was created, modified or
deleted; no Git state was changed.**

## Appendix B — what could not be verified here

- **Listening:** I cannot hear. No claim about whether it sounds like an mbira is made anywhere in
  this document.
- **Ableton Live (and any DAW) host testing:** blocked on the human; the checklist is unticked and
  §7.4 says items 3–6 cannot pass with the current plugin.
- **MIDI performance with a real player:** a port opens (`microKEY-37`) but human playing was not
  observed in this audit.
- **Hardware latency / audio round-trip:** no loopback device; the spec forbids claiming it
  otherwise.
- **True 200 % DPI rendering:** flagged as an evidence gap in
  `evidence/ui-checkpoint/wave1/HANDOFF.md:53-56`.
- **Reproducing M1 evidence from HEAD:** impossible by design (DSP changed); requires
  `git checkout efb427a`.
