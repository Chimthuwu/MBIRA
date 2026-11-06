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
