# MBIRA: Agent Prompt and Master Specification

Paste this whole document as the first message to the agent. **Part A** (sections 1 to 8) is the task for this session: Milestones 0 and 1 only. **Part B** (after section 8) is the full master specification, with my review amendments edited in and marked **\[Amended\]**.

---

## 1. Your task

You are the lead audio software engineer for **MBIRA**, a playable physically modelled virtual mbira built on Elementary Audio. The full specification is Part B of this document. Save it as `docs/MBIRA-SPEC.md` in the repo, then read all of it before doing anything else.

**Your scope in this session is Milestone 0 and Milestone 1 only:**

- **Milestone 0:** a dependency feasibility investigation.
- **Milestone 1:** a playable Windows proof of concept in a real C++ host, plus a verified VST3 hosting decision.

Do **not** build the full instrument, the instrument JSON definitions, the UI, the bridge, presets, or the plugin beyond what Milestone 1 needs. Those come in later sessions, after I confirm.

When Milestone 1 is finished, or you are blocked, **stop and report**. Do not continue into Milestone 2 on your own, even if every gate passed.

## 2. Precedence and how to read the spec

- Part B is the master specification, called "the spec" throughout Part A. Where Part A and Part B conflict, Part A governs scope and sequencing for this session, and Part B governs design detail.
- My review amendments are already edited into Part B and marked **\[Amended\]**. Section 4 below lists where each one lives. Keep the markers for now so I can review them.
- Priorities, in order: a convincing playable instrument; real-time safety and correctness; honest documentation; infrastructure and numerical targets. A number that does not correlate with sound quality never outranks listening quality.
- If the spec is ambiguous or contradicts itself, pick the most conservative reading, record the decision in `docs/architecture-decision.md`, and carry on. Ask me only when the answer would change the architecture.

## 3. Who does what

You cannot hear audio. I can. Split the work like this:

- **You:** build, run, measure, and write evidence. Produce rendered WAV files of defined test sequences. Produce a host-test checklist I can follow.
- **Me:** listen to the WAVs and the live standalone, judge whether it sounds and feels like an mbira, and run the VST3 in my DAW (I will name the host; assume Ableton Live on Windows unless I say otherwise).

**Your very first action is an environment report**, written to `todo.md` and repeated in your first message to me:

- OS and version, CPU, toolchain versions (compiler, CMake, Node, npm, git).
- Whether you can run executables, open an audio device, play sound, receive MIDI, and reach the network.
- Anything you will not be able to verify yourself.

Anything you cannot execute or observe is reported as **UNVERIFIED**. Never write that it works.

## 4. Where the amendments live

Each amendment is written out in full in Part B. Part A refers to them by these numbers.

- **4.1** Dependency feasibility gate: Part B §2.0.
- **4.2** Parameter gate (repeated changes during sustained audio): Part B §2.1, item 5.
- **4.3** Playability measurements (latency and CPU): Part B §2.1, items 7 and 8, and §1.3.
- **4.4** Exit conditions instead of time-boxes: Part B §1.1 and §2.2.
- **4.5** Shared soundboard boundary: Part B §3.3.
- **4.6** Gourd and buzz are approximations: Part B §3.3.
- **4.7** Modal ratios need justification: Part B §3.1.
- **4.8** UI priority over animation: Part B §5.1.
- **4.9** Tuning is an open question: Part B §4.3, and the questions in your final report.

Further clarifications added after a second review:

- **4.10** Verification boundary and editor spike scope: Part B §2.2 and §2.3.
- **4.11** Software versus hardware latency definition: Part B §1.3 and §2.1, item 7.
- **4.12** WAV reproducibility and manifest: Part B §2.1, after item 9.
- **4.13** A GO verdict does not skip the playable-audio gate: Part B §2.0.

Amendments 4.5 to 4.9 concern later milestones. Record them in `todo.md` now and apply them when you reach them.

## 5. Milestone 0: feasibility investigation

Do this first and alone.

1. Inspect the actual Elementary repositories and releases. Read source, official docs, and working examples. Never invent an API.
2. Fill in the records required by 4.1.
3. Establish, from source, the threading and real-time guarantees in spec §1.2. State plainly what is thread-safe, what is real-time safe, and where those differ. Document which thread runs graph construction, instruction application, parameter updates, `gc`, and `prune`.
4. Decide the JS execution model for the native host (spec A2). Prefer what the official Elementary native example uses. Add another runtime only if it is required and proven.
5. Write a short feasibility verdict at the top of `docs/architecture-decision.md`: **GO**, **GO WITH CONSTRAINTS** (list them), or **NO-GO** (state the evidence).

If the verdict is NO-GO, stop here and report. If it is GO or GO WITH CONSTRAINTS, **proceed to Milestone 1 without waiting**, unless the constraints change the architecture materially. In that case, report and wait.

## 6. Milestone 1: playable proof of concept

Follow spec §2.1 and §2.2 with the amendments above. In outline:

1. A minimal C++20/CMake Windows standalone with RtAudio (and RtMidi or similar for MIDI), running an Elementary graph produced by the DSP JS context from `src/dsp/`.
2. The graph is a decaying plucked tine with three damped modes, triggered by MIDI or by a documented test input.
3. One continuous parameter is adjusted repeatedly during sustained audio (4.2).
4. Measurements from 4.3.
5. Artefacts for me to evaluate:
   - rendered 48 kHz WAVs from the real native path where possible: a single soft note, a single hard note, a short overlapping phrase, and a ten-second parameter sweep during a sustained note;
   - a one-page "how to run and play it" with exact commands.
6. The direct VST3 spike under the exit conditions in 4.4. Compilation alone is not success. Write a host-test checklist covering load, audio at 44.1 and 48 kHz, MIDI, automation of the one parameter, state save and restore, and WebView2 child-window viability. I will run it in my DAW and report back.
7. Finish `docs/architecture-decision.md` as spec §2.3 describes, including verified licences. Never guess licence terms.

## 7. Working rules (reminders from the spec)

- Never invent APIs. Never claim untested results. Never present stubs, mocks, or placeholders as completed features.
- No allocation, blocking, file I/O, or arbitrary JS execution in the audio callback. Do not introduce unsafe synchronisation to get past a gate.
- Keep `todo.md` current with open items, gate status, and blockers. Commit in small logical steps when the environment allows.
- Pin versions and record checksums in `deps/manifest.json`. Do not hide native builds inside `npm install`.
- Do not skip ahead, and do not build past a failed gate.
- Use the corrected instrument ID `mbira-dzavadzimu` everywhere.

## 8. Final report format

End your session with a report in this order. Keep it plain and specific.

1. **Verdict:** Milestone 0 and Milestone 1, each marked PASSED, PASSED WITH CONSTRAINTS, FAILED, or UNVERIFIED, with one line of reasons.
2. **Evidence:** exact versions, commands, and outputs, with file paths to the WAVs and logs.
3. **Measurements:** latency and CPU tables from 4.3, with conditions.
4. **Threading findings:** the short version of what runs where, and any real-time risks you found.
5. **VST3 decision:** direct or JUCE fallback, with the evidence and the failed approaches, if any.
6. **What I must do:** the listening checklist and the host-test checklist.
7. **Blockers and risks.**
8. **Questions for me:** include the tuning question from 4.9.
9. **Proposed plan for Milestone 2**, not started.

Technical success (it renders, MIDI works, a parameter automates, VST3 loads, tests pass) does not establish musical success (it sounds like an mbira, feels natural to play, a player recognises its potential). Report only the technical results you actually verified, and leave the musical judgement to me.

# Part B: Master specification

This is the full MBIRA specification. Changes made after review are marked **\[Amended\]**. Section numbers carry a § prefix so they are not confused with Part A.

## §0. Role, goal, and working rules

You are the lead audio software engineer, DSP developer, and instrument designer for **MBIRA**. MBIRA is a playable virtual mbira. A Zimbabwean mbira player will evaluate it before multisample recordings exist.

**Deliverables:** a Windows-first standalone application and a VST3 instrument. Both must share one Elementary Audio DSP implementation.

**Priorities, in order:**

1. A convincing, playable instrument.
2. Real-time safety and correctness.
3. Honest documentation.
4. Infrastructure, portability, and numerical targets. These come last. A numerical target that does not correlate with sound quality never outranks listening quality.

**Working rules:**

- Work independently. Resolve uncertainties by reading actual source code, official documentation, and working examples.
- Never invent APIs. Never claim untested results. Never report placeholders, stubs, or mocks as completed features.
- Maintain `todo.md` throughout. Record open items, gate status, and blockers.
- Make small, logical commits when the environment permits.
- If the environment prevents execution, audio playback, MIDI input, or VST3 host testing, stop at that point and report it as a blocker. Do not claim the step passed.
- Respect each stop gate below. Do not build past a failed gate.
- **\[Amended\]** Part A decides which milestones you work on in a given session. Stop at the end of that scope and report, even if every gate passed.
- **\[Amended\]** You cannot hear audio. Report anything you cannot run or observe as UNVERIFIED. Produce rendered WAV files of defined test sequences and host-test checklists, so the human can evaluate sound and host behaviour.
- **\[Amended\]** The target DAW is Ableton Live on Windows, unless the human states otherwise. The human runs the DAW tests.

### Explicit assumptions (revise only with a documented reason)

- **A1. Instrument ID spelling.** The traditional name is *Mbira dzaVadzimu*. The original brief used `mbira-dzavdzimu`, which is a typo. Use the corrected ID `mbira-dzavadzimu` everywhere: file name, `instrument.id`, state, and tests. Record this decision in `docs/architecture-decision.md`.
- **A2. Elementary native runtime.** The native C++ runtime is expected to consume instruction batches produced by Elementary's JavaScript renderer. Verify this against source. If so, the native host must also run the trusted DSP JavaScript in some JS context. That context must be separate from the WebView (see §1.2). Treat the following only as candidates to verify, not as decisions:
  - an embedded JS engine already used by official Elementary native/plugin examples;
  - a mechanism the selected Elementary version provides directly.

  Adopt an additional runtime only if it is required and proven in the smallest working implementation.
- **A3. Note-off on a plucked instrument.** A real tine rings until it decays or is damped. The provisional behaviour is:
  - Note-off applies a gentle, configurable "finger damp" release, defaulting to roughly 150–300 ms to effective silence.
  - Note-off does not cut the note.
  - Sustain pedal defers this damping until pedal-up.
  - Natural decay frees the voice once it falls below a defined threshold.

  Document this lifecycle and mark it PROVISIONAL, pending the player's input.
- **A4. Gain staging.** Meeting the peak target (≤ −0.5 dBFS) must rely primarily on a documented fixed headroom and output gain. You may add a transparent safety limiter or soft clipper. If you do, document it, keep it inactive for normal playing, and report how often it engages in test sequences. It must not hide instability.
- **A5. Voice count.** `voices.max` (default 32, range 1–64) is a persisted, non-automatable instrument setting. Preallocate for 64. Apply changes off the audio thread.
- **A6. Test framework versions.** Use Vitest `1.2.2`. Use Catch2 `3.0.0` if that tag exists as a usable release. Otherwise use the nearest stable 3.x release (for example 3.0.1) and document the change. Use ESLint `8.56.0` and Prettier `3.2.5` unless compatibility requires a documented adjustment.

---

## §1. Architectural constraints

### §1.1 Stack

- **DSP.** Elementary Audio JavaScript signal graphs implement the instrument model. The standalone and the plugin must use the same DSP source files, instrument definitions, and parameter namespace. Native host adapters may differ.
- **Native.** Use C++20 and CMake for runtime hosting, audio/MIDI, standalone hosting, and plugin integration.
- **Plugin.** Investigate direct Steinberg VST3 SDK integration first. **\[Amended\]** This is bounded by the exit conditions in §2.2, not by a calendar time-box. If it cannot meet the spike criteria in §2.2, use a minimal JUCE CMake wrapper and document the precise reason. Do not use Projucer.
- **Standalone.** Prefer RtAudio for audio and RtMidi or another minimal suitable library for MIDI. Select and justify the actual dependencies during the proof of concept.
- **UI.** Use HTML/CSS/JavaScript embedded in a native WebView.
  - Target WebView2 on Windows first.
  - Design for WKWebView (macOS) and WebKitGTK (Linux), but do not implement those hosts yet.
  - Bundle release assets for offline use.
- **Build.** npm scripts orchestrate CMake.
  - Pin all dependencies and document prerequisites.
  - Dependency setup must be explicit and give actionable errors.
  - Do not hide a complex native build inside `npm install`.
- **JavaScript runtime.** Do not assume V8, QuickJS, or any other runtime (see A2). Use the execution model the selected Elementary integration actually supports.

### §1.2 Elementary runtime ownership and threading (mandatory)

Keep three contexts strictly separate:

1. **DSP JS context.** Loads only the trusted, source-controlled modules under `src/dsp/` and constructs Elementary graph instructions.
2. **Native Elementary audio runtime.** Renders audio.
3. **WebView JS context.** Renders the UI only. It sends validated parameter, preset, instrument, and note events through the native bridge.

Rules:

- Never execute DSP graph code supplied by WebView messages.
- The native host owns authoritative parameter state and forwards validated updates to the DSP context.

Before implementing continuous graph updates, inspect the actual Elementary runtime source and establish:

- the thread-safety guarantees of `Runtime::applyInstructions()` relative to `Runtime::process()`;
- whether graph instruction application, node construction, garbage collection, and resource destruction are real-time safe. Do not assume they are.

**\[Amended\]** This is the same investigation required by §2.0. Do it once and reference it from both places.

Document exactly which thread and context each of these executes on:

- graph construction;
- instruction application;
- parameter updates;
- `Runtime::gc()`;
- the corresponding JavaScript `Renderer.prune()`.

Preserve Runtime/Renderer synchronisation. Never perform potentially allocating or destructive operations inside the audio callback.

If concurrent graph updates are unsupported, identify a safe architecture that keeps audio processing uninterrupted, and prove it with evidence. Examples to evaluate (not assumptions):

- a double-buffered runtime with a lock-free swap;
- deferred destruction on a non-audio thread;
- driving continuous parameters via `el.const`/`el.sm` keyed nodes, versus via shared value mechanisms the runtime provides.

If no architecture satisfies the real-time requirements, stop and document the blocker. Do not introduce unsafe synchronization.

### §1.3 Real-time constraints

Verify that the chosen integration can meet each of these. Do not assume its graph and execution model can.

**Audio callback:**

- The audio callback must perform none of the following: arbitrary JS execution, graph compilation, memory allocation, blocking mutexes, filesystem operations, or UI work.
- Preallocate voices and audio buffers.
- Use atomics or bounded lock-free queues for cross-thread control and MIDI events.

**Parameter smoothing:**

- Smooth continuous audible parameters per parameter on the audio thread, normally over about 100 ms.
- Handle note events promptly, without waiting for that smoothing interval.

**Preset application:**

- Apply a preset as one coherent parameter snapshot at an audio-block boundary.
- Use a coordinated ramp of about 20 ms for continuous values, or a click-free immediate transition where appropriate. Handle discrete changes safely.
- Never expose partially applied preset states.
- Build or switch any required instrument graph off the audio thread.

**Output:**

- Stereo output.
- Finite, bounded samples.
- Denormal prevention (for example FTZ/DAZ on the audio thread plus DSP-level safeguards).

**Sample rates and block sizes:**

- Support 44.1 kHz and 48 kHz, with tests.
- Prepare and validate 88.2 kHz and 96 kHz where the environment permits.
- Handle sample-rate and block-size changes safely and preserve parameters.
- Rebuild off the audio thread where required.
- Measure transition/rebuild time and aim for 5 ms. Do not sacrifice correctness or fabricate a guarantee.

**\[Amended\] Latency and CPU (playability):**

- Measure and report software note-on-to-output latency and CPU load as specified in §2.1, items 7 and 8.
- Document the control-to-audio path a note event takes, thread by thread, and where latency is added.
- Provisional targets, which the human may revise after seeing real numbers: software note-on latency under one audio block plus 5 ms; CPU under 30% of one core at 32 voices (48 kHz, 256-sample block). If a target is missed, report the cause. Do not hide it and do not tune the test to pass.

If the verified integration cannot meet a non-negotiable constraint, document the evidence and stop at that gate. Do not build a fake substitute, and do not duplicate the DSP in C++.

### §1.4 Native/WebView bridge

Use a narrow, asynchronous message-passing bridge. Never expose general-purpose native objects. On Windows, investigate WebView2's web-message APIs (for example `PostWebMessageAsJson` / `WebMessageReceived`) and document the exact mechanism you verified. Future platform bridges must provide the same security properties.

**Schema:**

- Define a versioned, allowlisted message schema (`{ v, type, id?, payload }`) covering:
  - parameter reads and writes;
  - preset and instrument selection;
  - note-on and note-off;
  - device enumeration and selection;
  - status notifications (errors, device changes, current values, active-note highlights).

**Validation (native side):**

- Validate message type, origin, schema, IDs, numeric ranges, string lengths, and total payload size.
- Reject unknown operations and malformed or non-finite values. Log rejected messages in a rate-limited way.
- Never interpolate untrusted input into executable JavaScript, shell commands, file paths, or SQL.

**Navigation and access:**

- Restrict navigation and bridge access to the trusted bundled release UI, or to the explicitly enabled local development origin.
- Disable unnecessary WebView features.
- Deny unexpected external navigation, new windows, permission requests, and downloads.
- Provide no arbitrary filesystem, process, or native-code access.

**Queues and rate limits:**

- Bound all message queues.
- Coalesce high-frequency parameter updates, using latest-value-wins per parameter ID.
- Define overflow behaviour that can never leave notes stuck. For example:
  - note-offs are never dropped and take priority;
  - on note-queue overflow, issue an all-notes-damp.
- Never block or allocate in the audio callback.
- Perform device enumeration and changes off the audio thread.

**Development content:** treat development-server content as trusted developer code only. Never enable a development URL in release mode by default.

**Documentation:** in `docs/architecture-decision.md`, describe:

- the actual bridge mechanism;
- message schemas;
- origin checks;
- thread boundaries;
- queue limits;
- failure behaviour;
- a review covering injection, unauthorized navigation, malformed messages, and privilege escalation, with corresponding tests.

### §1.5 JUCE fallback boundary

JUCE is a fallback only for these problems:

- VST3 host integration;
- plugin lifecycle;
- parameter plumbing;
- editor hosting.

JUCE does not waive or resolve the Elementary runtime's real-time, threading, memory-allocation, or audio-processing requirements.

- If direct VST3 fails because of plugin-framework integration, evaluate the minimal JUCE wrapper.
- If the Elementary runtime itself cannot safely meet the audio-thread constraints, stop and document the evidence. Changing the plugin wrapper is not a solution to a DSP runtime limitation.

---

## §2. Milestone 1: prove the audio architecture first

Before building the instrument or any plugin framework, create `docs/architecture-decision.md` and implement the smallest working Windows proof of concept.

### §2.0 Dependency feasibility gate (Milestone 0) **\[Amended\]**

Before selecting any dependency, identify and record in `docs/architecture-decision.md`:

- the exact Elementary repository, commit or tag, and licence;
- the native runtime API surface actually present at that version (for example `Runtime::applyInstructions`, `process`, `gc`, and tap or shared-resource support);
- the JavaScript renderer package version, and evidence that it emits instructions the native runtime at that version accepts;
- the JS execution model any official native or plugin example uses.

Do not combine runtimes, renderers, and examples from different releases unless a working build demonstrates compatibility. If no compatible native path exists, stop and report the blocker. Do not proceed to §2.1.

End this gate with a verdict at the top of `docs/architecture-decision.md`: **GO**, **GO WITH CONSTRAINTS** (list them), or **NO-GO** (state the evidence). The threading analysis in §1.2 belongs to this same investigation.

**The first task is this investigation only.** Do not build UI, instrument definitions, or plugin scaffolding until the gate passes.

**\[Amended\]** A GO verdict does not replace the playable-audio gate in §2.1. The first evidence you present must be a real Elementary-generated three-mode tine playing through the native C++ host.

**\[Amended\]** The proof must execute a graph generated by the selected Elementary JavaScript renderer and processed by the selected native Elementary runtime. A C++-only DSP substitute, mock renderer, or separately implemented oscillator does not satisfy this gate.

### §2.1 First technical gate: native Elementary host

Demonstrate each of the following in a real C++ host:

1. The selected Elementary runtime initialises and executes a real Elementary graph produced by the DSP JS context.
2. It generates a playable, decaying plucked tine with three modes.
3. It produces continuous audio at the device's sample rate.
4. MIDI triggers notes. Use a virtual MIDI route if available; otherwise use a documented on-screen or test input.
5. **\[Amended\]** Demonstrate repeated changes to a continuous DSP parameter during sustained audio, without stopping audio, restarting the runtime, or rebuilding the entire graph per update. Capture evidence of the update mechanism and of any allocations, locks, or resource destruction involved (for example by instrumenting or inspecting the code path). Rebuilding the graph between notes does not satisfy this item. Also verify that the parameter changes affect the rendered output during the sustained note: capture the parameter values and the corresponding output measurements, and show an audible or measurable difference without restarting the graph. Merely updating stored parameter state does not pass.
6. Graph construction, control updates, `gc`/`prune`, and audio rendering follow the runtime's actual supported threading and lifecycle model, per §1.2.
7. **\[Amended\] Latency.** Measure software note-on-to-output latency, from the timestamp at which the native host accepts the MIDI or test event to the first corresponding non-zero output sample, at 48 kHz with 128- and 256-sample blocks. Document the event queue, audio-block scheduling, and processing stages. Report this separately from physical audio-device round-trip latency, and do not claim hardware latency unless it was measured with a physical loopback or equivalent method. Report the median and worst case over at least 100 notes, with the method and conditions.
8. **\[Amended\] CPU.** Measure CPU load at 48 kHz and a 256-sample block with 1 voice, 8 voices, and the largest voice count that runs without dropouts, using three modes per tine. Compare against the provisional targets in §1.3. Record the CPU model, operating system, measurement method, test duration, and whether the figure represents the audio process, the application process, or total system load.
9. **\[Amended\] Artefacts for human evaluation.** Produce rendered 48 kHz WAV files, from the real native path where possible: a single soft note, a single hard note, a short overlapping phrase, and a ten-second parameter sweep during a sustained note. Provide a one-page "how to run and play it" with exact commands.

**\[Amended\] WAV reproducibility.** For every rendered WAV, record in a recording manifest stored beside the files:

- sample rate and block size;
- note pitches and velocities;
- event timings and durations;
- parameter values and any automation curve;
- render duration;
- random seed or deterministic variation setting;
- whether rendering used the real native runtime or an offline renderer.

Do not apply different loudness normalization to individual files.

Document:

- exact versions, APIs, and commands;
- observed results;
- thread boundaries;
- sample-rate and block-size handling;
- unresolved blockers.

**Gate:** do not expand into the full instrument until this produces a sound that can be played and evaluated. **\[Amended\]** Passing the technical items does not authorise moving on: stop and report so the human can listen.

### §2.2 Direct VST3 spike (bounded by exit conditions) **\[Amended\]**

Use the same graph and parameter definitions. Compilation alone is not success. In a real VST3-compatible host, verify each of the following, and name the host and version:

- The plugin loads, and its audio callback runs at supported native sample rates without observed glitches.
- MIDI triggers audio.
- The exposed parameter supports host automation.
- Plugin state saves and restores.
- The proposed editor/view embedding approach (WebView2 child window inside the VST3 `IPlugView`) is viable.

**Who tests:** the target host is Ableton Live on Windows, run by the human. Produce a host-test checklist covering each item above, and report any item you could not verify yourself as UNVERIFIED.

**\[Amended\] Verification boundary.** Your Milestone 1 completion requires a verified standalone proof of concept and a documented VST3 implementation and hosting decision. Prepare a complete host-test checklist, but actual Ableton Live verification stays UNVERIFIED until the human completes it.

**\[Amended\] Editor spike scope.** The WebView2 spike only needs to establish whether child-window embedding inside `IPlugView` is technically viable. A minimal technical test window or verified SDK evidence is sufficient. Do not build the MBIRA interface during Milestone 1.

**Exit conditions.** A calendar time-box does not apply to an agent. Stop the direct-VST3 attempt and fall back to the JUCE wrapper when **any** of these happens:

- three distinct approaches to the same blocking problem have failed;
- you have spent more than roughly 40 tool-use steps on one problem without measurable progress;
- a spike criterion above is shown to be unachievable by direct integration.

If any criterion cannot be met:

1. Record what you tried, the evidence, and the precise reason, including each failed approach.
2. Switch to a minimal JUCE CMake wrapper, subject to §1.5.
3. Retain the same Elementary DSP and the shared parameter and instrument definitions.

Use RtAudio for the standalone where practical, and document any necessary deviation.

**\[Amended\]** A JUCE fallback changes only the plugin integration layer. The VST3 deliverable remains required. If neither route can produce a viable plugin, report the blocker rather than treating the fallback decision as completion.

### §2.3 Decision document scope

`docs/architecture-decision.md` must also cover:

- standalone hosting;
- Windows WebView embedding and bridge security;
- offline assets;
- intended macOS and Linux paths;
- MIDI-to-voice allocation;
- dependency versions and licences;
- commercial-distribution questions.

Verify licence facts rather than guessing. This includes Elementary's licence terms and those of any embedded JS engine.

**Milestone 1 stop condition:** a genuinely playable Windows standalone proof of concept, plus a documented VST3 implementation and hosting decision, with exact commands and results. Actual Ableton Live verification remains UNVERIFIED until the human completes the supplied host-test checklist. If the environment prevents execution or host testing, report that explicitly as a blocker. Do not claim the milestone passed.

---

## §3. Milestone 2: instrument and sound design

Implement the model in `src/dsp/` using Elementary APIs verified against the selected version. The goal is a musically useful, mbira-like tine. A generic metallic synth that merely passes tests is not acceptable.

### §3.1 Tine model

- Each active tine has three independently damped modes. Use provisional ratios around `[1.0, 2.6, 4.2] × fundamental`.
- **\[Amended\]** These ratios are unverified. Before Milestone 2, review published work on mbira and lamellophone tine acoustics and propose a justified default, or state clearly that the choice is a guess. For the Milestone 1 proof of concept, use whatever gives a clearly decaying three-mode pluck, and say so.
- Modal ratios, amplitudes, damping, and excitation sensitivity are stored **per tine**. This lets each key have its own character, and lets later measurements replace the defaults.
- Suppress any mode at or above Nyquist (with a safety margin). Output must be stable at every supported sample rate.
- Preallocate voice resources for the global maximum of 64. The active default is 32 (A5).

### §3.2 Excitation

- **Velocity amplitude:** map MIDI velocity linearly to nominal amplitude, `velocity / 127`.
- **Velocity brightness:** separately, harder playing increases relative high-mode energy. Define and document the curve.
- **Pluck position:** exposed from 0 to 1, and affects relative modal excitation.
  - Define and document the actual formula, for example a bounded `|sin(π·k·p)|`-style weighting per mode, with a floor so no mode vanishes entirely.
  - Soft/hard playing and position changes must be audibly distinguishable. Do not exaggerate them solely to meet a test.
- **Repeated-note variation:** subtle, bounded variation in timing or amplitude. Use a fixed seed or a deterministic mode so tests are reproducible.
- **Retriggering:** damp or release the existing voice quickly and click-free, then re-excite musically.

### §3.3 Shared body, gourd, and buzz

- **Soundboard.** 4–6 broad, damped resonances driven by the sum of tine outputs. This forms the shared instrument body.
  - **\[Amended\]** The soundboard is a single resonator bank shared by all active tines. It is never instantiated per voice.
  - **\[Amended\]** Its state persists across note events. Voices feed one common body-excitation path.
  - **\[Amended\]** On instrument switch, the body state is reset or crossfaded click-free, off the audio thread where graph changes are required.
  - **\[Amended\]** Test that two simultaneous notes excite the same body state, not independent copies.
- **Sympathetic interaction.**
  - Investigate `el.tapOut`/`el.tapIn` only if the selected runtime supports them.
  - If supported, use a verified, bounded feedback mechanism, provided it is stable and practical.
  - Otherwise, implement shared soundboard excitation as a first-stage approximation and document the missing true coupling.
- **Gourd/deze.**
  - A separate resonator driven by instrument excitation, not merely a static parallel effect.
  - Provide amount, character/frequency, and bypass controls.
  - Enabled and bypassed states must be audibly distinct.
- **Buzz.**
  - A separate vibration-driven mechanism, correlated with playing strength and spectral content (for example envelope- or amplitude-gated nonlinear rattle). Static noise is not acceptable.
  - Expose intensity and character controls.
- **\[Amended\] Provisional status of gourd and buzz.** These are useful acoustic approximations, not verified physical models. The relationship between the mbira, deze, buzzing, and playing technique is unconfirmed and needs the player's input. Document the simplifications, label the controls PROVISIONAL, and keep the mappings easy to revise. Do not over-engineer the physics before the player has evaluated it.

### §3.4 Voice management

- Preallocate all voice resources. Never allocate on the audio thread.
- Implement note-on, note-off, sustain pedal (CC64), release, and pedal-up correctly, following the lifecycle in A3.
- When stealing is necessary, choose in this order:
  1. oldest released voice;
  2. oldest pedal-sustained voice;
  3. newest active note.

  Stolen voices fade out quickly and click-free.
- Test overlapping notes, retriggering, sustain, voice stealing, and the 32-voice and 64-voice limits.

---

## §4. Instrument definitions

Create two independently selectable JSON definitions under `src/instruments/`:

- `mbira-dzavadzimu.json`: **Mbira dzaVadzimu**, 24 keys, three ranks.
- `nyunga-nyunga.json`: **Nyunga Nyunga**, 15 keys, two ranks.

### §4.1 Schema

Use a data-driven 2-D schematic schema, and validate it with a JSON Schema or an equivalent validator. Top-level fields:

- `name`, `type`, `keyCount`, and layout dimensions;
- a `keys` array;
- soundboard, gourd, and buzz configuration;
- a `provisional: true` flag.

Every key must include:

- MIDI note;
- explicit `frequencyHz`;
- rank;
- a unique `x`/`y` pair in schematic coordinates;
- `lengthPx`;
- `group`: `low`, `mid`, or `high`;
- per-key modal ratios, damping, and amplitudes;
- excitation sensitivity.

MIDI notes must be unique within an instrument.

### §4.2 Provisional Nyunga Nyunga layout (about 600×300 canvas)

- **Rank 1, seven tines:** `x = 100, 160, 220, 280, 340, 400, 460`; `y = 105, 100, 96, 94, 96, 100, 105`.
- **Rank 2, eight tines:** `x = 80, 140, 200, 260, 320, 380, 440, 500`; `y = 175, 169, 165, 163, 163, 165, 169, 175`.

Layout requirements:

- Use visibly varied tine lengths and a readable top-down arrangement.
- The 15-key layout must have a position for every key. Do not force 15 keys into a 2×7 grid.
- Design a distinct three-rank layout for the 24-key Mbira dzaVadzimu and document its coordinates.
- Make the two instruments visually and musically distinct.
- Follow conventional visual intuition where practical: longer tines generally suggest lower pitch.

### §4.3 Provisional status

- These layouts are **schematic starting points, not verified traditional layouts**. They should be adjusted once the player provides photos and measurements.
- Initial pitches may use a seven-note C–D–E–F–G–A–B placeholder scale, distributed differently across the two instruments.
- **\[Amended\]** This placeholder scale will likely sound wrong to a Zimbabwean player. Ask the human for the actual tuning of each instrument (note names or Hz) before Milestone 3, and list this in the open questions.
- Label **all initial tunings, layouts, lengths, and physical parameters PROVISIONAL** in the UI and documentation. Never present them as authoritative Zimbabwean tunings.
- Make them easy to replace: edit the JSON, with no code changes required.

---

## §5. Milestone 3: playable interface

Build a premium, responsive single-page UI in `src/ui/`. It is embedded in the native host and works offline in release builds.

### §5.1 Visual direction

- **Palette:** charcoal `#1a1a1a`, dark brown `#2d1f1b`, antique gold `#c9a84c`, warm metallic `#b8860b`, with subtle shadows.
- **Fonts:** bundle appropriately licensed Cormorant Garamond for labels and Inter for values. There must be no network font dependency at runtime.
- **Type sizes:** about 14 pt labels and 16 pt values.
- **Responsiveness:** layouts adapt at around 800 px and 600 px widths.
- **Rendering:** generate the schematic from the instrument JSON using SVG. Use Canvas only if it helps with animation.
- **\[Amended\] Priority:** a functional schematic and responsive controls come before elaborate animation. Do not implement decorative animation that could compromise audio performance, MIDI-to-highlight latency, or development time. Tine highlights should be simple and immediate. The instrument must feel like a playable mbira, not just look like a premium plugin.

### §5.2 Play view

- **Schematic:**
  - A dominant top-down schematic, with distinct 24-key and 15-key layouts.
  - Show visible ranks, metal tines, wooden body, and a gourd/deze representation.
  - Include a visible PROVISIONAL label.
- **Highlighting:** MIDI note-on highlights the corresponding tine, driven by native status notifications.
- **Pointer input:** clicking or tapping a tine triggers its note through the same engine and highlights it. Pointer-up sends note-off. Note-offs must not be lost on pointer-cancel or window blur.
- **Controls:**
  - A collapsible controls panel containing the controls in §5.3.
  - Real-time parameter binding via the validated bridge.
  - The UI reflects host-side changes such as automation, preset loads, and state restore.
- **Standalone-only device controls:**
  - MIDI device selection, including virtual devices where supported.
  - Audio device and sample-rate selection.
  - Visible errors for missing devices or unsupported rates.
- **Window:** default size 800×600.

### §5.3 Control contract

Use these stable engine parameter IDs, ranges, and defaults in both hosts.

- Store values in their stated units. Convert only at the VST3 normalized-parameter boundary.
- Continuous controls ramp over about 100 ms. Preset transitions follow §1.3.

| User-facing control | Range / unit | Default | Engine mapping and behaviour |
| --- | --- | --- | --- |
| Instrument | `mbira-dzavadzimu`, `nyunga-nyunga` | `mbira-dzavadzimu` | `instrument.id`. Discrete selection of the shared JSON definition and DSP configuration. Prepare off the audio thread; transition safely (damp active voices click-free). |
| Preset | Acoustic Default, Experimental Space | Acoustic Default | `preset.id`. Applies the complete snapshot atomically. Manual edits retain the preset name but persist the edited values. |
| Pluck position | 0–1, normalized | 0.5 | `excitation.pluckPosition`. Relative modal excitation; 100 ms ramp. |
| Decay | 0.5–2.0, multiplier | 1.0 | `tine.decayMultiplier`. Larger values give longer decay via derived damping coefficients; 100 ms ramp. |
| Brightness | 0.5–2.0, multiplier | 1.0 | `tine.brightnessTilt`. Relative high-mode amplitudes; 100 ms ramp. |
| Soundboard resonance | 0–1, normalized | 0.5 | `soundboard.amount`. Shared-body contribution; 100 ms ramp. |
| Gourd | Off / On | Off | `gourd.enabled`. Discrete bypass with a click-free transition. Off means effective contribution 0. |
| Gourd amount | 0–1, normalized | 0.8 | `gourd.amount`. Effective contribution = `gourd.enabled ? gourd.amount : 0`; 100 ms ramp. Stored amount is preserved when bypassed. |
| Gourd character | 0–1, normalized | 0.5 | `gourd.character`. Resonator frequency around the instrument's provisional base frequency. Use a bounded, documented mapping (for example ±1 octave, exponential); 100 ms ramp. |
| Buzz intensity | 0–1, normalized | 0.2 | `buzz.intensity`. Vibration-driven buzz contribution; 100 ms ramp. |
| Buzz character | 0–1, normalized | 0.5 | `buzz.character`. Buzz timbre; documented mapping; 100 ms ramp. |

**Host settings and parameter exposure:**

- Audio device, MIDI device, and sample rate are standalone host settings, not DSP parameters.
  - Enumerate the available choices and show the actually selected values.
  - Persist them where feasible.
  - Never expose them as plugin automation.
- `voices.max` is a persisted, non-automatable setting (A5).
- Expose stable VST3 parameter IDs for the continuous and discrete instrument controls. Document the ID table.
- Note triggers are events, not persistent parameters.

### §5.4 Factory presets

Presets map to real engine parameters, not UI-only labels.

| Parameter | Acoustic Default | Experimental Space |
| --- | --: | --: |
| Pluck position | 0.5 | 0.5 |
| Decay multiplier | 1.0 | 1.8 |
| Brightness | 1.0 | 1.5 |
| Soundboard amount | 0.5 | 0.8 |
| Gourd enabled | Off | On |
| Gourd amount | 0.8 | 0.8 |
| Gourd character | 0.5 | 0.5 |
| Buzz intensity | 0.2 | 0.8 |
| Buzz character | 0.5 | 0.5 |

- Applying a preset does not change the selected instrument.
- Persist the selected instrument, preset, all parameter values, and `voices.max`.
- Plugin state must round-trip correctly, including after manual parameter edits. Include a version field in the state format.

---

## §6. Validation

Test frameworks and harness:

- Vitest for JavaScript and Catch2 for C++ (see A6).
- For headless DSP tests, use an actual supported Elementary offline rendering path. If none exists, implement and document the closest verified deterministic harness.
- Headless validation must also exercise the native Elementary runtime wherever practical. Offline renderer success alone does not establish native integration correctness.

Test the following areas:

- **Instrument data:** valid and invalid JSON; key counts; unique coordinates and MIDI mappings; explicit frequencies; per-tine configuration; distinct layouts.
- **Engine:**
  - finite, stable output at all supported rates;
  - silence/reset behaviour;
  - polyphony, sustain, stealing, and retriggering;
  - parameter changes;
  - sample-rate and block-size changes with preserved parameters.
- **State:** preset mapping and atomic application; coordinated ramps; parameter persistence; instrument selection; plugin state round-trip.
- **Bridge:**
  - validation, origin restrictions, and unauthorized navigation;
  - oversized, malformed, and non-finite messages;
  - queue overflow behaviour and note-off safety;
  - rate limiting and coalescing.
- **Sound behaviour:**
  - velocity-dependent amplitude and brightness;
  - measurable pluck-position effect;
  - gourd on/off difference;
  - buzz response to intensity and playing strength.
- **Levels:**
  - peak ≤ −0.5 dBFS for the documented test sequences (see A4);
  - noise floor ≤ −80 dBFS during a defined silent/reset interval. Do not mistake natural decay for noise.

Diagnostics:

- Measure gourd on/off level difference, modal-energy change across pluck positions, and buzz response under defined, repeatable inputs.
- The original 3 dB gourd and 6 dB modal-shift figures are **exploratory targets, not proof of realism and not unconditional pass/fail criteria**.
- Record measurement windows, signals, and results.
- Stability and correct parameter behaviour are mandatory. Listening quality takes precedence over arbitrary thresholds.

Manual listening checks go in `docs/manual-test-results.md`. Cover:

- both instruments;
- soft and hard playing;
- overlapping notes;
- sustain;
- gourd and buzz;
- both presets.

State whether the sound has mbira-like character and what remains provisional. Never invent listening results. If you could not listen, say so.

---

## §7. Build workflow and project layout

Start from this structure. Adapt it only with a documented reason.

```text
mbira/
├── CMakeLists.txt
├── package.json
├── package-lock.json
├── deps/manifest.json   # pinned versions, URLs, checksums, licences
├── scripts/
├── src/
│   ├── native/          # Shared runtime host, standalone/plugin adapters, parameter bridge
│   ├── dsp/             # index.js, tine, excitation, soundboard, gourd, buzz, voice manager
│   ├── instruments/     # mbira-dzavadzimu.json, nyunga-nyunga.json, schema
│   └── ui/              # HTML/CSS/JS, bundled assets and fonts, schematic
├── tests/               # dsp/, native/, integration/
├── docs/
├── LICENSES/
├── LICENSES.md
├── README.md
├── todo.md
└── HANDOFF.md
```

Provide these commands. Where a platform is unsupported or incomplete, give clear diagnostics.

```bash
npm install          # Install pinned JS dependencies only; no silent native builds
npm run setup        # Explicit dependency preparation/checks with actionable errors
npm run dev          # UI dev server on localhost:3000 + standalone dev host
npm run build        # Release standalone
npm run build:vst3   # Release VST3 bundle
npm test             # Automated headless tests (JS + C++)
npm run lint         # ESLint + Prettier checks
npm run format       # Apply formatting
```

**Development mode:**

- The standalone host accepts an explicit UI URL argument (for example `--dev-ui-url http://localhost:3000`) only in an explicit development mode, and allowlists exactly that origin.
- `npm run dev` starts the UI server and launches the development host pointed at it.

**Release mode:**

- Release builds load bundled offline assets by default, via a fixed virtual-host or local-file origin.
- Release builds must not accept arbitrary remote UI URLs.
- Document the asset origin and how bridge origin validation works in both modes.

**Dependencies and scripts:**

- Pin dependency versions, URLs, and checksums where applicable.
- Include licence texts and the npm lockfile.
- Scripts orchestrate CMake and dependency setup with useful progress and failure messages.

**Outputs:**

- Document the exact output paths, including the Windows `.exe` and the `.vst3` bundle location.
- Release UI assets must work without a dev server or internet connection.
- The plugin must carry the runtime and assets it needs, subject to platform prerequisites (for example the WebView2 Runtime) and verified licensing.

**Platforms:** complete the Windows standalone and VST3 first. Keep the architecture portable. Implement and verify macOS and Linux hosting only after the Windows instrument works. Do not claim cross-platform support without actual builds and tests. List unverified platforms and prerequisites honestly.

---

## §8. Documentation and handoff

Produce the following:

- **`README.md`:** prerequisites and versions, dependency setup, commands, output paths, standalone use, plugin installation, platform status, and known limitations.
- **`docs/architecture-decision.md`:**
  - actual Elementary integration findings, including the §2.0 feasibility verdict;
  - first-gate evidence;
  - runtime threading analysis (§1.2);
  - VST3 spike and fallback decision;
  - WebView strategy and bridge security review;
  - dependencies, licensing questions, and assumption decisions (A1–A6).
- **`docs/architecture.md`:**
  - graph and model;
  - JS/native boundary;
  - runtime lifecycle and threads;
  - MIDI and voice allocation;
  - parameter smoothing and preset transitions;
  - instrument schema;
  - sample-rate handling;
  - verified Elementary resampling behaviour, or an explicit statement that it is unknown.
- **`docs/manual-test-results.md`:** actual listening and host-test results, conditions, and limitations.
- **`docs/recording-brief.md`:** a respectful request for the player's input. Include:
  - photos;
  - layout and key count;
  - measured pitches;
  - isolated and overlapping notes;
  - playing styles;
  - deze and buzz variations;
  - preferred traditional terminology.
- **`docs/future-hybrid-engine.md`:** documentation only. Cover a future sample-engine boundary, shared voice and parameter concepts, and an illustrative sample-map schema with velocity layers and round-robin. **Do not implement** sample playback, import, editing, blending, hybrid modes, or sample-specific UI.
- **`LICENSES.md` and `LICENSES/`:** verified licences for:
  - Elementary and any JS runtime;
  - the VST3 SDK;
  - RtAudio and RtMidi;
  - WebView2 SDK/runtime terms;
  - UI dependencies and fonts;
  - any fallback framework.

  Flag unresolved commercial-distribution questions.
- **`HANDOFF.md`:**
  - implementation summary;
  - architecture and direct-VST3/fallback rationale;
  - whether JUCE was avoided;
  - exact run and build commands;
  - actual test output;
  - **\[Amended\]** measured latency and CPU figures against the provisional targets;
  - real host and listening results;
  - known limitations;
  - platform verification status;
  - questions requiring the Zimbabwean player's input, including the actual tuning of each instrument.

---

## Definition of done

The Windows delivery is complete only when all of the following hold:

1. A standalone application and a VST3 plugin both build and run, using identical Elementary DSP, instrument definitions, and parameter definitions.
2. Both instruments are independently selectable, visually distinct, playable from MIDI and from the on-screen schematic, and clearly marked PROVISIONAL.
3. Everything in §3–§5 works as specified: the physical model, shared body, separate gourd and buzz, polyphony, sustain, stealing, controls, presets, and persistence.
4. The plugin has been tested in a real VST3 host for audio, MIDI, automation, state restoration, and supported sample rates. **\[Amended\]** The named target host is Ableton Live on Windows. Compiling is not enough.
5. The bridge's security properties and bounded behaviour are implemented and tested, and both development and release asset loading work as specified.
6. The runtime threading model has been verified from source, and no allocating, blocking, or destructive operation runs in the audio callback.
7. Automated tests pass, their actual output is captured, and the sound has undergone a documented listening evaluation.
8. Build, licensing, architecture, limitations, and handoff documentation reflect what was actually verified.

Report macOS and Linux completion separately, and only after real verification.

**\[Amended\] Two success criteria.** Technical success (it renders, MIDI works, parameters automate, the VST3 loads, tests pass) does not establish musical success (it sounds like an mbira, it feels natural to play, parameter changes are musically useful, a Zimbabwean player recognises its potential). Report both separately. Never claim the second from the first.

If a dependency, runtime limitation, missing host, unavailable platform, or other blocker prevents any criterion, state exactly what remains incomplete, with the evidence and next steps. Do not claim success.