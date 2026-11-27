// MBIRA WebView2 spike — prove: include/link under MinGW, load local ui/, and
// both directions of the {v,type,id,payload} bridge. Nothing persists.
#include <windows.h>
#include <WebView2.h>
#include <string>
#include <cstdio>

static const wchar_t* kEndpointHost = L"mbira.local";
static const wchar_t* kUiDir = L"Z:\\GITHUB\\MBIRA\\ui";

static void wvWrite(HWND h, const std::wstring& json) {
  // host -> ui via the window's ICoreWebView2
  // (we stash it in the window extra; set in the env handler)
  ICoreWebView2* wv = (ICoreWebView2*) GetWindowLongPtrW(h, GWLP_USERDATA);
  if (wv) wv->PostWebMessageAsJson(json.c_str());
}

// Forward decl so the message handler can send back
static ICoreWebView2* g_wv = nullptr;
static EventRegistrationToken g_token{};

static HRESULT onWebMessage(ICoreWebView2* wv, ICoreWebView2WebMessageReceivedEventArgs* args) {
  LPWSTR json = nullptr;
  args->get_WebMessageAsJson(&json);
  if (json) {
    // forward to native sink; here, echo back a telemetry-ish state
    std::wstring js(json);
    CoTaskMemFree(json);
    // log a subset (first 120 chars)
    fprintf(stderr, "[spike ui->host] %.140ls\n", js.c_str());
    // reply so ui receives an inbound message (proves host->ui direction)
    wv->PostWebMessageAsJson(L"{\"v\":1,\"type\":\"note.state\",\"payload\":{\"note\":72,\"active\":true}}");
  }
  return S_OK;
}

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int) {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  WNDCLASSEXW wc{};
  wc.cbSize = sizeof wc;
  wc.lpfnWndProc = [](HWND h, UINT m, WPARAM wp, LPARAM lp) -> LRESULT {
    if (m == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(h, m, wp, lp);
  };
  wc.hInstance = hInst;
  wc.lpszClassName = L"MbiraWebView2Spike";
  RegisterClassExW(&wc);
  HWND hwnd = CreateWindowExW(0, L"MbiraWebView2Spike", L"MBIRA WebView2 spike",
                              WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 800, 600,
                              nullptr, nullptr, hInst, nullptr);
  ShowWindow(hwnd, SW_SHOW);

  // Create the environment, then the webview as a child of hwnd.
  ICoreWebView2Environment* env = nullptr;
  auto cb = Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
    [&](HRESULT, ICoreWebView2Environment* e) -> HRESULT {
      env = e;
      e->CreateCoreWebView2Controller(hwnd, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
        [&](HRESULT, ICoreWebView2Controller* ctl) -> HRESULT {
          ctl->get_CoreWebView2(&g_wv);
          SetWindowLongPtrW(hwnd, GWLP_USERDATA, (LONG_PTR) g_wv);
          // map http://mbira.local -> ui dir (works with ES modules + CSP)
          g_wv->SetVirtualHostNameToFolderMapping(kEndpointHost, kUiDir, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
          g_wv->Navigate(L"https://mbira.local/index.html");
          // incoming messages
          g_wv->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [](ICoreWebView2* w, ICoreWebView2WebMessageReceivedEventArgs* a) -> HRESULT {
              return onWebMessage(w, a);
            }).Get(), &g_token);
          return S_OK;
        }).Get());
      return S_OK;
    }).Get();
  HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, L"Z:\\GITHUB\\MBIRA\\build\\wv2-userdata", nullptr, cb.Get());
  if (FAILED(hr)) { fprintf(stderr, "CreateCoreWebView2EnvironmentWithOptions failed: 0x%08lx\n", hr); return 1; }

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}
