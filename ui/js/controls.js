import { send } from './bridge.js';

/* ── faders ──────────────────────────────────────────────── */
// Every mount* returns a Map<param path, {get, set}> so a preset can read and
// write every control from the outside: the value lives in a closure, so there
// is no way to get or set it through the DOM alone.
export function mountFaders(root){
  const setters = new Map();
  root.querySelectorAll('.fader').forEach((f) => {
    const input = f.querySelector('.range');
    const out = f.querySelector('.fader__val');
    const param = f.dataset.param;
    const paint = () => { if (out) out.value = (+input.value).toFixed(2); };
    // Throttle host sends (~40 ms coalesced, immediate paint): dragging a
    // fader previously fired a param.set per input event (100+ host rebuilds
    // per drag), which read as delay. Final value is flushed on 'change'.
    let lastSent = 0;
    let timer = 0;
    let lastSentValue = +input.value;
    const flush = () => {
      const v = +input.value;
      if (v !== lastSentValue) { lastSentValue = v; send('param.set', { path: param, value: v }); }
      lastSent = performance.now();
    };
    input.addEventListener('input', () => {
      paint();
      const now = performance.now();
      if (now - lastSent >= 40) { clearTimeout(timer); flush(); }
      else if (!timer) { timer = setTimeout(() => { timer = 0; flush(); }, 40 - (now - lastSent)); }
    });
    input.addEventListener('change', () => { clearTimeout(timer); timer = 0; flush(); });
    paint();
    setters.set(param, { get: () => +input.value, set: (v) => { input.value = String(v); paint(); flush(); } });
  });
  return setters;
}

/* ── knobs ───────────────────────────────────────────────── */
export function mountKnobs(root){
  const setters = new Map();
  root.querySelectorAll('.knob').forEach((k) => {
    const dial = k.querySelector('.knob__dial');
    const min = +k.dataset.min, max = +k.dataset.max;
    let val = +k.dataset.value;

    const paint = () => {
      const n = (val - min) / (max - min);
      dial.style.setProperty('--rot', `${-135 + n * 270}deg`);
      dial.setAttribute('aria-valuenow', Math.round(n * 100));
      dial.setAttribute('aria-valuetext', val.toFixed(2));
      refreshRead();
    };

    const dyn = k.querySelector('.knob__val--dyn');
    // Dragging sends throttled like the faders (~40 ms), so the sound follows
    // the knob instead of only changing when it is released. Final value is
    // flushed on pointerup.
    let lastSent = -1e9, timer = 0;
    const sendNow = () => { lastSent = performance.now(); send('param.set', { path: k.dataset.param, value: val }); };
    const queueSend = () => {
      const now = performance.now();
      if (now - lastSent >= 40){ clearTimeout(timer); timer = 0; sendNow(); }
      else if (!timer){ timer = setTimeout(() => { timer = 0; sendNow(); }, 40 - (now - lastSent)); }
    };
    const commit = () => { clearTimeout(timer); timer = 0; sendNow(); };
    const refreshRead = () => { const nn = (val - min) / (max - min); if (dyn) dyn.textContent = `${Math.round(nn * 100)}%`; };

    dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { dial.setPointerCapture(e.pointerId); } catch (_) {}
      const y0 = e.clientY, v0 = val;
      const move = (ev) => {
        const dy = y0 - ev.clientY;           // up = increase
        val = Math.min(max, Math.max(min, v0 + (dy / 140) * (max - min)));
        paint();
        queueSend();
      };
      const up = () => {
        dial.removeEventListener('pointermove', move);
        dial.removeEventListener('pointerup', up);
        dial.removeEventListener('pointercancel', up);
        commit();
      };
      dial.addEventListener('pointermove', move);
      dial.addEventListener('pointerup', up);
      dial.addEventListener('pointercancel', up);
    });

    dial.addEventListener('keydown', (e) => {
      const step = (max - min) / 100;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') val = Math.min(max, val + step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') val = Math.max(min, val - step);
      else if (e.key === 'Home') val = min;
      else if (e.key === 'End') val = max;
      else return;
      e.preventDefault();
      paint(); commit();
    });

    dial.addEventListener('dblclick', () => { val = (min + max) / 2; paint(); commit(); });
    paint();
    setters.set(k.dataset.param, { get: () => val, set: (v) => { val = Math.min(max, Math.max(min, v)); paint(); commit(); } });
  });
  return setters;
}

/* ── output meter (telemetry-driven; mock when offline) ─── */
export function mountMeter(meterEl){
  const fills = meterEl.querySelectorAll('.meter__fill');
  function push(payload){
    if (payload.peakL !== undefined) fills[0].style.height = `${Math.min(100, payload.peakL * 100).toFixed(1)}%`;
    if (payload.peakR !== undefined) fills[1].style.height = `${Math.min(100, payload.peakR * 100).toFixed(1)}%`;
  }
  return { push };
}

/* ── mod strips (Pigments-style, one per source, per knob) ───
   The locked identity has no mod matrix and no Mod page: every knob carries
   its own strips. Velocity / Key / Random are per-note, so a depth is a real
   offset applied when the note is struck (the DSP latches it in noteOn()). LFO
   is different: it is a free-running oscillator summed into the parameter as a
   signal, so it keeps modulating while the note rings. It is therefore only
   offered on the targets that can move continuously (Geometry, Material,
   Decay); a knob lists its sources in data-sources. */
const MOD_SOURCES = [
  { id: 'vel', label: 'Velocity' },
  { id: 'key', label: 'Key' },
  { id: 'rnd', label: 'Random' },
  { id: 'lfo', label: 'LFO' },
];
const DEFAULT_SOURCES = ['vel', 'key', 'rnd'];

export function mountModStrips(root){
  const setters = new Map();
  root.querySelectorAll('.knob[data-mod]').forEach((knob) => {
    const host = knob.querySelector('.mods');
    if (!host) return;
    const target = knob.dataset.mod;
    const allowed = (knob.dataset.sources || DEFAULT_SOURCES.join(',')).split(',').map((s) => s.trim());
    const knobLabel = knob.querySelector('.knob__label')?.textContent?.trim() || target;
    const strips = [];

    const refreshKnob = () => {
      knob.classList.toggle('has-mod', strips.some((s) => s.depth !== 0));
    };

    for (const src of MOD_SOURCES) {
      if (!allowed.includes(src.id)) continue;
      const param = `mod.${target}.${src.id}`;
      const strip = document.createElement('div');
      strip.className = `mod mod--${src.id}`;
      strip.tabIndex = 0;
      strip.dataset.param = param;
      strip.dataset.source = src.id;
      strip.setAttribute('role', 'slider');
      strip.setAttribute('aria-valuemin', '-100');
      strip.setAttribute('aria-valuemax', '100');
      strip.setAttribute('aria-label', `${src.label} → ${knobLabel}`);
      strip.innerHTML = '<i class="mod__fill"></i><i class="mod__cap"></i>';
      host.appendChild(strip);

      const fill = strip.querySelector('.mod__fill');
      const cap = strip.querySelector('.mod__cap');
      let depth = 0;
      let lastSent = -1e9, timer = 0;

      const sendNow = () => {
        lastSent = performance.now();
        send('param.set', { path: param, value: depth });
      };
      const commit = () => { clearTimeout(timer); timer = 0; sendNow(); };
      const queueSend = () => {
        const now = performance.now();
        if (now - lastSent >= 40){ clearTimeout(timer); timer = 0; sendNow(); }
        else if (!timer){ timer = setTimeout(() => { timer = 0; sendNow(); }, 40 - (now - lastSent)); }
      };

      const paint = () => {
        const half = Math.abs(depth) * 50;         // % of the strip height
        fill.style.height = `${half}%`;
        fill.style.top = depth >= 0 ? `${50 - half}%` : '50%';
        cap.style.top = depth >= 0 ? `${50 - half}%` : `${50 + half}%`;
        strip.style.setProperty('--d', depth.toFixed(2));
        strip.setAttribute('aria-valuenow', String(Math.round(depth * 100)));
        strip.setAttribute('aria-valuetext', `${depth > 0 ? '+' : ''}${Math.round(depth * 100)}%`);
        strip.classList.toggle('is-on', depth !== 0);
        strip.title = `${src.label} → ${knobLabel}: ${depth > 0 ? '+' : ''}${Math.round(depth * 100)}%`;
        refreshKnob();
      };

      strip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { strip.setPointerCapture(e.pointerId); } catch (_) {}
        const y0 = e.clientY, d0 = depth;
        const move = (ev) => {
          depth = Math.max(-1, Math.min(1, d0 + (y0 - ev.clientY) / 90));
          paint(); queueSend();
        };
        const up = () => {
          strip.removeEventListener('pointermove', move);
          strip.removeEventListener('pointerup', up);
          strip.removeEventListener('pointercancel', up);
          commit();
        };
        strip.addEventListener('pointermove', move);
        strip.addEventListener('pointerup', up);
        strip.addEventListener('pointercancel', up);
      });

      strip.addEventListener('keydown', (e) => {
        const step = 0.05;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') depth = Math.min(1, depth + step);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') depth = Math.max(-1, depth - step);
        else if (e.key === 'Home') depth = 0;
        else if (e.key === 'End') depth = 1;
        else return;
        e.preventDefault();
        paint(); commit();
      });

      strip.addEventListener('dblclick', () => { depth = 0; paint(); commit(); });
      paint();
      strips.push({ get depth(){ return depth; } });
      setters.set(param, { get: () => depth, set: (v) => { depth = Math.max(-1, Math.min(1, v)); paint(); commit(); } });
    }
  });
  return setters;
}
