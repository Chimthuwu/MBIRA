/* ── presets ────────────────────────────────────────────────────────────────
   A preset is a named snapshot of EVERY wired control: the 3 macros, the 6
   modal knobs, master, the LFO rate and all 21 modulation-strip depths (18
   per-note + 3 LFO). Values use the same paths the UI already posts with
   param.set, so a recall is a batch of real parameter changes — nothing here is
   a UI-only label.

   Storage is localStorage under PRESET_STORAGE_KEY, which lives in the WebView2
   user-data folder and therefore survives app restarts. The §5.4 preset files
   and the plugin state round-trip come with the plugin work; this module already
   defines the snapshot shape they will use: { v, params: { <path>: value } }.

   Known limit: a recall posts one param.set per value, so the DSP ramps them
   with its normal smoothing. There is no block-boundary atomic swap yet
   (spec §1.3): every change is click-free, but the snapshot is not sample-atomic.
   ─────────────────────────────────────────────────────────────────────────── */

export const PRESET_STORAGE_KEY = 'mbira.presets.v1';
export const PRESET_SCHEMA = 1;

// ── preset file format (§5.4, portable, versioned) ──────────────────────────
// A single-preset file: { v:1, name, params:{<path>:value} }
// A bank file:          { v:1, type:'bank', presets:[{name,params}], last }
// parsePresetFile returns { kind:'preset', name, params } or
// { kind:'bank', presets:[{name,params}], last }. Unknown v → throws (so a
// future format bump can be rejected cleanly instead of loading garbage).
export const PRESET_FILE_SCHEMA = 1;

function normalizeParams(input) {
  if (!input || typeof input !== 'object') throw new Error('preset has no params object');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  if (Object.keys(out).length === 0) throw new Error('preset has no valid numeric params');
  return out;
}

export function serializePreset({ name = 'Preset', params = {} } = {}) {
  return JSON.stringify({ v: PRESET_FILE_SCHEMA, name, params });
}

export function serializeBank({ presets = [], last = '' } = {}) {
  return JSON.stringify({ v: PRESET_FILE_SCHEMA, type: 'bank', presets, last });
}

export function parsePresetFile(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch { throw new Error('preset file is not valid JSON'); }
  if (!obj || typeof obj !== 'object') throw new Error('preset file is not an object');
  if (obj.v !== PRESET_FILE_SCHEMA) throw new Error(`unsupported preset version v=${obj.v}`);
  if (obj.type === 'bank') {
    if (!Array.isArray(obj.presets)) throw new Error('bank has no presets array');
    const presets = obj.presets.map((p) => ({
      name: (p && typeof p.name === 'string' && p.name) || 'Preset',
      params: normalizeParams(p && p.params),
    }));
    return { kind: 'bank', presets, last: typeof obj.last === 'string' ? obj.last : '' };
  }
  return {
    kind: 'preset',
    name: typeof obj.name === 'string' && obj.name ? obj.name : 'Imported Preset',
    params: normalizeParams(obj.params),
  };
}

function readStore(){
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.v === PRESET_SCHEMA && Array.isArray(parsed.presets)){
      const presets = parsed.presets.filter((p) =>
        p && typeof p.name === 'string' && p.name.length > 0 && p.params && typeof p.params === 'object');
      return { v: PRESET_SCHEMA, presets, last: typeof parsed.last === 'string' ? parsed.last : '' };
    }
  } catch (_) { /* corrupt or blocked storage: start clean */ }
  return { v: PRESET_SCHEMA, presets: [], last: '' };
}

function writeStore(store){
  try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(store)); return true; }
  catch (_) { return false; }
}

const round3 = (v) => Math.round(v * 1000) / 1000;

export function mountPresets({ select, nameInput, saveButton, exportButton, importButton, importInput, controls, onStatus }){
  const store = readStore();
  const paths = [...controls.keys()].sort();

  const snapshot = () => {
    const params = {};
    for (const path of paths){
      const c = controls.get(path);
      const v = c ? c.get() : undefined;
      if (typeof v === 'number' && Number.isFinite(v)) params[path] = round3(v);
    }
    return params;
  };

  // Captured at mount time, before the user touches a control: the shipped sound
  // doubles as the factory preset ("Acoustic Default").
  const shipped = snapshot();

  const applyParams = (params) => {
    let applied = 0;
    for (const path of paths){
      const v = params[path];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const c = controls.get(path);
      if (!c) continue;
      c.set(v); // the control repaints and posts its own param.set
      applied++;
    }
    return applied;
  };

  const label = (name) => (name === '__factory' ? 'Acoustic Default' : name);

  const rebuild = (selected) => {
    if (!select) return;
    select.innerHTML = '';
    select.add(new Option('Acoustic Default', '__factory'));
    for (const p of store.presets) select.add(new Option(p.name, p.name));
    select.disabled = false;
    const want = selected || '__factory';
    select.value = [...select.options].some((o) => o.value === want) ? want : '__factory';
  };

  const recall = (name) => {
    if (!name) return 0;
    const params = name === '__factory'
      ? shipped
      : (store.presets.find((p) => p.name === name) || {}).params;
    if (!params) return 0;
    const applied = applyParams(params);
    store.last = name;
    writeStore(store);
    if (nameInput) nameInput.value = name === '__factory' ? '' : name;
    if (onStatus) onStatus(`${label(name)} · ${applied} params`);
    return applied;
  };

  const save = () => {
    const typed = (nameInput && nameInput.value ? nameInput.value : '').trim().slice(0, 40);
    const name = typed || `Preset ${store.presets.length + 1}`;
    const params = snapshot();
    const existing = store.presets.find((p) => p.name === name);
    if (existing) existing.params = params;
    else store.presets.push({ name, params });
    const ok = writeStore(store);
    rebuild(name);
    if (nameInput) nameInput.value = name;
    if (onStatus) onStatus(ok ? `saved ${name} · ${Object.keys(params).length} params` : `could not save ${name}`);
    return ok;
  };

  select?.addEventListener('change', () => { recall(select.value); });
  saveButton?.addEventListener('click', save);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){ e.preventDefault(); save(); }
  });

  // ── §5.4: portable preset files on disk (versioned round-trip) ──
  const download = (filename, text) => {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (_) { if (onStatus) onStatus('export failed'); }
  };

  exportButton?.addEventListener('click', () => {
    const params = snapshot();
    const base = (nameInput && nameInput.value ? nameInput.value : 'preset')
      .trim().replace(/[^\w.-]+/g, '_') || 'preset';
    download(`${base}.mbirapreset`, serializePreset({ name: (nameInput && nameInput.value) || 'Preset', params }));
    if (onStatus) onStatus(`exported ${Object.keys(params).length} params`);
  });

  importButton?.addEventListener('click', () => importInput?.click());

  importInput?.addEventListener('change', async () => {
    const f = importInput.files && importInput.files[0];
    if (!f) return;
    try {
      const r = parsePresetFile(await f.text());
      if (r.kind === 'bank') {
        for (const p of r.presets) {
          const ex = store.presets.find((q) => q.name === p.name);
          if (ex) ex.params = p.params; else store.presets.push(p);
        }
        if (r.last) store.last = r.last;
      } else {
        const ex = store.presets.find((q) => q.name === r.name);
        if (ex) ex.params = r.params; else store.presets.push({ name: r.name, params: r.params });
      }
      writeStore(store);
      rebuild(store.last && store.presets.some((p) => p.name === store.last) ? store.last : '__factory');
      if (store.last) recall(store.last);
      if (onStatus) onStatus(`imported ${r.kind === 'bank' ? r.presets.length + ' presets' : r.name}`);
    } catch (e) {
      if (onStatus) onStatus(`import failed: ${e.message}`);
    } finally {
      importInput.value = '';
    }
  });

  // Restore the preset used last session, so the knobs and strips come back as
  // they were left. The engine boots at the shipped defaults, so this recall is
  // what makes the sound match the UI after a restart.
  const restored = store.last && store.presets.some((p) => p.name === store.last) ? store.last : '';
  rebuild(restored || '__factory');
  if (restored) recall(restored);
  else if (select) select.value = '__factory';

  return { recall, save, snapshot, shipped, store };
}
