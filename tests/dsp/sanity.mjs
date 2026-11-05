// Headless sanity check of the DSP graph via @elemaudio/offline-renderer (WASM).
// This is NOT the native-runtime gate — it only proves the graph code renders
// and produces a decaying 3-mode pluck before we wire the C++ host.
import { el } from '@elemaudio/core';
import OfflineRenderer from '@elemaudio/offline-renderer';

const SR = 48000, DUR = 3, N = SR * DUR;

function voiceGraph(note, gate, damp, gains) {
  const freq = 440.0 * Math.pow(2.0, (note - 69) / 12.0);
  const RATIOS = [1.0, 2.6, 4.2];
  const TAUS = [1.2, 0.5, 0.22];
  const g = el.const({ key: `gate.${note}`, value: gate });
  const edge = el.sub(g, el.z(g));
  const modes = [0, 1, 2].map((i) => {
    const norm = 1.0 / (1.0 - Math.exp(-1.0 / (TAUS[i] * SR)));
    const env = el.mul(norm, el.smooth(el.tau2pole(TAUS[i]), edge));
    return el.mul(el.const({ key: `g${i}.${note}`, value: gains[i] }), env, el.cycle(freq * RATIOS[i]));
  });
  const relEnv = el.env(el.tau2pole(0.0002), el.tau2pole(0.03),
    el.const({ key: `damp.${note}`, value: damp }));
  return el.mul(0.22, relEnv, el.add(...modes));
}

const core = new OfflineRenderer();
await core.initialize({ numInputChannels: 0, numOutputChannels: 2, sampleRate: SR });

const gains = [1.0, 0.5, 0.28];
const g = voiceGraph(60, 1, 1, gains);
core.render(g, g);

const L = new Float32Array(N), R = new Float32Array(N);
core.process([], [L, R]);

const peakAt = (from, to) => {
  let p = 0;
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); ++i) { const a = Math.abs(L[i]); if (a > p) p = a; }
  return p;
};
const rms = (from, to) => {
  let s = 0, n = 0;
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); ++i) { s += L[i] * L[i]; ++n; }
  return Math.sqrt(s / n);
};
console.log(JSON.stringify({
  peak: +peakAt(0, DUR).toFixed(4),
  rms0_50ms: +rms(0, 0.05).toFixed(4),
  rms1s: +rms(1, 1.01).toFixed(4),
  rms2s: +rms(2, 2.01).toFixed(4),
  ratio_1s_to_0: +(rms(1, 1.01) / rms(0, 0.05)).toFixed(3),
}));
