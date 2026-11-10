# WAV recording manifest — `evidence/wav-m2/` (Milestone 2 evidence)

**Written 2026-11-08 during the recovery audit / Milestone L.** Spec §2.1
requires a manifest for every WAV set; this one was missing when the files were
committed (`3e69782`, `7f4a61e`, `a7051f8`). Where a parameter could not be
recovered it says so instead of guessing.

Common conditions for all 17 files: rendered by `mbira-poc render` — the real
`elem::Runtime<float>` (Elementary commit 60e7234) fed by `build/dsp-bundle.js`
(QuickJS). NOT the offline WASM renderer. 48 kHz, 16-bit PCM, **stereo buffers
whose left and right are bit-identical in every file** (the voice bus is mono,
summed to both channels). No loudness normalisation. Default instrument:
`src/instruments/mbira-dzavadzimu.json` unless noted; default ratio set
`cantilever`. Parameters are applied as `{"type":"param","name":…,"value":…}`
events inside the render, so each file is deterministic.

Provenance was re-established by re-rendering at HEAD `6293c17` and comparing
SHA-256 (first 12 hex chars below).

| File | Dur | Peak dBFS | RMS dBFS | sha256(12) | Event file | Provenance at HEAD |
|---|---|---|---|---|---|---|
| `macro-bright.wav` | 3 s | −9.37 | −22.05 | `d27d94c29fc3` | `tests/events/m2-macro-bright.json` | **verified** byte-identical |
| `macro-dark.wav` | 3 s | −9.79 | −22.08 | `1db24ce25deb` | `tests/events/m2-macro-dark.json` | **verified** |
| `macro-res-max.wav` | 3 s | −6.87 | −18.24 | `b7a3a81891c9` | `tests/events/m2-macro-res-max.json` | **verified** |
| `macro-res-off.wav` | 3 s | −12.83 | −26.24 | `17eb5dd8d4ef` | `tests/events/m2-macro-res-off.json` | **verified** |
| `mod-tremolo.wav` | 4 s | −7.80 | −22.76 | `055d946a226e` | `tests/events/m2-lfo-tremolo.json` | **verified** |
| `mod-adsr.wav` | 4 s | −18.05 | −26.54 | `48d1507695ab` | `tests/events/m2-adsr-swell.json` | **verified** |
| `default-check.wav` | 4 s | −14.67 | −27.74 | `701c28466da4` | `tests/events/m2-note-soft.json` (vel 60, no note-off) | **verified** |
| `mod-pitch.wav` | 4 s | −9.58 | −23.27 | `4de3e1d8f615` | `tests/events/m2-lfo-pitch.json` | expected match; **not re-rendered** |
| `dbg-res-max.wav` | 3 s | −6.87 | −18.24 | `b7a3a81891c9` | — | **duplicate** of `macro-res-max.wav` (byte-identical) |
| `dbg-res-off.wav` | 3 s | −12.83 | −26.24 | `17eb5dd8d4ef` | — | **duplicate** of `macro-res-off.wav` |
| `note-soft.wav` | 4 s | −14.71 | −28.14 | `6d6c1a98e22c` | unknown (not `note-soft.json`, not `m2-note-soft.json`) | **not reproducible** — see N-1 |
| `ab-cantilever.wav` | 4 s | −14.71 | −28.14 | `6d6c1a98e22c` | — | **duplicate of `note-soft.wav`** — see N-2 |
| `ab-classic.wav` | 4 s | −14.64 | −28.04 | `9492a0d72175` | `note-soft.json` + `MBIRA_RATIOSET=classic` (assumed) | **not reproducible** — see N-1/N-3 |
| `note-hard.wav` | 4 s | −7.32 | −21.54 | `3479db430625` | unknown (not `note-hard.json`, not `m2-note-hard.json`) | **not reproducible** — see N-1 |
| `inst-dzavadzimu.wav` | 8 s | **0.00** | −12.98 | `c33f761f484e` | unknown (not `phrase.json`, not `m2-phrase.json`) | **not reproducible** — see N-1/N-4 |
| `inst-nyunga.wav` | 8 s | −2.20 | −14.02 | `cb03a9d2417d` | unknown (not `m2-phrase.json` + `MBIRA_INSTRUMENT=nyunga…`) | **not reproducible** — see N-1/N-4 |
| `phrase-body.wav` | 8 s | **0.00** | −13.55 | `f42d8e717bd9` | unknown (not `phrase.json`, not `m2-phrase.json`) | **not reproducible** — see N-1/N-4 |

Re-render any verified row, e.g.:

```bash
./build-native/mbira-poc render /tmp/check.wav tests/events/m2-macro-bright.json --duration 3
# -> sha256(d27d94c29fc3…) == evidence/wav-m2/macro-bright.wav
```

## Notes and findings

- **N-1 — 7 of 17 files cannot be reproduced from HEAD.** `note-soft`,
  `note-hard`, `ab-classic`, `inst-dzavadzimu`, `inst-nyunga`, `phrase-body`
  (and `ab-cantilever`, which is a byte-copy of `note-soft`) do not match a
  re-render at HEAD with any committed event file, any block size (128/256/512
  tried) or `MBIRA_VOICES`. Most likely they were rendered **before the
  instrument framework landed** (`a7051f8`): since then `ratiosFor()`
  (`src/dsp/index.js:98-103`) prefers the per-key `modalRatios` from the
  instrument JSON over `RATIO_SETS`, and the per-instrument body config
  differs, so the same event file produces different audio than it did in the
  `7f4a61e`–`a7051f8` window. **ASSUMPTION** — confirming it needs a rebuild at
  that commit (not done; out of Milestone L scope). The remaining 7 files'
  event files were never committed (`git log --diff-filter=D -- tests/events`
  finds nothing, so they were ad-hoc and discarded).
- **N-2 — three files are exact copies.** `ab-cantilever` = `note-soft`,
  `dbg-res-max` = `macro-res-max`, `dbg-res-off` = `macro-res-off`. The A/B
  pair is therefore one file plus one real A/B file, not two.
- **N-3 — the classic-vs-cantilever A/B is now inert by default.**
  `MBIRA_RATIOSET=classic` had no effect at HEAD (both variants produced
  `701c28466da4`, identical to the plain render) because the loaded instrument
  supplies per-key `modalRatios`, which take precedence in `ratiosFor()`.
  Re-running the M1/M2 ratio A/B now requires an instrument JSON without
  `modalRatios`, or a code path that lets the global set win. Measured from
  the committed pair over the attack window (0.50–0.60 s): cantilever
  −52.88 dB vs classic −58.00 dB in 2–6 kHz (**+5.1 dB**), and −67.51 vs
  −73.42 dB over the whole tail (+5.9 dB). `todo.md:86` claims "attack band
  2.7× brighter" — 2.7× = 8.6 dB, which does not reproduce with this metric;
  the metric used at the time was not recorded.
- **N-4 — two files exceed the spec's peak target.** `inst-dzavadzimu.wav` and
  `phrase-body.wav` peak at **0.00 dBFS**; spec §4.11 requires ≤ −0.5 dBFS.
  Nothing is lost in the file (int16 full scale, not clipped by normalisation
  — the render does not normalise), but the signal reached full scale. Same for
  `inst-nyunga.wav` at −2.20 dB (inside target).
- **N-5 — no stereo image anywhere.** Left = right in all 17 files.
- **N-6 — `MBIRA_INSTRUMENT` with a bad path crashes the host.** Fixed at
  `cea9d24`: the loader catches `choc::file::Error` as well as
  `choc::json::ParseError`, prints a `NOTE:` and falls back to the default
  64-note pool, and malformed JSON is rejected before clearing the current
  instrument. (Originally observed with `MBIRA_INSTRUMENT=src/instruments/__none__.json`.)
