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

## Control panel (M2)

`live` (with UI) now has a physical-model control panel under the tine keyboard:

- **Pluck position** (0 = tine end, 0.5 = centre, 1 = other end) - changes how
  bright the NEXT note-on is.
- **Master** volume.
- **SOUNDBOARD (resonator)** - the shared 5-band body resonator bank; Enable
  toggle + amount. Off = dry tines.
- **GOURD (deze)** - Enable + amount + frequency (80-400 Hz). Off = bypassed.
- **BUZZ** - Enable + intensity + character (rattle tone centre). Off by default.
- **Tine: cantilever / classic** button - A/B the modal ratio sets
  (cantilever = justified physics default, classic = M1 placeholder).

All controls go through the same bounded event queue as MIDI (service thread
runs the JS renderer; audio thread untouched). All parameters PROVISIONAL.

## Instruments (M2)

The standalone/plugin loads `src/instruments/mbira-dzavadzimu.json` at startup
(override with `MBIRA_INSTRUMENT=src/instruments/nyunga-nyunga.json`). The
keyboard layout in the UI comes from the loaded instrument's schematic
coordinates. Edit the JSON to change tunings/layouts - no code changes needed
(all marked PROVISIONAL). Validate with `npm test`.

## Modulator framework (M2, Pigments-style)

Named parameters (UI binds via `setParam`):

| Param | Range | Default |
|---|---|---|
| `adsr.attack` / `adsr.release` | 0.2 ms - 0.5 s / 5 ms - 2 s | instant / 30 ms |
| `adsr.sustain` | 0-1 | 1 |
| `lfo.rate` | 0.1-20 Hz | 5 |
| `mod.lfoToPitch` | depth (0.01 = ~+/-1%) | 0 |
| `mod.lfoToMaster` | depth (tremolo) | 0 |
| `random.amount` | per-note jitter depth | 0.04 |
| `vel.amp` / `vel.bright` | velocity->amp/brightness | 1 / 1 |

Defaults reproduce the M1 sound exactly (within ~0.4 dB from the master-bus
move). The interim Win32 panel has a MODULATORS row with these controls;
the WebView2 UI should build the full routing matrix on this param set.
Evidence: evidence/wav-m2/mod-tremolo.wav, mod-pitch.wav, mod-adsr.wav.
