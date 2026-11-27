// MBIRA WebView2 verification spike — proves ui/ loads and the bridge works.
#include <windows.h>
#include <WebView2.h>
#include <string>
#include <cstdio>
#include <cstdlib>

static ICoreWebView2*        g_wv = nullptr;
static ICoreWebView2_3*      g_wv3 = nullptr;
static EventRegistrationToken g_wmToken{};
static EventRegistrationToken g_navToken{};
static HWND                  g_main = nullptr;

// ---- ExecuteScript completed: dump JSON ----
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
    fprintf(stderr, "[verify] ExecuteScript hr=0x%08lx result=%.500ls\n",
            (unsigned long)result, jsonResult ? jsonResult : L"(null)");
    fflush(stderr);
    return S_OK;
  }
  ScriptHandler() = default;
};

// ---- Navigation completed: fire the DOM probe + a host->ui telemetry push ----
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
    fprintf(stderr, "[verify] NavigationCompleted success=%d\n", ok ? 1 : 0);
    if (g_wv) g_wv->ExecuteScript(
        L"JSON.stringify({title:document.title, tines:document.querySelectorAll('.tine').length, nav:document.querySelectorAll('.nav button').length, hasBlend:!!document.querySelector('.blend'), webviewMsg:!!(window.chrome&&window.chrome.webview)})",
        (ICoreWebView2ExecuteScriptCompletedHandler*)new ScriptHandler);
    if (g_wv) g_wv->PostWebMessageAsJson(
        L"{\"v\":1,\"type\":\"telemetry\",\"payload\":{\"peakL\":0.42,\"peakR\":0.39}}");
    return S_OK;
  }
  NavHandler() = default;
};

// ---- Web-message received: ui -> host ----
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
    if (json) {
      fprintf(stderr, "[verify ui->host] %.220ls\n", json);
      fflush(stderr);
      CoTaskMemFree(json);
    }
    return S_OK;
  }
  WmHandler() = default;
};

// ---- Controller-created ----
struct CtrlHandler final : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(HRESULT, ICoreWebView2Controller* ctl) noexcept override {
    if (!ctl) return S_OK;
    ctl->get_CoreWebView2(&g_wv);
    if (g_wv) g_wv->QueryInterface(IID_ICoreWebView2_3, (void**)&g_wv3);
    if (g_wv3) g_wv3->SetVirtualHostNameToFolderMapping(
        L"mbira.local", L"Z:\\GITHUB\\MBIRA\\ui", COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
    if (g_wv) {
      g_wv->add_WebMessageReceived(new WmHandler, &g_wmToken);
      g_wv->add_NavigationCompleted(new NavHandler, &g_navToken);
      g_wv->Navigate(L"https://mbira.local/index.html");
    }
    if (ctl) ctl->put_IsVisible(TRUE);
    return S_OK;
  }
  CtrlHandler() = default;
};

// ---- Environment-created ----
struct EnvHandler final : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }
  STDMETHOD(Invoke)(HRESULT, ICoreWebView2Environment* env) noexcept override {
    if (!env) return S_OK;
    env->CreateCoreWebView2Controller(g_main, new CtrlHandler);
    return S_OK;
  }
  EnvHandler() = default;
};

LRESULT CALLBACK wndProc(HWND h, UINT m, WPARAM wp, LPARAM lp) {
  if (m == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProcW(h, m, wp, lp);
}

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int) {
  fprintf(stderr, "[verify] WinMain start\n");
  fflush(stderr);
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof wc; wc.lpfnWndProc = wndProc; wc.hInstance = hInst;
  wc.lpszClassName = L"MbiraWv2Host";
  RegisterClassExW(&wc);
  g_main = CreateWindowExW(0, L"MbiraWv2Host", L"MBIRA", WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT, CW_USEDEFAULT, 860, 640, nullptr, nullptr, hInst, nullptr);
  if (!g_main) { fprintf(stderr, "CreateWindow failed\n"); return 1; }
  ShowWindow(g_main, SW_SHOW);

  // userdata: point at a temp dir so we start clean each run
  const wchar_t* ud = L"Z:\\GITHUB\\MBIRA\\build\\wv2-userdata";
  // Enable CDP so we can drive/verify the UI (and it doubles as a debug flag).
  ICoreWebView2EnvironmentOptions* envOpts = nullptr;
  CoCreateInstance(CLSID_CoreWebView2EnvironmentOptions, nullptr, CLSCTX_INPROC_SERVER,
                   IID_ICoreWebView2EnvironmentOptions, (void**)&envOpts);
  if (envOpts) envOpts->put_AdditionalBrowserArguments(L"--remote-debugging-port=9226");
  HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, ud, envOpts, (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*)new EnvHandler);
  if (FAILED(hr)) { fprintf(stderr, "CreateCoreWebView2EnvironmentWithOptions failed: 0x%08lx\n", hr); return 1; }

  MSG msg;
  // auto-quit after 9s so the verification run is bounded, so we can read stderr
  DWORD t0 = GetTickCount();
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg); DispatchMessageW(&msg);
    if (GetTickCount() - t0 > 60000) {
      fprintf(stderr, "[verify] auto-quit timer fired\n");
      PostQuitMessage(0);
    }
  }
  return 0;
}
