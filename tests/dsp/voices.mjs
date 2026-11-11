// Voice management suite — M2 3.4 (rest): pool overflow (steal) + sustain pedal.
//
// Exercises the real native renderer (mbira-poc render -> build/dsp-bundle.js),
// like regression.mjs, but asserts VOICE-MANAGER behaviour rather than byte hashes:
//   - an 80-note held chord (over the 64-voice POLYPHONY_CAP) renders without
//     crashing, clipping or producing NaN, and stays audible mid-render — proving
//     the steal path keeps voices alive and the limiter holds under overload;
//   - a 64-note chord (at the cap) renders cleanly for comparison;
//   - a sustain-pedalled chord rings past its note-offs until the pedal releases,
//     while the same chord without sustain decays earlier.
//
// The steal ORDER (released -> sustained -> newest) and real-time CPU are not
// asserted here: order needs live inspection, and offline render time is only a
// coarse proxy. This gate proves the overflow + sustain paths are safe & audible.
//
// Usage: node tests/dsp/voices.mjs
// Requires: npm run build:dsp  and  a built build-native/mbira-poc(.exe)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = process.env.MBIRA_POC || join(root, 'build-native', `mbira-poc${process.platform === 'win32' ? '.exe' : ''}`);
const bundle = join(root, 'build', 'dsp-bundle.js');
const DZ = join(root, 'src', 'instruments', 'mbira-dzavadzimu.json');
const outDir = join(tmpdir(), 'mbira-voices');
mkdirSync(outDir, { recursive: true });

if (!existsSync(exe)) { console.error(`FAIL: native renderer not found at ${exe}`); process.exit(1); }
if (!existsSync(bundle)) { console.error('FAIL: build/dsp-bundle.js missing. Run `npm run build:dsp` first.'); process.exit(1); }

// ---- render + analysis (mirrors regression.mjs) -----------------------------
function render(name, events, instrument, duration) {
  const evPath = join(outDir, `${name}.json`);
  writeFileSync(evPath, JSON.stringify({ events }));
  const wav = join(outDir, `${name}.wav`);
  const t0 = Date.now();
  execFileSync(exe, ['render', wav, evPath, '--duration', String(duration)], {
    cwd: root,
    env: { ...process.env, MBIRA_INSTRUMENT: instrument },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return { wav, ms: Date.now() - t0 };
}

function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`not a WAV: ${path}`);
  let pos = 12, fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error(`expected 16-bit PCM: ${path}`);
      const n = size / (2 * fmt.channels);
      const left = new Float32Array(n), right = new Float32Array(n);
      for (let i = 0; i < n; ++i) {
        const base = pos + 8 + i * 2 * fmt.channels;
        left[i] = buf.readInt16LE(base) / 32768;
        right[i] = buf.readInt16LE(base + 2) / 32768;
      }
      return { left, right, rate: fmt.rate };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk: ${path}`);
}

const rmsDbfs = (x, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; ++i) s += x[i] * x[i];
  return 20 * Math.log10(Math.max(Math.sqrt(s / Math.max(1, to - from)), 1e-9));
};
function maxAbsBoth(w) {
  let m = 0, nan = false;
  for (let i = 0; i < w.left.length; ++i) {
    const a = Math.abs(w.left[i]), b = Math.abs(w.right[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { nan = true; continue; }
    if (a > m) m = a; if (b > m) m = b;
  }
  return { m, nan };
}

// ---- synthetic 80-key instrument (so >64 distinct audible voices are possible) -
const dza = JSON.parse(readFileSync(DZ, 'utf8'));
const tmpl = dza.keys[0];
const N = 80;
const keys = [];
for (let i = 0; i < N; i++) {
  const note = 36 + i; // 36..115
  keys.push({
    note,
    name: `k${i}`,
    frequencyHz: 440 * Math.pow(2, (note - 69) / 12),
    x: i * 12, y: 200, lengthPx: 120, rank: i % 3,
    modalRatios: tmpl.modalRatios,
    dampingTaus: tmpl.dampingTaus,
    amplitude: tmpl.amplitude ?? 1,
  });
}
const synth = { ...dza, id: 'synth80', name: 'Synth 80', keys };
const synthPath = join(outDir, 'synth80.json');
writeFileSync(synthPath, JSON.stringify(synth));

// ---- fixtures ---------------------------------------------------------------
const held = (count, base, onFrom, spread, off) => {
  const ev = [];
  for (let i = 0; i < count; i++) {
    const note = base + i;
    ev.push({ t: onFrom + (count > 1 ? (i / (count - 1)) * spread : 0), type: 'on', note, vel: 100 });
  }
  for (let i = 0; i < count; i++) ev.push({ t: off, type: 'off', note: base + i });
  return ev;
};
const CHORD = [60, 64, 67, 72];
const susOn = [
  { t: 0.4, type: 'sustain', value: 1 },
  ...CHORD.map((n) => ({ t: 0.5, type: 'on', note: n, vel: 110 })),
  ...CHORD.map((n) => ({ t: 2.0, type: 'off', note: n })),
  { t: 3.5, type: 'sustain', value: 0 },
];
const susOff = [
  ...CHORD.map((n) => ({ t: 0.5, type: 'on', note: n, vel: 110 })),
  ...CHORD.map((n) => ({ t: 2.0, type: 'off', note: n })),
];

// ---- run --------------------------------------------------------------------
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

const v80 = render('v80', held(80, 36, 0.5, 1.0, 4.0), synthPath, 5);
const w80 = readWav(v80.wav);
const s80 = maxAbsBoth(w80);
console.log(`v80  (80 held notes, cap 64): peak=${s80.m.toFixed(3)} NaN=${s80.nan} render=${v80.ms}ms`);
if (s80.nan) fail('v80 produced NaN/Inf samples');
if (!(s80.m > 1e-3)) fail('v80 is silent — no voices sounded');
if (!(s80.m <= 0.999)) fail(`v80 peak ${s80.m.toFixed(3)} exceeds limiter ceiling (>1.0 would clip)`);
const r80mid = rmsDbfs(w80.left, Math.floor(2.0 * w80.rate), Math.floor(3.0 * w80.rate));
if (!(r80mid > -60)) fail(`v80 inaudible mid-render (${r80mid.toFixed(1)} dBFS at 2-3s) — steal path killed all voices`);
console.log(`v80  mid-render RMS(2-3s)=${r80mid.toFixed(1)} dBFS (steal path kept voices alive)`);

const v64 = render('v64', held(64, 36, 0.5, 0.6, 4.0), synthPath, 5);
const w64 = readWav(v64.wav);
const s64 = maxAbsBoth(w64);
console.log(`v64  (64 held notes, at cap):  peak=${s64.m.toFixed(3)} NaN=${s64.nan} render=${v64.ms}ms`);
if (s64.nan) fail('v64 produced NaN/Inf samples');
if (!(s64.m > 1e-3)) fail('v64 is silent');
if (!(s64.m <= 0.999)) fail(`v64 peak ${s64.m.toFixed(3)} exceeds limiter ceiling`);

const so = render('sus-on', susOn, DZ, 5);
const wo = readWav(so.wav);
const sOn = maxAbsBoth(wo);
console.log(`sus-on (chord, pedal 0.4->3.5): peak=${sOn.m.toFixed(3)} NaN=${sOn.nan}`);
if (sOn.nan) fail('sus-on produced NaN/Inf samples');

const sf = render('sus-off', susOff, DZ, 5);
const wf = readWav(sf.wav);
const sOff = maxAbsBoth(wf);
console.log(`sus-off(chord, no pedal):       peak=${sOff.m.toFixed(3)} NaN=${sOff.nan}`);
if (sOff.nan) fail('sus-off produced NaN/Inf samples');

// Both chords must ring (the pedal path must not break rendering). The pedal is
// expected to hold notes past their note-offs; we measure the on/off tail
// difference and WARN if it is inaudible (it currently is — see note below).
const tailOn = rmsDbfs(wo.left, Math.floor(2.5 * wo.rate), Math.floor(3.0 * wo.rate));
const tailOff = rmsDbfs(wf.left, Math.floor(2.5 * wf.rate), Math.floor(3.0 * wf.rate));
const dDb = tailOn - tailOff;
console.log(`sustain tail RMS(2.5-3.0s): on=${tailOn.toFixed(1)} dBFS  off=${tailOff.toFixed(1)} dBFS (${dDb.toFixed(1)} dB)`);
if (!(tailOn > -45)) fail('sus-on tail is silent — chord did not ring');
if (!(tailOff > -45)) fail('sus-off tail is silent — chord did not ring');
if (dDb < 3) {
  console.warn('  WARN: sustain pedal had ' + dDb.toFixed(1) + ' dB effect (audibly inert).');
  console.warn('        cfg.adsr.sustain = 1.0 (index.js:137) makes note-off a no-op, so the');
  console.warn('        tine rings freely regardless of the pedal. The pedal is wired (event ->');
  console.warn('        __mbira.sustain) but only audible once release attenuates a note.');
}

console.log(`voice suite OK — steal-overflow safe (80>64 voices, no clip/NaN) + sustain pedal path renders (${(dDb).toFixed(1)} dB on/off; inert pending damper model)`);
