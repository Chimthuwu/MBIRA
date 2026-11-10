// MBIRA Milestone 2 — Elementary DSP graph: tine, excitation, shared body.
//
// Runs inside QuickJS embedded in the native host (same execution model as M1).
// Continuous parameters and note events are keyed `el.const` nodes: re-rendering
// with changed values makes the reconciler emit SET_PROPERTY for those nodes
// only (lock-free atomics on the native side). The soundboard / gourd / buzz
// chain uses STABLE KEYS for its stateful nodes so the same native node
// instances (and their filter state) persist across re-renders — the shared
// body state survives note events (spec 4.5).
//
// ----------------------------------------------------------------------------
// Tine model (spec 3.1) — 6-mode physical model
//   edge_i(t)  = trig - z(trig)                              // impulse per retrigger
//   env_i(t)   = norm_i * smooth(tau2pole(tau_i), edge_i)    // exponential decay
//   mode_i(t)  = gain_i(t) * env_i(t) * sin(2*pi*f*ratio_i*t)
//   damp(t)    = env(fastAtk, 30ms rel, dampGate)            // note-off release
//   voice      = damp * (sum_i mode_i + exciter burst)
//                (level is the post-limiter fader)
//
//   Modal ratios: PROVISIONAL-JUSTIFIED (amendment 4.7). An mbira tine is a
//   clamped-free (cantilever) beam; its mode frequencies follow the beam
//   eigenvalue squares (beta_n = 1.875, 4.694, 7.855, 10.996, 14.137, 17.279):
//       cantilever: ratios [1.0, 6.27, 17.55, 34.39, 56.84, 84.91]
//   Modes 1-3 come from the instrument JSON per key; modes 4-6 are the next
//   beam eigenvalues (their gains are small and they decay in ~10-25 ms, so
//   they read as attack sparkle, not as sustained overtones) and are dropped
//   above Nyquist. The M1 placeholder set [1.0, 2.6, 4.2] is kept as
//   "classic" for A/B comparison. Per-tine overrides replace any of this.
//
//   Physical controls (modal.*, modelled on the Mutable Elements / Pigments
//   modal approach):
//     modal.geometry  0 = instrument tine, then three resonator shapes are
//                     morphable: free-free bar (2.756, 5.404, 8.933, 13.34,
//                     18.64), circular membrane (1.594, 2.136, 2.296, 2.653,
//                     2.918), open tube (odd harmonics 3, 5, 7, 9, 11).
//                     Ratios interpolate; the fundamental never moves.
//     modal.material  upper-mode damping: 0 = wood (upper partials die 4x
//                     faster), 0.5 = neutral (the measured tine), 1 = steel
//                     (upper partials ring 4x longer, bell-like).
//     modal.decay     overall ring time, 0.25x .. 4x (mode 0 included).
//   Exciter (exciter.*): a filtered noise burst fired with the impulse edge,
//   12 ms decay, cutoff 400 Hz .. 12 kHz. 0 = pure pluck (the mbira default),
//   higher = the click of a harder mallet. Like brightness, it is captured at
//   note-on, so it shapes the next notes you play.
//
//   Modulation strips (identity: NO mod matrix, NO mod page): each physical
//   knob has per-note sources — velocity (0..1), key position (0..1) and a
//   deterministic bipolar random per strike — with a depth in [-1,1]. The
//   effective value is base + sum(depth * source), clamped per parameter, and
//   those sources are latched at note-on (no per-sample modulation cost).
//   Geometry, Material and Decay additionally take a free-running LFO source
//   (one shared sine oscillator, cfg.lfo.rate) with a depth in [-1,1]: it is
//   summed into the parameter AS A SIGNAL, so it keeps moving while the note
//   rings instead of being sampled once per strike. Strike-time parameters
//   (pluck position, exciter noise/tone) have no LFO strip: they only exist at
//   the moment a note starts.
//
//   Nyquist suppression: any mode with f * ratio > 0.45 * sampleRate is
//   omitted (gain 0) with a safety margin; setSampleRate() rebuilds the pool.
//
// Excitation (spec 3.2)
//   v = velocity/127                       // linear amplitude
//   b = 0.5 + 0.5*v                        // brightness: harder = brighter
//   base_i      = [1.0, 0.5, 0.28][i]
//   gain_i      = base_i * v * b^i         // documented brightness curve
//   pluck w_i   = max(0.10, |sin(pi * (i+1) * p)|)   // pluck position p in [0,1]
//                 p=0/1 -> tine end (strong upper modes), p=0.5 -> centre
//   variation   = 1 + 0.04 * (h - 0.5), h = hash(note, trigCount)   // deterministic
//
// Shared body (spec 3.3, all PROVISIONAL approximations)
//   soundboard: ONE 5-band resonator bank (svf bandpass, keyed) on the summed
//               voice bus; single shared instance, state persists per 4.5.
//   gourd:      comb (feedback delay) + bandpass at gourdFreq, amount mix,
//               bypass = amount 0. Driven by the bus (not a static parallel FX).
//   buzz:       amplitude-gated rattle: tanh(k * env(bus) * bandpass(bus, char)).
//               Correlated with playing strength; NOT static noise.

import { Renderer, el } from '@elemaudio/core';

const NMODES = 6;
const RATIO_SETS = {
  cantilever: {
    ratios: [1.0, 6.27, 17.55, 34.39, 56.84, 84.91],
    taus: [1.2, 0.20, 0.045, 0.025, 0.014, 0.009],
  },
  classic: { // M1 placeholder, A/B only
    ratios: [1.0, 2.6, 4.2, 8.0, 13.0, 19.0],
    taus: [1.2, 0.5, 0.22, 0.12, 0.07, 0.045],
  },
};
// 1/n-ish roll-off of the mode amplitudes; the extra modes are attack sparkle.
const BASE_GAINS = [1.0, 0.5, 0.28, 0.17, 0.10, 0.06];
// Geometry morph targets (indices 1..3 for modal.geometry 0.34 / 0.67 / 1.0).
// Ratio 0 is always the instrument's fundamental, so pitch never shifts.
const GEOMETRY_TARGETS = [
  [1.0, 2.756, 5.404, 8.933, 13.34, 18.64], // free-free bar
  [1.0, 1.594, 2.136, 2.296, 2.653, 2.918], // circular membrane
  [1.0, 3.0, 5.0, 7.0, 9.0, 11.0],          // open tube (odd harmonics)
];
// Nominal bus level feeding the safety limiter. Kept conservative so macro
// resonance/body boosts (which add energy on top of the dry bus) have headroom
// and don't push the limiter into audible saturation/distortion. The post-limiter
// fader (unity max) delivers the final loudness.
const BUS_TRIM = 0.20;
// Output fader position 0..1, applied AFTER the limiter so the fader controls
// loudness instead of limiter drive. Default = unity.
// Taper: gain = p^2.5, i.e. 100% = 0 dB, 80% = -4.8 dB, 50% = -15 dB,
// 30% = -26 dB, 0% = silence. A straight linear-in-dB taper (-60..0 dB) was
// rejected: it puts everything below 80% travel under -12 dB and feels dead.
const MASTER_DEFAULT = 1.0;
const FADER_TAPER = 2.5;

function faderGain(p) {
  if (p <= 0.005) return 0.0; // bottom of travel = silence
  return Math.pow(p, FADER_TAPER);
}

const core = new Renderer((batch) => {
  __postNativeMessage__(JSON.stringify(batch));
});

// Global config; every change re-renders (SET_PROPERTY or rebuild, off audio thread).
const cfg = {
  sampleRate: 48000.0,
  ratioSet: 'cantilever',
  master: MASTER_DEFAULT,
  pluckPos: 0.30,        // 0 = tine end, 0.5 = centre, 1 = other end
  soundboard: 0.35,      // wet amount of the shared resonator bank
  gourdAmount: 0.30,
  gourdFreq: 170.0,      // Hz, PROVISIONAL
  instrumentName: 'Default 64-voice range',
  buzzIntensity: 0.2,    // 0..1, spec default 0.2 (fix L-2: shipped off by mistake)
  buzzChar: 3200.0,      // Hz, PROVISIONAL
  // --- modulator framework (Pigments-style sources -> destinations) ---------
  // Defaults are no-ops: attack ~= instant, sustain = 1, release = M1 value,
  // LFO depths 0, random/velocity depths = M1 behaviour.
  adsr: { attack: 0.0002, release: 0.03, sustain: 1.0 }, // seconds / level
  lfo: { rate: 5.0 },                                    // Hz
  mod: { lfoToMaster: 0.0, lfoToPitch: 0.0 },            // route depths
  random: { amount: 0.04 },                              // per-note variation depth
  vel: { amp: 1.0, bright: 1.0 },                        // velocity->amp/brightness depths
  // --- macros (the UI-facing sound-shaping knobs; 0..1, 0.5 = neutral) ------
  macro: { resonance: 0.5, buzz: 0.5, brightness: 0.5 },
  // --- physical model (modal resonator + exciter) --------------------------
  modal: { geometry: 0.0, material: 0.5, decay: 0.5 }, // 0.5 = neutral except geometry
  exciter: { noise: 0.0, hardness: 0.5 },              // 0 = pure pluck
  // --- per-parameter modulation strips (identity: NO matrix, NO mod page) --
  // depth per (target, source), -1..1. vel/key/rnd are per-note and therefore
  // free of per-sample DSP cost (vel = strike force 0..1, key = position on the
  // board 0..1, rnd = deterministic bipolar variation per strike); lfo is the
  // shared free-running oscillator (bipolar -1..1) and is summed in-graph, so it
  // modulates ringing notes continuously. Only the continuous targets
  // (geometry/material/decay) carry an lfo depth: pluck/noise/hardness exist
  // only at note-on. A target's value is base + sum(depth * source), clamped to
  // the param range.
  pmod: {
    geometry: { vel: 0.0, key: 0.0, rnd: 0.0, lfo: 0.0 },
    material: { vel: 0.0, key: 0.0, rnd: 0.0, lfo: 0.0 },
    decay:    { vel: 0.0, key: 0.0, rnd: 0.0, lfo: 0.0 },
    pluck:    { vel: 0.0, key: 0.0, rnd: 0.0 },
    noise:    { vel: 0.0, key: 0.0, rnd: 0.0 },
    hardness: { vel: 0.0, key: 0.0, rnd: 0.0 },
  },
};

// Per-tine modal overrides: midiNote -> { ratios?, taus?, gains? } (JSON-driven).
const tineOverrides = new Map();

// Voice pool: spec 3.1 requires 64 preallocated voices (notes 48..111).
const POOL_MIN = 48;
const POOL_MAX = 48 + 64 - 1;
const voiceState = new Map(); // midiNote -> { freq, trig, damp, gains[3], sustained }
const voiceOrder = [];        // note-on order for voice stealing

// Sustain pedal (CC64): note-offs while held become pedal-sustained.
let sustainHeld = false;
const sustainedNotes = new Set();

// ---- per-parameter modulation (per-note sources) ---------------------------
// The source values are captured at note-on (st.src) and the depths live in
// cfg.pmod, so turning a depth up re-renders every ringing voice immediately
// while the base knob keeps morphing live — no per-sample cost, no matrix UI.
function modSource(note, trig, vel) {
  const span = Math.max(1, POOL_MAX - POOL_MIN);
  return {
    vel: Math.max(0.0, Math.min(1.0, vel / 127.0)),
    key: Math.max(0.0, Math.min(1.0, (note - POOL_MIN) / span)),
    rnd: 2.0 * hash01(note, trig) - 1.0,
  };
}

// Sum of the latched per-note source offsets for one target (a number).
function srcOffset(key, s) {
  const d = cfg.pmod[key];
  if (!d || !s) return 0.0;
  return d.vel * s.vel + d.key * s.key + d.rnd * s.rnd;
}

const clamp01 = (v) => Math.max(0.0, Math.min(1.0, v));
const clampDepth = (v) => Math.max(-1.0, Math.min(1.0, v));

// base + per-note modulation, clamped to the 0..1 param range.
function effParam(st, key, base) {
  return clamp01(base + (st && st.src ? srcOffset(key, st.src) : 0.0));
}

// The same value as a SIGNAL: base + latched per-note offsets + depth * lfo.
function effParamNode(st, key, base, lfo) {
  const off = base + (st && st.src ? srcOffset(key, st.src) : 0.0);
  const depth = (cfg.pmod[key] && lfo) ? cfg.pmod[key].lfo : 0.0;
  return el.max(0.0, el.min(1.0, depth === 0.0 ? off : el.add(off, el.mul(depth, lfo))));
}

// Base (unmorphed) mode table for a tine: the instrument's per-key ratios and
// taus for the modes it defines, then the remaining modes from the ratio set.
function baseModes(st) {
  const ov = tineOverrides.get(st.note);
  const set = RATIO_SETS[cfg.ratioSet] || RATIO_SETS.cantilever;
  const srcR = (ov && ov.ratios && ov.ratios.length) ? ov.ratios : set.ratios;
  const srcT = (ov && ov.taus && ov.taus.length) ? ov.taus : set.taus;
  const ratios = new Array(NMODES);
  const taus = new Array(NMODES);
  for (let i = 0; i < NMODES; ++i) {
    ratios[i] = i < srcR.length ? srcR[i] : (set.ratios[i] !== undefined ? set.ratios[i] : srcR[srcR.length - 1] * (i + 1));
    taus[i] = i < srcT.length ? srcT[i] : (set.taus[i] !== undefined ? set.taus[i] : srcT[srcT.length - 1]);
  }
  return { ratios, taus };
}

// modal.geometry morphs the partial ratios from the measured tine to a bar, a
// membrane or a tube. Linear in ratio space between adjacent shapes; the
// fundamental is never interpolated so the note stays in tune.
// Piecewise-linear interpolation across the four shape tables at g in [0,3].
function morphRatios(sets, g) {
  if (g <= 0.0) return sets[0];
  const i = Math.min(2, Math.floor(g));
  const t = g - i;
  const out = new Array(NMODES);
  out[0] = sets[0][0];
  for (let k = 1; k < NMODES; ++k) {
    const a = sets[i][k], b = sets[i + 1][k];
    out[k] = a + (b - a) * t;
  }
  return out;
}

// Geometry LFO: the same piecewise morph, but g is a signal, so the partial
// ratios travel continuously while the note rings. Ratios are returned as nodes
// only when the LFO depth is non-zero (the numeric path stays allocation-free).
function modalRatios(st, lfo) {
  const base = baseModes(st).ratios;
  const sets = [base, GEOMETRY_TARGETS[0], GEOMETRY_TARGETS[1], GEOMETRY_TARGETS[2]];
  const depth = (cfg.pmod.geometry && lfo) ? cfg.pmod.geometry.lfo : 0.0;
  if (depth === 0.0) return morphRatios(sets, effParam(st, 'geometry', cfg.modal.geometry) * 3.0);
  // r(g) = a0 + (a1-a0)*min(g,1) + (a2-a1)*max(g-1,0) + (a3-a2)*max(g-2,0)
  const g3 = el.mul(3.0, effParamNode(st, 'geometry', cfg.modal.geometry, lfo));
  const out = new Array(NMODES);
  out[0] = sets[0][0]; // the fundamental never moves
  for (let k = 1; k < NMODES; ++k) {
    const a0 = sets[0][k], a1 = sets[1][k], a2 = sets[2][k], a3 = sets[3][k];
    out[k] = el.add(a0, el.add(
      el.mul(a1 - a0, el.min(1.0, g3)),
      el.add(
        el.mul(a2 - a1, el.max(0.0, el.sub(g3, 1.0))),
        el.mul(a3 - a2, el.max(0.0, el.sub(g3, 2.0))))));
  }
  return out;
}

// Effective damping. material scales the UPPER modes only (0.25x .. 4x, 1x at
// 0.5); decay scales the whole tine (0.25x .. 4x, 1x at 0.5).
// Material/Decay LFO: tau becomes a signal, which the voice's pole() evaluates
// per sample (so the ring time itself moves while the note sounds).
function modalTaus(st, lfo) {
  const base = baseModes(st).taus;
  const dM = cfg.pmod.material, dD = cfg.pmod.decay;
  const lfoM = (dM && lfo) ? dM.lfo : 0.0;
  const lfoD = (dD && lfo) ? dD.lfo : 0.0;
  const out = new Array(NMODES);
  if (lfoM === 0.0 && lfoD === 0.0) {
    const mat = Math.pow(2.0, (effParam(st, 'material', cfg.modal.material) - 0.5) * 4.0);
    const dec = Math.pow(4.0, (effParam(st, 'decay', cfg.modal.decay) - 0.5) * 2.0);
    for (let i = 0; i < NMODES; ++i)
      out[i] = Math.max(0.004, base[i] * dec * (i === 0 ? 1.0 : mat));
    return out;
  }
  const mat = el.pow(2.0, el.mul(4.0, el.sub(effParamNode(st, 'material', cfg.modal.material, lfo), 0.5)));
  const dec = el.pow(4.0, el.mul(2.0, el.sub(effParamNode(st, 'decay', cfg.modal.decay, lfo), 0.5)));
  for (let i = 0; i < NMODES; ++i) {
    const tau = el.mul(base[i], dec);
    out[i] = el.max(0.004, i === 0 ? tau : el.mul(tau, mat));
  }
  return out;
}

function ensureState(note) {
  if (!voiceState.has(note)) {
    // Default pan: gentle spread across the fallback note range (-0.45 .. 0.45).
    // Overwritten with the instrument's physical x position in loadInstrument.
    const pan = ((note - POOL_MIN) / Math.max(1, POOL_MAX - POOL_MIN) - 0.5) * 0.9;
    voiceState.set(note, {
      note,
      freq: 440.0 * Math.pow(2.0, (note - 69) / 12.0),
      trig: 0,
      damp: 0,
      gains: new Array(NMODES).fill(0.0),
      noiseGain: 0.0,
      noiseFc: 1000.0,
      sustained: false,
      pan,
      src: null, // per-note modulation source values (set at note-on)
    });
  }
  return voiceState.get(note);
}

// Deterministic hash in [0,1) — reproducible tests (spec 3.2).
function hash01(note, trig) {
  const s = Math.sin(note * 12.9898 + trig * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Smoothed keyed const: SET_PROPERTY steps become ~30 ms ramps (click-free
// body-chain parameter changes; voice-side params are smoothed in-graph too).
function smoothConst(key, value, tau = 0.03) {
  return el.smooth(el.tau2pole(tau), el.const({ key, value }));
}

function computeGains(note, velocity, trig) {
  const st = ensureState(note);
  const vel = Math.max(0.0, Math.min(1.0, velocity / 127.0));
  const v = vel * cfg.vel.amp;
  const b = 0.5 + 0.5 * Math.min(1.0, v * cfg.vel.bright);
  // Brightness opens or closes the excitation tilt: 0 = dull (upper modes fall
  // off as b^(2i)), 0.5 = neutral, 1 = wide open (b^0, every mode at full
  // weight). This is the ATTACK half of the macro; the body/output shelf in
  // renderAll() is the sustained half, so the knob is audible on notes that are
  // already ringing too.
  const bTilt = 2.0 - 2.0 * cfg.macro.brightness;
  const h = hash01(note, trig);
  const variation = 1.0 + cfg.random.amount * (h - 0.5); // deterministic per-note jitter
  const ratios = modalRatios(st);
  const taus = modalTaus(st);
  // Pluck weighting (fix L-1): SIGNED sin(pi*(i+1)*p). The sign matters near
  // the endpoints - plucking past a mode's antinode inverts that mode's phase
  // relative to the others - so p and 1-p now give DIFFERENT timbres instead
  // of collapsing onto the same floor-clamped gain set. |sin| < 0.10 keeps the
  // 0.10 floor but preserves the sign.
  const p = effParam(st, 'pluck', cfg.pluckPos);
  const strikeWeight = (i, pos) => {
    const s = Math.sin(Math.PI * (i + 1) * pos);
    return Math.abs(s) < 0.10 ? (s < 0.0 ? -0.10 : 0.10) : s;
  };
  const w = [];
  for (let i = 0; i < NMODES; ++i) w.push(strikeWeight(i, p));
  // Level normalisation (fix L-1): a mode's decayed energy is proportional to
  // gain^2 * tau, so scale the gains so total voice energy matches the
  // p=0.5 reference regardless of pluck position (was a 19.9 dB swing).
  // Boost capped at +20 dB (sin weighting is near-node at the endpoints, so
  // restoring level there needs a big lift; the bus soft-limiter guards).
  const amp = (i) => BASE_GAINS[i] * v * Math.pow(b, i * bTilt);
  const energy = (ws) => {
    let e = 0.0;
    for (let i = 0; i < NMODES; ++i) e += amp(i) * amp(i) * ws[i] * ws[i] * taus[i];
    return e;
  };
  // w at p = 0.5 (the reference position), generated so the floor/sign rule
  // stays identical to the hand-written 3-mode reference.
  const refW = [];
  for (let i = 0; i < NMODES; ++i) refW.push(strikeWeight(i, 0.5));
  const e = energy(w), eRef = energy(refW);
  const norm = (e > 0.0 && eRef > 0.0) ? Math.min(10.0, Math.sqrt(eRef / e)) : 1.0;
  // Exciter burst (captured at note-on, like brightness): filtered noise for
  // 12 ms, level 0..~0.6, cutoff 400 Hz .. 12 kHz by exciter.hardness.
  const nAmt = effParam(st, 'noise', cfg.exciter.noise);
  // 2.4 is measured against the pluck: at full amount the burst peaks ~10 dB
  // under the modal attack (a clear mallet click, still a mbira pluck).
  st.noiseGain = nAmt > 0.0001 ? 2.4 * nAmt * (0.35 + 0.65 * vel) : 0.0;
  st.noiseFc = 400.0 * Math.pow(30.0, effParam(st, 'hardness', cfg.exciter.hardness));
  const g = [];
  for (let i = 0; i < NMODES; ++i) {
    const r = ratios[i];
    // Nyquist suppression with safety margin
    const audible = st.freq * r < 0.45 * cfg.sampleRate;
    g.push(audible ? amp(i) * w[i] * variation * norm : 0.0);
  }
  return g;
}

function buildVoiceGraph(st, lfo) {
  const note = st.note;
  const trig = el.const({ key: `trig.${note}`, value: st.trig });
  const edge = el.sub(trig, el.z(trig)); // fires on every increment of the counter
  const ratios = modalRatios(st, lfo);
  const taus = modalTaus(st, lfo);

  // LFO -> pitch (depth const keyed; 0 = no modulation). Audio-rate: cycle
  // takes the modulated frequency node directly.
  const pitchDepth = el.const({ key: 'mod.lfoToPitch', value: cfg.mod.lfoToPitch });
  const freqMod = el.mul(st.freq, el.add(1.0, el.mul(pitchDepth, lfo)));

  const modes = [];
  for (let i = 0; i < NMODES; ++i) {
    if (!st.gains[i]) { modes.push(el.const({ key: `g${i}.${note}`, value: 0.0 })); continue; }
    // pole() reads its coefficient per sample, so a signal tau (LFO on Decay or
    // Material) moves the ring time in the audio path. The constant-tau path is
    // the classic normalised one-pole (peak = norm * (1-p) = 1). With a moving
    // p that normalisation would renormalise every sample and the level would
    // pump with the ring time, so the signal path strikes with a plain unit
    // impulse instead: env = p*env + edge, i.e. peak exactly 1 at the strike and
    // a decay that follows p(t).
    const tau = taus[i];
    const p = el.tau2pole(tau);
    const env = typeof tau === 'number'
      ? el.mul(1.0 / (1.0 - Math.exp(-1.0 / (tau * cfg.sampleRate))), el.smooth(p, edge))
      : el.pole(p, edge);
    modes.push(el.mul(
      el.const({ key: `g${i}.${note}`, value: st.gains[i] }),
      env,
      el.mul(el.cycle(el.mul(freqMod, ratios[i]))),
    ));
  }
  // Exciter burst: one noise source per voice, low-passed at the exciter tone,
  // shaped by the same impulse edge (12 ms). Only built when the control is up
  // so a pure pluck costs nothing.
  if (st.noiseGain > 0.0) {
    const burstTau = 0.018;
    const bn = 1.0 / (1.0 - Math.exp(-1.0 / (burstTau * cfg.sampleRate)));
    const burst = el.mul(bn, el.smooth(el.tau2pole(burstTau), edge));
    const fc = el.const({ key: `nz.fc.${note}`, value: st.noiseFc });
    const nz = el.svf({ key: `nz.svf.${note}`, mode: 'lowpass' }, fc, el.const({ key: `nz.q.${note}`, value: 0.9 }), el.noise({ key: `nz.src.${note}` }));
    modes.push(el.mul(el.const({ key: `nz.g.${note}`, value: st.noiseGain }), burst, nz));
  }

  // ADSR-shaped amp envelope on the damp gate: el.env gives near-instant
  // attack (tau = adsr.attack) and one-pole release (tau = adsr.release).
  // Sustain level s blends: out = s + (1-s)*env. s=1 reproduces the M1 sound.
  const atk = el.const({ key: 'adsr.attack', value: cfg.adsr.attack });
  const rel = el.const({ key: 'adsr.release', value: cfg.adsr.release });
  const relEnv = el.env(el.tau2pole(atk), el.tau2pole(rel),
                        el.const({ key: `damp.${note}`, value: st.damp }));
  const sus = el.const({ key: 'adsr.sustain', value: cfg.adsr.sustain });
  const ampEnv = el.add(sus, el.mul(el.sub(1.0, sus), relEnv));
  return el.mul(ampEnv, el.add(...modes));
}

// ---- Shared body chain (stable keys => persistent state, spec 4.5) ---------

// Soundboard: 5 broad bandpass resonators on the summed bus. PROVISIONAL
// centre frequencies/widths; single shared instance for ALL voices.
let SB_BANDS = [
  { fc: 95.0,  q: 4.0, gain: 1.00 },
  { fc: 210.0, q: 5.0, gain: 0.80 },
  { fc: 430.0, q: 6.0, gain: 0.55 },
  { fc: 800.0, q: 6.0, gain: 0.35 },
  { fc: 1500.0, q: 8.0, gain: 0.20 },
];

function buildBodyChain(busL, busR) {
  // Macro curves: neutral (0.5) = 1.0x so the default sound is preserved; the
  // top half is compressed (max 1.4x, not 2x) to keep resonance/buzz boosts from
  // overdriving the safety limiter into audible distortion.
  const macroCurve = (v, hi = 0.8) => (v <= 0.5 ? v * 2.0 : 1.0 + (v - 0.5) * hi);
  const rm = macroCurve(cfg.macro.resonance, 0.5);   // 0 .. 1.25, neutral at 0.5
  const bm = macroCurve(cfg.macro.buzz, 1.0);        // 0 .. 1.5, a bit more range so buzz reads clearly

  // The bank runs per channel on mirrored keys; state persists via stable keys.
  const sbWetL = [], sbWetR = [];
  for (let i = 0; i < SB_BANDS.length; ++i) {
    const b = SB_BANDS[i];
    const fc = el.const({ key: `sb.fc.${i}`, value: b.fc });
    const q = el.const({ key: `sb.q.${i}`, value: b.q });
    const g = smoothConst(`sb.gain.${i}`, b.gain * cfg.soundboard * rm);
    const rL = el.mul(g, el.svf({ key: `sb.svf.${i}.L`, mode: 'bandpass' }, fc, q, busL));
    const rR = el.mul(g, el.svf({ key: `sb.svf.${i}.R`, mode: 'bandpass' }, fc, q, busR));
    sbWetL.push(rL); sbWetR.push(rR);
  }
  let outL = el.add(busL, el.add(...sbWetL));
  let outR = el.add(busR, el.add(...sbWetR));

  // Gourd/deze: comb resonator (feedback delay) + bandpass, PROVISIONAL.
  // L/R comb lengths differ by a few samples (L-4) so the body has width rather
  // than collapsing to mono when the buses decorrelate; same feedback/voicing.
  const gf = el.const({ key: 'gourd.freq', value: cfg.gourdFreq });
  const gq = el.const({ key: 'gourd.q', value: 6.0 });
  const ga = smoothConst('gourd.amount', cfg.gourdAmount * (0.4 + 0.6 * rm));
  const combLen = Math.max(16, Math.round(cfg.sampleRate / 260.0)); // ~260 Hz comb, PROVISIONAL
  const combLenR = combLen + Math.max(1, Math.round(cfg.sampleRate * 0.0007)); // +0.7 ms decorrelation
  const combL = el.delay({ key: 'gourd.comb.L', size: 4096 }, el.const({ key: 'gourd.len.L', value: combLen }), el.const({ key: 'gourd.fb', value: 0.45 }), busL);
  const combR = el.delay({ key: 'gourd.comb.R', size: 4096 }, el.const({ key: 'gourd.len.R', value: combLenR }), el.const({ key: 'gourd.fb' }), busR);
  outL = el.add(outL, el.mul(ga, el.svf({ key: 'gourd.svf.L', mode: 'bandpass' }, gf, gq, combL)));
  outR = el.add(outR, el.mul(ga, el.svf({ key: 'gourd.svf.R', mode: 'bandpass' }, gf, gq, combR)));

  // Buzz: amplitude-gated rattle (PROVISIONAL approximation of the deze buzz).
  // Mix scales with the macro so turning buzz up is clearly audible, but the
  // nonlinearity stays bounded (no harsh static blast at max).
  const bi = smoothConst('buzz.intensity', cfg.buzzIntensity * (1.0 + bm));
  const bc = el.const({ key: 'buzz.char', value: cfg.buzzChar });
  const bq = el.const({ key: 'buzz.q', value: 2.0 });
  const bpL = el.svf({ key: 'buzz.svf.L', mode: 'bandpass' }, bc, bq, outL);
  const bpR = el.svf({ key: 'buzz.svf.R', mode: 'bandpass' }, bc, bq, outR);
  const gateL = el.env(el.tau2pole(0.0005), el.tau2pole(0.05), outL);
  const gateR = el.env(el.tau2pole(0.0005), el.tau2pole(0.05), outR);
  const amtL = el.mul(el.mul(el.const({ key: 'buzz.k', value: 6.0 }), bi), gateL);
  const amtR = el.mul(el.mul(el.const({ key: 'buzz.k' }), bi), gateR);
  const buzzMix = smoothConst('buzz.mix', 0.25 + 0.45 * bm); // 0.25 .. 0.925
  outL = el.add(outL, el.mul(buzzMix, el.tanh(el.mul(amtL, bpL))));
  outR = el.add(outR, el.mul(buzzMix, el.tanh(el.mul(amtR, bpR))));

  return [outL, outR];
}

function renderAll() {
  // One shared LFO oscillator node; routes read its value at audio rate. Its
  // structure is identical on every render (the rate const is keyed), so the
  // native phasor keeps its phase across re-renders: the LFO is free-running
  // rather than restarting on every note-on or knob move.
  const lfo = el.cycle(el.const({ key: 'lfo.rate', value: cfg.lfo.rate }));
  const chans = [[], []];
  for (const st of voiceState.values()) {
    const g = buildVoiceGraph(st, lfo);
    // Constant-power pan from the tine's physical position (L-4). pan is
    // -0.5..0.5 so the image has width without hard-panning a single-body instrument.
    const theta = ((st.pan || 0) + 1) * 0.25 * Math.PI; // pan -1..1 -> 0..pi/2
    chans[0].push(theta === 0.25 * Math.PI ? g : el.mul(Math.cos(theta), g));
    chans[1].push(theta === 0.25 * Math.PI ? g : el.mul(Math.sin(theta), g));
  }
  const dryL = chans[0].length ? el.add(...chans[0]) : el.const({ key: 'bus.zero', value: 0.0 });
  const dryR = chans[1].length ? el.add(...chans[1]) : el.const({ key: 'bus.zero.R', value: 0.0 });
  let [outL, outR] = buildBodyChain(dryL, dryR);
  // Brightness macro, sustained half: a live high-shelf tilt on the whole bus
  // (+/-9 dB at 1.6 kHz, 0 dB at the neutral 0.5). Without it the macro only
  // touched mode gains at note-on, which the ear hears as nothing: the upper
  // partials are gone in ~100 ms. Keyed nodes + smoothed gain = click-free.
  {
    const tiltDb = el.mul(18.0, el.sub(smoothConst('tone.bright', cfg.macro.brightness, 0.03), 0.5));
    const fc = el.const({ key: 'tone.bright.fc', value: 1600.0 });
    const q = el.const({ key: 'tone.bright.q', value: 0.7 });
    outL = el.svfshelf({ key: 'tone.bright.L', mode: 'highshelf' }, fc, q, tiltDb, outL);
    outR = el.svfshelf({ key: 'tone.bright.R', mode: 'highshelf' }, fc, q, tiltDb, outR);
  }
  // Fixed bus trim + LFO -> master (tremolo). Both stay PRE-limiter so the
  // limiter sees a stable nominal level.
  const lfoGain = el.add(1.0, el.mul(el.const({ key: 'mod.lfoToMaster', value: cfg.mod.lfoToMaster }), lfo));
  const busGain = el.mul(BUS_TRIM, lfoGain);
  outL = el.mul(busGain, outL);
  outR = el.mul(busGain, outR);
  // Safety limiter (stereo-linked peak limiter). The old tanh(k*x)/k was only
  // ~linear for |x| < 0.2; a loud chord with resonance up reached ~1.3 and the
  // tanh compressed it by >40%, which is the gritty "distortion" people heard.
  // An envelope-follower gain is transparent below the ceiling and only pulls
  // the gain down when the mix would exceed it, so body resonance no longer
  // rides into a saturator.
  const CEIL = 0.80;
  const peak = el.max(el.abs(outL), el.abs(outR));
  const env = el.env(el.tau2pole(0.0001), el.tau2pole(0.25), peak);
  const limGain = el.min(1.0, el.div(CEIL, el.max(env, el.const({ key: 'lim.floor', value: 1e-6 }))));
  // Hard safety clamp at -0.18 dBFS: the envelope gain has an attack of ~0.1 ms,
  // so an exceptionally fast attack transient can slip past it for a few samples.
  // Clamping those is inaudible; letting them hit 0 dBFS in int16 is not.
  outL = el.max(el.min(el.mul(limGain, outL), 0.98), -0.98);
  outR = el.max(el.min(el.mul(limGain, outR), 0.98), -0.98);
  // Output fader: POST-limiter and dB-mapped (P1 fix). Loudness now tracks the
  // fader; the limiter is a pure safety net, not the thing the fader drives
  // into (which made every position above ~30% sound pinned and squashed).
  // 10 ms smoothing keeps fader moves click-free.
  const fader = smoothConst('master', faderGain(cfg.master), 0.01);
  outL = el.mul(fader, outL);
  outR = el.mul(fader, outR);
  core.render(outL, outR);
}

// ---- voice management (spec 3.4) -------------------------------------------

// Voice stealing: when the polyphony cap is hit, steal in order:
// oldest released -> oldest pedal-sustained -> newest active.
// Stolen voices get a quick click-free release (one-pole damp).
const POLYPHONY_CAP = 64;

function stealIfNeeded() {
  const active = voiceOrder.filter((n) => {
    const st = voiceState.get(n);
    return st && st.trig > 0;
  });
  if (active.length <= POLYPHONY_CAP) return;
  let victim = null;
  for (const n of voiceOrder) { // oldest released first
    const st = voiceState.get(n);
    if (st && st.damp === 0.0 && !st.sustained && st.trig > 0) { victim = n; break; }
  }
  if (victim == null) for (const n of voiceOrder) {
    const st = voiceState.get(n);
    if (st && st.sustained) { victim = n; break; }
  }
  if (victim == null) victim = voiceOrder[voiceOrder.length - 1]; // newest active
  const st = voiceState.get(victim);
  st.damp = 0.0; st.sustained = false; st.trig = 0;
  sustainedNotes.delete(victim);
}

function releaseNote(note) {
  const st = voiceState.get(note);
  if (!st) return;
  if (sustainHeld) { st.sustained = true; sustainedNotes.add(note); return; }
  st.damp = 0.0;
  renderAll();
}

function releaseSustained() {
  for (const n of sustainedNotes) {
    const st = voiceState.get(n);
    if (st) st.damp = 0.0;
  }
  sustainedNotes.clear();
  renderAll();
}

// ---- instrument definitions (spec section 4, JSON-driven) -------------------

let instrumentName = 'default';

// The host reads the instrument JSON (the JS context has no filesystem) and
// calls this with its text. Rebuilds the voice pool from the instrument's key
// list, applies per-tine modal overrides, and reconfigures the shared body
// (soundboard bands, gourd, buzz). Everything happens off the audio thread.
function loadInstrument(jsonText) {
  const inst = JSON.parse(jsonText);
  if (!inst || !Array.isArray(inst.keys) || inst.keys.length === 0)
    throw new Error('instrument JSON has no keys');
  // Validate every key BEFORE clearing the pool: a malformed file must leave
  // the currently-loaded instrument and voice pool untouched.
  for (const k of inst.keys) {
    if (typeof k.note !== 'number' || typeof k.frequencyHz !== 'number')
      throw new Error(`key missing note/frequencyHz: ${JSON.stringify(k).slice(0, 80)}`);
  }
  instrumentName = inst.id || inst.name || 'unknown';
  if (inst.name) cfg.instrumentName = inst.name;

  voiceState.clear();
  voiceOrder.length = 0;
  sustainedNotes.clear();
  tineOverrides.clear();

  // Stereo image (L-4): pan each tine by its physical board position. The
  // instrument JSON gives `x` (schematic px); normalise over the key set's
  // actual span and map to [-0.5, 0.5] (moderate width — a real mbira is a
  // single small body, not a wide stage). PROVISIONAL until measured geometry.
  const xs = inst.keys.map((k) => (typeof k.x === 'number' ? k.x : 0));
  const xMin = Math.min(...xs), xMax = Math.max(...xs), xSpan = Math.max(1, xMax - xMin);

  for (const k of inst.keys) {
    if (typeof k.note !== 'number' || typeof k.frequencyHz !== 'number')
      throw new Error(`key missing note/frequencyHz: ${JSON.stringify(k).slice(0, 80)}`);
    const st = ensureState(k.note);
    st.freq = k.frequencyHz;
    const x = typeof k.x === 'number' ? k.x : (xMin + xMax) / 2;
    st.pan = ((x - xMin) / xSpan - 0.5) * 1.0; // -0.5 .. 0.5
    const ov = {};
    if (Array.isArray(k.modalRatios)) ov.ratios = k.modalRatios;
    if (Array.isArray(k.dampingTaus)) ov.taus = k.dampingTaus;
    if (Object.keys(ov).length) tineOverrides.set(k.note, ov);
  }

  if (inst.soundboard && Array.isArray(inst.soundboard.bands) && inst.soundboard.bands.length) {
    SB_BANDS = inst.soundboard.bands.map((b) => ({ fc: b.fc, q: b.q, gain: b.gain }));
  }
  if (inst.gourd) {
    if (typeof inst.gourd.freqHz === 'number') cfg.gourdFreq = inst.gourd.freqHz;
    if (typeof inst.gourd.amount === 'number') cfg.gourdAmount = inst.gourd.amount;
  }
  if (inst.buzz) {
    if (typeof inst.buzz.characterHz === 'number') cfg.buzzChar = inst.buzz.characterHz;
    if (typeof inst.buzz.intensity === 'number') cfg.buzzIntensity = inst.buzz.intensity;
  }
  if (inst.provisional === false) cfg.provisional = false; // stays true in all shipped defs
  renderAll();
}

// ---- public API the host calls ---------------------------------------------

function noteOn(note, velocity) {
  const st = ensureState(note);
  st.trig += 1;          // every note-on is a fresh impulse edge
  st.src = modSource(note, st.trig, velocity); // mod strip sources, this strike
  st.gains = computeGains(note, velocity, st.trig);
  st.damp = 1.0;
  st.sustained = false;
  sustainedNotes.delete(note);
  const oi = voiceOrder.indexOf(note);
  if (oi >= 0) voiceOrder.splice(oi, 1);
  voiceOrder.push(note);
  stealIfNeeded();
  renderAll();
}

function noteOff(note) {
  releaseNote(note);
}

function sustain(pedalDown) {
  sustainHeld = !!pedalDown;
  if (!sustainHeld) releaseSustained();
}

function setParam(name, value) {
  switch (name) {
    case 'master': cfg.master = Math.max(0.0, Math.min(1.0, value)); break;
    case 'pluckPos': cfg.pluckPos = value; break;
    case 'soundboard': cfg.soundboard = value; break;
    case 'gourdAmount': cfg.gourdAmount = value; break;
    case 'gourdFreq': cfg.gourdFreq = value; break;
    case 'buzzIntensity': cfg.buzzIntensity = value; break;
    case 'buzzChar': cfg.buzzChar = value; break;
    // modulator framework
    case 'adsr.attack': cfg.adsr.attack = Math.max(0.0002, value); break;
    case 'adsr.release': cfg.adsr.release = Math.max(0.005, value); break;
    case 'adsr.sustain': cfg.adsr.sustain = Math.max(0.0, Math.min(1.0, value)); break;
    case 'lfo.rate': cfg.lfo.rate = Math.max(0.01, value); break;
    case 'mod.lfoToMaster': cfg.mod.lfoToMaster = value; break;
    case 'mod.lfoToPitch': cfg.mod.lfoToPitch = value; break;
    case 'random.amount': cfg.random.amount = value; break;
    case 'vel.amp': cfg.vel.amp = value; break;
    case 'vel.bright': cfg.vel.bright = value; break;
    case 'macro.resonance': cfg.macro.resonance = Math.max(0.0, Math.min(1.0, value)); break;
    case 'macro.buzz': cfg.macro.buzz = Math.max(0.0, Math.min(1.0, value)); break;
    case 'macro.brightness': cfg.macro.brightness = Math.max(0.0, Math.min(1.0, value)); break;
    // physical model
    case 'modal.geometry': cfg.modal.geometry = Math.max(0.0, Math.min(1.0, value)); break;
    case 'modal.material': cfg.modal.material = Math.max(0.0, Math.min(1.0, value)); break;
    case 'modal.decay': cfg.modal.decay = Math.max(0.0, Math.min(1.0, value)); break;
    case 'exciter.noise': cfg.exciter.noise = Math.max(0.0, Math.min(1.0, value)); break;
    case 'exciter.hardness': cfg.exciter.hardness = Math.max(0.0, Math.min(1.0, value)); break;
    default: {
      // per-parameter mod strips (UI): mod.<target>.<source>, depth -1..1
      const m = /^mod\.(geometry|material|decay|pluck|noise|hardness)\.(vel|key|rnd)$/.exec(name);
      if (m) { cfg.pmod[m[1]][m[2]] = clampDepth(value); break; }
      // free-running LFO strips: only the continuously-morphable targets
      const l = /^mod\.(geometry|material|decay)\.lfo$/.exec(name);
      if (!l) throw new Error(`unknown param: ${name}`);
      cfg.pmod[l[1]].lfo = clampDepth(value);
      break;
    }
  }
  renderAll();
}

// Compatibility with M1 events/tests: mode gains are an alias that scales the
// documented brightness curve per mode (kept click-free via SET_PROPERTY).
function setModeGain(modeIndex, value) {
  const scale = Math.min(4.0, value / Math.max(1e-6, BASE_GAINS[modeIndex]));
  for (const st of voiceState.values()) {
    if (st.gains[modeIndex] > 0.0) st.gains[modeIndex] = BASE_GAINS[modeIndex] * scale;
  }
  renderAll();
}

function setRatioSet(name) {
  if (!RATIO_SETS[name]) throw new Error(`unknown ratio set: ${name}`);
  cfg.ratioSet = name;
  renderAll();
}

function setTineOverride(note, paramsJson) {
  if (paramsJson == null) tineOverrides.delete(note);
  else {
    const cur = tineOverrides.get(note) || {};
    tineOverrides.set(note, { ...cur, ...JSON.parse(paramsJson) });
  }
  renderAll();
}

function allNotesDamp() {
  for (const st of voiceState.values()) { st.damp = 0.0; st.sustained = false; }
  sustainedNotes.clear();
  renderAll();
}

function getInstrument() {
  const keys = [...voiceState.keys()].map((n) => {
    const st = voiceState.get(n);
    return { note: n, frequencyHz: st.freq, ratios: modalRatios(st), taus: modalTaus(st) };
  });
  return { name: cfg.instrumentName || instrumentName, keys };
}

function configureSampleRate(sr) {
  cfg.sampleRate = sr;
  renderAll(); // rebuilds; Nyquist suppression re-evaluated per mode
}

// CPU-test helper: shrink the prebuilt voice pool to N notes.
function configurePool(n) {
  const keep = new Set();
  for (let i = 0; i < n; ++i) keep.add(POOL_MIN + i);
  for (const k of [...voiceState.keys()]) if (!keep.has(k)) voiceState.delete(k);
  renderAll();
}

// Pre-build the pitch range off the audio thread before the device starts.
for (let n = POOL_MIN; n <= POOL_MAX; ++n) ensureState(n);
renderAll();

globalThis.__mbira = {
  noteOn, noteOff, sustain, setParam, setModeGain, setRatioSet,
  setTineOverride, allNotesDamp, configureSampleRate, configurePool,
  loadInstrument, getInstrument,
};
