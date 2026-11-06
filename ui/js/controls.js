import { send } from './bridge.js';

/* ── faders ──────────────────────────────────────────────── */
export function mountFaders(root){
  root.querySelectorAll('.fader').forEach((f) => {
    const input = f.querySelector('.range');
    const out = f.querySelector('.fader__val');
    const param = f.dataset.param;
    const paint = () => { if (out) out.value = (+input.value).toFixed(2); };
    input.addEventListener('input', () => {
      paint();
      send('param.set', { path: param, value: +input.value });
    });
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
    };

    const commit = () => send('param.set', { path: k.dataset.param, value: val });

    dial.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dial.setPointerCapture(e.pointerId);
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

/* ── meter + scope (telemetry-driven; mock when offline) ─── */
export function mountTelemetry(meterEl, canvas){
  const ctx = canvas.getContext('2d', { alpha: true });
  let l = 0, r = 0, phase = 0, amp = 0;

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
    requestAnimationFrame(frame);
    if (document.visibilityState !== 'visible') return;

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

  requestAnimationFrame(frame);
  return { push };
}
