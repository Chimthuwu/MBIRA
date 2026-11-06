// MBIRA VST3 — processor + edit controller + plugin factory entry.
//
// Minimal Steinberg VST3 instrument ("spike" quality): one stereo output bus,
// one event input bus, no editor, no parameters. Note on/off events from the
// host are queued to a service thread that runs the JS DSP bundle (same
// architecture as the standalone host's live mode); the audio path calls
// elem::Runtime<float>::process() only.
#include "mbira_cids.h"
#include "mbira_engine.h"
#include "dsp_bundle.h"

#include "public.sdk/source/main/pluginfactory.h"
#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"

#include <chrono>

using namespace Steinberg;
using namespace Steinberg::Vst;

#define MBIRA_TRACE() (getenv("MBIRA_TRACE") != nullptr)

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
    if (data.inputParameterChanges) { /* no automatable params yet */ }

    // Queue note events for the service thread (never run JS on audio thread).
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
// Edit controller (no editor, no parameters)

class MbiraController : public EditController {
public:
  static FUnknown* createInstance (void*) { return (IEditController*) new MbiraController; }
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
