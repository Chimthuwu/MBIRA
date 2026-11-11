import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { INSTRUMENTS } from '../../ui/js/instruments.js';

// Every selector id must correspond to a real instrument JSON file present in
// src/instruments (the native id->path registry depends on this mapping).
const dir = 'src/instruments';
const jsonIds = new Set();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  try {
    const doc = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    if (doc && typeof doc.id === 'string') jsonIds.add(doc.id);
  } catch {
    /* skip non-instrument json (e.g. schema.json) */
  }
}

const selIds = INSTRUMENTS.map((i) => i.id);
assert.ok(selIds.length >= 1, 'selector must list at least one instrument');
assert.equal(new Set(selIds).size, selIds.length, 'selector ids must be unique');
for (const id of selIds) {
  assert.ok(
    jsonIds.has(id),
    `selector id "${id}" has no matching instrument JSON (have: ${[...jsonIds].join(', ')})`
  );
}
console.log(`instrument-selector OK (${selIds.length} instruments: ${selIds.join(', ')})`);
