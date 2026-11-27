// M2 3.4 rest — 32/64-voice CPU verification through the REAL native renderer.
//
// The steal/sustain suite (voices.mjs) covers correctness; this script closes the
// remaining M2 3.4 item: measure the audio-loop CPU percent for a 32-voice and a
// 64-voice held chord (POLYPHONY_CAP = 64) and assert real-time viability
// (audio_loop_cpu_percent < 80 %; the M1 gate target was < 30 % for <= 37 voices
// on the 3-mode engine — the 6-partial engine + body chain costs more, so the
// hard assert is realtime viability with headroom, and the numbers are printed
// for the todo/tracking).
//
// Shipped instruments have 15-24 keys, so like voices.mjs we build a synthetic
// 80-key instrument so 32/64 DISTINCT held voices are possible.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const exe = join(root, 'build-native', 'mbira-poc.exe');
const outDir = join(root, 'out-test', 'voices-cpu');

const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; };

if (!existsSync(exe)) { fail('native renderer not found at build-native/mbira-poc.exe'); process.exit(1); }
if (!existsSync(join(root, 'build', 'dsp-bundle.js'))) { fail('build/dsp-bundle.js missing. Run `npm run build:dsp` first.'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

// ---- synthetic 80-key instrument (same pattern as voices.mjs) ----------------
const dza = JSON.parse(readFileSync(join(root, 'src', 'instruments', 'mbira-dzavadzimu.json'), 'utf8'));
const tmpl = dza.keys[0];
const N = 80;
const keys = [];
for (let i = 0; i < N; i++) {
  const note = 36 + i;
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
const synth = { ...dza, id: 'synth80-cpu', name: 'Synth 80 CPU', keys };
const synthPath = join(outDir, 'synth80.json');
writeFileSync(synthPath, JSON.stringify(synth));

const held = (count, base, onFrom, spread, off) => {
  const ev = [];
  for (let i = 0; i < count; i++) {
    const note = base + i;
    ev.push({ t: onFrom + (count > 1 ? (i / (count - 1)) * spread : 0), type: 'on', note, vel: 100 });
  }
  for (let i = 0; i < count; i++) ev.push({ t: off, type: 'off', note: base + i });
  return ev;
};

// ---- render, parse the native audio_loop_cpu_percent metric ------------------
function renderCpu(name, events, duration) {
  const evPath = join(outDir, `${name}.json`);
  writeFileSync(evPath, JSON.stringify({ events }));
  const wav = join(outDir, `${name}.wav`);
  const out = execFileSync(exe, ['render', wav, evPath, '--duration', String(duration)], {
    cwd: root,
    env: { ...process.env, MBIRA_INSTRUMENT: synthPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString('utf8');
  const line = out.split('\n').find((l) => l.includes('"audio_loop_cpu_percent"'));
  if (!line) { fail(`no render JSON line for ${name}: ${out.slice(0, 200)}`); return null; }
  // The native printf does not escape Windows backslashes in the wav path, so the
  // line is not strict JSON — pull the metric fields out by pattern.
  const cpuM = line.match(/"audio_loop_cpu_percent":([\d.]+)/);
  const rateM = line.match(/"rate":([\d.]+)/);
  const blockM = line.match(/"block":(\d+)/);
  if (!cpuM) { fail(`no audio_loop_cpu_percent in: ${line.slice(0, 200)}`); return null; }
  return { cpu: parseFloat(cpuM[1]), rate: rateM ? parseFloat(rateM[1]) : 0, block: blockM ? parseInt(blockM[1], 10) : 0 };
}

// ---- run --------------------------------------------------------------------
const results = [];
for (const count of [32, 64]) {
  const r = renderCpu(`v${count}`, held(count, 36, 0.5, 1.0, 4.0), 5);
  if (r) {
    results.push({ count, ...r });
    console.log(`v${count}  (${count} held notes): audio_loop_cpu_percent=${r.cpu.toFixed(2)} @ ${r.rate} Hz / block ${r.block}`);
    if (!(r.cpu < 80)) fail(`v${count} CPU ${r.cpu.toFixed(2)}% is not real-time viable (>= 80%)`);
  }
}

if (results.length === 2) {
  const c64 = results.find((r) => r.count === 64).cpu;
  const c32 = results.find((r) => r.count === 32).cpu;
  if (c64 <= c32 * 1.5) {
    // not a hard failure: scaling should be roughly monotonic, warn only
    console.log(`NOTE 64-voice CPU is ${c64.toFixed(2)}% vs 32-voice ${c32.toFixed(2)}% (ratio ${(c64 / c32).toFixed(2)})`);
  }
  console.log('voice-cpu OK — 32/64 held voices render real-time viable (audio_loop_cpu_percent < 80%)');
}
