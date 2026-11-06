# MBIRA todo.md

## Environment report (2026-11-06)

- OS: Windows 10 Pro 22H2, build 19045.7807. CPU: AMD Ryzen 5 3600 (6c/12t). RAM: 32 GB.
- Toolchain: git 2.53.0.windows.3, CMake 4.4.3, Node v26.0.0, npm 11.12.1, Python 3.14.9, Ninja.
- Compiler: INSTALLED + VERIFIED — WinLibs MinGW-w64 GCC 16.2.0 (UCRT posix-seh r3), pinned, sha256 in deps/manifest.json.
- Executables: YES. Audio device: RtAudio enumerates devices (agent cannot listen; WAVs are the evidence). MIDI: RtMidi code present, UNVERIFIED until a device/loopback is probed.
- Network: YES.

## Gates / milestones

- [x] Spec saved to docs/MBIRA-SPEC.md
- [x] M0: Elementary source inspected (commit 60e7234, js renderer v4.0.3)
- [x] M0: feasibility verdict GO WITH CONSTRAINTS (docs/architecture-decision.md)
- [x] M0-M1: compiler installed and verified (GCC 16.2.0)
- [x] M1 GATE 1: native host builds; real Elementary graph renders 3-mode plucked tine
- [x] M1: test-triggered notes; continuous param changes during sustained audio (4.2) - evidence/wav/param-sweep.wav
- [x] M1: latency (120 notes, 128/256 blocks) and CPU (1/8/32/37 voices) measurements (4.3)
- [x] M1: rendered WAVs + manifest (evidence/RECORDING-MANIFEST.md); how-to-run doc
- [ ] M1: VST3 spike with exit conditions (4.4) + host-test checklist
- [ ] M1: finish architecture-decision.md with verified licences (RtAudio/RtMidi/QuickJS/choc/VST3)
- [ ] STOP after M1 and report (Part A section 1)

## Amendments 4.5-4.9 (later milestones - record now, apply then)

- 4.5 (3.3): soundboard = ONE shared resonator bank for all voices; state persists across notes; reset/crossfade off-audio-thread on instrument switch; test that two notes excite the same body state.
- 4.6 (3.3): gourd and buzz are acoustic approximations, not verified physics. Label PROVISIONAL, keep mappings easy to revise, wait for player input before over-engineering.
- 4.7 (3.1): modal ratios [1.0, 2.6, 4.2] are unverified - review lamellophone acoustics before M2 or state it is a guess. M1 uses them as an explicitly PROVISIONAL placeholder.
- 4.8 (5.1): functional UI before animation; simple immediate tine highlights; must feel playable.
- 4.9 (4.3): placeholder tunings will likely sound wrong - ask the human for real tunings before M3; list in open questions.
- 4.10-4.13: applied in M1 as written (verification boundary; software vs hardware latency; WAV manifest; GO does not skip playable-audio gate).

## Blockers / open items

- MIDI UNVERIFIED: mbira-poc live prints the detected port; needs a real device or loopMIDI from the human.
- Voice pool prebuilds notes 48-84 (37 voices) in M1; 64-voice preallocation is M2 voice-manager work.
- Live mode runs forever (no clean shutdown handler) - fine for a PoC; polish in M3 standalone.
- Release conventions: use js/core 4.0.1 + native runtime from the SAME repo commit (60e7234); never mix with the CLI example stale npm pin (^3.2).

## Final status (2026-11-06)

- [x] M1 VST3 spike: direct VST3 VIABLE - SDK validator 47/47 passed, smoke host produced real audio (-10.7 dBFS). No JUCE fallback. See evidence/vst3-spike.md.
- [x] M1: architecture-decision.md finished (VST3 decision + verified licences in LICENSES.md).
- [x] M1 COMPLETE - STOPPING per Part A section 1. Final report delivered in chat.
- Open for human: listen to evidence/wav/*.wav; run docs/vst3-host-test-checklist.md in Ableton; provide MIDI device/loopMIDI; answer Steinberg licence + tuning questions (4.9).
