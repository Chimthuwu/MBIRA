# MBIRA UI — drop-in mockup scaffold

Vanilla HTML/CSS/JS scaffold implementing the §4 control map, §5 deliverable
list, and §3 constraints (WebView2 child window, allowlisted envelope, no
framework, CSS-transform animation only). Runs as a plain page in a browser
today and drops into WebView2 unchanged.

No build step. No CDN. Open `index.html` directly (`file://` works in a
browser; in WebView2 map a virtual host to this folder).

## File tree

```
ui/
├─ index.html
├─ css/
│  ├─ tokens.css        # design tokens → CSS custom properties
│  └─ app.css           # layout + component states
├─ js/
│  ├─ bridge.js         # {v,type,id,payload} envelope + allowlist + host transport
│  ├─ layout.js         # tine keyboard geometry + note assignment (placeholder tuning)
│  ├─ keyboard.js       # pointer/touch/QWERTY input, per-tine visual state
│  ├─ controls.js       # fader / knob / insert-chip / meter / scope
│  └─ main.js           # wiring, mock host for offline design review
└─ README.md
```

## WebView2 integration notes

- Host object is `window.chrome.webview` — `postMessage(obj)` out,
  `addEventListener('message', …)` in. The object is JSON-serialized; keep
  payloads flat and primitive.
- Serve `ui/` from a virtual host mapping
  (`SetVirtualHostNameToFolderMapping`), not `file://`. This gives a real
  origin, enables module scripts without CORS friction, and lets the CSP in
  `index.html` do its job.
- `ui.ready` handshake is mandatory. Do not push telemetry before it arrives;
  do not let the UI send anything before the DSP runtime is constructed.
  `bridge.js` already emits it on load.
- Throttle host→UI telemetry to ≤30 Hz and coalesce: one telemetry message
  carrying `{peakL, peakR, rms}` beats three. Drop frames rather than queue
  them — stale meters are worse than chunky ones.
- DPI: everything is px in a 16px-rem-free scale. Test at 100/125/150/200%
  Windows scaling and at 600×400 (minimum viable DAW window) through
  1920×1080.
- Resize: `.app` is a 4-row grid with `minmax(0,1fr)` on the stage; the
  panels drop to one column below 900px. Nothing is absolutely sized except
  tine geometry, which is percentage-based off the board.
- Focus: Tab reaches every control. Tines are `<button>`s with
  `aria-pressed`; knobs are `role="slider"` with
  `aria-valuenow`/`aria-valuetext` and arrow/Home/End keys.
- Escape hatch for the mock: `window.__MBIRA_MOCK__` is the offline dev host.
  It should be dead code in production — gate it behind a build-time flag or
  just delete the block when wiring the real bridge.

## What this scaffold deliberately does not decide

- **Final tunings.** `layout.js` note assignment is a placeholder C-major
  spread. Real mbira dzaVadzimu tunings (amendment 4.9) will change the scale
  array and probably the row assignment. The layout function is isolated for
  exactly this reason.
- **The look.** Tokens are a defensible dark-instrument starting point (wood +
  steel + amber), not a verdict. Design agents should treat `tokens.css` as
  the swap point — every color and duration in `app.css` reads from it.
- **Effects UI depth.** The rack is chips only; per-effect panels are M2/M3.
- **Preset browser / storage backend.** Presets work (`js/presets.js`): a named
  snapshot of every wired control, saved in `localStorage` under
  `mbira.presets.v1` (WebView2 user data, so it survives restarts) and recalled
  as a batch of `param.set`. What is still open is the §5.4 backend: preset
  files on disk, a versioned plugin-state round-trip, and block-atomic recall.
- **Per-note tuning grid.** §4 calls for it; not mocked — it depends on the
  tuning question above.

## Open questions still blocking this UI

- Real tunings (4.9) — until these land, the keyboard's note labels are wrong
  and any pitch-layout decision is provisional.
- Voice pool display — status bar says 0 / 37; confirm whether M2's 64 should
  be user-visible or advanced-only.
- MIDI status semantics — what does "ok" mean when zero devices are present
  vs. a device present but no notes received? The dot currently only has
  ok/warn.
- WebView2 viability spike — everything above assumes it works. If the spike
  fails, the token/component spec survives; the transport in `bridge.js` does
  not.
