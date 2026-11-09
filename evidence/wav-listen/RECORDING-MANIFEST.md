# WAV recording manifest — Milestone L listening pack (re-render 2)

Re-rendered 2026-11-09 by `mbira-poc render` from **HEAD `cea9d24`** (branch
`ui/visual-first-assignment`), which carries the listening-pack defect fixes
L-1/L-2 (plus the prior session's uncommitted master-smoothing/soft-limiter and
WebView2 note-forwarding work). Same native path as the M1 manifest: the real
`elem::Runtime<float>` (Elementary commit 60e7234) fed by the QuickJS-executed
bundle `build/dsp-bundle.js` (esbuild from `src/dsp/index.js`). NOT the offline
WASM renderer. 16-bit PCM stereo, 48000 Hz, block 256. No loudness
normalisation, no limiting (the tanh soft limiter in the graph is always on;
ceiling ≈ −3 dBFS).

Deterministic: the only pseudo-random term is `hash01(note, trig)`
(`src/dsp/index.js`), a pure function of note + trigger counter — two runs of
the same command produce byte-identical output.

**Shipped defaults changed since re-render 1 (defect fixes):**
- **L-2 fixed:** buzz now ships at the spec default — `cfg.buzzIntensity 0.2`
  and `"intensity": 0.2` in both instrument JSONs. The default renders
  (`dz-*`, `ny-*`, `pluck-*`) therefore include the buzz rattle.
- **L-1 fixed:** pluck weighting is now SIGNED `sin(π(i+1)p)` (0.10 floor
  keeps the sign) with energy normalisation against the p=0.5 reference
  (mode energy ∝ gain²·τ; boost capped at +20 dB). Level is constant across
  the pluck-position range and the endpoints are no longer byte-identical
  (mode-2 phase inverts past its antinode).

Default voice model in every file (PROVISIONAL): cantilever modal ratios
`[1.0, 6.27, 17.55]`, per-key `dampingTaus` from the instrument JSON, shared
5-band soundboard bank, gourd comb+bandpass (amount 0.30), amplitude-gated
buzz (intensity 0.2, char 3200 Hz), 3-mode gain from velocity/brightness/pluck
weights, ADSR on the damp gate (defaults = M1 sound), master 0.80, mono voices
summed to both channels (measured: L and R are bit-identical in all 13 files —
see L-4 below).

## Files

| File | Instrument | Events file | Length | Peak dBFS | RMS dBFS | What to listen for |
|---|---|---|---|---|---|---|
| `dz-soft.wav` | dzaVadzimu (24 keys) | `tests/events/note-soft.json` (note 60, vel 40, off 3.5 s) | 4.0 s | −16.86 | −29.22 | soft-velocity character: is there any tine "ping", or only a dull blip? |
| `dz-hard.wav` | dzaVadzimu | `note-hard.json` (note 60, vel 127) | 4.0 s | −6.60 | −19.42 | hard attack — does it sound like a fingernail/flesh pluck or like a synthetic sine burst? |
| `dz-phrase.wav` | dzaVadzimu | `tests/events/phrase.json` (60/64/67/72) | 5.0 s | −5.33 | −18.20 | 4-note phrase: pitch stability, decay shape, ringing overlap |
| `ny-soft.wav` | Nyunga Nyunga (15 keys) | `note-soft.json` | 4.0 s | −13.64 | −25.88 | same note, other instrument — is the decay audibly different from `dz-soft`? |
| `ny-hard.wav` | Nyunga Nyunga | `note-hard.json` | 4.0 s | −4.89 | −16.44 | compare with `dz-hard` |
| `ny-phrase.wav` | Nyunga Nyunga | `phrase.json` | 5.0 s | −5.06 | −16.83 | compare with `dz-phrase` — **identical pitches** (see caveat L-3 below) |
| `ab-buzz-off.wav` | dzaVadzimu | `listen-buzz-off.json` (`buzzIntensity=0.0`) | 5.0 s | −5.72 | −18.41 | baseline: no deze buzz |
| `ab-buzz-on.wav` | dzaVadzimu | `listen-buzz-on.json` (`buzzIntensity=0.2`, spec default) | 5.0 s | −5.33 | −18.20 | **+5.4 dB in 2–8 kHz**: is the added rattle convincing, harsh, or too subtle? |
| `ab-gourd-off.wav` | dzaVadzimu | `listen-gourd-off.json` (`gourdAmount=0.0`) | 5.0 s | −5.40 | −18.67 | baseline: dry board only |
| `ab-gourd-on.wav` | dzaVadzimu | `listen-gourd-on.json` (`gourdAmount=0.3`, shipped default) | 5.0 s | −5.33 | −18.20 | +1.1 dB in 60–400 Hz — is the gourd resonance audible at all? |
| `pluck-0.0.wav` | dzaVadzimu | `listen-pluck-0.0.json` (`pluckPos=0.0`) | 4.0 s | −8.33 | −21.37 | pluck at the tine end — now level-matched (L-1 fixed) |
| `pluck-0.5.wav` | dzaVadzimu | `listen-pluck-0.5.json` (`pluckPos=0.5`) | 4.0 s | −10.00 | −21.41 | pluck at the centre: reference |
| `pluck-1.0.wav` | dzaVadzimu | `listen-pluck-1.0.json` (`pluckPos=1.0`) | 4.0 s | −8.47 | −21.45 | other end — different bytes from 0.0 (mode-2 sign flip) |

Band measurements (2nd-order RBJ bandpass applied twice, first 0.3 s skipped):

- buzz off → on = −36.94 → −31.53 dBFS in 2–8 kHz (+5.4 dB)
- gourd off → on = −28.71 → −27.59 dBFS in 60–400 Hz (+1.1 dB)
- `dz-phrase` → `ny-phrase` = −21.97 → −19.64 dBFS in 100–500 Hz and
  −31.45 → −30.43 dBFS in 2–6 kHz

## Objective status of the previously logged defects (this re-render)

- **L-1 FIXED.** RMS across `pluck-0.0 / 0.5 / 1.0` = −21.37 / −21.41 /
  −21.45 dBFS (0.08 dB spread; was −41.44 vs −21.56, a 19.9 dB swing). The
  two endpoints are now different renders (mode-2 phase inversion), not
  byte-identical copies. Caveat: very near p=0/1 the sin weighting sits on the
  0.10 floor for all three modes, so timbre there is near-flat (level is
  preserved); true end-pluck physics would need cantilever mode shapes
  φᵢ(x), not a pinned-string sin model — future work.
- **L-2 FIXED.** Buzz ships at the spec default 0.2 in `cfg` and both
  instrument JSONs; the default renders now carry the rattle, and the
  "Buzz Rattle" UI knob at 0.5 macro scales a non-zero base.
- **N-6 FIXED (not audible in this pack).** A missing/unreadable
  `MBIRA_INSTRUMENT` path now logs a NOTE and falls back to the default
  64-note pool (verified: exit 0, audio renders); a file that parses but has
  an invalid key logs an ERROR and the DSP pool is left untouched
  (validation moved before the pool clear in `loadInstrument`).
- **L-3 still open — the two instruments differ by decay only, not by
  tuning.** Both are placeholder equal-tempered C major (`provisional:
  true`); amendment 4.9's real tunings are still pending.
- **L-4 still open — no stereo image.** Left and right are bit-identical in
  all 13 files; the body chain is mono-summed and mirrored.

Reproduce any file with:

```bash
MBIRA_INSTRUMENT=src/instruments/nyunga-nyunga.json \
  ./build-native/mbira-poc render evidence/wav-listen/ny-hard.wav \
  tests/events/note-hard.json --duration 4
```
