# MBIRA — Augmented engine design (synthesis × multisampling)

Status: DESIGN ONLY (no build). Written 2026-11-27 for todo L121/L128, scoped by
the identity lock (todo #98): NO modulator matrix, NO Mod page, ever. The mod
framework v1 already ships as per-parameter mod strips (velocity / key / random
/ LFO sources latched at note-on); this doc does not redesign it.

## Goal

The engine blend (physical model <-> samples) plus a body-layer sample strip,
so a strike can be a real recorded tine layer blended with the 6-partial modal
synthesis. Blocked today on recordings from the Zimbabwean collaborator; the
design below is what gets built the day files arrive.

## Why el.sample fits

`@elemaudio/core@4.0.1` exposes `el.sample(props)` (see
`node_modules/@elemaudio/core/dist/index.d.ts:45`) plus `sampleseq`/`sampleseq2`
for keyed playback. Per voice, a sample node loads per-strike at note-on,
exactly where the mod sources (`st.src`) and gains are latched today
(`src/dsp/index.js` `buildVoiceGraph`, `noteOn`).

## Layer model (per key)

Each instrument key gains an optional `layers` array in the instrument JSON:

```json
{ "note": 60, "frequencyHz": 261.6, "x": 100,
  "layers": [ { "path": "dza/60-v1.wav", "velMin": 0,  "velMax": 0.33, "gain": 1.0 },
              { "path": "dza/60-v2.wav", "velMin": 0.33, "velMax": 0.66, "gain": 1.0 },
              { "path": "dza/60-v3.wav", "velMin": 0.66, "velMax": 1.0,  "gain": 1.0 } ] }
```

- Velocity-layer selection happens at note-on (same latch point as the mod
  sources); crossfades BETWEEN layers are NOT v1 — pick the single layer.
- `engine.blend` (0..1, default 0 = pure synthesis) crossfades the sample layer
  gain `(b)` against the modal-engine gain `(1-b)`. Both stay in the same voice
  so the shared soundboard/gourd/buzz chain sees the summed bus unchanged.
- Body layer (the "body-layer samples strip" from the identity lock): ONE shared
  body impulse/broadcast sample mixed on the bus, amount 0..1, reusing the
  gourd/soundboard insert point. Distinct from per-tine strike layers.

## Voice graph change (bounded)

1. `ensureState`/`noteOn`: add `st.sampleIdx` (selected layer) to the per-voice
   latch. Changing `engine.blend` re-renders only the blend consts (same
   SET_PROPERTY-only batch path as every other live param — no voice pool
   rebuild, no click).
2. `buildVoiceGraph`: build the `el.sample` node only when the key HAS layers
   and blend > 0 (mirrors the exciter.noise zero-cost-when-down rule).
3. Sample data must be available to QuickJS/embedded hosts: standalone reads
   from disk; the VST3 cannot — v1 embeds layers as base64 data URIs in the
   instrument header (same raw-string trick as `instrument_default.h.in`), with
   a hard size budget (approx 4 MB total) logged at build time.

## Presets / state

- `engine.blend` joins the 32-value preset patch as param `engine.blend`.
- The VST3 state chunk (v1, 'MBST') already reserves a param-pair list; the
  blend param becomes the first stored pair.
- Preset files gain `v:2` only if a breaking field is added; blend is additive
  so `v:1` files keep validating.

## UI (identity-lock compliant)

- The Play page keeps ONE blend dial + a body-amount strip; NO matrix, NO page.
- Without recordings, the blend dial stays disabled with the existing
  "pending recordings" label (already shipped as P2a).

## Open questions (owner)

1. Licence + consent for the collaborator recordings (attribution, distribution).
2. Sample rate/format target: 48 kHz mono 24-bit WAVs vs 16-bit (size budget).
3. Velocity layer count: 3 (proposed) or per-player preference.
4. Whether body-layer is one file for all keys or per-register (3 ranks).

Nothing in this doc changes shipped sound: with no layers present and
blend = 0, the graph is byte-identical to today (regression gate stays green).
