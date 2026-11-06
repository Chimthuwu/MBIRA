// MBIRA minimal tine UI: pure Win32 + GDI, double-buffered. Shows a stylized
// dzavadzimu layout (3 staggered rows) covering MIDI notes 48..84 (the DSP range).
// Tines flash on note-on (decay ~300 ms), dim faster (~100 ms) on note-off.
// Mouse: click a tine to play it (sent through the same event sink as MIDI).
#pragma once
#include <windows.h>
#include <atomic>
#include <functional>

namespace mbira_ui {

constexpr int kLo = 48, kHi = 84, kN = kHi - kLo + 1;

struct State {
  std::atomic<unsigned> onCount[128] {};   // bumped on every note-on (retrigger-safe)
  std::atomic<bool> held[128] {};
  void noteOn(int n)  { if (n >= 0 && n < 128) { held[n] = true; onCount[n]++; } }
  void noteOff(int n) { if (n >= 0 && n < 128) held[n] = false; }
};

// Layout: 3 rows; note i (0..36) goes to row i%3, slot i/3, so pitch rises
// left->right with the rows interleaved and staggered by a third of a slot
// (approximate mbira look, not a historical tuning). Higher pitch = shorter tine.
struct Rect { int x, y, w, h; };
inline Rect tineRect(int note, int W, int H) {
  int i = note - kLo, row = i % 3, slot = i / 3;           // slot 0..12
  double slotW = (W - 40.0) / 13.0;
  int w = (int)(slotW * 0.62);
  int x = 20 + (int)(slot * slotW + row * slotW / 3.0);
  int rowH = (H - 60) / 3;
  int h = (int)(rowH * (0.95 - 0.45 * (i / (double) kN)));
  int y = 30 + row * rowH;                                  // hang from the row's bar
  return { x, y, w, h };
}

struct Ctx {
  State* st; std::function<void(int, bool)> sink;
  float level[128] {}; unsigned seen[128] {}; int mouseNote = -1;
  HBITMAP bmp = nullptr; int bw = 0, bh = 0;
};

inline int hit(int mx, int my, int W, int H) {
  for (int n = kHi; n >= kLo; --n) {
    Rect r = tineRect(n, W, H);
    if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return n;
  }
  return -1;
}

inline LRESULT CALLBACK proc(HWND h, UINT m, WPARAM wp, LPARAM lp) {
  auto* c = (Ctx*) GetWindowLongPtrA(h, GWLP_USERDATA);
  if (!c) return DefWindowProcA(h, m, wp, lp);
  switch (m) {
    case WM_TIMER: {
      const float dt = 0.033f;
      for (int n = kLo; n <= kHi; ++n) {
        unsigned oc = c->st->onCount[n].load();
        if (oc != c->seen[n]) { c->seen[n] = oc; c->level[n] = 1.0f; }
        else c->level[n] -= dt / (c->st->held[n].load() ? 0.3f : 0.1f);
        if (c->level[n] < 0) c->level[n] = 0;
      }
      InvalidateRect(h, nullptr, FALSE); return 0;
    }
    case WM_LBUTTONDOWN: {
      RECT rc; GetClientRect(h, &rc);
      int n = hit(LOWORD(lp), HIWORD(lp), rc.right, rc.bottom);
      if (n >= 0) { c->mouseNote = n; SetCapture(h); c->st->noteOn(n); c->sink(n, true); }
      return 0;
    }
    case WM_LBUTTONUP:
      if (c->mouseNote >= 0) {
        c->st->noteOff(c->mouseNote); c->sink(c->mouseNote, false);
        c->mouseNote = -1; ReleaseCapture();
      }
      return 0;
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: {
      PAINTSTRUCT ps; HDC wdc = BeginPaint(h, &ps);
      RECT rc; GetClientRect(h, &rc); int W = rc.right, H = rc.bottom;
      if (W > 0 && H > 0) {
        if (!c->bmp || c->bw != W || c->bh != H) {
          if (c->bmp) DeleteObject(c->bmp);
          c->bmp = CreateCompatibleBitmap(wdc, W, H); c->bw = W; c->bh = H;
        }
        HDC dc = CreateCompatibleDC(wdc); HGDIOBJ old = SelectObject(dc, c->bmp);
        HBRUSH bg = CreateSolidBrush(RGB(28, 22, 18)); FillRect(dc, &rc, bg); DeleteObject(bg);
        int rowH = (H - 60) / 3;
        HBRUSH bar = CreateSolidBrush(RGB(90, 70, 50));
        for (int r = 0; r < 3; ++r) { RECT b { 10, 30 + r * rowH - 8, W - 10, 30 + r * rowH }; FillRect(dc, &b, bar); }
        DeleteObject(bar);
        HPEN pen = CreatePen(PS_SOLID, 1, RGB(20, 20, 20)); HGDIOBJ op = SelectObject(dc, pen);
        for (int n = kLo; n <= kHi; ++n) {
          float l = c->level[n]; Rect r = tineRect(n, W, H);
          int rr = 90 + (int)(165 * l), gg = 95 + (int)(150 * l), bb = 105 - (int)(60 * l);
          HBRUSH br = CreateSolidBrush(RGB(rr > 255 ? 255 : rr, gg > 255 ? 255 : gg, bb));
          HGDIOBJ ob = SelectObject(dc, br);
          RoundRect(dc, r.x, r.y, r.x + r.w, r.y + r.h, 8, 8);
          SelectObject(dc, ob); DeleteObject(br);
        }
        SelectObject(dc, op); DeleteObject(pen);
        BitBlt(wdc, 0, 0, W, H, dc, 0, 0, SRCCOPY);
        SelectObject(dc, old); DeleteDC(dc);
      }
      EndPaint(h, &ps); return 0;
    }
    case WM_DESTROY: KillTimer(h, 1); PostQuitMessage(0); return 0;
  }
  return DefWindowProcA(h, m, wp, lp);
}

// Blocks on the message loop until the window is closed (main thread).
// autoQuitS > 0 closes the window after that many seconds (testing).
inline int run(State& st, std::function<void(int, bool)> sink, double autoQuitS = 0) {
  Ctx ctx { &st, std::move(sink) };
  WNDCLASSA wc {}; wc.lpfnWndProc = proc; wc.hInstance = GetModuleHandleA(nullptr);
  wc.hCursor = LoadCursorA(nullptr, IDC_ARROW); wc.lpszClassName = "MbiraWnd";
  RegisterClassA(&wc);
  HWND h = CreateWindowExA(0, "MbiraWnd", "MBIRA", WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                           CW_USEDEFAULT, CW_USEDEFAULT, 900, 420, nullptr, nullptr, wc.hInstance, nullptr);
  if (!h) return 1;
  SetWindowLongPtrA(h, GWLP_USERDATA, (LONG_PTR) &ctx);
  SetTimer(h, 1, 33, nullptr);
  if (autoQuitS > 0) SetTimer(h, 2, (UINT)(autoQuitS * 1000), nullptr);
  MSG msg;
  while (GetMessageA(&msg, nullptr, 0, 0) > 0) {
    if (msg.message == WM_TIMER && msg.wParam == 2 && msg.hwnd == h) { DestroyWindow(h); continue; }
    TranslateMessage(&msg); DispatchMessageA(&msg);
  }
  if (ctx.bmp) DeleteObject(ctx.bmp);
  return 0;
}

} // namespace mbira_ui
