# Checkpoint 1 handoff — tokens + moodboard (AWAITING USER SIGNOFF)

Status: **STOPPED at the mandatory approval gate.** Nothing past the
checkpoint has been implemented (no navigation, no re-skin, no page work).

- Branch: `ui/visual-first-assignment` · base commit: `a7051f8` (main)
- Changed product file: `ui/css/tokens.css` only (uncommitted diff on this branch)
- Deliverables in this directory:
  - `moodboard.html` — single self-contained moodboard (open from file://).
    Standalone artifact: inlines its styles, NOT a product surface.
  - `palette.html` + `palette.css` — palette proof page that LINKS the product
    `ui/css/tokens.css` (no inline styles/scripts); verifies the swap is
    token-complete. Screenshot: `palette-screenshot.png` (captured at 764×429
    CSS px, Chrome via CDP, tokens confirmed loaded: body bg rgb(8,9,11)).

## Key proposal points (see moodboard)

- Shell deeper + cooler; wood redder/warmer; steel cooler/brighter — material
  separation by contrast, not shadows/gloss.
- Amber stays energy-only. NEW tokens `--sel`/`--sel-dim` (neutral cool steel)
  are proposed for focus/selection/navigation-current — the current amber
  focus outlines (`.select/.tine/.range/.knob__dial:focus-visible`) get moved
  to `--sel` in the post-signoff re-skin.
- Motion untouched: 18/220/600 ms + reduced-motion block.

## Inspection findings (recorded per assignment)

- `docs/DESIGN-AGENT-PACKAGE.md` DOES NOT EXIST in the repo — reported, not invented.
- `window.__MBIRA_MOCK__` is defined UNCONDITIONALLY in `main.js` (no build-time
  gate). README's "gate it or delete in production" is not yet implemented anywhere.
- Timing vs brief: press 18 ms ✓, release 220 ms ✓, damped JS removal 280 ms
  but CSS damped transition is 260 ms (minor mismatch, preserved), glow 600 ms ✓.
- Discrepancy: interaction spec says glow AND displacement scale with velocity;
  actual: displacement is fixed −2px, only the brightness filter scales, and
  `--vel` is set in JS but never consumed by any CSS rule.
- Amber hardcoded outside tokens: `board__glow` rgba in `app.css:90` (energy ✓
  but hex-literal), scope stroke rgba in `controls.js:97`. 12 hex literals in
  `app.css` total. All queued for the post-signoff re-skin (token-only rule).
- Verified live: 21 button-tines w/ aria-pressed, knob slider ARIA + keys,
  4-row grid, single-column panels <900px, QWERTY on/off, Esc→damped, 38
  tab-reachable controls.

## Open (post-signoff, in order)

1. Navigation + page model (Play/Tine/Body/Samples/FX), data-driven, per brief.
2. Re-skin surfaces using approved tokens.
3. 200% DPI capture — NOT YET POSSIBLE in this environment (browser zoom is
   not OS scaling); flagged as an evidence gap, needs user-arranged environment.
