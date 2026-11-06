# MBIRA — Verified licences (Milestone 1 set)

Each entry read from the actual licence file in the pinned source (see
`deps/manifest.json` for pins/checksums). Nothing here is guessed.

| Component | Version / pin | Licence | Source file |
|---|---|---|---|
| Elementary (native runtime + JS renderer) | commit 60e7234 (core 4.0.1 / renderers 4.0.3) | MIT (Copyright (c) 2023 Nick Thompson) | thirdparty/elementary/LICENSE.md → LICENSES/Elementary-LICENSE.md |
| choc (JS context wrapper, JSON, files) | elementary cli submodule @ 60e7234 | ISC | thirdparty/elementary/cli/choc/LICENSE.md → LICENSES/choc-LICENSE.md |
| QuickJS (embedded via choc) | vendored in choc | MIT-style (Bellard/Gordon) | LICENSES/QuickJS-LICENSE.txt (extracted from choc_javascript_QuickJS.h) |
| RtAudio | 6.0.1 | MIT-style, (c) 2001-2023 Gary P. Scavone | LICENSES/RtAudio-LICENSE |
| RtMidi | 6.0.0 | MIT-style, (c) 2003-2023 Gary P. Scavone | LICENSES/RtMidi-LICENSE |
| WinLibs GCC 16.2.0 (build tool only) | r3 ucrt | GPL-3.0-with-GCC-runtime-exception; build output unaffected | toolchain, not distributed |
| esbuild (dev dependency, bundler) | 0.25.12 | MIT (npm) | package.json devDependency |
| @elemaudio/core, offline-renderer (npm, dev/test) | 4.0.1 / 4.0.3 | MIT (npm) | package.json |

## Pending verification (M2+ / before distribution)

- **VST3 SDK** — dual licence GPLv3 / proprietary Steinberg agreement. A closed
  or free-but-not-GPL MBIRA distribution REQUIRES signing Steinberg's VST3
  licence. Decision needed with the human before release. (Spike uses the SDK
  for evaluation; that is fine, distribution is the question.)
- **WebView2 Runtime** — Microsoft's runtime terms; free to redistribute via
  the Evergreen bootstrapper but check the current agreement before shipping.
- **Fonts (Cormorant Garamond, Inter)** — M3 UI; both are OFL, but verify at
  bundle time.
- **JUCE** (only if the VST3 fallback triggers) — dual GPL/commercial.

## Commercial-distribution questions for the human

1. Is MBIRA intended to be sold/closed-source? If yes → Steinberg VST3
   proprietary licence sign-up is mandatory, and the Elementary MIT licence
   permits it (attribution required).
2. Bundled WebView2 distribution vs relying on the OS-installed Evergreen
   runtime — preference?
