# MBIRA VST3 — Ableton Live host-test checklist (for the human)

Plugin: `build-vst3/mbira-dzavadzimu.vst3` (Milestone 1 spike; DSP = same
`build/dsp-bundle.js` Elementary graph as the standalone). Copy the `.vst3`
bundle into `C:\Program Files\Common Files\VST3\` (or your custom VST3
folder) and rescan.

Target host: Ableton Live on Windows. Test at both 44.1 kHz and 48 kHz.
Mark each item PASS / FAIL / NOTES and send the table back.

## 1. Load
- [ ] Live scans and lists the plugin (search "MBIRA").
- [ ] Plugin loads into a MIDI track without errors or crash.
- [ ] Live's plug-in panel shows the editor (if the spike editor is a stub
      window, note what appears; the real editor is M3).

## 2. Audio
- [ ] Project at 44.1 kHz: play a note — audio output, no glitches/CPU spikes.
- [ ] Project at 48 kHz: same.
- [ ] No sound before any MIDI note is sent (silence check).

## 3. MIDI
- [ ] MIDI note-on produces a plucked tine (metallic, decaying).
- [ ] Note-off damps the note (~300 ms release), does not cut it.
- [ ] Fast repeats of the same key retrigger cleanly (no stuck/cut notes).
- [ ] Several overlapping notes sound together (3–4 note chord).

## 4. Automation (parameter: "Mode 1 Gain" or the spike's single parameter)
- [ ] Parameter appears in Live's automation list.
- [ ] Draw automation over a sustained note — timbre changes during the note.
- [ ] Record-arm + touch automation records movements.

## 5. State save / restore
- [ ] Save project with a changed parameter value; reload — value restored
      and sound matches.
- [ ] Save a Live set with a sustained/decaying note playing; reload — no
      stuck audio.

## 6. Editor embedding (WebView2 viability — M1 spike scope)
- [ ] Does the plugin open any window at all? (Spike may have none — then
      mark UNVERIFIED here.)
- [ ] Live remains stable when the plugin window is opened/closed repeatedly.

## 7. Stress
- [ ] Play a dense phrase (16th notes, chords) for 60 s — any dropouts,
      stuck notes, or rising CPU?
- [ ] Change sample rate while the plugin is loaded (Live preferences) —
      survives without crash?

## Report back
For each item: PASS / FAIL / UNVERIFIED + one line. Note Live version and
Windows audio driver type (ASIO/MME). Anything FAIL = the first thing M2 fixes.
