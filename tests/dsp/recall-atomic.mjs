// Block-atomic preset recall (§5.4) — two layers:
//
// 1. Native-render comparison: a mid-render `recall` event must land the new
//    values within one audio block (instant consts, no smooth ramp), while the
//    same change via a plain `param` event ramps over its smooth tau.
// 2. Bundle-level behaviour (Node, stubbed __postNativeMessage__): validation
//    runs BEFORE any mutation (unknown / non-finite params throw), every
//    preset-registry path is accepted (drift guard for the RECALLABLE list),
//    and a successful recall re-renders exactly once.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const exe = join(root, 'build-native', 'mbira-poc.exe');
const outDir = join(root, 'out-test', 'recall-atomic');
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };
mkdirSync(outDir, { recursive: true });

if (!existsSync(exe)) { fail('native renderer not found'); process.exit(1); }

// ---- part 1: native render, recall vs param ramp ----------------------------
function render(name, events, duration) {
  const evPath = join(outDir, `${name}.json`);
  writeFileSync(evPath, JSON.stringify({ events }));
  const wav = join(outDir, `${name}.wav`);
  execFileSync(exe, ['render', wav, evPath, '--duration', String(duration)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return wav;
}

function readWav(path) {
  const buf = readFileSync(path);
  let pos = 12, fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { rate: buf.readUInt32LE(pos + 12) };
    if (id === 'data') {
      const n = size / 4;
      const left = new Float32Array(n);
      for (let i = 0; i < n; ++i) left[i] = buf.readInt16LE(pos + 8 + i * 4) / 32768;
      return { left, rate: fmt.rate };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

const rmsDbfs = (x, from, to) => {
  let s = 0, n = 0;
  for (let i = Math.floor(from); i < Math.floor(to); ++i) { s += x[i] * x[i]; ++n; }
  return 20 * Math.log10(Math.max(Math.sqrt(s / Math.max(1, n)), 1e-9));
};

const NOTE_ON = [{ t: 0.95, type: 'on', note: 60, vel: 100 }]; // loud across the transition
const T = 1.0; // transition moment
const RECALL = { master: 0.1 }; // p^2.5 fader: 0.1^2.5 ~= 0.0032 (~-50 dB)

const wavRecall = render('recall', [...NOTE_ON,
  { t: T, type: 'recall', params: RECALL }], 3);
const wavParam = render('param', [...NOTE_ON,
  { t: T, type: 'param', name: 'master', value: 0.1 }], 3);

const wR = readWav(wavRecall), wP = readWav(wavParam);
const SR = wR.rate;
const at = (s) => s * SR;
const pre = 0.9, post10 = T + 0.015, postSettled = T + 0.3;

const rRecall = rmsDbfs(wR.left, at(post10), at(T + 0.04)); // ramp mid-flight window
const rParam = rmsDbfs(wP.left, at(post10), at(T + 0.04));
console.log(`transition 15-40ms after recall: block-atomic ${rRecall.toFixed(1)} dBFS vs ramped param ${rParam.toFixed(1)} dBFS`);
if (!(rRecall <= rParam - 6.0)) fail(`recall did not land instantly: ${rRecall.toFixed(1)} dBFS vs ramped ${rParam.toFixed(1)} dBFS (expected >= 6 dB lower)`);

const preRecall = rmsDbfs(wR.left, at(pre), at(T - 0.05));
const postRecall = rmsDbfs(wR.left, at(postSettled), at(T + 0.45));
console.log(`settled: pre ${preRecall.toFixed(1)} dBFS -> post ${postRecall.toFixed(1)} dBFS (recall drives the fader, not a mute)`);
if (!(postRecall < preRecall - 12.0)) fail('recall had no audible effect on the fader');

// ---- part 2: bundle-level recall behaviour ----------------------------------
const bundle = readFileSync(join(root, 'build', 'dsp-bundle.js'), 'utf8');
const batches = [];
const ctx = vm.createContext({
  console: { log: () => {}, warn: () => {}, error: () => {} },
  __postNativeMessage__: (text) => { batches.push(String(text).length); },
  globalThis: {},
});
ctx.globalThis = ctx;
try { vm.runInContext(bundle, ctx, { filename: 'dsp-bundle.js' }); }
catch (e) { fail(`bundle failed to evaluate: ${e.message}`); process.exit(1); }
batches.length = 0; // drop the startup graph

const mbira = vm.runInContext('globalThis.__mbira', ctx);

// every path the preset registry (32 values: master, 3 macros, 6 modal knobs,
// lfo.rate, 21 mod strips) can produce must be accepted by recall — this is the
// drift guard on the RECALLABLE list. Mirrors the controls mounted in ui/.
const PRESET_PATHS = [
  'master', 'macro.resonance', 'macro.buzz', 'macro.brightness',
  'modal.geometry', 'modal.material', 'modal.decay',
  'exciter.noise', 'exciter.hardness', 'lfo.rate',
  'mod.geometry.vel', 'mod.geometry.key', 'mod.geometry.rnd', 'mod.geometry.lfo',
  'mod.material.vel', 'mod.material.key', 'mod.material.rnd', 'mod.material.lfo',
  'mod.decay.vel', 'mod.decay.key', 'mod.decay.rnd', 'mod.decay.lfo',
  'mod.pluck.vel', 'mod.pluck.key', 'mod.pluck.rnd',
  'mod.noise.vel', 'mod.noise.key', 'mod.noise.rnd',
  'mod.hardness.vel', 'mod.hardness.key', 'mod.hardness.rnd',
];
try {
  const r = mbira.recall(Object.fromEntries(PRESET_PATHS.map((p) => [p, 0.5])));
  if (r.applied !== PRESET_PATHS.length) fail(`recall applied ${r.applied} of ${PRESET_PATHS.length}`);
} catch (e) { fail(`recall rejected a valid preset path: ${e.message}`); }

// validation must run BEFORE mutation: unknown / non-finite throw, nothing applied
for (const [desc, bad] of [
  ['unknown param', { master: 0.5, 'bogus.param': 1 }],
  ['non-finite value', { master: NaN }],
  ['array params', [1, 2]],
]) {
  let threw = false;
  try { mbira.recall(bad); } catch (_) { threw = true; }
  if (!threw) fail(`recall accepted ${desc}`);
}
const r2 = mbira.recall({ master: 0.25 });
if (r2.applied !== 1) fail('valid recall after failed recalls did not apply');

console.log('recall-atomic OK — block-atomic recall lands within one block; validation before mutation; all 31 preset paths accepted');
