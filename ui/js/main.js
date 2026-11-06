import { send, on } from './bridge.js';
import { mountKeyboard } from './keyboard.js';
import { mountFaders, mountKnobs, mountTelemetry } from './controls.js';

/* ── dev mock host (design review without the native app) ── */
window.__MBIRA_MOCK__ = {
  receive(msg){
    const log = window.__MBIRA_AUDIT__;
    if (log){ log.push(msg); console.debug('[mock]', msg.type, msg.payload); }
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

/* ── page model — data-driven. Each page = {id, label, section (DOM ref)}.
     Mounted controls are NOT per-page bindings; they are resolved once at
     init against the live DOM in whichever page owns them. */
const PAGES = [
  { id: 'play',    label: 'Play',    ref: null },
  { id: 'tine',    label: 'Tine',    ref: null },
  { id: 'body',    label: 'Body',    ref: null },
  { id: 'samples', label: 'Samples', ref: null },
  { id: 'fx',      label: 'FX',      ref: null },
];

/* resolve section refs NOW (after DOM ready), not per switch */
for (const p of PAGES) p.ref = document.querySelector(`[data-page="${p.id}"]`);

const navBtns = new Map();   // pageId → button
for (const p of PAGES){
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nav__btn';
  b.dataset.page = p.id;
  b.textContent = p.label;
  b.setAttribute('aria-current', p.id === 'play' ? 'page' : 'false');
  b.addEventListener('click', () => switchPage(p.id));
  nav.appendChild(b);
  navBtns.set(p.id, b);
}

let current = 'play';

function show(pageId){
  for (const p of PAGES) p.ref.hidden = p.id !== pageId;
  for (const [id, b] of navBtns) b.setAttribute('aria-current', id === pageId ? 'page' : 'false');
  current = pageId;
  navBtns.get(pageId).focus();     // move focus to newly active nav item
}

function switchPage(next){
  if (next === current) return;
  // before hiding the page that owns the keyboard, release locally held notes
  // through the existing note-off path (no panic, no host-note interference).
  if (current === 'play') kb.releaseLocal();
  show(next);
}

const board = $('#board');
const kb = mountKeyboard($('#tines'), board);
mountFaders(app);
mountKnobs(app);

/* scope lives on the Tine page — only draw while that page is visible so
   the loop pauses/resumes cleanly and waveform phase survives switches. */
const telemetry = mountTelemetry($('#meter'), $('#scope'),
  () => document.querySelector('[data-page="tine"]')?.hidden === false);
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

/* initial visibility (play active on load) */
show('play');

/* handshake */
send('ui.ready', { protocol: 1, build: 'ui-mock-0.1' });
