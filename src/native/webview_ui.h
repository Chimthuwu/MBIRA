// MBIRA WebView2 UI host — plain-COM (MinGW-safe, no WRL/Callback).
// Loads ui/index.html via a virtual-host mapping (works with ES modules + CSP)
// and bridges the allowlisted {v,type,id,payload} messages in both directions.
//
// Threads:
//   - main/UI thread: window + message loop; runs runWebView2() (blocks).
//   - web message handler (COM callback, STA): parses ui->host and calls the
//     injected sinks. Sinks are the same bounded-queue lambdas the GDI UI used,
//     so the JS renderer always runs on the service thread, never here.
//   - WM_TIMER (UI thread): pushes telemetry host->ui at ~30 Hz.
//   - audio thread: only writes peak atomics (never touches the webview).
#pragma once
#include <windows.h>
#include <WebView2.h>
#include <atomic>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <functional>
#include <mutex>
#include <set>
#include <string>

namespace mbira_wv2 {

// Sinks (called on the UI thread). Same contract as mbira_ui::run.
using NoteSink  = std::function<void(int note, bool on)>;
using ParamSink = std::function<void(const std::string& jsExpr)>;
using PeakFn    = std::function<void(float* peakL, float* peakR)>;

static ICoreWebView2*        g_wv = nullptr;
static ICoreWebView2Controller* g_ctl = nullptr;  // MUST be held: releasing it closes the WebView
static HWND                  g_hwnd = nullptr;
static EventRegistrationToken g_wmToken{};
static EventRegistrationToken g_navToken{};
static NoteSink   g_noteSink;
static ParamSink  g_paramSink;
static PeakFn     g_peakFn;
static FILE*      g_log = nullptr;

// MIDI → UI forwarding (host drives UI highlighting). MIDI callback runs on
// the RtMidi thread; the UI thread drains this queue each telemetry tick
// and posts note.state / status via PostWebMessage (STA, UI thread only).
struct WvNoteEvt { int note; bool on; int velocity; };
static std::deque<WvNoteEvt> g_noteQueue;
static std::mutex g_noteMutex;
static std::atomic<bool> g_midiSeen { false };
// UI-thread only: active notes (MIDI + UI clicks) for the voice count.
static std::set<int> g_activeNotes;
static bool g_lastMidiOk = false;
static int g_lastVoices = -1;
static bool g_statusDirty = false;

inline void wvEnqueueNote(int note, bool on, int velocity) {
  std::lock_guard<std::mutex> lk(g_noteMutex);
  if (g_noteQueue.size() < 512) g_noteQueue.push_back({ note, on, velocity });
}
// Instrument geometry envelope (main.cpp builds it in loadInstrumentFromDisk;
// posted to the UI once it reports ui.ready so the tine field renders the
// actual loaded instrument).
static std::string g_instrumentJson;
inline void wvSetInstrument(const std::string& envelope) { g_instrumentJson = envelope; }

inline void wvMarkMidiSeen() { g_midiSeen.store(true); }

static void wvLog(const char* fmt, ...) __attribute__((format(printf,1,2)));
static void wvLog(const char* fmt, ...) {
  if (!g_log) return;
  va_list ap; va_start(ap, fmt);
  vfprintf(g_log, fmt, ap); va_end(ap);
  fflush(g_log);
}

// ---------- ExecuteScript completed ----------
struct ScriptHandler final : public ICoreWebView2ExecuteScriptCompletedHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2ExecuteScriptCompletedHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2ExecuteScriptCompletedHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(HRESULT result, LPCWSTR jsonResult) noexcept override {
    // Dedupe: the 1 Hz probe only logs when page state actually changes.
    static std::wstring last;
    std::wstring cur = jsonResult ? jsonResult : L"(null)";
    if (cur != last) {
      wvLog("[wv2] ExecuteScript hr=0x%08lx %.240ls\n", (unsigned long)result, cur.c_str());
      last = cur;
    }
    return S_OK;
  }
  ScriptHandler() = default;
};

// ---------- Navigation completed ----------
struct NavHandler final : public ICoreWebView2NavigationCompletedEventHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2NavigationCompletedEventHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2NavigationCompletedEventHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) noexcept override {
    BOOL ok = FALSE; if (args) args->get_IsSuccess(&ok);
    wvLog("[wv2] NavigationCompleted success=%d\n", ok ? 1 : 0);
    if (g_wv) g_wv->ExecuteScript(
        L"JSON.stringify({title:document.title, tines:document.querySelectorAll('.tine').length, nav:document.querySelectorAll('.nav button').length})",
        (ICoreWebView2ExecuteScriptCompletedHandler*)new ScriptHandler);
    return S_OK;
  }
  NavHandler() = default;
};

// ---------- Content loading (fires on commit; quick liveness signal) ----------
struct ClHandler final : public ICoreWebView2ContentLoadingEventHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2ContentLoadingEventHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2ContentLoadingEventHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(ICoreWebView2*, ICoreWebView2ContentLoadingEventArgs* args) noexcept override {
    ULONGLONG id = 0; if (args) args->get_NavigationId(&id);
    wvLog("[wv2] ContentLoading navId=%llu\n", (unsigned long long)id);
    return S_OK;
  }
  ClHandler() = default;
};

// ---------- Process failed (THE diagnostic: why the browser/renderer died) ----------
struct PfHandler final : public ICoreWebView2ProcessFailedEventHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2ProcessFailedEventHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2ProcessFailedEventHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args) noexcept override {
    COREWEBVIEW2_PROCESS_FAILED_KIND kind = COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
    if (args) args->get_ProcessFailedKind(&kind);
    wvLog("[wv2] *** ProcessFailed kind=%d (0=bpExited,1=renderExited,2=frameRenderExited,"
          "3=utilityProcessExited,4=sandboxHelperExited=4? ,9=abnormalExit,11=terminated,12=launchFailed)\n", (int)kind);
    return S_OK;
  }
  PfHandler() = default;
};

// ---------- Web message received (ui -> host) ----------
static void handleUiMessage(const wchar_t* json);

struct WmHandler final : public ICoreWebView2WebMessageReceivedEventHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2WebMessageReceivedEventHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2WebMessageReceivedEventHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) noexcept override {
    LPWSTR json = nullptr;
    if (args) args->get_WebMessageAsJson(&json);
    if (json) { handleUiMessage(json); CoTaskMemFree(json); }
    return S_OK;
  }
  WmHandler() = default;
};

// ---------- Controller created ----------
struct CtrlHandler final : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
  ULONG refs = 1;
  const wchar_t* endpointHost;
  const wchar_t* uiDir;
  explicit CtrlHandler(const wchar_t* h, const wchar_t* u) : endpointHost(h), uiDir(u) {}
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(HRESULT, ICoreWebView2Controller* ctl) noexcept override {
    if (!ctl) return S_OK;
    ctl->AddRef();                    // keep controller alive for the app's lifetime
    g_ctl = ctl;
    RECT rc{}; if (g_hwnd) GetClientRect(g_hwnd, &rc);
    ctl->put_Bounds(rc);              // a 0x0 bounds renders a blank window
    ctl->put_IsVisible(TRUE);
    ICoreWebView2_3* w3 = nullptr;
    ctl->get_CoreWebView2(&g_wv);
    if (g_wv) g_wv->QueryInterface(IID_ICoreWebView2_3, (void**)&w3);
    if (w3) {
      w3->SetVirtualHostNameToFolderMapping(endpointHost, uiDir, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
      w3->Release();
    }
    if (g_wv) {
      g_wv->add_WebMessageReceived(new WmHandler, &g_wmToken);
      g_wv->add_NavigationCompleted(new NavHandler, &g_navToken);
      static EventRegistrationToken g_clToken{}, g_pfToken{};
      g_wv->add_ContentLoading(new ClHandler, &g_clToken);
      g_wv->add_ProcessFailed(new PfHandler, &g_pfToken);
      std::wstring url = L"https://";
      url += endpointHost; url += L"/index.html";
      g_wv->Navigate(url.c_str());
      wvLog("[wv2] navigating to %ls\n", url.c_str());
    }
    if (ctl) ctl->put_IsVisible(TRUE);
    return S_OK;
  }
};

// ---------- Environment created ----------
struct EnvHandler final : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
  ULONG refs = 1;
  const wchar_t* endpointHost;
  const wchar_t* uiDir;
  HWND parent;
  EnvHandler(HWND h, const wchar_t* ep, const wchar_t* udir) : endpointHost(ep), uiDir(udir), parent(h) {}
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(HRESULT, ICoreWebView2Environment* env) noexcept override {
    if (!env) return S_OK;
    env->CreateCoreWebView2Controller(parent, new CtrlHandler(endpointHost, uiDir));
    return S_OK;
  }
};

// Parse a ui->host envelope {v,type,id,payload}. Only the allowlisted types act.
static bool parseDouble(const wchar_t* field, const wchar_t* json, double* out) {
  // crude JSON string-number scan: search field name then parse first number
  *out = 0.0;
  if (!json) return false;
  const wchar_t* f = wcsstr(json, field);
  if (!f) return false;
  const wchar_t* colon = wcschr(f, L':');
  if (!colon) return false;
  colon++;
  while (*colon == L' ' || *colon == L'\t') colon++;
  if (*colon == L'"') return false; // not a number
  *out = wcstod(colon, nullptr);
  return true;
}
// Extract a JSON string value: field is the key INCLUDING quotes, e.g. L"\"path\"".
static bool parseStr(const wchar_t* field, const wchar_t* json, std::wstring& out) {
  if (!json) return false;
  const wchar_t* f = wcsstr(json, field);
  if (!f) return false;
  const wchar_t* colon = wcschr(f, L':');
  if (!colon) return false;
  const wchar_t* q = wcschr(colon, L'"');
  if (!q) return false;
  ++q;
  const wchar_t* end = wcschr(q, L'"');
  if (!end) return false;
  out.assign(q, end - q);
  return !out.empty();
}
// Exactly the names src/dsp/index.js setParam() accepts. Anything else the UI
// may send (blend/fx/layers/mode) is provisional: shown in the UI, no DSP yet.
static bool dspAccepts(const std::wstring& p) {
  static const wchar_t* k[] = { L"master", L"pluckPos", L"soundboard", L"gourdAmount",
    L"gourdFreq", L"buzzIntensity", L"buzzChar", L"adsr.attack", L"adsr.release",
    L"adsr.sustain", L"lfo.rate", L"mod.lfoToMaster", L"mod.lfoToPitch",
    L"random.amount", L"vel.amp", L"vel.bright", L"macro.resonance",
    L"macro.buzz", L"macro.brightness" };
  for (const wchar_t* s : k) if (p == s) return true;
  return false;
}

static bool fieldContains(const wchar_t* field, const wchar_t* json, const wchar_t* needle) {
  const wchar_t* f = wcsstr(json, field);
  if (!f) return false;
  return wcsstr(f, needle) != nullptr;
}

inline bool wvHostReady();
inline void wvSendHost(const wchar_t* json);   // defined below (used in ui.ready)

static void handleUiMessage(const wchar_t* json) {
  wchar_t sharp[240]; swprintf(sharp, 240, L"%.220ls", json);
  wvLog("[wv2 ui->host] %ls\n", sharp);
  // type
  if (wcsstr(json, L"\"type\":\"param.set\"")) {
      // Bridge contract: {v,type,id:seq,payload:{path,value}} — path lives in payload.path.
      std::wstring path;
      if (!parseStr(L"\"path\"", json, path)) {
        wvLog("[wv2] param.set without payload.path — ignored\n");
      } else if (!dspAccepts(path)) {
        // Provisional control: visible in the UI, not wired into the DSP yet.
        static std::set<std::wstring> warned;
        if (warned.insert(path).second)
          wvLog("[wv2] provisional (no DSP mapping yet, UI-only): %ls\n", path.c_str());
      } else {
        double v = 0; parseDouble(L"\"value\"", json, &v);
        char buf[64]; snprintf(buf, sizeof buf, "%.4f)", v);
        std::string expr = std::string("__mbira.setParam('") +
                           std::string(path.begin(), path.end()) + "'," + buf;
        if (g_paramSink) g_paramSink(expr);
      }
    } else if (wcsstr(json, L"\"type\":\"note.on\"")) {
    double n = 0; parseDouble(L"\"note\"", json, &n);
    double vel = 100; parseDouble(L"\"vel\"", json, &vel);
    if (g_noteSink) g_noteSink((int)n, true);
    g_activeNotes.insert((int)n); g_statusDirty = true; // track UI clicks in voice count
    (void) vel;
  } else if (wcsstr(json, L"\"type\":\"note.off\"")) {
    double n = 0; parseDouble(L"\"note\"", json, &n);
    if (g_noteSink) g_noteSink((int)n, false);
    g_activeNotes.erase((int)n); g_statusDirty = true;
  } else if (wcsstr(json, L"\"type\":\"panic\"")) {
    if (g_paramSink) g_paramSink("__mbira.allNotesDamp()");
    g_activeNotes.clear();
    { std::lock_guard<std::mutex> lk(g_noteMutex); g_noteQueue.clear(); }
    g_statusDirty = true;
  } else if (wcsstr(json, L"\"type\":\"ui.ready\"")) {
    // UI is up: give it the loaded instrument so the tine field matches.
    if (!g_instrumentJson.empty()) {
      int n = MultiByteToWideChar(CP_UTF8, 0, g_instrumentJson.c_str(), -1, nullptr, 0);
      if (n > 0) {
        std::wstring w((size_t) n, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, g_instrumentJson.c_str(), -1, &w[0], n);
        wvLog("[wv2] posting instrument to UI\n");
        wvSendHost(w.c_str());
      }
    }
  } else if (fieldContains(L"\"type\"", json, L"preset") ||
             fieldContains(L"\"type\"", json, L"instrument") || wcsstr(json, L"\"type\":\"note.state\"")) {
    // informational; ignore (no-op)
  }
}

// Host->ui telemetry + param echo helpers (call on UI thread).
inline bool wvHostReady() { return g_wv != nullptr; }
inline void wvSendHost(const wchar_t* json) { if (g_wv) g_wv->PostWebMessageAsJson(json); }

// Main entry: blocks on the message loop until the window closes. Mirrors
// mbira_ui::run(). uiDir passed as UTF-8; converted to wide internally.
inline int runWebView2(NoteSink noteSink, ParamSink paramSink, PeakFn peakFn,
                       const std::string& uiDirUtf8, const std::string& userDataUtf8,
                       const std::string& logPathUtf8, bool enableCdp = false) {
  if (g_log) fclose(g_log);
  g_log = fopen(logPathUtf8.c_str(), "w");
  if (!g_log) g_log = fopen("NUL", "w");
  g_noteSink = std::move(noteSink);
  g_paramSink = std::move(paramSink);
  g_peakFn = std::move(peakFn);
  g_wv = nullptr;
  { std::lock_guard<std::mutex> lk(g_noteMutex); g_noteQueue.clear(); }
  g_activeNotes.clear();
  g_midiSeen.store(false); g_lastMidiOk = false; g_lastVoices = -1; g_statusDirty = false;

  // utf8 -> wide
  auto widen = [](const std::string& s, std::wstring& out) {
    out.clear();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    if (n > 0) { out.resize(n); MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &out[0], n); }
  };
  std::wstring uiDir, userData;
  widen(uiDirUtf8, uiDir); widen(userDataUtf8, userData);

  if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof wc; wc.lpfnWndProc = [](HWND h, UINT m, WPARAM wp, LPARAM lp) -> LRESULT {
    if (m == WM_SIZE && g_ctl) {     // keep the WebView filling the window
      RECT rc{}; GetClientRect(h, &rc);
      g_ctl->put_Bounds(rc);
      return 0;
    }
    if (m == WM_TIMER && wp == 3) {  // 1 Hz liveness probe — independent of nav events
      if (g_wv) g_wv->ExecuteScript(
          L"JSON.stringify({rs:document.readyState,href:location.href,"
          L"title:document.title,tines:document.querySelectorAll('.tine').length,"
          L"chrome:!!(window.chrome&&window.chrome.webview)})"
          , (ICoreWebView2ExecuteScriptCompletedHandler*)new ScriptHandler);
      return 0;
    }
    if (m == WM_TIMER && wp == 2) {  // telemetry tick (30 Hz)
      if (g_peakFn && g_wv) {
        float L = 0, R = 0; g_peakFn(&L, &R);
        wchar_t j[160]; swprintf(j, 160, L"{\"v\":1,\"type\":\"telemetry\",\"payload\":{\"peakL\":%.3f,\"peakR\":%.3f}}", (double)L, (double)R);
        g_wv->PostWebMessageAsJson(j);
      }
      // Drain MIDI note queue → note.state (tine highlighting) + status.
      if (g_wv) {
        std::deque<WvNoteEvt> batch;
        { std::lock_guard<std::mutex> lk(g_noteMutex); batch.swap(g_noteQueue); }
        bool voicesChanged = false;
        for (auto& e : batch) {
          if (e.on) { if (!g_activeNotes.count(e.note)) { g_activeNotes.insert(e.note); voicesChanged = true; } }
          else { if (g_activeNotes.erase(e.note) > 0) voicesChanged = true; }
          wchar_t j[192];
          swprintf(j, 192, L"{\"v\":1,\"type\":\"note.state\",\"payload\":{\"note\":%d,\"on\":%ls,\"velocity\":%d}}",
                   e.note, e.on ? L"true" : L"false", e.velocity);
          g_wv->PostWebMessageAsJson(j);
        }
        bool midiOk = g_midiSeen.load();
        if (voicesChanged) g_statusDirty = true;
        if (midiOk != g_lastMidiOk) { g_lastMidiOk = midiOk; g_statusDirty = true; }
        int voices = (int)g_activeNotes.size();
        if ((g_statusDirty && (midiOk || voices != 0)) || (voices != g_lastVoices && (midiOk || voices != 0))) {
          wchar_t j[192];
          swprintf(j, 192, L"{\"v\":1,\"type\":\"status\",\"payload\":{\"midi\":\"%ls\",\"voices\":%d}}",
                   midiOk ? L"ok" : L"unverified", voices);
          g_wv->PostWebMessageAsJson(j);
          g_lastVoices = voices; g_statusDirty = false;
        } else if (g_statusDirty && !midiOk && voices == 0) { g_statusDirty = false; }
      }
      return 0;
    }
    if (m == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(h, m, wp, lp);
  };
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"MbiraWebView2Host";
  RegisterClassExW(&wc);
  HWND win = CreateWindowExW(0, L"MbiraWebView2Host", L"MBIRA", WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT, CW_USEDEFAULT, 860, 640, nullptr, nullptr, wc.hInstance, nullptr);
  if (!win) { CoUninitialize(); return 1; }
  ShowWindow(win, SW_SHOW);
  g_hwnd = win;  // controller bounds are computed from this client rect

  const wchar_t* host = L"mbira.local";
  // CDP for debugging is enabled via the documented env var (avoids needing
  // CLSID_CoreWebView2EnvironmentOptions, which the header does not define
  // without WRL and which MinGW lacks).
  if (enableCdp) {
    SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", L"--remote-debugging-port=9226");
  }
  HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, userData.empty() ? nullptr : userData.c_str(), nullptr, new EnvHandler(win, host, uiDir.c_str()));
  if (FAILED(hr)) {
    wvLog("[wv2] env create failed 0x%08lx\n", (unsigned long)hr);
    DestroyWindow(win); CoUninitialize(); return 1;
  }

  SetTimer(win, 2, 33, nullptr);  // 30 Hz telemetry
  SetTimer(win, 3, 1000, nullptr);  // 1 Hz page liveness probe
  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  if (g_wv) g_wv->Release();  // best-effort; app is exiting
  KillTimer(win, 2);
  DestroyWindow(win);
  CoUninitialize();
  if (g_log) { fclose(g_log); g_log = nullptr; }
  return 0;
}

} // namespace mbira_wv2
