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
// Tine model (spec 3.1)
//   edge_i(t)  = trig - z(trig)                              // impulse per retrigger
//   env_i(t)   = norm_i * smooth(tau2pole(tau_i), edge_i)    // exponential decay
//   mode_i(t)  = gain_i(t) * env_i(t) * sin(2*pi*f*ratio_i*t)
//   damp(t)    = env(fastAtk, 30ms rel, dampGate)            // note-off release
//   voice      = master * damp * sum_i mode_i
//
//   Modal ratios: PROVISIONAL-JUSTIFIED (amendment 4.7). An mbira tine is a
//   clamped-free (cantilever) beam; its mode frequencies follow the beam
//   eigenvalue squares (beta1..beta3 = 1.875, 4.694, 6.786):
//       cantilever: ratios [1.0, 6.27, 17.55], fast-decaying upper modes.
//   This matches the observed character (inharmonic attack overtones that die
//   out quickly, leaving a near-pure fundamental). The M1 placeholder set
//   [1.0, 2.6, 4.2] is kept as "classic" for A/B comparison. Per-tine
//   overrides (setTineOverride) replace any of this per key.
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

const RATIO_SETS = {
  cantilever: { ratios: [1.0, 6.27, 17.55], taus: [1.2, 0.20, 0.045] },
  classic:    { ratios: [1.0, 2.6, 4.2],    taus: [1.2, 0.5, 0.22] }, // M1 placeholder, A/B only
};
const BASE_GAINS = [1.0, 0.5, 0.28];
const MASTER_DEFAULT = 0.22;

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
  buzzIntensity: 0.0,    // 0..1 (off by default until the player weighs in)
  buzzChar: 3200.0,      // Hz, PROVISIONAL
  // --- modulator framework (Pigments-style sources -> destinations) ---------
  // Defaults are no-ops: attack ~= instant, sustain = 1, release = M1 value,
  // LFO depths 0, random/velocity depths = M1 behaviour.
  adsr: { attack: 0.0002, release: 0.03, sustain: 1.0 }, // seconds / level
  lfo: { rate: 5.0 },                                    // Hz
  mod: { lfoToMaster: 0.0, lfoToPitch: 0.0 },            // route depths
  random: { amount: 0.04 },                              // per-note variation depth
  vel: { amp: 1.0, bright: 1.0 },                        // velocity->amp/brightness depths
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

function ratiosFor(st) {
  const ov = tineOverrides.get(st.note);
  const set = RATIO_SETS[cfg.ratioSet] || RATIO_SETS.cantilever;
  if (ov && ov.ratios) return { ratios: ov.ratios, taus: ov.taus || set.taus };
  return { ratios: set.ratios, taus: set.taus };
}

function ensureState(note) {
  if (!voiceState.has(note)) {
    voiceState.set(note, {
      note,
      freq: 440.0 * Math.pow(2.0, (note - 69) / 12.0),
      trig: 0,
      damp: 0,
      gains: [0.0, 0.0, 0.0],
      sustained: false,
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
  const v = Math.max(0.0, Math.min(1.0, velocity / 127.0)) * cfg.vel.amp;
  const b = 0.5 + 0.5 * Math.min(1.0, v * cfg.vel.bright);
  const h = hash01(note, trig);
  const variation = 1.0 + cfg.random.amount * (h - 0.5); // deterministic per-note jitter
  const g = [];
  for (let i = 0; i < 3; ++i) {
    const base = BASE_GAINS[i] * v * Math.pow(b, i);
    const w = Math.max(0.10, Math.abs(Math.sin(Math.PI * (i + 1) * cfg.pluckPos)));
    const r = ratiosFor(st).ratios[i];
    // Nyquist suppression with safety margin
    const audible = st.freq * r < 0.45 * cfg.sampleRate;
    g.push(audible ? base * w * variation : 0.0);
  }
  return g;
}

function buildVoiceGraph(st, lfo) {
  const note = st.note;
  const trig = el.const({ key: `trig.${note}`, value: st.trig });
  const edge = el.sub(trig, el.z(trig)); // fires on every increment of the counter
  const { ratios, taus } = ratiosFor(st);

  // LFO -> pitch (depth const keyed; 0 = no modulation). Audio-rate: cycle
  // takes the modulated frequency node directly.
  const pitchDepth = el.const({ key: 'mod.lfoToPitch', value: cfg.mod.lfoToPitch });
  const freqMod = el.mul(st.freq, el.add(1.0, el.mul(pitchDepth, lfo)));

  const modes = [0, 1, 2].map((i) => {
    if (st.gains[i] === 0.0) return el.const({ key: `g${i}.${note}`, value: 0.0 });
    const norm = 1.0 / (1.0 - Math.exp(-1.0 / (taus[i] * cfg.sampleRate)));
    const env = el.mul(norm, el.smooth(el.tau2pole(taus[i]), edge));
    return el.mul(
      el.const({ key: `g${i}.${note}`, value: st.gains[i] }),
      env,
      el.mul(el.cycle(el.mul(freqMod, ratios[i]))),
    );
  });

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
  // The bank runs per channel on mirrored keys; state persists via stable keys.
  const sbWetL = [], sbWetR = [];
  for (let i = 0; i < SB_BANDS.length; ++i) {
    const b = SB_BANDS[i];
    const fc = el.const({ key: `sb.fc.${i}`, value: b.fc });
    const q = el.const({ key: `sb.q.${i}`, value: b.q });
    const g = smoothConst(`sb.gain.${i}`, b.gain * cfg.soundboard);
    const rL = el.mul(g, el.svf({ key: `sb.svf.${i}.L`, mode: 'bandpass' }, fc, q, busL));
    const rR = el.mul(g, el.svf({ key: `sb.svf.${i}.R`, mode: 'bandpass' }, fc, q, busR));
    sbWetL.push(rL); sbWetR.push(rR);
  }
  let outL = el.add(busL, el.add(...sbWetL));
  let outR = el.add(busR, el.add(...sbWetR));

  // Gourd/deze: comb resonator (feedback delay) + bandpass, PROVISIONAL.
  const gf = el.const({ key: 'gourd.freq', value: cfg.gourdFreq });
  const gq = el.const({ key: 'gourd.q', value: 6.0 });
  const ga = smoothConst('gourd.amount', cfg.gourdAmount);
  const combLen = Math.max(16, Math.round(cfg.sampleRate / 260.0)); // ~260 Hz comb, PROVISIONAL
  const combL = el.delay({ key: 'gourd.comb.L', size: 4096 }, el.const({ key: 'gourd.len', value: combLen }), el.const({ key: 'gourd.fb', value: 0.45 }), busL);
  const combR = el.delay({ key: 'gourd.comb.R', size: 4096 }, el.const({ key: 'gourd.len' }), el.const({ key: 'gourd.fb' }), busR);
  outL = el.add(outL, el.mul(ga, el.svf({ key: 'gourd.svf.L', mode: 'bandpass' }, gf, gq, combL)));
  outR = el.add(outR, el.mul(ga, el.svf({ key: 'gourd.svf.R', mode: 'bandpass' }, gf, gq, combR)));

  // Buzz: amplitude-gated rattle (PROVISIONAL approximation of the deze buzz).
  const bi = smoothConst('buzz.intensity', cfg.buzzIntensity);
  const bc = el.const({ key: 'buzz.char', value: cfg.buzzChar });
  const bq = el.const({ key: 'buzz.q', value: 2.0 });
  const bpL = el.svf({ key: 'buzz.svf.L', mode: 'bandpass' }, bc, bq, outL);
  const bpR = el.svf({ key: 'buzz.svf.R', mode: 'bandpass' }, bc, bq, outR);
  const gateL = el.env(el.tau2pole(0.0005), el.tau2pole(0.05), outL);
  const gateR = el.env(el.tau2pole(0.0005), el.tau2pole(0.05), outR);
  const amtL = el.mul(el.mul(el.const({ key: 'buzz.k', value: 6.0 }), bi), gateL);
  const amtR = el.mul(el.mul(el.const({ key: 'buzz.k' }), bi), gateR);
  outL = el.add(outL, el.mul(el.const({ key: 'buzz.mix', value: 0.5 }), el.tanh(el.mul(amtL, bpL))));
  outR = el.add(outR, el.mul(el.const({ key: 'buzz.mix' }), el.tanh(el.mul(amtR, bpR))));

  return [outL, outR];
}

function renderAll() {
  // One shared LFO oscillator node; routes read its value at audio rate.
  const lfo = el.cycle(el.const({ key: 'lfo.rate', value: cfg.lfo.rate }));
  const chans = [[], []];
  for (const st of voiceState.values()) {
    const g = buildVoiceGraph(st, lfo);
    chans[0].push(g);
    chans[1].push(g);
  }
  const dryL = chans[0].length ? el.add(...chans[0]) : el.const({ key: 'bus.zero', value: 0.0 });
  const dryR = chans[1].length ? el.add(...chans[1]) : el.const({ key: 'bus.zero.R', value: 0.0 });
  let [outL, outR] = buildBodyChain(dryL, dryR);
  // Master now lives on the bus; LFO -> master (tremolo) modulates around it.
  const master = smoothConst('master', cfg.master, 0.05);
  const lfoGain = el.add(1.0, el.mul(el.const({ key: 'mod.lfoToMaster', value: cfg.mod.lfoToMaster }), lfo));
  const outGain = el.mul(master, lfoGain);
  outL = el.mul(outGain, outL);
  outR = el.mul(outGain, outR);
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
  instrumentName = inst.id || inst.name || 'unknown';
  if (inst.name) cfg.instrumentName = inst.name;

  voiceState.clear();
  voiceOrder.length = 0;
  sustainedNotes.clear();
  tineOverrides.clear();

  for (const k of inst.keys) {
    if (typeof k.note !== 'number' || typeof k.frequencyHz !== 'number')
      throw new Error(`key missing note/frequencyHz: ${JSON.stringify(k).slice(0, 80)}`);
    const st = ensureState(k.note);
    st.freq = k.frequencyHz;
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
    case 'master': cfg.master = value; break;
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
    default: throw new Error(`unknown param: ${name}`);
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
    const r = ratiosFor(st);
    return { note: n, frequencyHz: st.freq, ratios: r.ratios, taus: r.taus };
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
