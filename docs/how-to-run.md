# MBIRA — How to run and play the Milestone 1 proof of concept

## Prerequisites (one-time)

- MinGW-w64 GCC at `deps/bin/winlibs/mingw64/bin` (pinned WinLibs r3, see `deps/manifest.json`)
- CMake ≥ 3.20 + Ninja, Node ≥ 20 (only for building the DSP bundle)

## Build

```bash
# 1. DSP bundle (JS graph -> single QuickJS script)
npm install
npm run build:dsp          # -> build/dsp-bundle.js

# 2. Native host (MinGW on PATH so CMake finds gcc)
export PATH="$PWD/deps/bin/winlibs/mingw64/bin:$PATH"   # git-bash; on cmd: set PATH=...
cmake -B build-native -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build-native # -> build-native/mbira-poc.exe
```

## Render the evidence WAVs (no audio device or MIDI needed)

From the repo root:

```bash
./build-native/mbira-poc.exe render evidence/wav/note-soft.wav  tests/events/note-soft.json  --duration 4
./build-native/mbira-poc.exe render evidence/wav/note-hard.wav  tests/events/note-hard.json  --duration 4
./build-native/mbira-poc.exe render evidence/wav/phrase.wav     tests/events/phrase.json     --duration 5
./build-native/mbira-poc.exe render evidence/wav/param-sweep.wav tests/events/sweep.json     --duration 12
```

Each run prints a metrics JSON line (latency + audio-loop CPU) and a peak dBFS.
Event files are plain JSON: `{"events":[{"t":0.5,"type":"on","note":60,"vel":100}, ...]}`
with types `on`, `off`, `param` (`mode` 0–2, `value`), `alldamp`.

## Play it live (needs an audio device; MIDI optional)

```bash
./build-native/mbira-poc.exe live --block 256 --rate 48000
```

Uses the default Windows output device (WinMM/MME) and the first MIDI input
port if one exists (RtMidi; it reports the port name or prints that none was
found). Play your MIDI controller; Ctrl+C to quit.
`MBIRA_VOICES=N` env shrinks the voice pool for CPU tests.
`MBIRA_BUNDLE=path` loads an alternative DSP bundle.
`MBIRA_TRACE=1` traces per-block levels and applied instruction batches.

## What you should hear

A metallic plucked tine with three decaying partials (ratios 1.0 / 2.6 / 4.2 —
PROVISIONAL placeholder, not verified mbira acoustics), soft attack, ~1.2 s
fundamental ring, quick ~300 ms damp release on note-off. In `param-sweep.wav`
the timbre of a held note audibly changes as each mode's gain is swept.

Judgement of whether it sounds like an mbira is yours (agent cannot listen).

## Control panel

Two UIs exist:

- **WebView2 UI** (default `live`): a 24-key schematic board, a master fader in
  the top bar, and **one Play page** holding every wired control: the 3 macros
  (Resonance / Buzz / Brightness), the 6 physical-model knobs (Geometry /
  Material / Decay / Strike Pos / Strike Noise / Noise Tone), a modulation strip
  beside each of those knobs, and the live output visualizer (Scope / Spectrum /
  Spectrogram). Body & Deze and Samples remain separate pages for the pending
  sample work. The FX rack, mode/blend and sample controls were removed or
  disabled because they had no DSP behind them — only wired controls are shown.
  `macro.buzz` scales the buzz rattle (buzz ships on at the spec default
  intensity).
- **Interim Win32 GDI panel** (`--ui gdi`, legacy): pluck position, master,
  SOUNDBOARD / GOURD / BUZZ (enable + amount/frequency/character) and tine
  ratio-set A/B. The master fader is now post-limiter and loudness-tracking
  (unity at the right, silence at the left).

All controls go through the same bounded event queue as MIDI (service thread
runs the JS renderer; audio thread untouched). All parameters PROVISIONAL.

## Instruments (M2)

The standalone/plugin loads `src/instruments/mbira-dzavadzimu.json` at startup
(override with `MBIRA_INSTRUMENT=src/instruments/nyunga-nyunga.json`). The
keyboard layout in the UI comes from the loaded instrument's schematic
coordinates. Edit the JSON to change tunings/layouts - no code changes needed
(all marked PROVISIONAL). Validate with `npm test`.

## Modulator framework (engine internals)

Named parameters (`setParam`) — **engine internals, not a mod matrix UI** (the
locked identity has no modulator page; the UI exposes only the 3 macros + master):

| Param | Range | Default |
|---|---|---|
| `adsr.attack` / `adsr.release` | 0.2 ms - 0.5 s / 5 ms - 2 s | instant / 30 ms |
| `adsr.sustain` | 0-1 | 1 |
| `lfo.rate` | 0.1-20 Hz | 5 |
| `mod.lfoToPitch` | depth (0.01 = ~+/-1%) | 0 |
| `mod.lfoToMaster` | depth (tremolo) | 0 |
| `random.amount` | per-note jitter depth | 0.04 |
| `vel.amp` / `vel.bright` | velocity->amp/brightness | 1 / 1 |

Defaults reproduce the M1 sound (within ~0.4 dB from the master-bus move).
The interim Win32 GDI panel (`--ui gdi`) still exposes these as a MODULATORS
row for debugging; the WebView2 UI does not. Evidence:
evidence/wav-m2/mod-tremolo.wav, mod-pitch.wav, mod-adsr.wav.

## Macros (the UI-facing knobs)

`macro.resonance` (soundboard band gains + gourd amount), `macro.buzz`
(rattle intensity), `macro.brightness` (overtone tilt). All 0..1, 0.5
neutral. Brightness is two things in one knob, because either alone was barely
audible: it opens the excitation on the pluck (mode weights b^(2i) at 0 .. b^0
at 1) AND it drives a live high-shelf on the output bus (+/-9 dB at 1.6 kHz,
smoothed), so turning it under your fingers changes notes that are already
ringing. Measured on a 4-note phrase: 8.3 dB up / 9.7 dB down in 2-8 kHz with
the body band (60-400 Hz) inside 0.05 dB - a tilt, not a volume control. The
regression gate asserts both halves. These are the three knobs the product UI's Play page shows;
per the locked identity there is NO modulator matrix in the UI - ADSR/LFO/
random/velocity params are engine internals for per-parameter mod strips.

## Physical model (modal resonator + exciter)

Six partials per tine. Modes 1-3 are the per-key cantilever ratios from the
instrument JSON; modes 4-6 are the next beam eigenvalues, low level and short
decay (attack sparkle). Named parameters, all 0..1 and all wired:

| Param | Range | Default | Effect |
|---|---|---|---|
| `modal.geometry` | 0-1 | 0 | 0 = steel tine, 0.33 = free-free bar, 0.67 = membrane, 1 = open tube. Morphs the partial ratios; the fundamental stays in tune. |
| `modal.material` | 0-1 | 0.5 | Upper-mode damping 0.25x (wood) .. 4x (steel), 1x at 0.5. |
| `modal.decay` | 0-1 | 0.5 | Whole-tine ring time 0.25x .. 4x, 1x at 0.5. |
| `pluckPos` | 0-1 | 0.30 | Strike position (signed partial weighting, energy-normalised). |
| `exciter.noise` | 0-1 | 0 | Strike transient: 0 = pure pluck, up to a hard-mallet click. Applied at note-on. |
| `exciter.hardness` | 0-1 | 0.5 | Noise-burst tone, 400 Hz .. 12 kHz. |

Geometry and Material change the tone of notes already ringing; Strike Noise /
Noise Tone are captured at note-on (like Brightness). `pluckPos` is the same
parameter the GDI panel calls PLUCK. Evidence: the 16-case regression gate in
`tests/dsp/regression.mjs` asserts all four behave (geometry -14.8 dB in
2-8 kHz, material +2.8 dB, decay -33.5 dB at 2-3 s, strike noise +6.8 dB in
the first 30 ms), and `evidence/wav-listen/` re-render 7 is the listening pack.

## Modulation strips (per parameter, no matrix)

Each physical knob carries slim strips — Velocity, Key, Random, and (on the
continuous targets) LFO — and the depth is dragged up (+) or down (-) with a
double-click to reset. This is the whole modulation UI: still no modulator page
and no routing matrix, per the locked identity.

| Param | Range | Source value |
|---|---|---|
| `mod.<target>.vel` | -1..1 | strike force 0..1 |
| `mod.<target>.key` | -1..1 | tine position on the board 0..1 |
| `mod.<target>.rnd` | -1..1 | deterministic bipolar random per strike |
| `mod.<target>.lfo` | -1..1 | free-running LFO, bipolar -1..1 |

`<target>` is `geometry`, `material`, `decay`, `pluck`, `noise` or `hardness`.

## Presets

The top bar's preset menu saves and recalls a **named snapshot of every wired
control**, not just the macros: 3 macros, 6 modal knobs, master, `lfo.rate` and
all 21 modulation-strip depths (18 per-note + 3 LFO) = 32 values. Type a name and
hit Save (or Enter); choose a preset to recall it. "Acoustic Default" is the
shipped sound, captured from the controls before anything is touched.

- Snapshot shape: `{ v: 1, params: { "modal.geometry": 0.8, "mod.decay.lfo": 0.5, ... } }`
  — the same paths the UI already posts with `param.set`, so a recall is a real
  parameter change, not a UI-only label.
- Storage: `localStorage['mbira.presets.v1']` inside the WebView2 user-data
  folder, so presets and the last-used preset survive an app restart (the UI
  restores it and re-sends every value, so the sound matches the controls).
- Not the §5.4 backend yet: there are no preset files in the repo, no plugin
  state round-trip, and a recall posts one `param.set` per value (each ramps
  click-free, but the snapshot is not swapped at a single block boundary).
  Those land with the plugin work; the snapshot shape above is what they will
  persist.
The effective value is `base + sum(depth * source)`, clamped to the param
range. Velocity/Key/Random are latched per voice in `noteOn()`, so moving a
depth re-shapes voices that are still ringing (Geometry/Material/Decay) while
the attack-captured targets (Strike Pos/Noise/Tone) apply to the next strike.

**The LFO is different: it modulates continuously.** It is one shared sine
oscillator (`lfo.rate`, 0.1-20 Hz, slider in the strip legend, default 5 Hz)
summed into the parameter *as a signal* inside the audio graph, not sampled per
strike. Geometry turns the partial-ratio morph into a per-sample signal, and
Material/Decay feed a signal ring time into the voice's one-pole filter (which
reads its coefficient every sample), so notes keep morphing for as long as they
sound. Phase lives in the native phasor and its node structure is stable across
re-renders, so the LFO runs free: it does not restart on note-on or on a knob
move. Only these three targets carry an LFO strip - Strike Pos/Noise/Tone exist
only at the moment a note starts, so the UI does not offer a control there.

Evidence: `tests/dsp/regression.mjs` `dz-mod-decay-vel` strikes the same note
twice and asserts the second (decay<-velocity depth 1) rings 9.3 dB longer at
+2 s. `dz-mod-decay-lfo` renders that note with the LFO depth at 0 and at 1: the
20 ms envelope ripples 0.3 -> 3.6 dB at the 1.5 Hz LFO rate and changes sign 5
times across the ring (a per-note source could only step once). A separate
render strikes the same note 0.5 s apart at 1 Hz and the onset windows differ by
1.9 dB, i.e. the LFO phase is still running; if it restarted per strike they
would be identical.

## Output visualizer

Play page bottom panel: **Scope / Spectrum / Spectrogram**, ported from the
PsydeClip visualizer. It draws real audio, not a mock: the audio thread appends
the mono bus to a 4096-sample lock-free ring, and the UI thread copies the
newest 1024 samples (~21 ms at 48 kHz, one scope sweep) into each 30 Hz
telemetry frame with the engine sample rate. The UI runs its own 1024-point
FFT (Hann, 46.9 Hz bins) for the spectrum and the scrolling spectrogram, so a
silent engine draws a flat line and silence.
