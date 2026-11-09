import { buildTines, buildKeymap, instrumentName, setInstrument, noteName } from './layout.js';
import { send } from './bridge.js';

const GLOW_DECAY = 600;
let glowTimer = 0;

export function mountKeyboard(root, board){
  const byPointer = new Map();   // pointerId → tine el
  const byKey = new Map();       // key → tine el
  const held = new Set();        // midi currently on
  let els = [];
  let keymap = {};

  // ── (re)build the tine field for the current instrument ──
  function build(){
    for (const el of els) el.remove();
    els = [];
    const tines = buildTines();
    keymap = buildKeymap(tines);
    const byMidi = new Map();
    for (const t of tines){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tine tine--r${t.rank}`;
      b.dataset.midi = String(t.midi);
      b.dataset.rank = String(t.rank);
      b.setAttribute('aria-label', `${instrumentName()} ${t.name}`);
      b.setAttribute('aria-pressed', 'false');
      // CSSOM writes only — keeps CSP `style-src 'self'` clean
      b.style.left = `${t.x}%`;
      b.style.width = `${t.w}%`;
      b.style.top = `${t.top}%`;
      b.style.height = `${t.h}%`;
      b.style.marginLeft = `${-t.w / 2}%`;
      // front ranks draw over the rows behind them (real mbira: the short
      // front tines sit in front of the longer ranks behind)
      b.style.zIndex = String(10 + t.rank * 10 + Math.round(t.x));
      const label = document.createElement('span');
      label.className = 'tine__label';
      label.textContent = t.name;
      b.appendChild(label);
      // deterministic per-tine sheen variation (same light source, slightly
      // different polish per tine — kills the copy-pasted look)
      b.style.setProperty('--lum', (0.15 + ((t.midi * 2654435761 >>> 0) % 100) / 100 * 0.7).toFixed(2));
      root.appendChild(b);
      els.push(b);
      byMidi.set(t.midi, b);
    }
    return byMidi;
  }

  let byMidi = build();

  // ── visual state ─────────────────────────────────────────
  function paintOn(el, velocity){
    el.classList.remove('is-damped');
    el.classList.add('is-on');
    el.setAttribute('aria-pressed', 'true');
    // velocity → glow strength on this tine + board wash
    const v = Math.min(1, Math.max(0, velocity / 127));
    el.style.setProperty('--vel', v.toFixed(3));
    el.style.filter = `brightness(${(1.15 + v * 0.35).toFixed(2)})`;
  }

  function paintOff(el){
    if (!el) return;
    el.classList.remove('is-on');
    el.classList.add('is-damped');
    el.setAttribute('aria-pressed', 'false');
    el.style.filter = '';
    setTimeout(() => el.classList.remove('is-damped'), 280);
  }

  function boardGlow(el){
    const r = root.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    board.style.setProperty('--gx', `${((b.left + b.width / 2 - r.left) / r.width) * 100}%`);
    board.style.setProperty('--gy', `${((b.top + b.height * 0.7 - r.top) / r.height) * 100}%`);
    board.style.setProperty('--gop', '1');
    clearTimeout(glowTimer);
    glowTimer = setTimeout(() => board.style.setProperty('--gop', '0'), GLOW_DECAY);
  }

  // ── note lifecycle ───────────────────────────────────────
  function noteOn(el, velocity){
    const midi = +el.dataset.midi;
    if (held.has(midi)) return;
    held.add(midi);
    paintOn(el, velocity);
    boardGlow(el);
    // SYNCHRONOUS: paint first, then tell the host. Never await.
    send('note.on', { note: midi, velocity: Math.round(velocity) });
  }

  function noteOff(el){
    const midi = +el.dataset.midi;
    if (!held.delete(midi)) return false;
    paintOff(el);
    send('note.off', { note: midi, velocity: 0 });
    return true;
  }

  function allOff(){
    for (const midi of held){
      const el = byMidi.get(midi);
      if (el) paintOff(el);
    }
    held.clear();
    byPointer.clear();
    byKey.clear();
    send('panic', {});
  }

  // ── pointer ──────────────────────────────────────────────
  function velocityFrom(e, el){
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return 40 + t * 87;              // 40 (top) … 127 (tip)
  }

  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.tine');
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    byPointer.set(e.pointerId, el);
    noteOn(el, velocityFrom(e, el));
  });

  const release = (e) => {
    const el = byPointer.get(e.pointerId);
    if (!el) return;
    byPointer.delete(e.pointerId);
    noteOff(el);
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  // ── QWERTY ───────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { allOff(); return; }
    const midi = keymap[e.key.toLowerCase()];
    if (midi === undefined) return;
    const el = byMidi.get(midi);
    if (!el || byKey.has(e.key)) return;
    e.preventDefault();
    byKey.set(e.key, el);
    noteOn(el, 100);
  });

  window.addEventListener('keyup', (e) => {
    const el = byKey.get(e.key);
    if (!el) return;
    byKey.delete(e.key);
    noteOff(el);
  });

  // safety: lose focus → all notes off
  window.addEventListener('blur', allOff);

  // ── release only LOCALLY held notes (page switch) ────────
  function releaseLocal(){
    const seen = new Set();
    const list = [];
    for (const pid of byPointer.keys()){
      const el = byPointer.get(pid);
      if (!el) continue;
      try { if (el.hasPointerCapture && el.hasPointerCapture(pid)) el.releasePointerCapture(pid); } catch (_) {}
      if (!seen.has(el)) { seen.add(el); list.push(el); }
    }
    for (const el of byKey.values()){
      if (!seen.has(el)) { seen.add(el); list.push(el); }
    }
    let sent = 0;
    for (const el of list){
      if (noteOff(el)) sent++;
    }
    byPointer.clear();
    byKey.clear();
    return sent;
  }

  // ── host-driven note state (MIDI in, automation) ─────────
  return {
    els,
    releaseLocal,
    /** Switch the rendered instrument schematic (host message). */
    setInstrument(id){
      if (!setInstrument(id)) return false;
      // release anything held locally, then rebuild the field
      allOff();
      byMidi = build();
      els = [...byMidi.values()];
      return true;
    },
    setHostNote(midi, on, velocity = 100){
      const el = byMidi.get(midi);
      if (!el) return;
      if (on){ held.add(midi); paintOn(el, velocity); boardGlow(el); }
      else { held.delete(midi); paintOff(el); }
    },
    allOff,
  };
}
