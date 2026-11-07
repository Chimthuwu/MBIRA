# WAV recording manifest — Milestone L listening pack

Rendered 2026-11-08 by `mbira-poc render` from **HEAD `6293c17`** (branch
`ui/visual-first-assignment`), i.e. the current M2 DSP — *not* the M1 baseline
(`efb427a`, tag `m1-baseline`). Same native path as the M1 manifest: the real
`elem::Runtime<float>` (Elementary commit 60e7234) fed by the QuickJS-executed
bundle `build/dsp-bundle.js` (esbuild from `src/dsp/index.js`). NOT the offline
WASM renderer. 16-bit PCM stereo, 48000 Hz, block 256. No loudness
normalisation, no limiting.

Deterministic: the only pseudo-random term is `hash01(note, trig)`
(`src/dsp/index.js:120-123`), a pure function of note + trigger counter — two
runs of the same command produce byte-identical output.

Default voice model in every file (PROVISIONAL): cantilever modal ratios
`[1.0, 6.27, 17.55]`, per-key `dampingTaus`/`amplitudes` from the instrument
JSON, shared 5-band soundboard bank, gourd comb+bandpass, amplitude-gated buzz,
3-mode gain from velocity/brightness/pluck weights, ADSR on the damp gate
(defaults = M1 sound), master 0.80, mono voices summed to both channels
(measured: L and R are bit-identical in all 13 files).

## Files

| File | Instrument | Events file | Length | Peak dBFS | RMS dBFS | What to listen for |
|---|---|---|---|---|---|---|
| `dz-soft.wav` | dzaVadzimu (24 keys) | `tests/events/note-soft.json` (note 60, vel 40, off 3.5 s) | 4.0 s | −18.53 | −31.29 | soft-velocity character: is there any tine "ping", or only a dull blip? |
| `dz-hard.wav` | dzaVadzimu | `tests/events/note-hard.json` (note 60, vel 127) | 4.0 s | −7.05 | −21.15 | hard attack — does it sound like a fingernail/flesh pluck or like a synthetic sine burst? |
| `dz-phrase.wav` | dzaVadzimu | `tests/events/phrase.json` (60/64/67/72) | 5.0 s | −5.26 | −19.93 | 4-note phrase: pitch stability, decay shape, ringing overlap |
| `ny-soft.wav` | Nyunga Nyunga (15 keys) | `note-soft.json` | 4.0 s | −15.42 | −27.92 | same note, other instrument — is the decay audibly different from `dz-soft`? |
| `ny-hard.wav` | Nyunga Nyunga | `note-hard.json` | 4.0 s | −4.69 | −17.83 | compare with `dz-hard` |
| `ny-phrase.wav` | Nyunga Nyunga | `phrase.json` | 5.0 s | −5.42 | −18.44 | compare with `dz-phrase` — **identical pitches** (see caveat below) |
| `ab-buzz-off.wav` | dzaVadzimu | `listen-buzz-off.json` (`buzzIntensity=0.0`) | 5.0 s | −5.26 | −19.93 | baseline: no deze buzz |
| `ab-buzz-on.wav` | dzaVadzimu | `listen-buzz-on.json` (`buzzIntensity=0.2`, spec default) | 5.0 s | −4.68 | −19.70 | **+6.7 dB in 2–8 kHz**: is the added rattle convincing, harsh, or too subtle? |
| `ab-gourd-off.wav` | dzaVadzimu | `listen-gourd-off.json` (`gourdAmount=0.0`) | 5.0 s | −5.80 | −20.44 | baseline: dry board only |
| `ab-gourd-on.wav` | dzaVadzimu | `listen-gourd-on.json` (`gourdAmount=0.3`, shipped default) | 5.0 s | −5.26 | −19.93 | +0.32 dB in 60–400 Hz — is the gourd resonance audible at all? |
| `pluck-0.0-end.wav` | dzaVadzimu | `listen-pluck-0.0.json` (`pluckPos=0.0`) | 4.0 s | −27.42 | −41.44 | pluck at the tine end — **see defect L-1** |
| `pluck-0.5-centre.wav` | dzaVadzimu | `listen-pluck-0.5.json` (`pluckPos=0.5`) | 4.0 s | −9.80 | −21.56 | pluck at the centre: bright, full level (reference) |
| `pluck-1.0-otherend.wav` | dzaVadzimu | `listen-pluck-1.0.json` (`pluckPos=1.0`) | 4.0 s | −27.42 | −41.44 | **byte-identical** to `pluck-0.0-end.wav` — see defect L-1 |

Band measurements (2nd-order RBJ bandpass applied twice, first 0.3 s skipped):
buzz off → on = −54.10 → −47.38 dBFS in 2–8 kHz; gourd off → on = −24.09 →
−23.77 dBFS in 60–400 Hz; `dz-phrase` → `ny-phrase` = −24.11 → −23.11 dBFS in
100–500 Hz and −47.07 → −47.34 dBFS in 2–6 kHz.

Reproduce any file with:

```bash
MBIRA_INSTRUMENT=src/instruments/nyunga-nyunga.json \
  ./build-native/mbira-poc render evidence/wav-listen/ny-hard.wav \
  tests/events/note-hard.json --duration 4
```

## Objective findings from building this pack (no listening required)

- **L-1 — pluck position is degenerate and does not preserve level.**
  `computeGains()` (`src/dsp/index.js:141`) uses
  `w = max(0.10, |sin(π(i+1)p)|)` with **no normalisation**. At `p=0` and
  `p=1` every mode lands on the 0.10 floor, so the two extremes render
  **byte-identical audio** and 19.9 dB quieter (RMS −41.44 vs −21.56) than the
  centre. The control therefore produces a 20 dB level jump across its range
  and no audible difference between its two endpoints. *(Not fixed here —
  Milestone L forbids anything but listening-driven fixes.)*
- **L-2 — buzz is off in the shipped default.** The instrument JSON ships
  `"buzz": {"intensity": 0.0}` while `cfg.macro.buzz` only scales that value
  (`index.js:223`), so the WebView UI's "Buzz Rattle" knob can produce no sound
  until `buzzIntensity` is raised. The buzz *path itself* works: at the spec's
  default 0.2 it adds +6.7 dB in the 2–8 kHz band (`ab-buzz-on.wav`).
- **L-3 — the two instruments differ by decay only, not by tuning.**
  `mbira-dzavadzimu.json` and `nyunga-nyunga.json` assign **the same
  frequencies to every shared MIDI note** (both are placeholder equal-tempered
  C major, `provisional: true`); per-key `dampingTaus` differ
  (e.g. note 48/60 first tau 1.3826 s vs 1.2023 s). So `dz-*` vs `ny-*`
  currently demonstrates timbre, not tuning — the reason amendment 4.9's real
  tunings matter.
- **L-4 — no stereo image.** Left and right are bit-identical in all 13 files;
  the body chain is mono-summed and mirrored.
