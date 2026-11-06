import { send, on } from './bridge.js';
import { mountKeyboard } from './keyboard.js';
import { mountFaders, mountKnobs, mountTelemetry, mountBlend } from './controls.js';

/* ── dev mock host (design review without the native app) ── */
window.__MBIRA_MOCK__ = {
  receive(msg){
    const log = window.__MBIRA_AUDIT__;
    if (log){ log.push(msg); console.debug('[mock]', msg.type, msg.payload?.path ?? msg.type); }
    if (msg.type === 'note.on' && Math.random() < 0.9){
      setTimeout(() => window.__MBIRA_DISPATCH__({
        v: 1, type: 'telemetry',
        payload: { peakL: 0.35 + Math.random() * 0.5, peakR: 0.3 + Math.random() * 0.5,
                   rms: 0.2 + Math.random() * 0.5 },
      }), 30);
    }
  },
};
/* test hook: records every outbound bridge message */
window.__MBIRA_AUDIT__ = [];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const nav = $('#nav');

/* ── page model — data-driven ────────────────────────────── */
const PAGES = [
  { id: 'play',    label: 'Play',      ref: null },
  { id: 'tine',    label: 'Tine Model', ref: null },
  { id: 'body',    label: 'Body & Deze', ref: null },
  { id: 'samples', label: 'Samples',   ref: null },
  { id: 'fx',      label: 'FX Rack',   ref: null },
];
for (const p of PAGES) p.ref = document.querySelector(`[data-page="${p.id}"]`);

/* touch shortcuts — run Page Numbering pass: keep the hero board persistent;
   the keyboard never hides, so no note-release is needed on switch. */
const navBtns = new Map();
for (const p of PAGES){
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'nav__btn'; b.dataset.page = p.id;
  b.textContent = p.label;
  b.setAttribute('aria-current', p.id === 'play' ? 'page' : 'false');
  b.addEventListener('click', () => switchPage(p.id));
  nav.appendChild(b); navBtns.set(p.id, b);
}
let current = 'play';
function show(pageId){
  for (const p of PAGES) p.ref.hidden = p.id !== pageId;
  for (const [id, b] of navBtns) b.setAttribute('aria-current', id === pageId ? 'page' : 'false');
  current = pageId;
  navBtns.get(pageId).focus();
}
function switchPage(next){ if (next !== current) show(next); }

/* ── keyboard — persistent hero, mounted once ────────────── */
const board = $('#board');
const kb = mountKeyboard($('#tines'), board);
mountBlend(app);
mountFaders(app);
mountKnobs(app);

/* scope lives on the Tine page — draw only while that page is visible so the
   loop pauses/resumes cleanly and waveform phase survives switches. */
const telemetry = mountTelemetry($('#meter'), $('#scope'),
  () => document.querySelector('[data-page="tine"]')?.hidden === false);
on('telemetry', (p) => telemetry.push(p));

/* host-driven note state (MIDI input, automation, preset audition) */
on('note.state', ({ note, on: isOn, velocity }) => kb.setHostNote(note, isOn, velocity));
on('param.state', ({ path, value }) => {
  const el = document.querySelector(`[data-param="${path}"]`);
  if (!el) return;
  const range = el.querySelector('.range');
  if (range){ range.value = value; range.dispatchEvent(new Event('input')); }
});

/* top bar */
$('#panic').addEventListener('click', () => kb.allOff());

/* FX toggles + layer M/S — all via param.set (no new bridge types) */
$$('.fx-card').forEach((card) => {
  const on = card.querySelector('[data-enable]');
  on.addEventListener('click', () => {
    const v = on.getAttribute('aria-pressed') !== 'true';
    on.setAttribute('aria-pressed', String(v));
    send('param.set', { path: `fx.${card.dataset.fx}.enabled`, value: v ? 1 : 0 });
  });
});
$$('.layer-btns').forEach((group) => {
  const layer = group.closest('.sample-layer').dataset.layer;
  group.querySelectorAll('.btn-mini').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.getAttribute('aria-pressed') !== 'true';
      const kind = b.hasAttribute('data-mute') ? 'mute' : 'solo';
      if (kind === 'solo'){
        // exclusive across the whole strip: turning one on turns all others off
        document.querySelectorAll('#samplesList .btn-mini[data-solo]')
          .forEach((o) => o.setAttribute('aria-pressed', o === b ? String(v) : 'false'));
        if (v){ document.querySelectorAll('#samplesList .btn-mini[data-mute]')
          .forEach((o) => o.setAttribute('aria-pressed', o === b ? o.getAttribute('aria-pressed') : 'false')); }
      } else {
        b.setAttribute('aria-pressed', String(v));
      }
      send('param.set', { path: `layer.${layer}.${kind}`, value: v ? 1 : 0 });
    });
  });
});

/* status bar */
on('status', (s) => {
  if (s.cpu !== undefined) $('#st-cpu').textContent = `${s.cpu.toFixed(0)}%`;
  if (s.voices !== undefined) $('#st-voices').textContent = String(s.voices);
  if (s.midi){
    const el = $('#st-midi'); el.innerHTML = '';
    const dot = document.createElement('i'); dot.className = `dot dot--${s.midi === 'ok' ? 'ok' : 'warn'}`;
    el.append(dot, document.createTextNode(`MIDI: ${s.midi}`));
  }
});

/* initial visibility (play active on load) */
show('play');
send('ui.ready', { protocol: 1, build: 'ui-mock-0.2' });
