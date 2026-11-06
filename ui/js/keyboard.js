import { buildTines, KEYMAP, noteName } from './layout.js';
import { send } from './bridge.js';

const GLOW_DECAY = 600;
let glowTimer = 0;

export function mountKeyboard(root, board){
  const tines = buildTines();
  const els = [];
  const byPointer = new Map();   // pointerId → tine el
  const byKey = new Map();       // key → tine el
  const held = new Set();        // midi currently on

  for (const t of tines){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tine';
    b.dataset.midi = String(t.midi);
    b.dataset.row = String(t.row);
    b.setAttribute('aria-label', noteName(t.midi));
    b.setAttribute('aria-pressed', 'false');
    b.title = noteName(t.midi);
    // CSSOM writes only — keeps CSP `style-src 'self'` clean
    b.style.left = `${t.x}%`;
    b.style.width = `${t.w}%`;
    b.style.top = `${t.top}%`;
    b.style.height = `${t.h}%`;
    b.style.marginLeft = `${-t.w / 2}%`;
    // stagger z so longer middle tines overlap cleanly
    b.style.zIndex = String(10 + t.row);
    root.appendChild(b);
    els.push(b);
  }

  // ── visual state ───────────────────────────────────────
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

  // ── note lifecycle ─────────────────────────────────────
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
      const el = els.find((e) => +e.dataset.midi === midi);
      if (el) paintOff(el);
    }
    held.clear();
    byPointer.clear();
    byKey.clear();
    send('panic', {});
  }

  // ── pointer ────────────────────────────────────────────
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

  // ── QWERTY ─────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { allOff(); return; }
    const idx = KEYMAP[e.key.toLowerCase()];
    if (idx === undefined) return;
    const el = els[idx];
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

  // ── release only LOCALLY held notes (page switch) ─────
  // Sends one note.off per unique locally-held tine (pointer+keyboard).
  // Does NOT panic, does NOT touch host-driven notes. Clears pointer capture
  // and the local maps so a later physical keyup/pointerup is a no-op.
  function releaseLocal(){
    const seen = new Set();
    const els = [];
    for (const pid of byPointer.keys()){
      const el = byPointer.get(pid);
      if (!el) continue;
      try { if (el.hasPointerCapture && el.hasPointerCapture(pid)) el.releasePointerCapture(pid); } catch (_) {}
      if (!seen.has(el)) { seen.add(el); els.push(el); }
    }
    for (const el of byKey.values()){
      if (!seen.has(el)) { seen.add(el); els.push(el); }
    }
    let sent = 0;
    for (const el of els){
      if (noteOff(el)) sent++;
    }
    byPointer.clear();
    byKey.clear();
    return sent;
  }

  // ── host-driven note state (MIDI in, automation) ───────
  return {
    els,
    releaseLocal,
    setHostNote(midi, on, velocity = 100){
      const el = els.find((e) => +e.dataset.midi === midi);
      if (!el) return;
      if (on){ held.add(midi); paintOn(el, velocity); boardGlow(el); }
      else { held.delete(midi); paintOff(el); }
    },
    allOff,
  };
}
