// Offline repro of the native host's exact sequence: initial silent graph
// (all voices, gains 0), then re-render with one note's gate/gains set.
import { el } from '@elemaudio/core';
import OfflineRenderer from '@elemaudio/offline-renderer';

const SR = 48000;
const RATIOS = [1.0, 2.6, 4.2];
const TAUS = [1.2, 0.5, 0.22];
const MASTER = 0.22;

const voiceState = new Map();
for (let n = 48; n <= 84; ++n) voiceState.set(n, { freq: 440.0 * Math.pow(2, (n - 69) / 12), gate: 0, damp: 0, gains: [0, 0, 0] });

function buildVoiceGraph(st) {
  const note = Math.round(69 + 12 * Math.log2(st.freq / 440.0));
  const gate = el.const({ key: `gate.${note}`, value: st.gate });
  const edge = el.sub(gate, el.z(gate));
  const modes = [0, 1, 2].map((i) => {
    const norm = 1.0 / (1.0 - Math.exp(-1.0 / (TAUS[i] * SR)));
    const env = el.mul(norm, el.smooth(el.tau2pole(TAUS[i]), edge));
    return el.mul(el.const({ key: `g${i}.${note}`, value: st.gains[i] }), env, el.cycle(st.freq * RATIOS[i]));
  });
  const relEnv = el.env(el.tau2pole(0.0002), el.tau2pole(0.03),
    el.const({ key: `damp.${note}`, value: st.damp }));
  return el.mul(MASTER, relEnv, el.add(...modes));
}

function renderAll() {
  const g = [...voiceState.values()].map(buildVoiceGraph);
  core.render(el.add(...g), el.add(...g));
}

const core = new OfflineRenderer();
await core.initialize({ numInputChannels: 0, numOutputChannels: 2, sampleRate: SR });

const N = SR;
const L = new Float32Array(N), R = new Float32Array(N);
renderAll();
core.process([], [L, R]);
let p1 = 0; for (let i = 0; i < N; ++i) p1 = Math.max(p1, Math.abs(L[i]));

// Now noteOn(60, 100)
const st = voiceState.get(60);
st.gains = [100 / 127, 0.5 * (100 / 127) * (0.5 + 0.5 * 100 / 127), 0.28 * (100 / 127) * (0.5 + 0.5 * 100 / 127)];
st.damp = 1; st.gate = 1;
renderAll();

const L2 = new Float32Array(N), R2 = new Float32Array(N);
core.process([], [L2, R2]);
let p2 = 0, first = -1; for (let i = 0; i < N; ++i) { const a = Math.abs(L2[i]); if (a > p2) p2 = a; if (first < 0 && a > 1e-4) first = i; }
console.log(JSON.stringify({ peakFirstBuffer: p1, peakSecondBuffer: p2, firstNonZeroIdx: first }));
