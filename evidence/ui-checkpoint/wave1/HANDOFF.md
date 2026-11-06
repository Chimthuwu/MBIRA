# MBIRA — UI Wave 1 · navigation + 5-page model + re-skin (handoff)

**Status: IMPLEMENTED + VERIFIED** on branch `ui/visual-first-assignment` (pending commit).
Branch base: `a7051f88f52fe5d9fe9a2f4050236c016c553191`.
Proceeding after checkpoint signoff ("ok go" ·  2026-11-07) + Design Agent Package (ends at Part 4; Parts 5–8 wave assignments and Part 9 review bar are absent from the file).

## What changed (this wave)

**Image** | `ui/index.html` — restructured from one long surface into a **persistent 3-band shell**:
`topbar / nav / views / statusbar`. Five page sections, each `data-page` + `hidden`
when inactive (`[hidden]` verified to win over `.view` display in the live DOM):

| Page | Contents (existing controls, nothing invented) |
|---|---|
| **Play** | tine keyboard hero, **Master** fader, output meter |
| **Tine** | Mode 1–3 faders · Stiffness/Decay/Damping/Strike knobs · **scope** (moved here) |
| **Body** | Buzz + Gourd knobs + provisional note |
| **Samples** | honest empty state — explicitly no engine / no fake controls |
| **FX** | Reverb/Delay/Drive chips + reserved disabled `+` insert |

Voice count readout lives in the **persistent status bar only** (not duplicated on Play).

**JS** | `ui/js/main.js` — **data-driven page model**: `PAGES` records
`{id, label, section-ref}` resolved once at init, not per switch. Nav buttons built from `PAGES`.
`switchPage` → `show(id)`: toggles `hidden`, updates `aria-current`, moves focus to the active
nav item, and **releases locally-held notes before leaving Play** (`kb.releaseLocal()`).

**Image** | `ui/css/app.css` — re-skin on the **approved tokens** (committed `bd2c86b`):

- Focus rings & selection moved to **neutral `--sel`** (never amber). Amber is now **energy-only**:
  tine strike glow, note-on ring, active insert, meter fill. Verified by grep: every
  remaining `--accent` / `--accent-hot` hit is an energy event.
- Board glow token-based via `color-mix` instead of a hardcoded `rgba(240,166,60,·)`.
- Nav/page/samples styles added; all colours from tokens (no new hex literals).

## Bridge contract (unchanged — verified)

`{v,type,id,payload}` envelope; allowlist intact. **No new message types.**
Page switching emits **only** `note.off` per locally-held note — no `panic`, no `param.set`.

## Verified live (Chrome/CDP, 127.0.0.1:8766, `data-param`/IDs preserved)

- 21 tines (3 rows × 7), board 575×192 at 600×400, all tines inside board bounds, no app vertical overflow.
- keydown `a` → `note.on:60`; **switch page while held** → exactly one `note.off:60`; later physical
  keyup emits **0** extra messages (no duplicate note-off). Switch with nothing held → **0** messages.
- Host-driven note (via `note.state`) survives a page switch, untouched.
- `param.set@mode1` still fires from the Tine page fader; Panic → `note.on:60,panic`.
- Focus moves to the newly active nav item after every switch.
- All four inactive pages `hidden` (correctly gated). Feels playable: velocity + 600 ms auto-fade + pointer capture preserved.

## Evidence

`evidence/ui-checkpoint/wave1/wave1-600x400-{play,tine,body,samples,fx}.png` — all five pages at
600×400 (Chrome via CDP, deviceMetricsOverride). **Pending evidence gap (unchanged):** true 200% OS DPI
capture is impossible in this environment (browser zoom ≠ OS scaling). A Windows 200% DPI run or explicit
gap acceptance is required before these screenshots count as the DPI deliverable.

## Found but not fixed (honest) — carried from checkpoint

- Damped state is 260 ms vs the 280 ms spec (locally-observed on `paintOff`).
- `--vel` token exists but is unused (velocity→glow-radius displacement not yet linear).
- `__MBIRA_MOCK__` remains ungated (dev convenience; fine until the real WebView2 host lands).
- Scope stroke hardcoded as `rgba(240,166,60,.85)` in `controls.js` — energy-appropriate; left as-is.

## Out of scope (deferred, per First Assignment + package)

Engine blend, the three macros, per-parameter mod strips, sample controls, WebView2 spike, real tunings
(amendment §4.9), MIDI device verification, Bitwig host test. The modulator-framework commit `3e69782`
is DSP/native-side, does not touch `ui/`, and maps to the package's allowed per-parameter mod strips —
recorded as a divergence, not reverted.

## Handoffs
- **Next wave** reads this; visual changes need **no new bridge types** and **no JS behaviour changes** to the keyboard/meter.
- Pre-existing off-limits WIP (uncommitted) untouched: `src/dsp/index.js`, `src/native/ui.h`, `src/native/main.cpp`.
