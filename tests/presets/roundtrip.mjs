// §5.4 preset-file round-trip: the versioned, portable on-disk preset format.
// Pure functions (no DOM), so this runs under plain node as part of `npm test`.
import assert from 'node:assert/strict';
import { serializePreset, serializeBank, parsePresetFile, PRESET_FILE_SCHEMA } from '../../ui/js/presets.js';

// single-preset round-trip preserves name + every numeric param
const sample = { name: 'Warm Pad', params: { master: 0.5, 'macro.brightness': 0.8, 'mod.decay.lfo': 1, 'modal.geometry': 0 } };
const s = serializePreset(sample);
const p = parsePresetFile(s);
assert.equal(p.kind, 'preset');
assert.equal(p.name, 'Warm Pad');
assert.equal(p.params.master, 0.5);
assert.equal(p.params['macro.brightness'], 0.8);
assert.equal(p.params['mod.decay.lfo'], 1);

// bank round-trip preserves all presets + the last pointer
const bank = { presets: [sample, { name: 'Bright', params: { master: 1, 'macro.brightness': 1 } }], last: 'Warm Pad' };
const bp = parsePresetFile(serializeBank(bank));
assert.equal(bp.kind, 'bank');
assert.equal(bp.presets.length, 2);
assert.equal(bp.presets[0].name, 'Warm Pad');
assert.equal(bp.presets[1].params.master, 1);
assert.equal(bp.last, 'Warm Pad');

// unknown schema version is rejected (so a future bump can't load garbage)
let threw = false;
try { parsePresetFile(JSON.stringify({ v: 2, name: 'x', params: { master: 1 } })); } catch { threw = true; }
assert.ok(threw, 'should reject unsupported preset version');

// malformed JSON is rejected
threw = false;
try { parsePresetFile('{ this is not json'); } catch { threw = true; }
assert.ok(threw, 'should reject malformed JSON');

// non-numeric params are dropped, but an all-invalid preset is rejected
const dropped = parsePresetFile(JSON.stringify({ v: 1, name: 'y', params: { master: 'loud', ok: 0.3 } }));
assert.equal('master' in dropped.params, false, 'non-numeric param must be dropped');
assert.equal(dropped.params.ok, 0.3);
threw = false;
try { parsePresetFile(JSON.stringify({ v: 1, name: 'z', params: { a: 'b' } })); } catch { threw = true; }
assert.ok(threw, 'all-invalid params must be rejected');

// instrument id is preserved (and validated against known instruments)
const withInst = { name: 'Dza Voice', params: { master: 0.7 }, instrument: 'mbira-dzavadzimu' };
const pi = parsePresetFile(serializePreset(withInst));
assert.equal(pi.instrument, 'mbira-dzavadzimu');

// a bank preset carries its instrument
const bankInst = parsePresetFile(serializeBank({ presets: [withInst], last: 'Dza Voice' }));
assert.equal(bankInst.presets[0].instrument, 'mbira-dzavadzimu');

// an unknown instrument id is dropped (never stored as something we'd switch to)
const badInst = parsePresetFile(JSON.stringify({ v: 1, name: 'X', params: { master: 1 }, instrument: 'does-not-exist' }));
assert.equal(badInst.instrument, undefined);

// the exported schema constant matches what we parse against
assert.equal(PRESET_FILE_SCHEMA, 1);

console.log('preset-file roundtrip OK (single + bank, schema/v1, instrument persist, rejection paths)');
