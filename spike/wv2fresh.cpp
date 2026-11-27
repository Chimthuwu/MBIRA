// MBIRA WebView2 spike — plain-COM (no WRL/Callback; MinGW-safe).
// Proves: include/link, virtual-host load of ui/, both bridge directions.
#include <windows.h>
#include <WebView2.h>
#include <string>
#include <cstdio>

static ICoreWebView2*      g_wv = nullptr;
static ICoreWebView2_3*    g_wv3 = nullptr;
static EventRegistrationToken g_wmToken{};
static HWND                g_main = nullptr;

// ---- Plain COM handler helpers (MinGW has no WRL). ----
// Each handler is a small concrete class overriding IUnknown + the target
// interface's Invoke. Three needed.

// ---- 1) Environment-created -> then create controller ----
struct EnvHandler final : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, __uuidof(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler)) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }

  STDMETHOD(Invoke)(HRESULT, ICoreWebView2Environment* env) noexcept override {
    if (!env) return S_OK;
    auto* done = new struct CtrlHandler;
    return env->CreateCoreWebView2Controller(g_main, (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler*)done);
  }
  EnvHandler() = default;
};

// ---- 2) Controller-created -> wire bridge, load ui/ ----
struct CtrlHandler final : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, __uuidof(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler)) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }

  STDMETHOD(Invoke)(HRESULT, ICoreWebView2Controller* ctl) noexcept override {
    if (!ctl) return S_OK;
    ctl->get_CoreWebView2(&g_wv);
    if (g_wv) g_wv->QueryInterface(__uuidof(ICoreWebView2_3), (void**)&g_wv3);
    // Keep the window alive until the webview closes.
    // map https://mbira.local -> ui/ dir (ES-module + CSP friendly)
    if (g_wv3) g_wv3->SetVirtualHostNameToFolderMapping(
        L"mbira.local", L"Z:\\GITHUB\\MBIRA\\ui", COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
    if (g_wv) g_wv->Navigate(L"https://mbira.local/index.html");
    // inbound: ui -> host
    auto* wmHandler = new (struct WmHandler);
    if (g_wv) g_wv->add_WebMessageReceived(
        (ICoreWebView2WebMessageReceivedEventHandler*)wmHandler, &g_wmToken);
    if (ctl) ctl->put_IsVisible(TRUE);
    return S_OK;
  }
  CtrlHandler() = default;
};

// ---- 3) Web-message received: ui -> host ----
struct WmHandler final : public ICoreWebView2WebMessageReceivedEventHandler {
  ULONG refs = 1;
  STDMETHOD(QueryInterface)(REFIID riid, void** pp) noexcept override {
    if (IsEqualIID(riid, __uuidof(ICoreWebView2WebMessageReceivedEventHandler)) || IsEqualIID(riid, IID_IUnknown))
      { *pp = (ICoreWebView2WebMessageReceivedEventHandler*)this; AddRef(); return S_OK; }
    *pp = nullptr; return E_NOINTERFACE;
  }
  STDMETHOD_(ULONG, AddRef)() noexcept override { return ++refs; }
  STDMETHOD_(ULONG, Release)() noexcept override { if (--refs == 0) { delete this; return 0; } return refs; }

  STDMETHOD(Invoke)(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) noexcept override {
    LPWSTR json = nullptr;
    args->get_WebMessageAsJson(&json);
    if (json) {
      fprintf(stderr, "[spike ui->host] %.140ls\n", json);
      // reply host->ui: proves the reverse direction (note.state bounce)
      if (g_wv) g_wv->PostWebMessageAsJson(
          L"{\"v\":1,\"type\":\"note.state\",\"payload\":{\"note\":72,\"active\":true}}");
      CoTaskMemFree(json);
    }
    return S_OK;
  }
  WmHandler() = default;
};

LRESULT CALLBACK wndProc(HWND h, UINT m, WPARAM wp, LPARAM lp) {
  if (m == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProcW(h, m, wp, lp);
}

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int) {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof wc; wc.lpfnWndProc = wndProc; wc.hInstance = hInst;
  wc.lpszClassName = L"MbiraWv2Host";
  RegisterClassExW(&wc);
  g_main = CreateWindowExW(0, L"MbiraWv2Host", L"MBIRA", WS_OVERLAPPEDWINDOW,
      CW_USEDEFAULT, CW_USEDEFAULT, 860, 640, nullptr, nullptr, hInst, nullptr);
  if (!g_main) { fprintf(stderr, "CreateWindow failed\n"); return 1; }
  ShowWindow(g_main, SW_SHOW);

  HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, L"Z:\\GITHUB\\MBIRA\\build\\wv2-userdata", nullptr,
      (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*)new EnvHandler);
  if (FAILED(hr)) { fprintf(stderr, "CreateCoreWebView2EnvironmentWithOptions failed: 0x%08lx\n", hr); return 1; }

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}
