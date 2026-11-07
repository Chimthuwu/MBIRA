# MBIRA — manual test results (listening record)

**This file does not exist yet as evidence: it is the blank record the spec
requires (`docs/MBIRA-SPEC.md` §8). Fill it in by listening. An agent cannot
hear — every row below is empty on purpose.**

- Pack: `evidence/wav-listen/` (13 files) + `evidence/wav-listen/RECORDING-MANIFEST.md`
- Rendered from: HEAD `6293c17`, branch `ui/visual-first-assignment`, 2026-11-08
- M1 baseline (older, different sound): tag `m1-baseline` = commit `efb427a`
- Audio: 48 kHz / 16-bit / block 256 / no normalisation / mono content in both channels
- Reference: an actual mbira dzaVadzimu and Nyunga Nyunga if one is available

## Part A — does it sound like an instrument at all? (human, ~5 min)

Play in this order, one at a time: `dz-soft` → `dz-hard` → `dz-phrase`.

| # | Question | Answer (Y / N / notes) |
|---|---|---|
| A1 | Does `dz-soft` produce a clear pitch, or a dull blip? | |
| A2 | Does `dz-hard` attack read as a pluck (flesh/nail on metal), not a synthetic beep? | |
| A3 | Does the decay curve sound like a struck tine (fast attack, long tail, partials dying at different rates) or like a sine with an envelope? | |
| A4 | Does the note still ring after note-off at t=3.5 s, or is it chopped? | |
| A5 | Is anything obviously wrong: clicks, zipper noise, pitch glide, pumping? | |
| A6 | Does the 4-note phrase overlap like strings ringing on a soundboard? | |

## Part B — does it behave like a mbira? (mbira player, if available)

| # | Question | Answer |
|---|---|---|
| B1 | Are the intervals right? (Placeholder: both instruments are equal-tempered C major — `provisional: true`. Amendment 4.9 asked for real tunings.) | |
| B2 | DzaVadzimu vs Nyunga: is `ny-hard` audibly a different instrument from `dz-hard`, or just the same note slightly longer/shorter? | |
| B3 | Is the key range plausible? dzaVadzimu = 24 keys, MIDI 48–88; Nyunga = 15 keys, MIDI 60–84 | |
| B4 | Does the buzz/deze sound like the real instrument? Compare `ab-buzz-off` vs `ab-buzz-on` | |
| B5 | Does the gourd add anything? `ab-gourd-off` vs `ab-gourd-on` (measured difference is only +0.32 dB below 400 Hz) | |
| B6 | What does the player say is *most* wrong? | |

## Part C — pluck position (objective defect, confirm audibly)

| # | Question | Answer |
|---|---|---|
| C1 | `pluck-0.0-end` vs `pluck-0.5-centre`: does it sound like a 20 dB drop? | |
| C2 | `pluck-0.0-end` vs `pluck-1.0-otherend`: can you hear any difference? (They are byte-identical — defect L-1 in the manifest) | |

## Part D — open questions carried from M1 (never answered)

| # | Question | Answer |
|---|---|---|
| D1 | Amendment 4.9: real tunings for both instruments (note names or Hz). Can the player provide them? | |
| D2 | Should buzz ship on (spec default `buzz.intensity = 0.2`) or off (shipped JSON `0.0`)? Defect L-2. | |
| D3 | Acceptance for this pack: is HEAD good enough to keep building sound, or must the tine model be reworked first? | |

## Result

- Date: ____________ · Listener(s): ____________
- Verdict (keep building / rework the model first / needs a player session first): ____________
- Notes: ________________________________________________________________
