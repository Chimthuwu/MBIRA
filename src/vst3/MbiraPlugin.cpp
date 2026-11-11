// MBIRA VST3 — processor + edit controller + plugin factory entry.
//
// Minimal Steinberg VST3 instrument: one stereo output bus, one event input
// bus, no editor. Host note on/off + instrument switches are pushed to a
// thread-safe queue in process() and evaluated on the AUDIO thread (before
// rendering) via EventBridge::drain(). All JS DSP work therefore runs on the
// audio thread alongside elem::Runtime<float>::process() — this avoids touching
// the choc QuickJS context / elem graph from two threads (which silently dropped
// voices).
//
// An "Instrument" parameter (0 = dzaVadzimu, 1 = nyunga-nyunga) lets the host
// switch the loaded instrument; the processor reads it in process() and pushes a
// LoadInstrument event (mirrors the standalone's instrument.select path). The two
// instruments are embedded in the binary, so no filesystem access is required.
#include "mbira_cids.h"
#include "mbira_engine.h"
#include "dsp_bundle.h"

#include "public.sdk/source/main/pluginfactory.h"
#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"

#include <chrono>

using namespace Steinberg;
using namespace Steinberg::Vst;

#define MBIRA_TRACE() (getenv("MBIRA_TRACE") != nullptr)

// Instrument parameter id. 0 = dzaVadzimu (default), 1 = nyunga-nyunga.
static const Vst::ParamID kInstrumentParamId = 1001;

// ---------------------------------------------------------------------------
// Processor

class MbiraProcessor : public AudioEffect {
public:
  static FUnknown* createInstance (void*) { return (IAudioProcessor*) new MbiraProcessor; }

  MbiraProcessor () {
    setControllerClass (kMbiraControllerUID);
  }
  ~MbiraProcessor () override { teardownEngine (); }

  tresult PLUGIN_API initialize (FUnknown* context) override {
    if (AudioEffect::initialize (context) != kResultOk) return kResultFalse;
    addAudioOutput (STR16 ("Stereo Out"), SpeakerArr::kStereo);
    addEventInput (STR16 ("Event In"), 1);
    return kResultOk;
  }

  tresult PLUGIN_API terminate () override {
    teardownEngine ();
    return AudioEffect::terminate ();
  }

  tresult PLUGIN_API setActive (TBool state) override {
    if (state) {
      if (!ensureEngine ()) return kResultFalse;
      bridge.start (engine.get ());
    } else {
      bridge.stop ();
    }
    return AudioEffect::setActive (state);
  }

  tresult PLUGIN_API setupProcessing (ProcessSetup& newSetup) override {
    if (newSetup.symbolicSampleSize != kSample32) return kResultFalse;
    processSetup.sampleRate = newSetup.sampleRate;
    processSetup.maxSamplesPerBlock = newSetup.maxSamplesPerBlock;    processSetup.symbolicSampleSize = kSample32;
    // Engine already built with this SR/BS? else rebuild on next activate.
    if (engine && (engine->sampleRate != newSetup.sampleRate ||
                   (int) engine->blockSize != newSetup.maxSamplesPerBlock))
      teardownEngine ();
    return kResultOk;
  }

  tresult PLUGIN_API canProcessSampleSize (int32 symbolicSampleSize) override {
    return symbolicSampleSize == kSample32 ? kResultTrue : kResultFalse;
  }

  tresult PLUGIN_API process (ProcessData& data) override {
    if (!engine) return kResultFalse;

    // Instrument-parameter automation: push a LoadInstrument event so the audio
    // thread swaps the loaded instrument (mirrors instrument.select).
    if (data.inputParameterChanges) {
      int32 nParams = data.inputParameterChanges->getParameterCount ();
      for (int32 pi = 0; pi < nParams; ++pi) {
        auto* pq = data.inputParameterChanges->getParameterData (pi);
        if (!pq) continue;
        int32 nPoints = pq->getPointCount ();
        if (nPoints <= 0) continue;
        Vst::ParamValue v = 0.0; int32 off = 0;
        if (pq->getPoint (nPoints - 1, off, v) == kResultOk &&
            pq->getParameterId () == kInstrumentParamId) {
          MbiraEvent ev; ev.kind = MbiraEvent::LoadInstrument;
          ev.text = (v < 0.5) ? getMbiraDzaJson () : getMbiraNyungaJson ();
          bridge.push (ev);
        }
      }
    }

    // Queue note events for the audio-thread drain (JS runs on the audio thread).
    if (data.inputEvents) {
      int32 n = data.inputEvents->getEventCount ();
      for (int32 i = 0; i < n; ++i) {
        MbiraEvent ev;
        Vst::Event e;
        if (data.inputEvents->getEvent (i, e) != kResultOk) continue;
        if (e.type == Event::kNoteOnEvent && e.noteOn.velocity > 0.f) {
          ev.kind = MbiraEvent::NoteOn; ev.note = e.noteOn.pitch; ev.vel = (int) (e.noteOn.velocity * 127.f + 0.5f);
          bridge.push (ev);
        } else if (e.type == Event::kNoteOffEvent ||
                   (e.type == Event::kNoteOnEvent && e.noteOn.velocity == 0.f)) {
          ev.kind = MbiraEvent::NoteOff; ev.note = e.type == Event::kNoteOffEvent ? e.noteOff.pitch : e.noteOn.pitch;
          bridge.push (ev);
        }
      }
    }

    // Drain queued host events (note on/off, instrument switches) and evaluate
    // them on the AUDIO thread, so all JS graph work happens on the same thread
    // that renders. Must run before processAudio().
    bridge.drain (engine.get ());

    const int32 numFrames = data.numSamples;
    if (numFrames <= 0) return kResultOk;
    auto* outs = data.outputs;
    if (!outs || outs->numChannels <= 0) return kResultOk;

    const size_t nch = (size_t) std::min (outs->numChannels, 2);
    // deinterleave into scratch planes, render, interleave back
    planesScratch.assign (nch * (size_t) numFrames, 0.0f);
    float* chans[2] { planesScratch.data (), planesScratch.data () + numFrames };
    engine->processAudio (chans, nch, (size_t) numFrames);

    for (int32 c = 0; c < outs->numChannels; ++c) {
      float* dst = outs->channelBuffers32[c];
      if ((size_t) c < nch) {
        const float* src = planesScratch.data () + (size_t) c * (size_t) numFrames;
        memcpy (dst, src, sizeof (float) * numFrames);
      } else {
        memset (dst, 0, sizeof (float) * numFrames);
      }
    }
    return kResultOk;
  }

  tresult PLUGIN_API getState (IBStream*) override { return kNotImplemented; }
  tresult PLUGIN_API setState (IBStream*) override { return kNotImplemented; }
  uint32 PLUGIN_API getTailSamples () override { return kNoTail; }

private:
  bool ensureEngine () {
    if (engine) return true;
    double sr = processSetup.sampleRate > 0 ? processSetup.sampleRate : 48000.0;
    int32 bs = processSetup.maxSamplesPerBlock > 0 ? processSetup.maxSamplesPerBlock : 256;
    engine = std::make_unique<Engine> (sr, (int) bs);
    if (!engine->loadBundleFromString (getMbiraBundleJs ())) {
      fprintf (stderr, "[mbira-vst3] ERROR: %s\n", engine->lastError.c_str ());
      engine.reset ();
      return false;
    }
    // Queue the embedded default instrument (dzaVadzimu) to the bridge, exactly
    // like a runtime instrument switch. It is evaluated on the audio thread in
    // the first process()'s drain(), ahead of any note-on, so the voice pool is
    // always rebuilt before the first note strikes.
    {
      MbiraEvent ev; ev.kind = MbiraEvent::LoadInstrument; ev.text = getMbiraDzaJson ();
      bridge.push (ev);
    }
    if (MBIRA_TRACE ()) fprintf (stderr, "[mbira-vst3] engine up: sr=%.0f bs=%d\n", sr, (int) bs);
    return true;
  }

  void teardownEngine () {
    bridge.stop ();
    engine.reset ();
  }

  std::unique_ptr<Engine> engine;
  EventBridge bridge;
  std::vector<float> planesScratch;
  ProcessSetup processSetup {};
};

// ---------------------------------------------------------------------------
// Edit controller (no editor; owns the Instrument parameter)

class MbiraController : public EditController {
public:
  static FUnknown* createInstance (void*) { return (IEditController*) new MbiraController; }

  tresult PLUGIN_API initialize (FUnknown* context) override {
    if (EditController::initialize (context) != kResultOk) return kResultFalse;
    parameters.addParameter (STR16 ("Instrument"), STR16 ("Inst"), 1, 0.0,
                             Vst::ParameterInfo::kCanAutomate, kInstrumentParamId);
    return kResultOk;
  }

  tresult PLUGIN_API getParameterInfo (int32 paramIndex, Vst::ParameterInfo& info) override {
    if (paramIndex == 0) {
      memset (&info, 0, sizeof (info));
      info.id = kInstrumentParamId;
      info.flags = Vst::ParameterInfo::kCanAutomate;
      info.defaultNormalizedValue = 0.0;
      info.stepCount = 1;  // 2 discrete values: 0 = dzaVadzimu, 1 = nyunga-nyunga
      strcpy16 (info.title, STR16 ("Instrument"));
      strcpy16 (info.shortTitle, STR16 ("Inst"));
      return kResultOk;
    }
    return kResultFalse;
  }

  tresult PLUGIN_API getParamStringByValue (Vst::ParamID id, Vst::ParamValue value, Vst::String128 string) override {
    if (id == kInstrumentParamId) {
      strcpy16 (string, value < 0.5 ? STR16 ("dzaVadzimu") : STR16 ("nyunga-nyunga"));
      return kResultOk;
    }
    return kResultFalse;
  }
};

// ---------------------------------------------------------------------------
// Plugin factory

BEGIN_FACTORY_DEF ("MBIRA", "https://github.com/mbira", "mailto:mbira@example.com")

DEF_CLASS2 (INLINE_UID_FROM_FUID (kMbiraProcessorUID),
            PClassInfo::kManyInstances,
            kVstAudioEffectClass,
            "MBIRA",
            Vst::kDistributable,
            "Instrument|Synth",
            "1.0.0",
            kVstVersionString,
            MbiraProcessor::createInstance)

DEF_CLASS2 (INLINE_UID_FROM_FUID (kMbiraControllerUID),
            PClassInfo::kManyInstances,
            kVstComponentControllerClass,
            "MBIRA Controller",
            0,
            "",
            "1.0.0",
            kVstVersionString,
            MbiraController::createInstance)

END_FACTORY
