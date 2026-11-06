// MBIRA VST3 spike — offline smoke test host.
// Loads the built MBIRA.vst3 DLL directly (no full hosting layer), creates the
// component, sends a note-on, processes audio and asserts a non-silent output.
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "public.sdk/source/vst/hosting/eventlist.h"

#include <windows.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;

typedef IPluginFactory* (PLUGIN_API* GetPluginFactoryFunc) ();

int main (int argc, char** argv) {
  const char* dllPath = argc > 1 ? argv[1] : "build-vst3/vst3/MBIRA.vst3/Contents/x86_64-win/MBIRA.vst3";
  HMODULE mod = LoadLibraryA (dllPath);
  if (!mod) { fprintf (stderr, "FAIL: LoadLibraryA(%s) err=%lu\n", dllPath, GetLastError ()); return 1; }
  auto getFactory = (GetPluginFactoryFunc) GetProcAddress (mod, "GetPluginFactory");
  if (!getFactory) { fprintf (stderr, "FAIL: no GetPluginFactory export\n"); return 1; }

  IPluginFactory* factory = getFactory ();
  if (!factory) { fprintf (stderr, "FAIL: GetPluginFactory returned null\n"); return 1; }
  fprintf (stderr, "factory: classes=%d\n", factory->countClasses ());

  IComponent* comp = nullptr;
  IEditController* ctrl = nullptr;
  for (int32 i = 0; i < factory->countClasses (); ++i) {
    PClassInfo ci;
    if (factory->getClassInfo (i, &ci) != kResultOk) continue;
    FUnknown* inst = nullptr;
    if (factory->createInstance (ci.cid, IComponent::iid, (void**) &inst) == kResultOk && inst) {
      comp = (IComponent*) inst;
      fprintf (stderr, "component: name='%s' category='%s'\n", ci.name, ci.category);
    } else if (factory->createInstance (ci.cid, IEditController::iid, (void**) &inst) == kResultOk && inst) {
      ctrl = (IEditController*) inst;
      fprintf (stderr, "controller: name='%s'\n", ci.name);
    }
  }
  if (!comp || !ctrl) { fprintf (stderr, "FAIL: could not create component/controller\n"); return 1; }

  if (comp->initialize (nullptr) != kResultOk) { fprintf (stderr, "FAIL: component initialize\n"); return 1; }
  if (ctrl->initialize (nullptr) != kResultOk) { fprintf (stderr, "FAIL: controller initialize\n"); return 1; }
  ctrl->setComponentState (nullptr); // flush (no state)

  TUID ctrlCid {};
  if (comp->getControllerClassId (ctrlCid) != kResultTrue) { fprintf (stderr, "FAIL: controllerClassId\n"); return 1; }

  IAudioProcessor* proc = nullptr;
  comp->queryInterface (IAudioProcessor::iid, (void**) &proc);
  if (!proc) { fprintf (stderr, "FAIL: no IAudioProcessor\n"); return 1; }

  ProcessSetup setup { kRealtime, kSample32, 256, 48000.0 };
  if (proc->setupProcessing (setup) != kResultOk) { fprintf (stderr, "FAIL: setupProcessing\n"); return 1; }
  if (comp->setActive (true) != kResultOk) { fprintf (stderr, "FAIL: setActive(true)\n"); return 1; }
  if (proc->setProcessing (true) != kResultOk && proc->setProcessing (true) != kNotImplemented)
    { fprintf (stderr, "FAIL: setProcessing(true)\n"); return 1; }

  // process loop: note-on at block 0, render ~1 s, expect non-silent output
  const int32 block = 256, blocks = 48000 / block;
  std::vector<float> planes (2 * block, 0.f);
  double peak = 0.0;
  for (int32 b = 0; b < blocks; ++b) {
    ProcessData data {};
    ProcessContext ctx {};
    ctx.sampleRate = 48000.0;
    data.processContext = &ctx;
    data.numSamples = block;
    data.numInputs = 0; data.numOutputs = 1;
    AudioBusBuffers out {};
    out.numChannels = 2;
    float* chans[2] { planes.data (), planes.data () + block };
    out.channelBuffers32 = chans;
    data.outputs = &out;

    if (b == 0) {
      EventList events;
      Event ev {};
      ev.busIndex = 0; ev.sampleOffset = 0; ev.ppqPosition = 0; ev.flags = 0;
      ev.type = Event::kNoteOnEvent;
      ev.noteOn.channel = 0; ev.noteOn.pitch = 64; ev.noteOn.velocity = 100.f / 127.f;
      events.addEvent (ev);
      data.inputEvents = &events;
    }

    if (proc->process (data) != kResultOk) { fprintf (stderr, "FAIL: process\n"); return 1; }
    if (b > 3) // allow a few blocks for the JS service thread to apply the note
      for (int32 i = 0; i < block; ++i)
        peak = std::max (peak, (double) std::fabs (chans[0][i]));
  }

  proc->setProcessing (false);
  comp->setActive (false);
  proc->release ();
  comp->terminate ();
  ctrl->terminate ();
  comp->release (); ctrl->release ();
  factory->release ();
  FreeLibrary (mod);

  double dbfs = 20.0 * std::log10 (peak > 1e-9 ? peak : 1e-9);
  printf ("{\"smoke\":\"vst3\",\"peak\":%.6f,\"peak_dbfs\":%.2f,\"ok\":%s}\n",
          peak, dbfs, peak > 1e-3 ? "true" : "false");
  return peak > 1e-3 ? 0 : 1;
}
