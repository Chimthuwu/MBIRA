# Mbira Hybrid VST — Full Chat Summary

Source: ChatGPT shared conversation "Design Mbira Synthesizer"
URL: https://chatgpt.com/share/6aecc465-b694-83ec-b4b5-8af1b3de4a0c
Date of chat: Today (day of share), starting ~12:57 PM

---

## MESSAGE 1 — User's opening request

The user wants to build an **Mbira instrument**. Their friend from Zimbabwe has offered to
record **multisamples**; the user will do everything else. The friend mentioned there are a
few different kinds of mbira — one sounded like "nunga nunga" (actually **Nyunga Nyunga**) —
and that some have a **resonator**.

Key goals stated by the user:
- The plan is to make a **VST3** version.
- Before getting the multisamples, the user needs a product to SHOW the friend that must
  **LOOK, FEEL and BE impressive** — so the UI and the sound must both be good.
- The user likes the **Arturia Augmented** bundle, and wants something SIMILAR in behavior:
  combining synthesizers WITH actual sampled instruments (they think this sounds best).
- One thing the Augmented bundle does NOT do is **physical modelling synthesis**, and the
  user wants physical modelling to be the **foundation** of this synthesizer. They asked:
  is this a good idea? Should we do this?

---

## MESSAGE 2 — ChatGPT's big response (Yes, PM should be the foundation)

ChatGPT agreed enthusiastically: physical modelling should be the foundation, and there's an
opportunity to make something more interesting than a conventional sampled Mbira VST. The
concept: a **hybrid acoustic instrument synthesizer** with:

1. Real recorded Mbira performances and multisamples.
2. A physically modelled Mbira engine generating its own tones.
3. A synthesis layer that transforms, extends and blends the acoustic sound.
4. A beautiful instrument-focused interface inspired by Arturia Augmented.

Important distinction: **don't** build a sampler with a few synthesis effects bolted on;
build the physical instrument model FIRST, then use recordings for authenticity, complexity
and character.

### Section 1 — Mbira varieties

- The instrument the friend mentioned is **Nyunga Nyunga** (sometimes written Nyunganyunga),
  not "nunga nunga".
- Zimbabwean mbira traditions are NOT simply different presets of the same instrument:

| Variety | Details |
|---|---|
| **Mbira dzaVadzimu** (recommended starting point) | Traditionally ~22–28 metal keys; three distinct playing registers; often played inside a large gourd resonator called a **deze**; characteristic buzzing and rich overlapping harmonics. |
| **Nyunga Nyunga** | Typically 15 keys; two rows of keys; different layout and playing approach; distinctive, often bright and melodic character; can also be played with a resonator. |
| **Matepe** | Another distinct Zimbabwean lamellophone; different key arrangement and playing technique; worth considering as a future instrument model. |

- **The resonator is real**: the **deze** is a hollowed-out gourd or calabash that the mbira
  is placed inside. It does more than make the instrument louder — it changes the acoustic
  character, adding resonance and shaping harmonics.
- Little **metal bottle caps, shells or beads** produce the characteristic **buzzing** sound.
- Key design implication: model the **mbira, the resonator and the buzzing mechanism as
  separate interacting components**.

### Section 2 — Physical modelling as the heart

Conventional sampled instrument = record notes → store → trigger → filter/effects. Limited
by the recordings. Physical modelling = **mathematically simulate** the physical behaviour:
metal tines being plucked, vibrating, interacting with the wooden soundboard, exciting a
resonator.

Five components of the physical model:

1. **01 — Metal tine model** (core synthesis engine): simulates vibrating metal tongues.
   Parameters: tine length, tine stiffness, material/metal character, damping,
   inharmonicity, tuning.
2. **02 — Pluck excitation**: simulates thumb/finger interacting with each tine.
   Parameters: pluck position, pluck strength, pluck stiffness, attack character, release
   behaviour.
3. **03 — Soundboard**: models the wooden body and vibration transfer. Parameters: wood
   character, resonance, body coupling, structural damping.
4. **04 — Deze resonator**: simulates the hollow gourd and its acoustic resonances.
   Parameters: resonator size, resonance frequency, resonance intensity, acoustic coupling.
5. **05 — Buzz mechanism**: simulates bottle caps, shells and metal buzzers. Parameters:
   buzz intensity, mechanical looseness, rattle density, resonant interaction.

The exciting part: **components interact**. Plucking harder doesn't just make it louder —
it changes the transient, excites different resonances, produces more aggressive buzz. That
behaviour is what makes physical modelling interesting.

### Section 3 — The hybrid architecture (their version of Augmented)

Two independent sound engines blended together:

- **ENGINE A — PHYSICAL**: physical modelling synthesis (tines, plucks, wood, gourd, buzz).
- **ENGINE B — SAMPLED**: real-world recordings (multisamples, articulations, variations).
- **HYBRID BLEND**: continuously adjustable, independent engine levels and modulation.

Blend positions and results:
- 100% physical / 0% samples → fully modelled instrument
- 75/25 → organic, slightly synthetic
- 50/50 → hybrid acoustic
- 25/75 → realistic, enhanced
- 0/100 → pure recorded Mbira

Both engines should have their own independent controls. The physical engine could even
provide additional harmonics and resonance to the sampled engine — going beyond typical
Augmented architecture. Technical note: don't force the sample engine to follow every
physical-model parameter; some controls shared, others engine-specific.

### Section 4 — Sound engine implementation (v1 approach)

Don't simulate everything at full complexity from day one. First version uses:
- **Modal synthesis** — for the tine's vibrating modes and inharmonic overtones.
- **Physical excitation modelling** — for the actual pluck.
- **Resonant filters / modal resonators** — for the wooden body and gourd.
- **Nonlinear noise and collision modelling** — for the metallic buzzers.

Controllable physical model without ridiculous CPU. Later: digital waveguides or
finite-difference models.

**The instrument should be playable** — not a generic synth that happens to sound like a
Mbira. It should understand its own physical layout:
- Every virtual key has its own pitch, length, physical characteristics.
- Notes have slightly different attack/decay characteristics.
- Pluck position changes harmonic content.
- Multiple notes interact through the soundboard.
- The resonator responds to the collective notes being played.
- Buzzing responds dynamically to the vibration (gourd + buzzers should respond to the
  actual instrument excitation, not be an effect on the final output).

**What about the samples?** Ask the friend to record several configurations:
- Mbira without the deze.
- Mbira inside the deze.
- Different plucking strengths.
- Different playing articulations.
- Different tunings, if possible.
- Different buzzer configurations.
- Ideally a clean direct signal AND a separate microphone recording in natural acoustic
  environment.

Important warning: **don't ask him to record hundreds of random notes yet**. First agree on
instrument, tuning, recording format, velocity layers and articulations — otherwise risk
redoing the recording session.

### Section 5 — UI: premium instrument feel

Inspired by Arturia Augmented but NOT copying it. Dark, elegant, slightly organic interface
with a visual representation of the actual Mbira. The two-engine architecture should be
immediately obvious. Sketch layout: header (MBIRA — HYBRID INSTRUMENT · V1.0, STEREO, preset
selector e.g. "Nyamaropa · Warm Resonance"), interactive instrument visualization, ENGINE
MIX (PHYSICAL 65/35 SAMPLES), Physical Engine section (tine/excitation: stiffness, pluck
position, damping), Sample Engine section (acoustic character: sample variation, velocity
layers, round robin), Resonator section (deze size, buzz, body, gourd/metal caps/wood),
Effects (filter, drive, delay, reverb). Labelled "Conceptual UI direction — not a finished
plugin mockup."

Pages:
| Page | Purpose |
|---|---|
| Play | Main instrument, engine blend, performance controls |
| Physical | Detailed physical modelling parameters |
| Samples | Multisample editing and articulation |
| Resonator | Gourd, wood and buzzer modelling |
| FX | Effects and modulation |
| Advanced | Tuning, MIDI, voice management |

Play page default; advanced controls shouldn't overwhelm someone who just wants to play.

### Section 6 — Development technology

| Component | Technology |
|---|---|
| Plugin framework | C++ / JUCE |
| Plugin format | VST3 |
| Physical modelling | Custom C++ DSP |
| Sample playback | Custom multisample engine |
| Effects | Custom DSP initially |
| UI | JUCE custom components / OpenGL where useful |
| Presets | JSON or structured preset format |
| DAW testing | Ableton Live |

Keep DSP engine independent of the interface: develop/test the physical model separately
before integrating; room for standalone versions later.

Early architectural decision — **modular engine system**:

```
MBIRA
├── Instrument Definition
│   ├── Instrument Type
│   ├── Key Layout
│   ├── Tuning System
│   └── Key Characteristics
├── Physical Engine
│   ├── Pluck Exciter
│   ├── Tine Resonator
│   ├── Soundboard
│   ├── Deze Resonator
│   └── Buzzer Simulation
├── Sample Engine
│   ├── Multisample Mapping
│   ├── Velocity Layers
│   ├── Round Robin
│   └── Articulations
├── Hybrid Mixer
├── Modulation
├── Effects
└── Stereo Output
```

Important so different Mbira varieties can be added later without rewriting the synth.

### Section 7 — Development roadmap (first proposal)

**Don't start by collecting multisamples. Build a convincing playable prototype first.**
- Phase 1 — The physical instrument: first playable Mbira dzaVadzimu model; tine, pluck,
  resonance, buzz sounding convincing.
- Phase 2 — The instrument interface: premium UI, playable keyboard, engine controls,
  instrument visualization.
- Phase 3 — Hybrid sample engine: integrate friend's recordings, multisample mapping,
  velocity layers, round robins.
- Phase 4 — Advanced sound design: modulation, resonator controls, effects, experimental
  synthesis.
- Phase 5 — VST3 release: optimize CPU, test in Ableton, preset management, polish.

### Section 8 — Three decisions before starting

1. Which instrument first? (DzaVadzimu / Nyunga Nyunga / both with one as prototype)
2. What should physical modelling achieve? (Hybrid-first / Acoustic-first / Experimental-first)
3. Ultimate ambition? (Premium realistic Mbira VST / new synth inspired by Mbira / both)

ChatGPT's personal recommendation: **go with both** — build the dzaVadzimu first, make the
physical modelling genuinely good, use the sampled instrument to bring it to life.

Also: **involve the Zimbabwean friend throughout**, not just for recording — have him
validate tuning, playing behaviour, construction and sound. It's a representation of a real
cultural instrument; authenticity is part of what makes the product special.

---

## MESSAGE 3 — User's decisions

User filled in ChatGPT's decision form:
- **Initial instrument: both**
- **Physical modelling philosophy: realistic**
- **Overall ambition: both**
- Instruction: "Use these decisions to develop the technical architecture and implementation
  specification."

---

## MESSAGE 4 — ChatGPT's Technical Architecture & Implementation Specification

Header: "MBIRA — Technical Architecture & Implementation Specification. Architecture
direction established: VST3 · JUCE · C++". A physically modelled acoustic instrument
platform with dual-engine synthesis architecture.

The three decisions establish three principles:
1. Both DzaVadzimu and Nyunga Nyunga are **first-class instruments**, not presets of one
   generic Mbira.
2. **Acoustic realism comes first** — the physical model must behave like a real instrument
   before experimental synthesis.
3. The product has **two identities**: authentic playable instrument AND expressive
   experimental synthesizer.

This changes one thing: don't make one Mbira model and re-tune it for the second instrument.
Each needs its own physical definition, key geometry, tuning, playing behaviour and
resonator configuration. The DSP engine stays instrument-agnostic so other lamellophones can
be added later without rebuilding.

### 1. Product architecture — three layers

- **LAYER 1 — INSTRUMENT IDENTITY**: DzaVadzimu (independent instrument definition);
  Nyunga Nyunga (independent instrument definition).
- **LAYER 2 — SOUND GENERATION**: Physical engine (mechanical and acoustic modelling);
  Sample engine (recorded acoustic performances); hybrid interaction and blending.
- **LAYER 3 — SOUND DESIGN**: Modulation; Effects; Output.

Architectural rule: instrument definitions, physical model and sample engine must be
**separate modules**. **The UI must never contain the actual sound-generation logic.**

### 2. Physical modelling DSP design

The most important engineering decision. Recommendation: **hybrid modal physical model with
nonlinear excitation and coupled resonators**.

Why modal synthesis: metal tongues of an Mbira are **vibrating beams, not strings**. Want to
simulate each individual tongue's multiple resonant modes.

**2.1 Tine simulation** — each key gets an independent physical model. A simplified damped
modal model:

ẍₘ + 2ζₘωₘẋₘ + ωₘ²xₘ = Fₘ(t)

Where xₘ = displacement of a vibration mode; ωₘ = modal frequency; ζₘ = damping
coefficient; Fₘ(t) = plucking force projected onto that mode.

Each tine contains multiple modes:
| Mode | Purpose |
|---|---|
| Fundamental | Main musical pitch |
| Mode 2 | Upper harmonic character |
| Mode 3 | Metallic brightness |
| Mode 4+ | Subtle timbral detail |

Don't force frequencies to be perfect integer multiples — real metal tongues have
**inharmonic partials**. Initial modal frequencies derived from physical properties (tine
length, width, thickness, material stiffness, boundary conditions), then **calibrated
against real recordings**.

**2.2 Pluck simulation** — finger↔tine interaction. Pluck engine parameters: pluck position,
pluck force, contact stiffness, release behaviour, finger softness, excitation noise.

Velocity influences more than volume:
- **Soft pluck** (low velocity): gentle attack, reduced high-frequency energy, softer
  excitation, longer perceived decay in some configurations.
- **Normal pluck** (medium): natural attack, balanced harmonics, typical response.
- **Hard pluck** (high): stronger excitation, brighter transient, potential nonlinear
  behaviour, more mechanical noise.

These behaviours should be **calibrated against the friend's recordings**, not invented as
arbitrary velocity curves.

**2.3 Soundboard and sympathetic resonance** — this makes the instrument feel alive. A
**shared soundboard model** containing resonant modes. Each tine injects energy into it; it
feeds some energy back into other tines — a **coupled physical system**. Support different
degrees of coupling (depends on actual construction).

**2.4 Deze resonator** — own resonant model: a bank of acoustic resonant modes with
parameters for gourd size, internal cavity resonance, resonance damping,
instrument-to-gourd coupling, acoustic output character. Must sound different when the
Mbira is played **without** the gourd. Distinguish the **soundboard's buzzers** from the
**gourd's rim buzzers** — physically different mechanisms.

**2.5 Buzz mechanism** — deserves its own DSP component. Model loosely attached metal
objects as **nonlinear, vibration-triggered resonators**. Simple first implementation:
threshold-triggered mechanical excitation + damped resonant oscillators + stochastic
micro-impacts + metallic noise components + independent damping and coupling.

**Do NOT just add white noise to the output.** Buzzing must respond to the instrument's
actual vibration: a quiet pluck → subtle shimmer; stronger/sustained passage → much more
obvious mechanical rattle.

### 3. The two instrument definitions

Both instruments get individual **configuration files**. Physical engine loads an instrument
definition rather than hardcoding key count/layout.

| Property | DzaVadzimu | Nyunga Nyunga |
|---|---|---|
| Key configuration | Commonly 22–28 | Commonly 15 |
| Layout | Multiple ranks | Two rows |
| Playing | Two thumbs and right index finger on typical models | Two thumbs |
| Tuning | Instrument-specific heptatonic tunings common | Instrument-specific tuning |
| Soundboard | Hardwood | Construction-specific |
| Resonator | Often deze | Depends on instrument |
| Buzzers | Commonly present | Must be documented per instrument |

These are **starting profiles, not fixed specs** — let the friend identify the actual
instruments he'll record, including precise key layouts and tunings.

Example instrument definition JSON (values illustrative):
```json
{
  "instrument": "mbira_dzavadzimu",
  "version": 1,
  "keyCount": 24,
  "tuning": { "type": "custom", "referenceFrequency": 440.0 },
  "construction": {
    "soundboard": "hardwood",
    "tineMaterial": "steel",
    "resonator": "deze",
    "buzzMechanism": "metal_caps"
  },
  "playingLayout": { "ranks": 3, "supportsMultipleKeys": true }
}
```

Instrument definition should store **per-key**: MIDI note assignment, actual measured pitch,
tine dimensions, fundamental frequency, modal frequency ratios, damping, excitation
sensitivity, sample mapping, playing-hand assignment. This lets two physically different
Mbiras of the same variety each have their own identity.

### 4. Sample engine specification

Treat it as a proper instrument playback system, not a basic audio-file player.

| Feature | Priority |
|---|---|
| Multisample mapping | Essential |
| Velocity layers | Essential |
| Round robin | Essential |
| Per-key sample assignment | Essential |
| Sample start / end | Essential |
| Looping | Optional for initial Mbira recordings |
| Articulation mapping | High |
| Sample variation | High |
| Pitch correction | Essential |
| Stereo sample playback | High |

Use **24-bit WAV recordings at 96 kHz** if the recording setup supports it; convert and
resample internally as needed.

**Recording session with the friend** — send a recording specification first:

A. **Instrument documentation**: exact variety; maker and construction; key count and
layout; tuning and measured pitches; resonator and buzzer configuration.

B. **Individual key recordings**: every key separately; soft, medium and hard plucks;
multiple repeated takes; consistent microphone placement.

C. **Full instrument recordings**: single-note playing; repeated notes; two-note
combinations; chords and overlapping notes; traditional playing patterns.

D. **Acoustic configurations**: without resonator (where possible); inside the deze;
different buzzer configurations if available.

E. **Recording format**: WAV; 24-bit PCM; 96 kHz preferred; no compression, reverb or
processing; consistent gain; documented microphone position.

Recommendation: record some isolated tines with a **contact microphone or piezo pickup** as
well as conventional mics — the contact recording helps study tine vibration; mic recordings
capture the complete acoustic instrument.

**Don't spend the entire recording session collecting velocity layers.** First capture
enough material to build and validate the instrument model.

### 5. Hybrid engine interaction

More sophisticated than simply mixing two audio signals. Three operating modes:

- **Mode A — Independent** (default): both engines play independently with a continuous
  blend control. Best for conventional hybrid sound design.
- **Mode B — Physical enhancement**: the physical model provides additional resonances,
  excitation and mechanical character to the sample engine. Best for making recordings more
  expressive.
- **Mode C — Coupled hybrid**: sample and physical engines share selected excitation and
  resonance information. Best for experimental synthesis and advanced acoustic simulation.

Technical detail: coupled mode should share **control signals and selected resonator
states**, NOT indiscriminately feed final sample audio back into the physical simulation —
control feedback, stability and CPU usage.

**Voice architecture** — each MIDI note creates a voice containing:

```
MbiraVoice
├── Note State
│   ├── MIDI Note
│   ├── Velocity
│   ├── Key Identity
│   └── Playing State
├── Physical Voice
│   ├── Pluck Excitation
│   └── Tine Modes
├── Sample Voice
│   ├── Sample Selection
│   └── Playback State
└── Voice Output
    └── Hybrid Blend
```

The shared soundboard, gourd and buzz mechanisms are **instrument-level components**, not
duplicated per MIDI voice — important for CPU efficiency and realistic interactions between
simultaneously played notes.

### 6. Plugin technology and codebase structure

| | |
|---|---|
| Language | C++20 |
| Framework | JUCE |
| Plugin format | VST3 |
| Interface | Custom JUCE GUI |
| Assets | WAV + JSON |

JUCE supports VST3 and standalone builds (useful for developing independently of a DAW).

**Licensing consideration**: JUCE has AGPLv3 and commercial licensing options — decide which
applies before distributing a proprietary plugin. The Steinberg VST3 SDK itself has an MIT
licensing option.

Proposed repository:

```
MBIRA/
├── CMakeLists.txt
├── README.md
├── Source/
│   ├── Plugin/
│   │   ├── PluginProcessor.cpp / .h
│   │   └── PluginEditor.cpp / .h
│   ├── Instruments/
│   │   ├── InstrumentDefinition.h
│   │   ├── InstrumentManager.h
│   │   ├── DzaVadzimu/
│   │   └── NyungaNyunga/
│   ├── DSP/
│   │   ├── Physical/
│   │   │   ├── TineModel.h
│   │   │   ├── ModalResonator.h
│   │   │   ├── PluckExciter.h
│   │   │   ├── SoundboardModel.h
│   │   │   ├── GourdResonator.h
│   │   │   └── BuzzModel.h
│   │   ├── Sampling/
│   │   │   ├── SampleEngine.h
│   │   │   ├── SampleMapping.h
│   │   │   ├── SampleVoice.h
│   │   │   └── RoundRobin.h
│   │   ├── Hybrid/
│   │   │   ├── HybridEngine.h
│   │   │   └── EngineMixer.h
│   │   ├── Modulation/
│   │   └── Effects/
│   ├── Voices/
│   │   ├── MbiraVoice.h
│   │   └── VoiceManager.h
│   ├── Parameters/
│   │   └── ParameterLayout.h
│   └── UI/
│       ├── MainView/ InstrumentView/ PhysicalView/
│       ├── SampleView/ ResonatorView/ EffectsView/
│       └── Components/
├── Assets/
│   ├── Instruments/ Samples/ Presets/
├── Tests/
│   ├── DSP/ Sampling/ Instruments/ Integration/
└── Documentation/
    ├── DSP_SPEC.md
    ├── RECORDING_SPEC.md
    ├── INSTRUMENT_MODEL.md
    └── UI_SPEC.md
```

Proposed structure — not a requirement to create every file immediately.

**Audio-thread requirements (non-negotiable for a serious plugin):**
- No memory allocation inside the audio callback.
- No file loading inside the audio callback.
- No blocking mutexes.
- Preallocate voice and resonator buffers.
- Load samples asynchronously.
- Smooth parameter changes.
- Handle sample-rate changes.
- Support 44.1, 48, 88.2 and 96 kHz.
- Avoid denormal-related CPU spikes.
- Support stereo output and mono input/output configurations where appropriate.
- Test at 64, 128, 256 and 512 sample buffer sizes.

### 7. UI specification

Five-page layout, first page designed for musicians rather than DSP engineers. Sketch:
header "MBIRA / INSTRUMENT SERIES / PRESET READY", instrument selector (DZA VADZIMU ▾),
preset card ("Nyamaropa — Traditional instrument · Warm acoustic character"), ENGINE BLEND
(PHYSICAL ↔ SAMPLES), macro sliders (Resonance 68%, Buzz 42%, Brightness 55%), page tabs
Play · Physical · Samples · Resonator · FX. Labelled "Illustrative interface direction — the
final design will use real interactive controls."

Page responsibilities:
| Page | Controls |
|---|---|
| Play | Instrument, preset, blend, macros, performance |
| Physical | Tines, pluck, damping, coupling |
| Samples | Mapping, velocity, round robin, articulations |
| Resonator | Wood, deze, buzzers, acoustic response |
| FX | Filters, drive, modulation, delay, reverb |

**Interactive Mbira visualization** feature: keys respond to MIDI input, animate when
played, visually indicate active notes. Eventually users can click individual virtual tines
to audition them and inspect their physical parameters. Much better communication than a
generic knob-filled synth interface.

### 8. Realism validation and testing

Be strict: don't call the physical engine finished just because it produces pleasant plucked
sound. Needs to behave **plausibly compared with the real instrument**. Establish a
reference recording library and repeatable tests.

| Test | What we're checking |
|---|---|
| Isolated tine | Pitch, transient, decay and partials |
| Velocity sweep | Changes in attack and brightness |
| Pluck position | Changes in harmonic structure |
| Repeated notes | Mechanical consistency |
| Simultaneous notes | Shared resonance and interactions |
| Resonator on/off | Acoustic differences |
| Buzz on/off | Mechanical rattle response |
| Sample/model comparison | Timbre and envelope similarity |

Measure: fundamental pitch error; partial frequency differences; decay time; spectral
envelope; attack time; loudness consistency; CPU consumption.

Particularly useful test: record one actual tine and compare its **spectrogram** against the
simulated tine — use that comparison to calibrate the physical model.

The academic literature on discrete-time physical modelling provides the foundation for the
modal, waveguide and finite-difference techniques.

### 9. Development roadmap (milestones with working deliverables, not one giant AI prompt)

- **M0 — Project foundation**: C++20/JUCE/CMake; VST3 and standalone targets; MIDI input;
  basic audio output; parameter architecture; automated test framework. *Acceptance: a
  functioning plugin loads in Ableton and plays a test tone.*
- **M1 — Physical tine prototype**: modal tine simulation; pluck excitation; velocity
  sensitivity; damping; multiple simultaneous tines. *Acceptance: a convincing, tunable,
  playable plucked-metal instrument without samples.*
- **M2 — Full instrument modelling**: instrument definitions; both Mbira layouts;
  soundboard coupling; deze resonator; buzz mechanism. *Acceptance: two distinct playable
  instrument configurations with independently adjustable physical characteristics.*
- **M3 — Sample engine**: multisample playback; key mapping; velocity layers; round robin;
  sample import and management. *Acceptance: the friend's recordings can be loaded and
  played correctly.*
- **M4 — Hybrid engine**: independent blend; physical enhancement; coupled hybrid mode;
  voice management; CPU optimization. *Acceptance: all three hybrid operating modes work
  reliably.*
- **M5 — Premium interface**: custom interface; interactive instrument; five pages;
  presets; modulation and effects. *Acceptance: the plugin feels like a finished commercial
  instrument.*
- **M6 — Validation and release**: recording comparisons; DAW compatibility; CPU profiling;
  state restoration; installer and asset packaging. *Acceptance: stable VST3 release with
  documented instrument authenticity and reproducible presets.*

### 10. Three things NOT to compromise on

1. **Don't fake the physical modelling.** A few resonant filters and a pitch oscillator are
   not a convincing physical model. Need actual per-tine modal behaviour, excitation and
   shared acoustic interactions.
2. **Don't treat both instruments as interchangeable.** Each needs a separately validated
   instrument definition. Preserve tuning differences — don't force every Mbira into
   Western equal temperament.
3. **Don't sacrifice the acoustic instrument for experimental sound design.** Need an
   authentic, minimally processed instrument mode. Experimental synthesis is an extension,
   not a replacement.

### 11. Final architectural recommendation

"MBIRA — Physical Instrument First. Infinite Sound Design Second."

| Decision | Final direction |
|---|---|
| Architecture | Modular hybrid synthesizer |
| DSP foundation | Coupled modal physical modelling |
| Instruments | DzaVadzimu + Nyunga Nyunga |
| Sample engine | Multisample playback |
| Hybrid design | Three operating modes |
| Framework | JUCE / C++20 |
| Format | VST3 |
| UI | Premium custom instrument interface |
| Initial priority | Acoustic authenticity |
| Long-term priority | Experimental synthesis |

**Additional idea — instrument fingerprinting**: eventually recreate an individual physical
Mbira digitally. Record its dimensions, key pitches, modal responses, decay characteristics,
resonator and buzz configuration → create an instrument profile → that profile becomes a
digital representation of that particular instrument rather than a generic Mbira preset.
Could become one of the defining features of the product.

### Next steps proposed by ChatGPT

Before writing full implementation prompts for Claude or Antigravity, establish that the
first physical model is **calibrated against a real instrument**, not designed entirely from
theoretical values. Ask the friend for:
- Photos of both instruments.
- A top-down photo showing every key.
- Key count and tuning information.
- A short isolated-note recording.
- A recording with and without the deze, if available.

Build the first prototype while those recordings are being prepared. Next step: turn the
architecture into a **repo-ready engineering specification** with separate DSP, sample-engine,
UI and testing tasks that coding agents can implement without stepping on each other's work.

**References cited:** Mbira instrument construction — MBIRA.org; Grinnell College Mbira
dzaVadzimu documentation; Discrete-time modelling of musical instruments (IOPscience);
JUCE documentation (GitHub); Steinberg VST3 licensing.

ChatGPT's closing offer: outline implementation steps for physical modelling DSP; design
JSON schema for instrument definitions; detail plugin voice architecture and audio-thread
requirements. Closing line: "I think we have the foundation for something genuinely special
here."
