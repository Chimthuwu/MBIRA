// MBIRA VST3 — offline smoke test host.
// Loads the built MBIRA.vst3 DLL directly (no full hosting layer), creates the
// component, sends a note-on, processes audio and asserts a non-silent output.
// Also switches instruments mid-run (Instrument parameter change + a new note-on)
// to exercise the LoadInstrument path end-to-end.
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"

#include <windows.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;

typedef IPluginFactory* (PLUGIN_API* GetPluginFactoryFunc) ();

// Instrument parameter id — must match MbiraPlugin.cpp (0 = dzaVadzimu, 1 = nyunga-nyunga).
static const Vst::ParamID kInstParam = 1001;

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

  // process loop: note-on at block 0 (dzaVadzimu), switch instrument at
  // switchBlock, new note-on at reNoteBlock (nyunga-nyunga). Peak per phase is
  // measured and both must be non-silent.
  const int32 block = 256, blocks = 48000 / block;
  const int32 switchBlock = 100, reNoteBlock = 101;
  std::vector<float> planes (2 * block, 0.f);
  double peakDza = 0.0, peakNyunga = 0.0;
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

    ParameterChanges pc (1);
    if (b == switchBlock) {
      int32 idx = 0;
      IParamValueQueue* q = pc.addParameterData (kInstParam, idx);
      if (q) q->addPoint (0, 1.0, idx);
      data.inputParameterChanges = &pc;
    }

    if (b == 5) {  // early dza note: stresses the startup-load/race fix
      EventList events;
      Event ev {};
      ev.busIndex = 0; ev.sampleOffset = 0; ev.ppqPosition = 0; ev.flags = 0;
      ev.type = Event::kNoteOnEvent;
      ev.noteOn.channel = 0; ev.noteOn.pitch = 64; ev.noteOn.velocity = 100.f / 127.f;
      events.addEvent (ev);
      data.inputEvents = &events;
    }
    if (b == reNoteBlock) {
      EventList events;
      Event ev {};
      ev.busIndex = 0; ev.sampleOffset = 0; ev.ppqPosition = 0; ev.flags = 0;
      ev.type = Event::kNoteOnEvent;
      ev.noteOn.channel = 0; ev.noteOn.pitch = 72; ev.noteOn.velocity = 100.f / 127.f;
      events.addEvent (ev);
      data.inputEvents = &events;
    }

    if (proc->process (data) != kResultOk) { fprintf (stderr, "FAIL: process\n"); return 1; }
    if (b > 10 && b < switchBlock)
      for (int32 i = 0; i < block; ++i) peakDza = std::max (peakDza, (double) std::fabs (chans[0][i]));
    if (b > reNoteBlock + 3)
      for (int32 i = 0; i < block; ++i) peakNyunga = std::max (peakNyunga, (double) std::fabs (chans[0][i]));
  }

  proc->setProcessing (false);
  comp->setActive (false);
  proc->release ();
  comp->terminate ();
  ctrl->terminate ();
  comp->release (); ctrl->release ();
  factory->release ();
  FreeLibrary (mod);

  double dbfsD = 20.0 * std::log10 (peakDza > 1e-9 ? peakDza : 1e-9);
  double dbfsN = 20.0 * std::log10 (peakNyunga > 1e-9 ? peakNyunga : 1e-9);
  bool ok = (peakDza > 1e-3) && (peakNyunga > 1e-3);
  printf ("{\"smoke\":\"vst3\",\"peak_dza\":%.6f,\"peak_dza_dbfs\":%.2f,\"peak_nyunga\":%.6f,\"peak_nyunga_dbfs\":%.2f,\"ok\":%s}\n",
          peakDza, dbfsD, peakNyunga, dbfsN, ok ? "true" : "false");
  return ok ? 0 : 1;
}
