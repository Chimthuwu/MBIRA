// Real-bundle regression gate (audit 2026-11-10, phase A2).
//
// Renders canonical event files through the SHIPPED path — the native host
// (mbira-poc render: real elem::Runtime + QuickJS executing build/dsp-bundle.js)
// — and compares SHA-256 of the 16-bit PCM output against a checked-in
// reference manifest. Any DSP edit changes these hashes; that is intentional:
// update the manifest deliberately (`node tests/dsp/regression.mjs --update`)
// and say why in the commit message.
//
// Also re-asserts the two listening-pack fixes as BEHAVIOUR, not just bytes:
//   L-1  pluck position is level-matched across p = 0.0 / 0.5 / 1.0
//   L-2  buzz ships on by default and adds 2-8 kHz energy
//   mod  per-note strips shift the value once per strike; the free-running LFO
//        strip keeps moving the value while the note rings
//
// Usage: node tests/dsp/regression.mjs [--update]
// Requires: npm run build:dsp  and  a built build-native/mbira-poc(.exe)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = process.env.MBIRA_POC || join(root, 'build-native', `mbira-poc${process.platform === 'win32' ? '.exe' : ''}`);
const bundle = join(root, 'build', 'dsp-bundle.js');
const refPath = join(root, 'tests', 'dsp', 'reference-manifest.json');
const update = process.argv.includes('--update');

const DZ = join(root, 'src', 'instruments', 'mbira-dzavadzimu.json');
const NY = join(root, 'src', 'instruments', 'nyunga-nyunga.json');
const ev = (f) => join(root, 'tests', 'events', f);

const cases = [
  { name: 'dz-phrase',         events: ev('phrase.json'),                  duration: 5, instrument: DZ },
  { name: 'ny-phrase',         events: ev('phrase.json'),                  duration: 5, instrument: NY },
  { name: 'dz-pluck-0.0',      events: ev('listen-pluck-0.0.json'),        duration: 4, instrument: DZ },
  { name: 'dz-pluck-0.5',      events: ev('listen-pluck-0.5.json'),        duration: 4, instrument: DZ },
  { name: 'dz-pluck-1.0',      events: ev('listen-pluck-1.0.json'),        duration: 4, instrument: DZ },
  { name: 'dz-buzz-off',       events: ev('listen-buzz-off.json'),         duration: 5, instrument: DZ },
  { name: 'dz-buzz-on',        events: ev('listen-buzz-on.json'),          duration: 5, instrument: DZ },
  { name: 'dz-macro-bright',   events: ev('listen-macro-bright-max.json'), duration: 4, instrument: DZ },
  // brightness is a live spectral tilt: same phrase at 0.0 / 0.5 / 1.0
  { name: 'dz-bright-min',     events: ev('listen-macro-bright-min.json'), duration: 4, instrument: DZ },
  { name: 'dz-bright-mid',     events: ev('listen-macro-bright-mid.json'), duration: 4, instrument: DZ },
  { name: 'dz-macro-res-off',  events: ev('listen-macro-res-off.json'),    duration: 5, instrument: DZ },
  { name: 'dz-macro-buzz-max', events: ev('listen-macro-buzz-max.json'),   duration: 5, instrument: DZ },
  { name: 'dz-master-half',    events: ev('listen-master-half.json'),      duration: 5, instrument: DZ },
  // physical model (modal resonator + exciter) — same note/vel as dz-pluck-0.5
  { name: 'dz-modal-geo',      events: ev('modal-geometry-max.json'),      duration: 4, instrument: DZ },
  { name: 'dz-modal-mat',      events: ev('modal-material-max.json'),      duration: 4, instrument: DZ },
  { name: 'dz-modal-decay',    events: ev('modal-decay-min.json'),         duration: 4, instrument: DZ },
  { name: 'dz-modal-noise',    events: ev('exciter-noise-max.json'),       duration: 4, instrument: DZ },
  // per-parameter mod strip: same note struck twice, decay->velocity depth 0 then 1
  { name: 'dz-mod-decay-vel',  events: ev('modal-mod-decay-vel.json'),     duration: 7, instrument: DZ },
  // free-running LFO strip: decay<-LFO depth 0 (control) vs 1 (continuous)
  { name: 'dz-mod-decay-lfo-off', events: ev('modal-mod-decay-lfo-off.json'), duration: 4, instrument: DZ },
  { name: 'dz-mod-decay-lfo',     events: ev('modal-mod-decay-lfo.json'),     duration: 4, instrument: DZ },
];

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };

if (!existsSync(exe)) {
  console.error(`FAIL: native renderer not found at ${relative(root, exe)}.`);
  console.error('      Build it (docs/how-to-run.md) or set MBIRA_POC to the mbira-poc binary.');
  console.error('      This gate deliberately refuses to fall back to the WASM offline renderer.');
  process.exit(1);
}
if (!existsSync(bundle)) {
  console.error('FAIL: build/dsp-bundle.js missing. Run `npm run build:dsp` first.');
  process.exit(1);
}

// ---- real native render ----------------------------------------------------
const outDir = join(tmpdir(), 'mbira-regression');
mkdirSync(outDir, { recursive: true });

function render(c) {
  const wav = join(outDir, `${c.name}.wav`);
  execFileSync(exe, ['render', wav, c.events, '--duration', String(c.duration)], {
    cwd: root,
    env: { ...process.env, MBIRA_INSTRUMENT: c.instrument },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return wav;
}

// ---- minimal 16-bit stereo PCM reader -------------------------------------
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
      const left = new Float32Array(n);
      const right = new Float32Array(n);
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
  const r = Math.sqrt(s / Math.max(1, to - from));
  return 20 * Math.log10(Math.max(r, 1e-9));
};

// RBJ bandpass applied twice, first fromS skipped (matches the listening-pack manifest).
function bandpassDbfs(x, rate, f0, q, fromS = 0.3) {
  const w0 = (2 * Math.PI * f0) / rate, alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha, b1 = 0, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  let y = x;
  for (let pass = 0; pass < 2; ++pass) {
    const out = new Float32Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; ++i) {
      const v = (b0 / a0) * y[i] + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v;
    }
    y = out;
  }
  return rmsDbfs(y, Math.floor(fromS * rate));
}
const highBandDbfs = (x, rate) => bandpassDbfs(x, rate, 4000, 1.4);   // ~2-8 kHz (buzz)
const lowBandDbfs = (x, rate) => bandpassDbfs(x, rate, 220, 1.0);    // ~60-400 Hz (body/gourd)
const rmsRangeDbfs = (x, rate, fromS, toS) =>
  rmsDbfs(x, Math.floor(fromS * rate), Math.min(x.length, Math.floor(toS * rate)));
const bandRangeDbfs = (x, rate, f0, q, fromS, toS) =>
  bandpassDbfs(x.subarray(Math.floor(fromS * rate), Math.min(x.length, Math.floor(toS * rate))), rate, f0, q, 0);

// ---- run -------------------------------------------------------------------
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const reference = existsSync(refPath) ? JSON.parse(readFileSync(refPath, 'utf8')) : { cases: {} };
const rendered = {};
const hashes = {};

for (const c of cases) {
  process.stdout.write(`render ${c.name} ... `);
  const wav = render(c);
  rendered[c.name] = readWav(wav);
  hashes[c.name] = sha256(wav);
  console.log(hashes[c.name].slice(0, 12));
}

if (update) {
  const manifest = {
    note: 'SHA-256 of real-native renders (mbira-poc render -> build/dsp-bundle.js, 16-bit PCM stereo). '
        + 'Regenerate with `node tests/dsp/regression.mjs --update` only for DELIBERATE DSP changes; '
        + 'state the reason in the commit message.',
    bundleSha256: sha256(bundle),
    cases: Object.fromEntries(cases.map((c) => [c.name, {
      events: relative(root, c.events).replaceAll('\\', '/'),
      duration: c.duration,
      instrument: relative(root, c.instrument).replaceAll('\\', '/'),
      sha256: hashes[c.name],
    }])),
  };
  writeFileSync(refPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nupdated ${relative(root, refPath)} (${cases.length} cases, bundle ${manifest.bundleSha256.slice(0, 12)})`);
  process.exit(process.exitCode || 0);
}

// 1. byte-exact regression
for (const c of cases) {
  const want = reference.cases?.[c.name]?.sha256;
  if (!want) { fail(`${c.name}: no reference hash (run with --update to seed it)`); continue; }
  if (want !== hashes[c.name]) console.error(`  ${c.name}\n    expected ${want}\n    actual   ${hashes[c.name]}`);
}
if (process.exitCode) console.error('DSP output changed. If intentional: `node tests/dsp/regression.mjs --update` + explain in the commit.');

// 2. L-1: pluck position is level-matched, and the endpoints are not copies
const plucks = ['dz-pluck-0.0', 'dz-pluck-0.5', 'dz-pluck-1.0'];
const levels = plucks.map((n) => rmsDbfs(rendered[n].left));
const spread = Math.max(...levels) - Math.min(...levels);
console.log(`L-1 pluck RMS: ${levels.map((v) => v.toFixed(2)).join(' / ')} dBFS (spread ${spread.toFixed(2)} dB)`);
if (spread > 0.5) fail(`L-1 regressed: pluck level spread ${spread.toFixed(2)} dB > 0.5 dB`);
if (hashes['dz-pluck-0.0'] === hashes['dz-pluck-1.0']) fail('L-1 regressed: pluck endpoints render byte-identical');

// 3. L-2: buzz on adds high-band energy over buzz off
const off = highBandDbfs(rendered['dz-buzz-off'].left, rendered['dz-buzz-off'].rate);
const on = highBandDbfs(rendered['dz-buzz-on'].left, rendered['dz-buzz-on'].rate);
console.log(`L-2 buzz 2-8 kHz: ${off.toFixed(2)} -> ${on.toFixed(2)} dBFS (${(on - off).toFixed(1)} dB)`);
if (!(on > off + 2)) fail(`L-2 regressed: buzz adds only ${(on - off).toFixed(1)} dB in 2-8 kHz`);

// 4. Macro/body/master respond (regression guards for the wired DSP params)
const ref = rendered['dz-phrase'];
const refRms = rmsDbfs(ref.left), refRate = ref.rate;
const masterHalfRms = rmsDbfs(rendered['dz-master-half'].left);
console.log(`master 1.0 -> 0.5 RMS: ${refRms.toFixed(2)} -> ${masterHalfRms.toFixed(2)} dBFS (${(masterHalfRms - refRms).toFixed(1)} dB)`);
if (!(masterHalfRms < refRms - 6)) fail(`master fader regressed: half position only ${(masterHalfRms - refRms).toFixed(1)} dB down`);

const resOffLow = lowBandDbfs(rendered['dz-macro-res-off'].left, refRate);
const refLow = lowBandDbfs(ref.left, refRate);
console.log(`resonance 0.5 -> 0.0 (60-400 Hz): ${refLow.toFixed(2)} -> ${resOffLow.toFixed(2)} dBFS (${(resOffLow - refLow).toFixed(1)} dB)`);
if (!(resOffLow < refLow - 0.5)) fail(`macro.resonance regressed: turning off changed 60-400 Hz by only ${(resOffLow - refLow).toFixed(1)} dB`);

const buzzMaxHi = highBandDbfs(rendered['dz-macro-buzz-max'].left, refRate);
const refHi = highBandDbfs(ref.left, refRate);
console.log(`macro.buzz 0.5 -> 1.0 (2-8 kHz): ${refHi.toFixed(2)} -> ${buzzMaxHi.toFixed(2)} dBFS (${(buzzMaxHi - refHi).toFixed(1)} dB)`);
if (!(buzzMaxHi > refHi + 1)) fail(`macro.buzz regressed: max only ${(buzzMaxHi - refHi).toFixed(1)} dB above neutral in 2-8 kHz`);

// macro.brightness must be an audible TILT (6+ dB either way in 2-8 kHz) and a
// tilt rather than a volume knob (body band within 2 dB). Before 2026-11-10 it
// only shifted mode gains at note-on, which measured ~1 dB end to end - i.e.
// the knob did nothing on a note that was already ringing.
{
  const mid = rendered['dz-bright-mid'];
  const dark = rendered['dz-bright-min'];
  const bright = rendered['dz-macro-bright'];
  const midHi = highBandDbfs(mid.left, mid.rate);
  const midLow = lowBandDbfs(mid.left, mid.rate);
  const brightHi = highBandDbfs(bright.left, mid.rate);
  const darkHi = highBandDbfs(dark.left, mid.rate);
  const brightLow = lowBandDbfs(bright.left, mid.rate);
  const darkLow = lowBandDbfs(dark.left, mid.rate);
  console.log(`macro.brightness 0.0 / 0.5 / 1.0 (2-8 kHz): ${darkHi.toFixed(2)} / ${midHi.toFixed(2)} / ${brightHi.toFixed(2)} dBFS (${(brightHi - midHi).toFixed(1)} / ${(darkHi - midHi).toFixed(1)} dB)`);
  console.log(`macro.brightness 0.0 / 0.5 / 1.0 (60-400 Hz): ${darkLow.toFixed(2)} / ${midLow.toFixed(2)} / ${brightLow.toFixed(2)} dBFS`);
  if (!(brightHi > midHi + 6)) fail(`macro.brightness regressed: 1.0 is only ${(brightHi - midHi).toFixed(1)} dB above neutral in 2-8 kHz`);
  if (!(darkHi < midHi - 6)) fail(`macro.brightness regressed: 0.0 is only ${(midHi - darkHi).toFixed(1)} dB below neutral in 2-8 kHz`);
  if (Math.abs(brightLow - midLow) > 2 || Math.abs(darkLow - midLow) > 2)
    fail(`macro.brightness is a level change, not a tilt: body moved ${(brightLow - midLow).toFixed(1)} / ${(darkLow - midLow).toFixed(1)} dB`);
}

// 5. Physical model: the resonator and exciter controls must audibly change the sound.
{
  const p05 = rendered['dz-pluck-0.5'];
  const refHi = highBandDbfs(p05.left, p05.rate);
  const geoHi = highBandDbfs(rendered['dz-modal-geo'].left, rendered['dz-modal-geo'].rate);
  console.log(`modal.geometry 0 -> 1 (2-8 kHz): ${refHi.toFixed(2)} -> ${geoHi.toFixed(2)} dBFS (${(geoHi - refHi).toFixed(1)} dB)`);
  if (!(Math.abs(geoHi - refHi) > 3)) fail(`modal.geometry regressed: geometry max only ${(geoHi - refHi).toFixed(1)} dB from the tine set in 2-8 kHz`);

  const matHi = highBandDbfs(rendered['dz-modal-mat'].left, rendered['dz-modal-mat'].rate);
  console.log(`modal.material 0.5 -> 1.0 (2-8 kHz): ${refHi.toFixed(2)} -> ${matHi.toFixed(2)} dBFS (${(matHi - refHi).toFixed(1)} dB)`);
  if (!(matHi > refHi + 2)) fail(`modal.material regressed: steel only ${(matHi - refHi).toFixed(1)} dB above neutral in 2-8 kHz`);

  const tail = rmsRangeDbfs(p05.left, p05.rate, 2.0, 3.0);
  const decayTail = rmsRangeDbfs(rendered['dz-modal-decay'].left, rendered['dz-modal-decay'].rate, 2.0, 3.0);
  console.log(`modal.decay 0.5 -> 0.0 tail 2.0-3.0 s: ${tail.toFixed(2)} -> ${decayTail.toFixed(2)} dBFS (${(decayTail - tail).toFixed(1)} dB)`);
  if (!(decayTail < tail - 12)) fail(`modal.decay regressed: 0.25x ring only ${(decayTail - tail).toFixed(1)} dB at 2-3 s`);

  const nz = rendered['dz-modal-noise'];
  const attackRef = bandRangeDbfs(p05.left, p05.rate, 4000, 1.4, 0.500, 0.530);
  const attackNz = bandRangeDbfs(nz.left, nz.rate, 4000, 1.4, 0.500, 0.530);
  console.log(`exciter.noise 0 -> 1.0 attack 0-30 ms (2-8 kHz): ${attackRef.toFixed(2)} -> ${attackNz.toFixed(2)} dBFS (${(attackNz - attackRef).toFixed(1)} dB)`);
  if (!(attackNz > attackRef + 4)) fail(`exciter.noise regressed: full strike noise only ${(attackNz - attackRef).toFixed(1)} dB in the first 30 ms`);

  // Mod strip (per-note source): with mod.decay.vel = 1, the SAME note at the
  // same velocity must ring longer than it did with the depth at 0. Both tails
  // are measured 2.0-2.4 s after their own strike.
  const mv = rendered['dz-mod-decay-vel'];
  const plainTail = rmsRangeDbfs(mv.left, mv.rate, 2.0, 2.4);
  const modTail = rmsRangeDbfs(mv.left, mv.rate, 5.0, 5.4);
  console.log(`mod.decay.vel 0 -> 1 tail 2 s after strike: ${plainTail.toFixed(2)} -> ${modTail.toFixed(2)} dBFS (${(modTail - plainTail).toFixed(1)} dB)`);
  if (!(modTail > plainTail + 6)) fail(`mod strip regressed: velocity->decay only ${(modTail - plainTail).toFixed(1)} dB longer ring`);

  // Free-running LFO strip: with mod.decay.lfo = 1 the ring time must keep
  // MOVING while the note sounds, so the envelope has to ripple at the LFO rate
  // (1.5 Hz here) rather than change once at the strike. Envelope = 20 ms RMS
  // frames; subtracting a one-period moving average leaves the LFO component.
  const lfoRipple = (wav) => {
    const hop = Math.round(0.02 * wav.rate);
    const env = [];
    for (let s = Math.floor(0.5 * wav.rate); s + hop <= Math.floor(2.8 * wav.rate); s += hop) {
      let e = 0;
      for (let i = s; i < s + hop; ++i) e += wav.left[i] * wav.left[i];
      env.push(10 * Math.log10(Math.max(1e-12, e / hop)));
    }
    const half = Math.floor((1 / 1.5) / 0.02 / 2); // half an LFO cycle, in frames
    let lo = Infinity, hi = -Infinity, crossings = 0, prev = 0;
    for (let i = half; i < env.length - half; ++i) {
      let m = 0;
      for (let k = -half; k <= half; ++k) m += env[i + k];
      const r = env[i] - m / (2 * half + 1);
      if (r < lo) lo = r;
      if (r > hi) hi = r;
      if (i > half && (r < 0) !== (prev < 0)) crossings++;
      prev = r;
    }
    return { ripple: hi - lo, crossings };
  };
  const lfoOff = lfoRipple(rendered['dz-mod-decay-lfo-off']);
  const lfoOn = lfoRipple(rendered['dz-mod-decay-lfo']);
  console.log(`mod.decay.lfo 0 -> 1 envelope ripple at 1.5 Hz: ${lfoOff.ripple.toFixed(1)} -> ${lfoOn.ripple.toFixed(1)} dB (${lfoOn.crossings} sign changes)`);
  if (!(lfoOff.ripple < 1.0)) fail(`LFO baseline already ripples ${lfoOff.ripple.toFixed(1)} dB — test cannot discriminate`);
  if (!(lfoOn.ripple > 2.0)) fail(`mod.decay.lfo regressed: envelope only ripples ${lfoOn.ripple.toFixed(1)} dB`);
  if (!(lfoOn.crossings >= 3)) fail(`mod.decay.lfo regressed: ${lfoOn.crossings} sign changes — the ring time is not moving repeatedly`);
}

// 6. L-4: stereo image — L and R differ on a multi-note, spatially spread render.
{
  const { left, right } = rendered['dz-phrase'];
  let diff = 0, energy = 0;
  for (let i = 0; i < left.length; ++i) { const d = left[i] - right[i]; diff += d * d; energy += left[i] * left[i] + right[i] * right[i]; }
  const ratio = Math.sqrt(diff / Math.max(1e-12, energy));
  console.log(`L-4 stereo L/R difference ratio (dz-phrase): ${ratio.toFixed(4)}`);
  if (!(ratio > 0.001)) fail('L-4 regressed: left and right channels are (near-)identical');
}

if (process.exitCode) { console.error('regression gate FAILED'); process.exit(1); }
console.log(`regression gate OK — ${cases.length} real-bundle renders match reference manifest`);
