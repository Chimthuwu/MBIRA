# MBIRA todo.md

## Environment report (2026-11-06)

- OS: Windows 10 Pro 22H2, build 19045.7807. CPU: AMD Ryzen 5 3600 (6c/12t). RAM: 32 GB.
- Toolchain: git 2.53.0.windows.3, CMake 4.4.3, Node v26.0.0, npm 11.12.1, Python 3.14.9, Ninja.
- Compiler: INSTALLED + VERIFIED — WinLibs MinGW-w64 GCC 16.2.0 (UCRT posix-seh r3), pinned, sha256 in deps/manifest.json.
- Executables: YES. Audio device: RtAudio enumerates devices (agent cannot listen; WAVs are the evidence). MIDI: RtMidi code present, UNVERIFIED until a device/loopback is probed.
- Network: YES.

## Gates / milestones

- [x] Spec saved to docs/MBIRA-SPEC.md
- [x] M0: Elementary source inspected (commit 60e7234, js renderer v4.0.3)
- [x] M0: feasibility verdict GO WITH CONSTRAINTS (docs/architecture-decision.md)
- [x] M0-M1: compiler installed and verified (GCC 16.2.0)
- [x] M1 GATE 1: native host builds; real Elementary graph renders 3-mode plucked tine
- [x] M1: test-triggered notes; continuous param changes during sustained audio (4.2) - evidence/wav/param-sweep.wav
- [x] M1: latency (120 notes, 128/256 blocks) and CPU (1/8/32/37 voices) measurements (4.3)
- [x] M1: rendered WAVs + manifest (evidence/RECORDING-MANIFEST.md); how-to-run doc
- [ ] M1: VST3 spike with exit conditions (4.4) + host-test checklist
- [ ] M1: finish architecture-decision.md with verified licences (RtAudio/RtMidi/QuickJS/choc/VST3)
- [ ] STOP after M1 and report (Part A section 1)

## Amendments 4.5-4.9 (later milestones - record now, apply then)

- 4.5 (3.3): soundboard = ONE shared resonator bank for all voices; state persists across notes; reset/crossfade off-audio-thread on instrument switch; test that two notes excite the same body state.
- 4.6 (3.3): gourd and buzz are acoustic approximations, not verified physics. Label PROVISIONAL, keep mappings easy to revise, wait for player input before over-engineering.
- 4.7 (3.1): modal ratios [1.0, 2.6, 4.2] are unverified - review lamellophone acoustics before M2 or state it is a guess. M1 uses them as an explicitly PROVISIONAL placeholder.
- 4.8 (5.1): functional UI before animation; simple immediate tine highlights; must feel playable.
- 4.9 (4.3): placeholder tunings will likely sound wrong - ask the human for real tunings before M3; list in open questions.
- 4.10-4.13: applied in M1 as written (verification boundary; software vs hardware latency; WAV manifest; GO does not skip playable-audio gate).

## Blockers / open items

- MIDI UNVERIFIED: mbira-poc live prints the detected port; needs a real device or loopMIDI from the human.
- Voice pool prebuilds notes 48-84 (37 voices) in M1; 64-voice preallocation is M2 voice-manager work.
- Live mode runs forever (no clean shutdown handler) - fine for a PoC; polish in M3 standalone.
- Release conventions: use js/core 4.0.1 + native runtime from the SAME repo commit (60e7234); never mix with the CLI example stale npm pin (^3.2).

## Final status (2026-11-06)

- [x] M1 VST3 spike: direct VST3 VIABLE - SDK validator 47/47 passed, smoke host produced real audio (-10.7 dBFS). No JUCE fallback. See evidence/vst3-spike.md.
- [x] M1: architecture-decision.md finished (VST3 decision + verified licences in LICENSES.md).
- [x] M1 COMPLETE - STOPPING per Part A section 1. Final report delivered in chat.
- Open for human: listen to evidence/wav/*.wav; run docs/vst3-host-test-checklist.md in Ableton; provide MIDI device/loopMIDI; answer Steinberg licence + tuning questions (4.9).

## UI scaffold (2026-11-07)

- [x] Web UI scaffold dropped in as `ui/` (vanilla HTML/CSS/JS, no build, no CDN):
  `index.html` + `css/tokens.css` + `css/app.css` + `js/{bridge,layout,keyboard,controls,main}.js`
  + `README.md`. Allowlisted `{v,type,id,payload}` envelope in `bridge.js`
  (`ui.ready`, `param.set`, `note.on/off`, `panic`, `preset.*`, `instrument.select`).
  21 tines (3 rows × 7, placeholder C-major spread per 4.9), pointer/touch/QWERTY
  input, faders/knobs/insert chips/meter/scope, mock host (`__MBIRA_MOCK__`).
- [x] Verified in browser (local http, file:// blocked by harness): 21 tines in
  DOM, QWERTY `a` → MIDI 60 note-on with `.is-on`, keyup → off, fader input
  updates readout. Screenshot: `ui-preview.png`. JS syntax clean
  (`node --check` × 5).
- [x] WebView2 viability spike — SHIPPED (`46de4e2`). `src/native/webview_ui.h`
  is a plain-COM (no WRL) WebView2 host: virtual-host mapping
  `mbira.local` → `ui/` (ES modules + CSP load with no server), allowlisted
  `{v,type,id,payload}` bridge both directions, telemetry pushed from `WM_TIMER`
  at 30 Hz. `mbira-poc live` defaults to it (`--ui gdi` restores the Win32 panel).
  Two root causes fixed: (1) `CtrlHandler` released the controller as soon as the
  callback returned — that closed the WebView and killed `msedgewebview2`, giving
  the blank white window; now `AddRef`'d for the app's lifetime and sized from the
  client rect (`put_Bounds` was never called → 0×0) + resized on `WM_SIZE`.
  (2) the param parser read `payload.name`, but the bridge sends the path in
  `payload.path`, so every control became `__mbira.setParam('?', v)` and the DSP
  threw `unknown param: ?`. Verified over CDP on the running native host:
  `NavigationCompleted success=1`, `ui.ready`, 21 tines / 5 nav / 10 knobs,
  `master`+`macro.*` reach the DSP, 0 JS errors. Evidence:
  `evidence/standalone/native-host.png`. **Provisional:** `blend.engine`,
  `fx.*`, `layer.*`, `mode1-3` have no DSP `setParam` case — UI-only for now
  (logged once as provisional; adding them = sound-generation work, locked).
- [ ] Open questions still blocking UI (see `ui/README.md`): real tunings (4.9),
  voice-count display (37 vs M2 64), MIDI status semantics.
- Note: separate native `src/native/ui.h` (uncommitted WIP, `mbira_ui::State`
  wired into `main.cpp` live MIDI path) exists alongside this WebView2 UI —
  they are independent; `src/dsp/index.js` currently gutted to a 1-line
  "M2 rewrite marker" (also uncommitted WIP, NOT committed here).

## M2 in progress (2026-11-07)

- [x] 3.1: cantilever modal ratios [1.0, 6.27, 17.55] (justified via clamped-free beam eigenvalues, amendment 4.7); per-tine override API; Nyquist suppression (0.45*sr margin); A/B WAVs ab-classic vs ab-cantilever (attack band 2.7x brighter with cantilever set).
- [x] 3.2: excitation - linear velocity amp, documented brightness curve (b^i), pluck-position weighting |sin(pi*(i+1)*p)| with 0.10 floor, deterministic +/-2% repeated-note variation (hash(note,trig)).
- [x] 3.3: shared soundboard = ONE keyed 5-band svf resonator bank on the summed bus (state persists via stable keys); gourd = comb+bandpass with amount/freq/bypass; buzz = amplitude-gated tanh rattle; body params smoothed in-graph (param-step clicks eliminated: 0.138 -> 0.008 max jump).
- [x] 3.4 (partial): 64-voice pool (notes 48-111), sustain pedal CC64 (sustain API + event), voice-stealing order implemented (released -> sustained -> newest).
- [x] Host: named-param events {"type":"param","name":...} + sustain events; MBIRA_RATIOSET env for A/B renders. Evidence: evidence/wav-m2/.
- [ ] 3.4 (rest): explicit steal/overlap/sustain test suite; verify 32/64-voice CPU.
- [ ] 4: instrument JSONs (mbira-dzavadzimu 24-key, nyunga-nyunga 15-key) + schema validator; wire loadInstrument.
- [ ] DIRECTION (user, 2026-11-07): Pigments-inspired MODULATOR architecture (velocity, key-map, ADSR, LFO, random sources -> any param) + AUGMENTED engine = synthesis x MULTISAMPLING (el.sample exists in core 4.0.1). Design the modulator matrix + sample-layer engine before building presets/instrument switching.
- [x] UI (interim Win32): control panel with pluck/master sliders, SOUNDBOARD enable+amount, GOURD enable+amount+freq, BUZZ enable+intensity+character, cantilever/classic toggle; params flow through the live event queue (Raw events) to the service thread. UI smoke test clean (0 xruns). WebView2 editor still pending (design agents).
- [x] MIDI: RtMidi now OPENS port 0 (microKEY-37 detected in live boot). Actual playing still needs human test.
- [x] 4 (core): src/instruments/ schema.json + mbira-dzavadzimu.json (24 keys, 3 ranks) + nyunga-nyunga.json (15 keys, spec 4.2 coords), per-key modal ratios/taus/amplitudes/excitationSensitivity, per-instrument soundboard/gourd/buzz config; validator tests/instruments/validate.mjs wired into npm test.
- [x] DSP loadInstrument(jsonText): voice pool rebuilds from instrument key list, per-tine overrides, body reconfig. Host loads at startup (MBIRA_INSTRUMENT env) and feeds schematic geometry to the UI keyboard. Evidence: inst-dzavadzimu.wav vs inst-nyunga.wav (audibly distinct).
- [x] IDENTITY LOCK (Design Agent Package 2): NO modulator matrix, NO Mod page, ever. UI surface = 3 macros (Resonance/Buzz/Brightness) + engine blend (physical<->samples) + per-parameter mod strips + body-layer samples strip. Mod-framework params remain engine internals (driven by mod strips).
- [x] Macros in DSP: macro.resonance (scales soundboard bands + gourd amount), macro.buzz (scales rattle intensity), macro.brightness (overtone exponent tilt - NOTE inverted exponent, b<1). Verified by A/B renders (macro-*.wav). Interim panel has MACROS row; ADSR/LFO row relabelled DEV ONLY.
- [ ] Engine blend + body-layer samples: needs el.sample + recordings from the Zimbabwean collaborator. DSP hook next; UI = Body page strip (design agents own visuals).
- [ ] UI: instrument selector; mod page; sample-layer strip (augmented engine).
- [x] Modulator framework v1: per-voice ADSR (attack/release/sustain), shared LFO -> master (tremolo) and -> pitch (audio-rate), random depth, velocity depth params; all via setParam, defaults = M1 sound. Interim panel has a MODULATORS row. Verified: 5 Hz tremolo ripple, 2 Hz pitch sweep 260-270 Hz, swell+release envelope. Full routing matrix + sample-layer engine = next.


## Milestone L — the listening set (started 2026-11-08, PAUSED here)

- [x] Recovery audit: `docs/RECOVERY-AUDIT.md` (read-only; last trustworthy M1 baseline = `efb427a`, not `c9e5aea`).
- [x] Baseline tagged `m1-baseline` = `efb427a` (M1 evidence is only reproducible from there; HEAD cannot reproduce it).
- [x] Manifest for `evidence/wav-m2/` (missing since `3e69782`): `evidence/wav-m2/RECORDING-MANIFEST.md`.
      7/17 files provenance-verified by byte-identical re-render; 3 are duplicates; 7 are NOT reproducible at HEAD (N-1).
- [x] Listening pack rendered from HEAD `6293c17` -> `evidence/wav-listen/` (13 WAVs) + manifest with
      per-file peak/RMS/band measurements and defects L-1..L-4.
- [x] Blank human record: `docs/manual-test-results.md` (Part A human / Part B player / Part C L-1 / Part D open questions).
- [x] (2026-11-09, user authorised skipping the listen-first gate) Objective defects fixed at `cea9d24`:
      L-1 signed+energy-normalised pluck weighting (RMS spread 19.9 dB -> 0.08 dB; endpoints distinct, mode-2 sign flip),
      L-2 buzz ships at spec default 0.2 (cfg + both instrument JSONs),
      N-6 bad `MBIRA_INSTRUMENT` path falls back with a NOTE (exit 0); malformed keys validated before pool clear.
- [x] Listening pack re-rendered from `cea9d24` -> `evidence/wav-listen/` (13 WAVs) + updated RECORDING-MANIFEST.md
      (buzz now +5.4 dB in 2-8 kHz on defaults; L-3 tuning / L-4 stereo still open).
- [x] (2026-11-09) Hero keyboard rebuilt on the real instrument schematic (commit 190d147):
      layout.js generated from src/instruments/*.json (interleaved 3-register fan, graded widths),
      realistic board CSS (wood grain, rimmed soundhole, hold-down rail + screws, per-tine sheen),
      note labels, dynamic QWERTY map (Q-P / A-L / Z-B), host posts `instrument` envelope on ui.ready.
      Visual review pass: initial flat grid -> 9/10 (24 tines confirmed interleaved, click fires note.on through the bridge).
      Note: instrument JSON geometry is still PROVISIONAL (spec 4.3) - layout updates automatically when tunings/coords land.
- [ ] **BLOCKED ON A HUMAN: listen to `evidence/wav-listen/` (re-render 2) and fill in `docs/manual-test-results.md`.**
- [x] (2026-11-09) HUMAN VERDICT (live session, user): "sounds and looks fine" - Milestone L listening gate SATISFIED.
      New findings from that session (prepared, not yet executed - see "Next" below): dead controls; master fader clips at ~30%.
- [ ] Remaining logged defects: L-3 instruments differ by decay only, not tuning (amendment 4.9 real tunings),
      L-4 no stereo image (mono-summed body chain).
- [ ] This satisfies `todo.md` M1 STOP + spec 8 gate **only after the human records the result.**
      No further UI / modulation / sample / FX / VST3 work before then (spec 0, spec 8). [SATISFIED 2026-11-09 - gate open]

## Next — prepared 2026-11-09 (user session findings; NOT yet executed)

- [ ] **P1 — master fader clips even at ~30%.** Diagnosis: `master` is applied PRE-limiter
      (src/dsp/index.js:277-284: outGain = master*lfoGain, then tanh soft limiter k=1.4, ceiling ~0.71).
      The limiter pins output at ~0.71 for any master above the point where the bus saturates, so the fader
      only reshapes drive/distortion, not loudness; at 30% the tanh is already deep in saturation = perceived clipping.
      Fix plan: move `master` trim POST-limiter (limiter becomes a pure safety), map the fader in dB
      (e.g. -60..+6 dB, default -6), A/B render before/after to prove loudness now tracks the fader.
      Verify with evidence/wav-listen-style measurements (peak + RMS vs fader position).
- [ ] **P2 — "none of the other controls do shit".** Two distinct causes:
      a) Knobs with NO DSP at all: `mode1/2/3` (partial mix), `fx.reverb.decay`, `fx.delay.feedback`,
         `fx.drive.warmth`, `fx.spatial.width` (ui/index.html:105-222). Host correctly logs them as
         provisional (webview_ui.h:274 dspAccepts list + :302 warning). Decide: implement in DSP (mode mix is
         cheap; fx.* is M3 territory) or remove/hide until spec'd. Identity lock (todo #98) allows mod strips +
         macros + blend only - fx page likely out of scope short-term: HIDE, don't fake.
      b) Params in dspAccepts that SHOULD work (macros, adsr/lfo, gourd, buzz, soundboard, pluckPos) - user
         says nothing moves. Before touching DSP, verify the live standalone path end-to-end: webview param.set
         -> g_paramSink -> `__mbira.setParam('path',v)` expr -> running QuickJS bundle. Suspect: expr string
         built with only 1 decimal `%.4f` is fine, but check g_paramSink is actually connected in live mode
         (grep main.cpp for g_paramSink wiring) and that smoothConst('master',...) rebuilds don't get dropped.
         Log per-param A/B evidence (render with MBIRA_RATIOSET-style param events) before claiming any fix.
- [ ] After P1/P2: re-run the live-session test notes (docs/manual-test-results.md Part B) with the user.
