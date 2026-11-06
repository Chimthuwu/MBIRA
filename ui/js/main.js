import { send, on } from './bridge.js';
import { mountKeyboard } from './keyboard.js';
import { mountFaders, mountKnobs, mountTelemetry } from './controls.js';

/* ── dev mock host (design review without the native app) ── */
window.__MBIRA_MOCK__ = {
  receive(msg){
    if (msg.type === 'note.on' && Math.random() < 0.9){
      setTimeout(() => window.__MBIRA_DISPATCH__({
        v: 1, type: 'telemetry',
        payload: { peakL: 0.35 + Math.random() * 0.5, peakR: 0.3 + Math.random() * 0.5,
                   rms: 0.2 + Math.random() * 0.5 },
      }), 30);
    }
  },
};

const $ = (s, r = document) => r.querySelector(s);

const app = $('#app');
const board = $('#board');

const kb = mountKeyboard($('#tines'), board);
mountFaders(app);
mountKnobs(app);

const telemetry = mountTelemetry($('#meter'), $('#scope'));
on('telemetry', (p) => telemetry.push(p));

/* host-driven note state (MIDI input, automation, preset audition) */
on('note.state', ({ note, on: isOn, velocity }) =>
  kb.setHostNote(note, isOn, velocity));

on('param.state', ({ path, value }) => {
  const el = document.querySelector(`[data-param="${path}"]`);
  if (!el) return;
  const range = el.querySelector('.range');
  if (range){ range.value = value; range.dispatchEvent(new Event('input')); }
});

/* top bar */
$('#panic').addEventListener('click', () => kb.allOff());

document.querySelectorAll('.insert').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.disabled) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    send('param.set', { path: `fx.${b.dataset.fx}.enabled`, value: on ? 1 : 0 });
  }));

/* status bar */
on('status', (s) => {
  if (s.cpu !== undefined) $('#st-cpu').textContent = `CPU ${s.cpu.toFixed(0)}%`;
  if (s.voices !== undefined) $('#st-voices').textContent = `Voices ${s.voices} / ${s.maxVoices ?? 37}`;
  if (s.midi) {
    const el = $('#st-midi');
    el.innerHTML = '';
    const dot = document.createElement('i');
    dot.className = `dot dot--${s.midi === 'ok' ? 'ok' : 'warn'}`;
    el.append(dot, document.createTextNode(`MIDI: ${s.midi}`));
  }
});

/* handshake */
send('ui.ready', { protocol: 1, build: 'ui-mock-0.1' });
