import { send } from './bridge.js';

/* ── faders ──────────────────────────────────────────────── */
export function mountFaders(root){
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
  });
}

/* ── knobs ───────────────────────────────────────────────── */
export function mountKnobs(root){
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
    const commit = () => send('param.set', { path: k.dataset.param, value: val });
    const refreshRead = () => { const nn = (val - min) / (max - min); if (dyn) dyn.textContent = `${Math.round(nn * 100)}%`; };

    dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { dial.setPointerCapture(e.pointerId); } catch (_) {}
      const y0 = e.clientY, v0 = val;
      const move = (ev) => {
        const dy = y0 - ev.clientY;           // up = increase
        val = Math.min(max, Math.max(min, v0 + (dy / 140) * (max - min)));
        paint();
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
  });
}

/* ── engine blend slider (Physical <-> Samples; param.set) ── */
export function mountBlend(root){
  const b = root.querySelector('[data-blend]');
  if (!b) return;
  const track = b.querySelector('.blend__track');
  const min = +track.getAttribute('aria-valuemin');
  const max = +track.getAttribute('aria-valuemax');
  let now = +track.getAttribute('aria-valuenow');

  const paint = () => {
    const s = `${now}%`;
    b.style.setProperty('--bpos', s);
    track.querySelector('.blend__read').textContent = String(Math.round(now));
    track.setAttribute('aria-valuenow', String(Math.round(now)));
    track.setAttribute('aria-valuetext',
      now >= 100 ? '100% physical model' : (now <= 0 ? '100% body samples' : `${Math.round(now)}% physical, ${100 - Math.round(now)}% samples`));
  };
  const commit = () => send('param.set', { path: 'blend.engine', value: now / 100 });

  const set = (v) => { now = Math.min(max, Math.max(min, v)); paint(); };

  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { track.setPointerCapture(e.pointerId); } catch (_) {}
    const r = track.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * max);
    const move = (ev) => set(((ev.clientX - r.left) / r.width) * max);
    const up = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      commit();
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  });
  track.addEventListener('keydown', (e) => {
    const step = 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { set(now + step); commit(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { set(now - step); commit(); }
    else if (e.key === 'Home') { set(min); commit(); }
    else if (e.key === 'End') { set(max); commit(); }
    else return;
    e.preventDefault();
  });
  paint();
}

/* ── meter + scope (telemetry-driven; mock when offline) ─── */
export function mountTelemetry(meterEl, canvas, isScopeVisible = () => true){
  const ctx = canvas.getContext('2d', { alpha: true });
  let l = 0, r = 0, phase = 0, amp = 0;
  let raf = 0;

  const fills = meterEl.querySelectorAll('.meter__fill');

  function push(payload){
    // payload: { peakL, peakR, rms?, wave?: Float32Array }
    l = payload.peakL ?? l;
    r = payload.peakR ?? r;
    amp = Math.max(amp, payload.rms ?? 0);
    fills[0].style.height = `${Math.min(100, l * 100).toFixed(1)}%`;
    fills[1].style.height = `${Math.min(100, r * 100).toFixed(1)}%`;
  }

  function frame(){
    raf = requestAnimationFrame(frame);
    if (document.visibilityState !== 'visible') return;
    // scope only draws on the Tine page; otherwise pause in place so the
    // waveform phase survives page switches (Play → Tine → Play).
    if (!isScopeVisible()) return;

    // decay
    amp *= 0.985;
    phase += 0.09;

    const w = canvas.width, h = canvas.height, mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(240,166,60,.85)';
    ctx.beginPath();
    for (let x = 0; x <= w; x += 3){
      const t = x / w;
      const y = mid + Math.sin(t * Math.PI * 14 + phase) *
                      Math.sin(t * Math.PI) * (mid - 6) * (0.25 + amp);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  frame();
  return { push };
}
