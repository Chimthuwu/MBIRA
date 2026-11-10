import { send, on } from './bridge.js';
import { mountKeyboard } from './keyboard.js';
import { mountFaders, mountKnobs, mountMeter, mountModStrips } from './controls.js';
import { mountPresets } from './presets.js';
import { mountVisualizer } from './visualizer.js';

/* ── dev mock host (design review without the native app) ──
   Mimics a telemetry frame, including the 1024-sample wave the real host
   sends, so the scope/spectrum/spectrogram run with no native app attached. */
function mockWave(note){
  const N = 1024, sr = 48000;
  const f = 440 * Math.pow(2, (note - 69) / 12);
  const out = new Array(N);
  for (let i = 0; i < N; i++){
    const t = i / sr;
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) * Math.exp(-t * (6 + h * 9)) / h;
    out[i] = Math.round(127 * Math.max(-1, Math.min(1, v * Math.exp(-t * 12) * 0.9)));
  }
  return out;
}

window.__MBIRA_MOCK__ = {
  receive(msg){
    const log = window.__MBIRA_AUDIT__;
    if (log){ log.push(msg); console.debug('[mock]', msg.type, msg.payload?.path ?? msg.type); }
    if (msg.type === 'note.on' && Math.random() < 0.9){
      setTimeout(() => window.__MBIRA_DISPATCH__({
        v: 1, type: 'telemetry',
        payload: { peakL: 0.35 + Math.random() * 0.5, peakR: 0.3 + Math.random() * 0.5,
                   sr: 48000, wave: mockWave(msg.payload?.note ?? 60) },
      }), 30);
    }
  },
};
/* test hook: records every outbound bridge message */
window.__MBIRA_AUDIT__ = [];

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const nav = $('#nav');

/* ── page model — data-driven ────────────────────────────── */
const PAGES = [
  { id: 'play',    label: 'Play',      ref: null },
  { id: 'body',    label: 'Body & Deze', ref: null },
  { id: 'samples', label: 'Samples',   ref: null },
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
// Every control reports {get,set} keyed by its param path; presets read and
// write that map, so a preset is exactly the same paths the host accepts.
const controls = new Map();
for (const group of [mountFaders(app), mountKnobs(app), mountModStrips(app)])
  for (const [path, api] of group) controls.set(path, api);

/* Free-running LFO rate: the shared clock behind every LFO strip (default 5 Hz
   matches cfg.lfo.rate). Throttled like the knobs so dragging it does not flood
   the host, and phase is preserved by the engine when the rate changes. */
const lfoRate = $('#lfo-rate');
if (lfoRate){
  const readout = $('#lfo-rate-val');
  const paintRate = () => { if (readout) readout.textContent = `${(+lfoRate.value).toFixed(1)} Hz`; };
  let lastRate = -1e9, rateTimer = 0;
  const sendRate = () => { lastRate = performance.now(); send('param.set', { path: 'lfo.rate', value: +lfoRate.value }); };
  lfoRate.addEventListener('input', () => {
    paintRate();
    const now = performance.now();
    if (now - lastRate >= 40){ clearTimeout(rateTimer); rateTimer = 0; sendRate(); }
    else if (!rateTimer){ rateTimer = setTimeout(() => { rateTimer = 0; sendRate(); }, 40 - (now - lastRate)); }
  });
  lfoRate.addEventListener('change', () => { clearTimeout(rateTimer); rateTimer = 0; sendRate(); });
  paintRate();
  controls.set('lfo.rate', {
    get: () => +lfoRate.value,
    set: (v) => { lfoRate.value = String(v); lfoRate.dispatchEvent(new Event('input')); lfoRate.dispatchEvent(new Event('change')); },
  });
}

/* Presets: named snapshots of every knob, the LFO rate and every mod-strip
   depth, kept in localStorage (WebView2 user data, so they survive restarts). */
mountPresets({
  select: $('#preset'),
  nameInput: $('#preset-name'),
  saveButton: $('#preset-save'),
  exportButton: $('#preset-export'),
  importButton: $('#preset-import'),
  importInput: $('#preset-file'),
  controls,
  onStatus: (text) => { const s = $('#st-preset'); if (s) s.textContent = `Preset: ${text}`; },
});

/* One telemetry frame drives the meter and the visualizer: peaks for the meter,
   the 1024-sample mono window for scope/spectrum/spectrogram. */
const meter = mountMeter($('#meter'));
const viz = mountVisualizer($('#scope'), [...document.querySelectorAll('.viz-tab')]);
on('telemetry', (p) => { meter.push(p); viz.push(p); });

/* host-driven note state (MIDI input, automation, preset audition) */
on('note.state', ({ note, on: isOn, velocity }) => kb.setHostNote(note, isOn, velocity));

/* loaded instrument schematic → rebuild the tine field from real geometry */
const instChip = $('#provisional') || document.querySelector('.provisional');
on('instrument', (p) => {
  if (!p || !p.id) return;
  if (kb.setInstrument(p.id) && instChip) instChip.textContent = p.name || p.id;
});
on('param.state', ({ path, value }) => {
  const el = document.querySelector(`[data-param="${path}"]`);
  if (!el) return;
  const range = el.querySelector('.range');
  if (range){ range.value = value; range.dispatchEvent(new Event('input')); }
});

/* top bar */
$('#panic').addEventListener('click', () => kb.allOff());

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
