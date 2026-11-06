# WAV recording manifest — Milestone 1 evidence

All WAVs rendered by the real native path: `mbira-poc render` runs the actual
`elem::Runtime<float>` (Elementary commit 60e7234) fed by the QuickJS-executed
DSP bundle (`build/dsp-bundle.js` from `src/dsp/index.js`). NOT the offline
WASM renderer. 16-bit PCM stereo. No loudness normalization applied per file.
Deterministic: no random variation (repeated-note variation not yet implemented
— PROVISIONAL for M1).

Common conditions: Windows 10 Pro 22H2, Ryzen 5 3600, rendered offline (faster
than real time; audio loop CPU column = wall time of the process() calls only).

| File | Rate | Block | Events | Peak dBFS | Params | Render CPU (audio loop) |
|---|---|---|---|---|---|---|
| note-soft.wav | 48000 | 256 | note 60 (C4) vel 40, on t=0.5 off t=3.5 | -19.67 | mode gains [v, .5v·tilt, .28v·tilt], tilt=0.657 | 15.6% |
| note-hard.wav | 48000 | 256 | note 60 vel 127, on t=0.5 off t=3.5 | -8.23 | tilt=1.0 | 15.7% |
| phrase.wav | 48000 | 256 | notes 60/64/67/72 vel 80–110, on 0.5/0.9/1.3/1.7, offs 3.0–3.2 | -6.39 | — | 15.4% |
| param-sweep.wav | 48000 | 256 | note 60 vel 127 on t=0.5, off t=11.0 | -8.23 | mode0 0.6/0.05 at 1/2/3/4 s; mode1 0.8/0.1 at 5/6/7 s; mode2 0.9/0.05 at 8/9 s | 16.1% |
| latency256.wav | 48000 | 256 | 120 note on/off pairs (see tests/events/latency100.json), 0.2 s apart | -10.67 | — | 16.2% |
| latency128.wav | 48000 | 128 | same 120 pairs | (metrics file) | — | 17.1% |

Voice model in all files (PROVISIONAL): 3 damped modes, ratios [1.0, 2.6, 4.2]
(spec placeholder, amendment 4.7 — NOT verified acoustics), taus [1.2, 0.5, 0.22] s,
master gain 0.22, mono voices summed to both channels, el.env release (tau 30 ms)
on note-off, trigger-counter impulse excitation.

## Param sweep audible effect (amendment 4.2)

RMS (0.7 s window, 0.05 s after each change), note still ringing throughout:
baseline (all gains at vel-127 defaults) -19.3 dBFS → mode0=0.6 -17.1 →
mode0=0.05 -25.3 → mode0=0.6 -29.3 (overall decay also present) → mode0=0.05
-50.0 → mode1=0.8 -56.2 (mode1 dominates what's left) → mode1=0.1 -40.3 →
mode2=0.9 -69.0 (only mode2 remains at t=8 s; fundamental long decayed) →
mode2=0.05 -72.7. Graph never rebuilt; SET_PROPERTY batches only (see
render-log.txt batch sizes: 983–1026 bytes for mode sweeps, no CREATE_NODE).
Audio never stopped; runtime never restarted.

## Latency measurement (amendments 4.3 / 4.11)

Method: each note-on is dispatched by the render driver at a block boundary;
the metric records samples from that boundary to the first output sample with
|L| > 1e-4. Results: 128-block median 0.000 ms, worst 0.042 ms (2 samples);
256-block median 0.000 ms, worst ~0.1 ms. Interpretation: the impulse edge
lands on the first sample of the block that accepts the event, so in-block
latency ≈ 0; total software note-on-to-output latency is therefore
0–1 audio block of scheduling = 0–5.33 ms at 256 samples, 0–2.67 ms at 128.
This measures the render graph only — physical device output latency is NOT
measured here (no loopback hardware); it is UNVERIFIED.
