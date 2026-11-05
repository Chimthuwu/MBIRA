# MBIRA todo.md

## Environment report (2026-11-06)

- OS: Windows 10 Pro 22H2, build 19045.7807. CPU: AMD Ryzen 5 3600 (6c/12t). RAM: 32 GB.
- Toolchain at session start: git 2.53.0.windows.3, CMake 4.4.3, Node v26.0.0, npm 11.12.1, Python 3.14.9, Ninja (AppData).
- **No C/C++ compiler was present** (no MSVC, no clang, no gcc; VS folders empty shells). → Installing WinLibs POSIX UCRT (MinGW-w64 GCC, free) in the background. UNVERIFIED until its first successful compile.
- Executables: YES (can run/build). Audio device: expected reachable for rendering; **the agent cannot listen** — WAVs are the evidence. MIDI: UNVERIFIED until a device/loopback is probed with RtMidi; a documented test input will be provided either way.
- Network: YES (github.com reachable).

## Gates / milestones

- [x] Spec saved to `docs/MBIRA-SPEC.md`
- [x] M0: Elementary source cloned and inspected (commit 60e7234, js renderer v4.0.3)
- [ ] M0: feasibility verdict written (docs/architecture-decision.md) — in progress
- [ ] M0→M1: compiler installed and verified with a hello-build
- [ ] M1: native host builds; Elementary graph renders a 3-mode plucked tine (GATE 1)
- [ ] M1: MIDI/test-triggered notes; continuous param changes during sustained audio (4.2)
- [ ] M1: latency (≥100 notes, 128/256 blocks) and CPU (1/8/max voices) measurements (4.3)
- [ ] M1: rendered WAVs + manifest; how-to-run doc (4.9, 4.12)
- [ ] M1: VST3 spike with exit conditions (4.4) + host-test checklist
- [ ] M1: finish architecture-decision.md with verified licences (never guess)
- [ ] STOP after M1 and report (Part A §1)

## Amendments 4.5–4.9 (later milestones — record now, apply then)

- 4.5 (§3.3): soundboard = ONE shared resonator bank for all voices; state persists across notes; reset/crossfade off-audio-thread on instrument switch; test that two notes excite the same body state.
- 4.6 (§3.3): gourd and buzz are acoustic approximations, not verified physics. Label PROVISIONAL, keep mappings easy to revise, wait for player input before over-engineering.
- 4.7 (§3.1): modal ratios [1.0, 2.6, 4.2] are unverified — review lamellophone acoustics before M2 or state it's a guess. For M1 use whatever gives a clearly decaying 3-mode pluck and say so.
- 4.8 (§5.1): functional UI before animation; simple immediate tine highlights; must feel playable.
- 4.9 (§4.3): placeholder tunings will likely sound wrong — ask the human for real tunings before M3; list in open questions.
- 4.10–4.13: applied in M1 as written in the spec (verification boundary; software vs hardware latency; WAV manifest; GO does not skip playable-audio gate).

## Blockers / open items

- Compiler: WinLibs install running (background). If winget path fails, fall back to a direct zip download from winlibs.com (pinned URL + sha256 in deps/manifest.json).
- MIDI route: check for existing loopMIDI/virtual port; else documented test input (OK per spec §2.1 item 4).
- Release conventions: repo js/core is 4.0.1, web/offline renderers 4.0.3, runtime project 0.11.5, CLI example pins @elemaudio/core ^3.2 — must NOT mix; use the same repo commit for both sides and record in manifest.
