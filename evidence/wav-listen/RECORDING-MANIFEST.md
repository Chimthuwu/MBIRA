# WAV recording manifest — Milestone L listening pack (re-render 7)

Re-rendered 2026-11-10 from this working tree (P1 master-fader fix, P2 UI
honesty pass, L-4 stereo image, macro-audibility fix, the **limiter rework**
that fixes the live resonance distortion, and the **6-partial modal engine**
with Geometry / Material / Decay / Strike-noise controls) by `mbira-poc render`, the
same native path as the M1 manifest: the real `elem::Runtime<float>`
(Elementary commit 60e7234) fed by the QuickJS-executed bundle
`build/dsp-bundle.js` (esbuild from `src/dsp/index.js`). NOT the offline WASM
renderer.

Provenance anchor: `build/dsp-bundle.js` SHA-256 `fd36b122705bd50122bb755ffe8076c57e88056b5db201fa6a64672791352096`
(reproduce: `npm run build:dsp`, then the commands at the end).

16-bit PCM stereo, 48000 Hz, block 256. No loudness normalisation.

**Limiter (changed in re-render 6).** The old `tanh(k*x)/k` safety stage was
only ~linear for |x| < 0.2; a loud chord with resonance up reached ~1.3 into it
and was compressed by >40% — that was the audible gritty "clipping". It is now
a stereo-linked envelope peak limiter (0.1 ms attack, 250 ms release, 0.80
ceiling) plus a −0.18 dBFS safety clamp for single-sample overshoot. Measured on
an 8-note 127-velocity chord: peak −1.2 dBFS, zero clamped samples, and
**5.6 dB less energy above 15 kHz** than the tanh version (the hash that made it
sound distorted). Below the ceiling the limiter is unity gain, so normal playing
is unchanged.

**Modal engine (changed in re-render 7).** Each tine now renders **6 partials**
(modes 4-6 are the next cantilever beam eigenvalues 34.39 / 56.84 / 84.91 with
small amplitudes and 9-25 ms damping, so they read as attack sparkle and are
dropped above Nyquist). Three physical controls were added, all no-ops at their
defaults except Geometry whose default *is* the measured tine:
`modal.geometry` morphs the partial ratios to a bar (2.756 / 5.404 / 8.933 /
13.34 / 18.64), a membrane (1.594 / 2.136 / 2.296 / 2.653 / 2.918) or an open
tube (odd harmonics 3 / 5 / 7 / 9 / 11) while the fundamental stays in tune;
`modal.material` scales upper-mode damping 0.25× (wood) .. 4× (steel);
`modal.decay` scales the whole ring time 0.25× .. 4×. The exciter adds a
low-passed noise burst (`exciter.noise`, 0 = pure pluck, the mbira default;
`exciter.hardness` = 400 Hz .. 12 kHz, 18 ms decay). Measured on note 60
vel 100: Geometry max moves the 2-8 kHz band −14.8 dB, Material max +2.8 dB,
Decay min cuts the 2-3 s tail by 33.5 dB, Strike Noise max adds +6.8 dB of
2-8 kHz energy in the first 30 ms.

Deterministic: the only pseudo-random term is `hash01(note, trig)`, a pure
function of note + trigger counter — two runs of the same command are
byte-identical. `npm test` re-renders 11 canonical cases through this same
native path and fails on any byte or invariant drift.

## Which fixes ship in this pack

- **Live resonance distortion / clipping — fixed.** See the limiter note above;
  body macro gain is also tamer at the top (resonance max 1.25×, neutral 50% =
  1.0×, unchanged default sound).
- **Buzz audible** — mix scales with the macro: buzz off → on = **+10.6 dB**
  in 2–8 kHz; macro buzz max adds +3.1 dB over neutral.
- **Brightness** shapes the overtone mix **at note-on** (by design) — it reads
  on new plucks, not on a note already ringing.
- **P1 fader** post-limiter, loudness-tracking (50% = −15.1 dB).
- **L-4 stereo** (provisional), **L-1 pluck** balance, **L-2 buzz ships on**.

Default voice model in every file (PROVISIONAL): cantilever modal ratios
≈`[1.0, 6.27, 17.55, 34.39, 56.84, 84.91]` (modes 1-3 per key ±0.5% from the
instrument JSON), per-key `dampingTaus`, shared 5-band soundboard bank, gourd
comb+bandpass (amount 0.30), amplitude-gated buzz (intensity 0.2, char 3200 Hz),
6-mode gain from velocity/brightness/pluck weights, ADSR on the damp gate
(defaults = M1 sound), Geometry 0 / Material 0.5 / Decay 0.5 / Strike Noise 0
(pure pluck), fixed bus trim 0.20, unity output fader.

## Files

Peak/RMS values are measured on the left channel (stereo render). Band
definitions used elsewhere in this manifest/gate: 2nd-order RBJ bandpass
applied twice, first 0.3 s skipped — 2–8 kHz at 4 kHz / Q 1.4, 60–400 Hz at
155 Hz / Q 1.0.

| File | Instrument | Events file | Length | Peak dBFS | RMS dBFS | SHA-256 |
|---|---|---|---|---|---|---|
| `dz-soft.wav` | dzaVadzimu (24 keys) | `tests/events/note-soft.json` (note 60, vel 40, off 3.5 s) | 4.0 s | −20 | −33.05 | `0b95416848458d5f30c1c137260e90b35950b0342af23a895dd6534f8c964d0c` |
| `dz-hard.wav` | dzaVadzimu | `note-hard.json` (note 60, vel 127) | 4.0 s | −7.3 | −22.76 | `2bdd2bb0bd4ebd21c7cc323d9f5ea8638011eac4c5c28bc523bc83e3e3d49658` |
| `dz-phrase.wav` | dzaVadzimu | `phrase.json` (60/64/67/72) | 5.0 s | −6.98 | −22.59 | `fc9216897a4cf82697e15ecde4d5d5b1d43208cf2f93e8615e174456aee6f082` |
| `ny-soft.wav` | Nyunga Nyunga (15 keys) | `note-soft.json` | 4.0 s | −14.26 | −27.74 | `1e8bcc665de95ed3686dc9d48e44a6802d7465390cb6f26f98e5c0e6bfdde456` |
| `ny-hard.wav` | Nyunga Nyunga | `note-hard.json` | 4.0 s | −3.04 | −17.48 | `6be399908d26c47761274e0905d5713b4ac20eba7da703781e04e65dcba54bbc` |
| `ny-phrase.wav` | Nyunga Nyunga | `phrase.json` | 5.0 s | −3.95 | −18.07 | `a801bd9de5cb491fff337f13cb7bba3430bca296c6f76476be1b95616664d3a7` |
| `ab-buzz-off.wav` | dzaVadzimu | `listen-buzz-off.json` (`buzzIntensity=0.0`) | 5.0 s | −8.98 | −23.15 | `a969be3c9a75f7a1fba7a10014e80693b79b094bd7621fd241139d9157ba02de` |
| `ab-buzz-on.wav` | dzaVadzimu | `listen-buzz-on.json` (`buzzIntensity=0.2`, spec default) | 5.0 s | −6.98 | −22.59 | `fc9216897a4cf82697e15ecde4d5d5b1d43208cf2f93e8615e174456aee6f082` |
| `ab-gourd-off.wav` | dzaVadzimu | `listen-gourd-off.json` (`gourdAmount=0.0`) | 5.0 s | −6.97 | −23.24 | `70d341a773519b9314f2bc40390c19a7e949a781e0f46689a7b981112c0a3dd3` |
| `ab-gourd-on.wav` | dzaVadzimu | `listen-gourd-on.json` (`gourdAmount=0.3`, default) | 5.0 s | −6.98 | −22.59 | `fc9216897a4cf82697e15ecde4d5d5b1d43208cf2f93e8615e174456aee6f082` |
| `pluck-0.0.wav` | dzaVadzimu | `listen-pluck-0.0.json` (`pluckPos=0.0`) | 4.0 s | −9.54 | −24.89 | `b5a9dc418da0ea054f6590619f9dee27c4078e9f9faa119dc30373d024e44845` |
| `pluck-0.5.wav` | dzaVadzimu | `listen-pluck-0.5.json` (`pluckPos=0.5`) | 4.0 s | −12.25 | −25.05 | `4f90ddd0597e9294b99b9a8ef1c6de6a4455dae12d309bdbb27a092fc6629e69` |
| `pluck-1.0.wav` | dzaVadzimu | `listen-pluck-1.0.json` (`pluckPos=1.0`) | 4.0 s | −9.89 | −25.01 | `38c315295a6beca840b9ec41ffea1735fb14db1412e08ad6f290c917ccfae1df` |

`ab-buzz-on`, `ab-gourd-on` and `dz-phrase` are the same render (all three are
the shipped defaults), hence the identical hash — expected.

## Objective status of the logged defects

- **L-1 FIXED.** RMS across `pluck-0.0 / 0.5 / 1.0` = −24.89 / −25.05 / −25.01 dBFS (left
  channel). Caveat: near p=0/1 the weighting floors still flatten timbre; true
  end-pluck physics needs cantilever mode shapes φᵢ(x).
- **L-2 FIXED.** Buzz ships at 0.2 and is clearly audible.
- **L-4 FIXED (provisional).** Stereo image from tine panning + gourd L/R comb
  decorrelation. Not a measured mic image.
- **P1 FIXED.** Post-limiter, loudness-tracking master fader.
- **Live distortion FIXED.** Limiter rework (measured above); re-confirm by ear
  after relaunching the app.
- **L-3 still open — the two instruments differ mostly by decay, not by
  tuning.** Both are placeholder equal-tempered C major (`provisional: true`).

Reproduce any file with (from the repo root, after `npm run build:dsp`):

```bash
MBIRA_INSTRUMENT=src/instruments/nyunga-nyunga.json   ./build-native/mbira-poc render evidence/wav-listen/ny-hard.wav   tests/events/note-hard.json --duration 4
```

`npm test` includes `tests/dsp/regression.mjs`, which re-renders 15 canonical
cases through the same native path and fails if the audio bytes or the L-1,
L-2, wired-param, physical-model or L-4 invariants drift.
