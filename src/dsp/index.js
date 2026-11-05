// MBIRA Milestone 1 — Elementary DSP graph: decaying plucked tine, three damped modes.
//
// Runs inside QuickJS embedded in the native host (the execution model of the
// official Elementary CLI example). Bundled with esbuild; the host registers
// `__postNativeMessage__` and evaluates this bundle once. The Renderer callback
// ships instruction batches to `elem::Runtime::applyInstructions`.
//
// Continuous parameters and note events are keyed `el.const` nodes: re-rendering
// the same graph with a changed value makes the reconciler emit SET_PROPERTY for
// that node only, which the native runtime applies on the non-realtime thread to
// a lock-free atomic (verified in runtime/elem/builtins/Core.h, ConstNode).
// No graph rebuild, no runtime restart, no allocation on the audio thread.
//
// Voice model (PROVISIONAL, Milestone 1 — per amendment 4.7 the modal ratios
// [1.0, 2.6, 4.2] are the spec's placeholder, not verified acoustics):
//
//   edge_i(t)  = gate - z(gate)                             // impulse at each note-on edge
//   env_i(t)   = norm_i * smooth(tau2pole(tau_i), edge_i)   // exponential decay
//   mode_i(t)  = gain_i * env_i(t) * sin(2*pi*f*ratio_i*t)
//   damp(t)    = (1/(1-p)) * smooth(tau2pole(0.05), dampGate)  // note-off release
//   voice      = MASTER * damp * sum_i(mode_i)
//
// gate / dampGate / gain_i are all keyed consts. Retrigger protocol (host side):
// if gate is already 1, render once with gate=0 before the next gate=1 render so
// a fresh impulse edge is produced. dampGate returns to 1 before the re-trigger,
// click-free via its one-pole.

import { Renderer, el } from '@elemaudio/core';

const RATIOS = [1.0, 2.6, 4.2];   // modal ratios (PROVISIONAL)
const TAUS   = [1.2, 0.5, 0.22];  // decay time constants, seconds
const MASTER = 0.22;              // fixed headroom; documented gain staging (A4)

const core = new Renderer((batch) => {
  __postNativeMessage__(JSON.stringify(batch));
});

const SAMPLE_RATE = 48000.0; // matches the PoC host device/render rate; fixed for M1

// Voice state is the JS-side source of truth for re-renders; the native runtime
// holds the authoritative live atomic values.
const voiceState = new Map(); // midiNote -> { freq, gate, damp, gains[3] }

function ensureState(note) {
  if (!voiceState.has(note)) {
    voiceState.set(note, {
      freq: 440.0 * Math.pow(2.0, (note - 69) / 12.0),
      gate: 0,
      damp: 0,
      gains: [0.0, 0.0, 0.0],
    });
  }
  return voiceState.get(note);
}

function buildVoiceGraph(st) {
  const note = noteOf(st);

  const gate = el.const({ key: `gate.${note}`, value: st.gate });
  const edge = el.sub(gate, el.z(gate));

  const modes = [0, 1, 2].map((i) => {
    const norm = 1.0 / (1.0 - Math.exp(-1.0 / (TAUS[i] * SAMPLE_RATE)));
    const env = el.mul(norm, el.smooth(el.tau2pole(TAUS[i]), edge));
    return el.mul(
      el.const({ key: `g${i}.${note}`, value: st.gains[i] }),
      env,
      el.cycle(st.freq * RATIOS[i]),
    );
  });

  const body = el.add(...modes);
  // Note-off release: el.env is the native asymmetric envelope follower —
  // near-instant attack when dampGate jumps to 1 at note-on, one-pole release
  // (tau 30 ms, ~280 ms to -80 dB) when it drops to 0. Click-free both ways.
  const relEnv = el.env(
    el.tau2pole(0.0002),
    el.tau2pole(0.03),
    el.const({ key: `damp.${note}`, value: st.damp }),
  );

  return el.mul(MASTER, relEnv, body);
}

function noteOf(st) {
  return Math.round(69 + 12 * Math.log2(st.freq / 440.0));
}

function renderAll() {
  const chans = [[], []];
  for (const st of voiceState.values()) {
    // Same voice graph feeds both channels (mono voices on a stereo bus;
    // PROVISIONAL — per-tine pan placement comes with the instrument work).
    const g = buildVoiceGraph(st);
    chans[0].push(g);
    chans[1].push(g);
  }
  core.render(
    chans[0].length ? el.add(...chans[0]) : el.const({ value: 0.0 }),
    chans[1].length ? el.add(...chans[1]) : el.const({ value: 0.0 }),
  );
}

// --- public API the host calls ---------------------------------------------

function noteOn(note, velocity) {
  const st = ensureState(note);
  const v = velocity / 127.0;
  const tilt = 0.5 + 0.5 * v; // harder = brighter (PROVISIONAL)
  st.gains = [v, 0.5 * v * tilt, 0.28 * v * tilt];
  st.damp = 1.0;

  if (st.gate === 1) {
    st.gate = 0;
    renderAll(); // clear the previous edge first
  }
  st.gate = 1;
  renderAll();
}

function noteOff(note) {
  if (!voiceState.has(note)) return;
  ensureState(note).damp = 0.0; // one-pole release (~300 ms to silence), gate stays 1
  renderAll();
}

// Continuous parameter (spec 2.1 item 5 / amendment 4.2): re-render with changed
// const values; the reconciler emits SET_PROPERTY per changed gain const, applied
// lock-free on the native side during sustained audio.
function setModeGain(modeIndex, value) {
  for (const st of voiceState.values()) st.gains[modeIndex] = value;
  renderAll();
}

function allNotesDamp() {
  for (const st of voiceState.values()) st.damp = 0.0;
  renderAll();
}

// Pre-build the pitch range so the initial graph allocation happens up front,
// off the audio thread, before the device starts.
for (let n = 48; n <= 84; ++n) ensureState(n);
renderAll();

globalThis.__mbira = { noteOn, noteOff, setModeGain, allNotesDamp };
