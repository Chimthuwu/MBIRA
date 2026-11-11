# MBIRA todo.md

## 2026-11-11 — shipped 2026-11-10 WIP + §5.4 preset files

- [x] **Committed the whole 2026-11-10 session** (was sitting uncommitted on `ui/visual-first-assignment`): 5 logical commits — DSP 6-partial modal engine, native scope tap + allowlist, single Play-page UI + mod strips + presets + visualizer, 20-case regression gate, docs/evidence. Verified before commit: `npm test` green (20 real-bundle renders match reference manifest; L-1 spread 0.16 dB, L-2 +10.6 dB, L-4 stereo 0.34) and native build compiles clean (GCC 16.2.0, ninja). Pushed to `Chimthuwu/MBIRA` via the Chimthuwu token. Commits `6d61c0d`..`11d4dcf`.
- [x] **§5.4 preset files on disk (partial):** versioned on-disk format (v1) — single-preset `{v,name,params}` and bank `{v,type:'bank',presets,last}` files with strict validation (unknown v rejected, non-numeric params dropped, all-invalid rejected). Export/Import buttons in the top bar: Export downloads the current 32-value patch as `.mbirapreset` JSON; Import parses single/bank, merges by name, recalls. Pure serialize/parse covered by `tests/presets/roundtrip.mjs` (now in `npm test`). Commit `7026d2a`.
- [x] **§5.4 instrument persistence DONE:** a saved/exported preset now carries the loaded instrument id and recall re-selects it (before restoring knobs) via the same instrument.select path. Validated against the INSTRUMENTS registry. Commit `9745c47`.
- [ ] **§5.4 still open:** block-atomic recall (sample-boundary swap instead of per-param ramp); `voices.max` persistence (no DSP `voices.max` param exists yet — pool is build-time fixed, so this needs a new runtime voice-count capability before it can land); and the native plugin-state round-trip.
- [ ] **Still human-gated (no change):** relaunch `mbira-poc live` and ear-confirm P1 master taper / L-4 stereo / modal.* / brightness / presets by ear; fill `docs/manual-test-results.md` Parts A–D.

## 2026-11-11 — runtime instrument selector

- [x] **Instrument selector shipped.** WebView2 UI now has an Instrument dropdown (top bar, next to Save). Selecting one sends `instrument.select {id}`; the native host resolves id→path via `resolveInstrumentPath` and pushes an `Event::LoadInstrument` onto the same bounded service-thread queue as params. `dispatchEvent` reloads the DSP (`__mbira.loadInstrument`), rebuilds the schematic geometry (`g_geom`/`g_instGeom`), and reposts the geometry envelope so the tine field swaps live. Shared `applyInstrumentText`/`applyInstrumentGeometry` factored out of `loadInstrumentFromDisk` — startup and runtime now share one load path. Commit `ddfc417`.
- [x] **Registry + test.** `src/native/main.cpp` maps `mbira-dzavadzimu`/`nyunga-nyunga` → the two instrument JSONs; `ui/js/instruments.js` is the UI source of truth; `tests/instruments/instrument-selector.test.mjs` asserts every selector id has a matching instrument JSON `id` and is wired into `npm test`. Gate green (instrument-selector OK, 2 instruments).
- [ ] **Human to confirm:** relaunch `mbira-poc live`, pick the other instrument from the dropdown, confirm the tine field swaps and the new instrument's timbre is audible on the next strike.

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

## 2026-11-10 — ground truth + P1/P2 (executed)

- [x] **Phase A2 — real-bundle regression gate.** `tests/dsp/regression.mjs` renders 7 canonical
      cases through the SHIPPED path (`build-native/mbira-poc render` + real elem::Runtime +
      QuickJS on `build/dsp-bundle.js`) and compares SHA-256 against `tests/dsp/reference-manifest.json`
      (checked in). It also re-asserts L-1 (pluck RMS spread <= 0.5 dB, endpoints distinct) and
      L-2 (buzz adds > 2 dB in 2-8 kHz). Wired into `npm test` (which now rebuilds the bundle first).
      Green at the new state: 7/7 hashes, L-1 spread 0.08 dB, L-2 +7.5 dB. Regenerate only for
      deliberate DSP changes: `node tests/dsp/regression.mjs --update`.
- [x] **Phase A1 — SHA-256 provenance for the listening pack.** Re-rendered all 13 files
      (`evidence/wav-listen/`, re-render 3) at the post-P1 DSP state; manifest now carries a
      SHA-256 column, the `dsp-bundle.js` SHA-256 anchor, and the P1 before/after table.
      Two files are duplicate hashes of `dz-phrase` by design (they ARE the defaults).
- [x] **P1 — master fader clips at ~30%: FIXED.** `master` is now a POST-limiter fader
      (`gain = p^2.5`, 0% = silence, 100% = unity); the bus gets a fixed `BUS_TRIM = 0.25` so the
      limiter stays linear in normal playing. Default fader moved 0.22 -> 1.0 in DSP + WebView2 UI +
      Win32 panel. Measured on `phrase.json` (peak dBFS at 0.22/0.3/0.5/0.8/1.0):
      before -5.33/-4.09/-3.12/-2.94/-2.93 (13 dB of travel = 2.4 dB of loudness, squashed);
      after -37.64/-30.90/-19.81/-9.60/-4.76 (26 dB of travel from 30% to 100%). Max -4.76 dBFS,
      below the -3 dBFS limiter ceiling, so no fader position can clip.
- [x] **P2a — dead controls: removed/disabled, not faked.** FX rack page + nav and `mode1/2/3`
      knobs deleted (no DSP; mode ratios are now a read-only table). Engine blend, preset dropdown and
      sample-layer M/S are explicitly disabled with pending labels (sanctioned surface, but blocked on
      recordings/preset system). Macro knob defaults corrected to 0.50/0.50/0.50 to match the DSP
      (they showed 74/42/60%). Remaining webview controls are all wired: 24 tines, 3 macros, master.
- [x] **P2b — live param path: no DSP defect found.** Last session log (`build/liveui.log`, 289 UI->host
      messages) shows `master`/`macro.*` arriving with no "provisional" warning, i.e. accepted and
      pushed to `g_paramSink` -> Event::Raw -> service thread -> `__mbira.setParam`; offline renders
      prove the DSP responds (macro A/B, body params). The "nothing works" report is explained by the
      unwired fx/mode/blend/layer controls now removed, plus P1's fader pinning.
- [x] **L-4 — stereo image (provisional): FIXED.** Each voice is constant-power panned by the tine's
      physical `x` from the instrument JSON (moderate width), and the gourd comb L/R delay lengths
      differ by ~0.7 ms so the body keeps width. Multi-note renders are no longer L==R (regression gate
      L/R difference ratio 0.334 on the phrase). Listening pack re-rendered (re-render 4). Not a
      measured mic image — PROVISIONAL until real geometry/miking is known.
- [x] **Regression gate expanded to 11 cases** covering the wired DSP params (3 macros, master) plus
      L-1, L-2 and an L-4 stereo assertion. `npm test` fails on byte or invariant drift.
- [x] **Phase A3 doc updates (audit):** `evidence/wav-m2/RECORDING-MANIFEST.md` N-6 marked fixed;
      `docs/how-to-run.md` control/modulator sections corrected (no mod-matrix UI, ratio-set story and
      fader reality); `docs/manual-test-results.md` header/defect refs updated and a post-2026-11-09
      fixes note added (Parts A-D still blank — needs the human).
- [ ] Re-run the live-session test notes with the user (docs/manual-test-results.md Part B) on the
      new UI/build; confirm the fader feels proportional and the stereo image is audible (objective
      numbers are offline; the rebuilt `mbira-poc` must be relaunched to hear P1/L-4).
- [ ] `docs/manual-test-results.md` Parts A-D still blank (needs the human).

## Next — originally prepared 2026-11-09 (P1 and P2a now executed, see above)

- [x] **P1 — master fader clips even at ~30%.** Diagnosis: `master` is applied PRE-limiter
      (src/dsp/index.js:277-284: outGain = master*lfoGain, then tanh soft limiter k=1.4, ceiling ~0.71).
      The limiter pins output at ~0.71 for any master above the point where the bus saturates, so the fader
      only reshapes drive/distortion, not loudness; at 30% the tanh is already deep in saturation = perceived clipping.
      Fix plan: move `master` trim POST-limiter (limiter becomes a pure safety), map the fader in dB
      (e.g. -60..+6 dB, default -6), A/B render before/after to prove loudness now tracks the fader.
      Verify with evidence/wav-listen-style measurements (peak + RMS vs fader position).
      DONE 2026-11-10 (power taper p^2.5 instead of linear-in-dB — see the 2026-11-10 section).
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
- [x] P2a DONE 2026-11-10 (fx/mode removed; blend/preset/layers disabled); P2b DONE 2026-11-10
      (no DSP defect found — evidence in the 2026-11-10 section).
- [ ] After P1/P2: re-run the live-session test notes (docs/manual-test-results.md Part B) with the user.

## 2026-11-10 (latest) — live distortion + master placement + small-UI labels

- [x] **Live distortion/clipping with resonance up — real cause found and fixed.**
      The safety stage was `tanh(k*x)/k` with k=1.2: only ~linear below |x|≈0.2. A loud
      chord (8 notes, vel 127) reached ~1.3 into it, i.e. >40% gain compression = the grit.
      Replaced with a stereo-linked envelope peak limiter (attack 0.1 ms, release 250 ms,
      ceiling 0.80) + −0.18 dBFS safety clamp for single-sample overshoot. Evidence:
      same 8-note chord peaks −1.2 dBFS (was −2.29 through the saturated tanh), 0 clamped
      samples, and **5.6 dB less energy >15 kHz** (−47.7 → −53.3 dBFS) = measurably less
      harmonic hash. Resonance macro top also tamed 1.4× → 1.25×; neutral 50% still 1.0×.
      Gate reseeded/re-run green (11/11, bundle dfdcc5f6c238); listening pack re-render 6.
- [x] **Master volume is now a vertical fader in the top bar next to Panic/Damp**
      (large Master Output panel removed). Same post-limiter loudness taper.
- [x] **Small-UI controls no longer hide anything.** Removed the media-query rules that hid
      the Vol label/value, the Preset label and the brand subtitle, and that collapsed the
      macro row. The same controls stay visible at every width; only spacing/type scale.
      Knob rows no longer squash (`flex:0 0 auto`, `align-content:start`) — that squashing
      was what clipped the knob labels when the window was short.
- [ ] User to relaunch `mbira-poc live` (bundle loads at host start) and confirm by ear;
      then Part B live notes.

## 2026-11-10 (later) — physical model: 6-partial modal engine + exciter

Pushing on without the collaborator recordings (user's call): the synth gains real
physical-modelling controls instead of the sample layer.

- [x] **Modal engine: 3 → 6 partials.** Modes 1-3 stay the per-key cantilever ratios
      from the instrument JSON; modes 4-6 are the next beam eigenvalues
      (34.39 / 56.84 / 84.91), amplitudes 0.17/0.10/0.06 and 9-25 ms damping, so they
      read as attack sparkle. Nyquist suppression unchanged. CPU cost measured on
      `build/stress/phrase8.json` (8 notes, real native render):
      `audio_loop_cpu_percent` 6.16 → 7.96 (+1.8 points).
- [x] **`modal.geometry`** (0..1, default 0 = measured tine): morphs partial ratios
      through free-free bar (2.756/5.404/8.933/13.34/18.64) → circular membrane
      (1.594/2.136/2.296/2.653/2.918) → open tube (odd harmonics 3/5/7/9/11).
      Interpolated in ratio space; the fundamental is never morphed, so pitch holds.
- [x] **`modal.material`** (default 0.5 = neutral): upper-mode damping 0.25× (wood) ..
      4× (steel). **`modal.decay`** (default 0.5): whole-tine ring time 0.25× .. 4×.
      Both feed the same tau table as the level normaliser, so pluck balance (L-1)
      survives — measured spread 0.16 dB.
- [x] **Exciter**: `exciter.noise` (0 = pure pluck, the mbira default) fires a
      low-passed noise burst on the note-on edge (18 ms, `exciter.hardness` = 400 Hz ..
      12 kHz). Captured at note-on like Brightness; the node is only built when the
      control is up, so defaults cost nothing.
- [x] **UI**: Tine Model page rebuilt as "Modal Resonator (6 partials)" with 6 knobs
      (Geometry / Material / Decay / Strike Pos / Strike Noise / Noise Tone), all on the
      locked per-parameter strip model (no matrix, no Mod page). Replaced the two fake
      mod chips with the sources that actually exist (velocity, random). Knobs now send
      throttled param.set while dragging (40 ms, like the faders) instead of only on
      release, so the sound follows the knob.
- [x] **Native allowlist** (`webview_ui.h dspAccepts`) + rebuilt `mbira-poc.exe`.
- [x] **Gate**: 4 new cases (`dz-modal-geo`, `dz-modal-mat`, `dz-modal-decay`,
      `dz-modal-noise`) + behaviour assertions. Measured on note 60 vel 100:
      geometry max −14.8 dB in 2-8 kHz, material max +2.8 dB, decay min −33.5 dB at
      2-3 s, strike noise max +6.8 dB in the first 30 ms. Manifest reseeded: 15 cases,
      bundle `fd36b122705b`, `npm test` green.
- [x] **Listening pack re-render 7** (13 WAVs + manifest): all defaults now render the
      6-partial model; loudest file `ny-hard` at −3.04 dBFS peak, no clipping.
- [ ] User to relaunch `mbira-poc live` and try Geometry / Material / Decay / Strike
      Noise by ear. Only the compiled host + DSP bundle changed, so a fresh launch is
      required to hear any of this.

## 2026-11-10 (later still) — one Play page, Pigments-style mod strips, real visualizers

User call: stop spreading controls over pages; everything visible together, mod
strips in a Pigments idiom, and replace the mocked scope with real audio.

- [x] **Single Play page.** Macros, the 6 modal knobs, the strips and the output
      visualizer now live on Play; the Tine Model page and its nav entry are gone.
      Layout: 3 columns (macros | model | output) on wide windows, 2 columns with
      the visualizer underneath below 1180 px, one column below 700 px. At
      1400x780 the whole page fits without scrolling; at the default window it
      scrolls (the views row is only ~166 px tall because the shell is short).
- [x] **Mod strips (removed the chip row).** Three slim vertical strips next to
      each physical dial — Velocity (amber), Key (steel blue), Random (violet) —
      drag up/down for +/-, double-click resets, keyboard arrows work. Bipolar
      fill from the centre with a cap at the depth; knobs with any depth get an
      amber halo. Each strip is a real param: `mod.<target>.<source>`.
- [x] **DSP: per-note modulation.** Sources are latched at note-on (velocity 0..1,
      board position 0..1, deterministic bipolar random) and stored per voice, so
      the effective value is `base + sum(depth*source)` clamped to range, with no
      per-sample cost. Moving a depth re-shapes ringing voices for
      Geometry/Material/Decay; Strike Pos/Noise/Tone apply on the next strike.
      Gate: `dz-mod-decay-vel` strikes the same note twice, +9.3 dB tail at +2 s
      with decay<-velocity at 1.0. 16 cases green.
- [x] **Native audio tap.** The audio thread appends the mono bus to a 4096-sample
      lock-free ring; the 30 Hz telemetry frame carries the newest 1024 samples
      (int8, ~21 ms) plus the engine sample rate. The waveform is real — idle
      draws a flat line, a struck tine drew 149 px of vertical spread vs 2 px idle.
- [x] **Visualizer ported from PsydeClip** (`ui/js/visualizer.js`): oscilloscope
      with zero-crossing trigger and constant-ish display gain, spectrum with log
      frequency axis and peak-fall smoothing, and a scrolling spectrogram with
      offscreen history + amber ramp. Scope/Spectrum/Spectrogram tabs; the UI
      computes its own 1024-point Hann FFT (46.9 Hz bins at 48 kHz).
- [x] **Native allowlist** extended with the 18 `mod.*` paths + rebuilt exe.
      Verified end-to-end over CDP: 18 strips, 3 tabs, no console errors,
      `param.set mod.decay.vel` reaches the DSP, and a real tine strike lights the
      scope from host samples.
- [x] Docs updated (`docs/how-to-run.md`: Play page, strip params, visualizer tap).
- [ ] User to relaunch `mbira-poc live` (the exe and bundle both changed).

## 2026-11-10 (later still) — free-running LFO as a fourth mod strip source

- [x] **DSP.** `cfg.pmod.<target>.lfo` for geometry/material/decay. The LFO node
      (one shared sine at `lfo.rate`) is summed into the parameter *in the graph*,
      so it is sample-accurate and keeps moving while a note rings: geometry's
      partial-ratio morph is built as a signal (piecewise-linear across the shape
      tables), and material/decay feed a signal tau into the voice's one-pole
      (elem's `pole` reads its coefficient per sample). The signal path strikes
      with a unit impulse (`env = p*env + edge`) instead of the normalised
      `(1-p)` form, because a moving coefficient would renormalise every sample
      and pump the level (~8 dB spike on the first attempt).
- [x] **Free-running, not per-note.** The LFO is always in the render, its node
      structure is stable across re-renders (rate const is keyed), so the native
      phasor keeps its phase through note-ons and knob moves. Verified: same note
      struck 0.5 s apart at 1 Hz gives a 1.9 dB different onset window; a phase
      that restarted per strike would render identically.
- [x] **UI.** Fourth strip (mint) on Geometry/Material/Decay only — `data-sources`
      on the knob decides which strips mount, so Strike Pos/Noise/Tone stay at
      three. Legend gained an LFO item with a 0.1-20 Hz rate slider and readout
      (throttled `lfo.rate` sends). Host allowlist + exe rebuilt for the three
      new paths.
- [x] **Gate.** Two new renders: `dz-mod-decay-lfo-off` / `dz-mod-decay-lfo`
      (18 cases total). Assertion: 20 ms envelope, one-LFO-period moving average
      removed, must ripple 3.6 dB with >= 3 sign changes at depth 1 and < 1 dB at
      depth 0. CDP: 21 strips with the right source sets, slider sends
      `lfo.rate 2.5`, keyboard strip sends `mod.geometry.lfo 1`, no console errors.
- [ ] User to relaunch `mbira-poc live` (exe + bundle both changed again).

## 2026-11-10 (later still) — presets capture the knobs and mod strip depths

The preset `<select>` in the top bar was a disabled stub ("Presets pending").
It is now the seed of §5.4, scoped to what can actually round-trip today.

- [x] **A preset is the whole wired patch**, not just macros: 3 macros, 6 modal
      knobs, master, `lfo.rate` and all 21 strip depths (18 per-note + 3 LFO) =
      32 values. Shape `{v:1, params:{<param path>: value}}` — the exact paths the
      UI already sends with `param.set`.
- [x] **Controls gained a {get,set} registry** (`mountFaders`/`mountKnobs`/
      `mountModStrips`), because a knob's value lives in a closure and cannot be
      set through the DOM; `lfo.rate` joins the registry by hand.
- [x] **`ui/js/presets.js`** + top-bar name box and Save button, status line in
      the footer. Storage: `localStorage['mbira.presets.v1']` (WebView2 user data
      → survives restarts); the last-used preset is restored on load and its 32
      values are re-sent, so sound and controls agree after a relaunch.
      "Acoustic Default" = the shipped snapshot captured at mount time.
- [x] **Verified over CDP**: save → 32 params stored (knob `modal.geometry` 1.0,
      strip `mod.decay.lfo` 1.0); recall → geometry 100 %, strip +100 %, master
      0.5, LFO 2.5 Hz; full page reload → same values restored and 56 `param.set`
      messages reached the host; no console errors, no top-bar overlap or
      overflow at 741 / 996 / 1400 px.
- [x] **§5.4 preset files on disk + versioned round-trip DONE (2026-11-11):** export/import `.mbirapreset` (single) and bank JSON with v1 schema validation; covered by `tests/presets/roundtrip.mjs`.
- [ ] **§5.4 still open:** block-atomic recall (sample-boundary swap vs per-param ramp), instrument + `voices.max` persistence, native plugin-state round-trip.

## 2026-11-10 (later still) — the Play page fits the default window; brightness now does something

Two things reported from actually using the app.

### Shell height: the Play page no longer scrolls at the default window

- [x] **Measured the real default window instead of guessing**: a fresh
      `mbira-poc live` is **741x528 CSS px** (dpr 1.14). Before the change the
      page needed ~759 px of a 297 px view, i.e. it scrolled by more than a
      screen. Two causes: shell chrome (topbar 130 when the right cluster
      wrapped, hero 200, status 34) and the visualizer sitting full-width under
      both panels.
- [x] **2-column reflow below 1180 px**: macros in col 1 row 1, the model panel
      spanning both rows in col 2, the visualizer under the macros in col 1
      row 2. The wide-roomy 3-panel layout is untouched above 1180 px.
- [x] **Compact shell** at `(max-height:720px)` / `(max-width:1180px and
      max-height:860px)`: single-row top bar (brand subtitle + mini meter
      hidden, master fader 42 px), hero 118, status 22, panel padding/gaps
      tightened, Play prose hidden, dials + strips 38 px. Nothing was removed
      from the Play page itself — only chrome shrank.
- [x] **Scope sizes itself**: `flex:1 1 0; min-height:0` (an `auto` basis uses
      the canvas bitmap as intrinsic height and overflowed the panel by 30 px)
      plus a `ResizeObserver` in `ui/js/visualizer.js` so the bitmap follows the
      fluid box instead of being stretched.
- [x] **Verified by CDP emulation at 1:1 CSS px** (fit = `scrollHeight <=
      clientHeight`): 675x481, 700x500, 820x560, 900x520, 1020x600, 1020x760,
      1200x700, 1400x781 all fit; at the real 741x528 the boxes are topbar 60 /
      hero 118 / view 328 / status 22 with the modal panel at 372x242 and the
      scope canvas at 325x102. Only <=620 px wide (single column) still scrolls.
- [ ] Not seen by eye on the compact layout (CSS work verified by measuring
      boxes, no screenshot). Spectrum + spectrogram were re-checked at the small
      canvas size only by a quick probe that read 0 bright px — the scope was
      verified (1119 px of trace); re-check those two modes when convenient.

### Brightness: from "doesn't do shit" to an 18 dB tilt

- [x] **Reproduced it with numbers first**: brightness 0.0 / 0.5 / 1.0 on the
      same 4-note phrase measured -39.9 / -39.3 / -38.7 dBFS in 2-8 kHz, i.e.
      **1.2 dB end to end**, and 0.0 dB overall. The macro only scaled modal
      gains at note-on, and those partials are gone in ~100 ms, so on anything
      already ringing the knob was a no-op.
- [x] **Widened the excitation half**: `bTilt` is now `2.0 - 2.0*brightness`
      (was 1.5 - brightness, and only ever 0.5..1.5).
- [x] **Added the sustained half**: a live high-shelf at 1.6 kHz on the output
      bus, gain `(brightness - 0.5) * 18 dB` (+/-9 dB) through a 30 ms smoothed
      const, so turning the knob under your fingers moves a ringing note and the
      change is click-free. Applied pre-limiter so the safety limiter still sees
      the same nominal level.
- [x] **Result**: -49.0 / -39.3 / -31.0 dBFS in 2-8 kHz (**+8.3 / -9.7 dB** from
      neutral) with the 60-400 Hz body band inside 0.04 dB - a tilt, not a gain.
      Mid-note 0 -> 1 on a ringing note adds 10.0 dB above 1.6 kHz with total
      level unchanged. Hot test (8 notes, buzz + resonance at max, brightness 1)
      peaks at -0.18 dBFS vs -0.73 neutral: +0.55 dB, so the limiter is not
      being pushed into overdrive by the macro.
- [x] **Gate tightened, not just reseeded**: `dz-bright-min` and `dz-bright-mid`
      fixtures (same phrase as `listen-macro-bright-max.json`) compare
      0.0/0.5/1.0 like-for-like and fail below 6 dB either way, or if the body
      band moves more than 2 dB (would mean the knob became a volume control).
      Gate is 20 renders and green.
- [x] UI copy no longer says "applies to the next notes you play"; the tooltip
      and the Play-page sentence describe the live tilt.
- [ ] Not confirmed by ear - measured only. If it now sounds too EQ-ish at the
      extremes, ±6 dB at 1.6 kHz is the obvious dial to turn down.
