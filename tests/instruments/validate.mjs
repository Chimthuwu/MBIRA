// Validates src/instruments/*.json against schema.json + spec section 4 rules
// (unique MIDI notes, keyCount == keys.length, canvas fit). Run: node tests/instruments/validate.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = JSON.parse(readFileSync(join(root, 'src/instruments/schema.json'), 'utf8'));

let failures = 0;
const fail = (msg) => { console.error('FAIL:', msg); failures++; };

for (const file of readdirSync(join(root, 'src/instruments')).filter((f) => f.endsWith('.json') && f !== 'schema.json')) {
  const inst = JSON.parse(readFileSync(join(root, 'src/instruments', file), 'utf8'));
  // top-level required
  for (const k of schema.required) if (!(k in inst)) fail(`${file}: missing top-level "${k}"`);
  if (inst.keyCount !== inst.keys.length) fail(`${file}: keyCount ${inst.keyCount} != keys.length ${inst.keys.length}`);
  if (inst.provisional !== true) fail(`${file}: provisional must be true`);
  // per-key required + ranges
  const notes = new Set();
  for (const k of inst.keys) {
    for (const f of schema.properties.keys.items.required)
      if (!(f in k)) fail(`${file}: key note ${k.note} missing "${f}"`);
    if (notes.has(k.note)) fail(`${file}: duplicate MIDI note ${k.note}`);
    notes.add(k.note);
    if (k.frequencyHz <= 0) fail(`${file}: note ${k.note} bad frequency`);
    if (k.modalRatios?.length !== 3 || k.dampingTaus?.length !== 3 || k.amplitudes?.length !== 3)
      fail(`${file}: note ${k.note} modal arrays must have 3 entries`);
    if (k.note < inst.canvas.width ? 0 : 0) {} // noop keeps linters calm
    if (k.x < 0 || k.y < 0 || k.x > inst.canvas.width || k.y > inst.canvas.height)
      fail(`${file}: note ${k.note} outside canvas`);
  }
  console.log(`${file}: ${inst.keys.length} keys, ${inst.keyCount} declared, ${failures === 0 ? 'OK' : 'FAILED'}`);
}
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('all instrument definitions valid');
