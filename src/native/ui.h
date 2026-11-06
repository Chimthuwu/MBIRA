// MBIRA UI: pure Win32 + GDI, double-buffered.
// Top: stylized dzavadzimu layout (3 staggered rows) covering MIDI notes 48..84
//   (the DSP range). Tines flash on note-on (decay ~300 ms), dim faster (~100 ms)
//   on note-off. Mouse: click a tine to play it (same sink as MIDI).
// Bottom: PHYSICAL-MODEL CONTROL PANEL (M2) - sliders + enable toggles wired to
//   the named-parameter sink (__mbira.setParam / setRatioSet on the service
//   thread via the live event queue). This is the interim UI until the
//   WebView2 editor (spec section 5 / design agents).
#pragma once
#include <windows.h>
#include <commctrl.h>
#include <atomic>
#include <functional>
#include <string>
#include <cstdio>
#include <vector>
#include <algorithm>

namespace mbira_ui {

constexpr int kLo = 48, kHi = 84, kN = kHi - kLo + 1;
constexpr int PANEL_H = 350;   // control panel strip at the bottom

struct KeyGeom { int note; float x, y, len; };  // schematic coords (canvas units)

struct State {
  std::atomic<unsigned> onCount[128] {};   // bumped on every note-on (retrigger-safe)
  std::atomic<bool> held[128] {};
  std::vector<KeyGeom> geom;               // from the loaded instrument (empty = legacy layout)
  float canvasW = 800.0f, canvasH = 300.0f;
  void noteOn(int n)  { if (n >= 0 && n < 128) { held[n] = true; onCount[n]++; } }
  void noteOff(int n) { if (n >= 0 && n < 128) held[n] = false; }
};

// Layout: 3 rows; note i (0..36) goes to row i%3, slot i/3, so pitch rises
// left->right with the rows interleaved and staggered by a third of a slot
// (approximate mbira look, not a historical tuning). Higher pitch = shorter tine.
struct Rect { int x, y, w, h; };
inline Rect tineRect(const State& st, int note, int W, int H) {
  if (!st.geom.empty()) {
    // instrument-driven schematic layout: fit the canvas into the tine area
    const int tineH = H - PANEL_H;
    double s = std::min((W - 40.0) / st.canvasW, (tineH - 50.0) / st.canvasH);
    for (const auto& k : st.geom)
      if (k.note == note) {
        int w = std::max(6, (int)(k.len * s * 0.35));
        int h = std::max(18, (int)(k.len * s * 0.9));
        return { 20 + (int)(k.x * s), 15 + (int)(k.y * s), w, h };
      }
    return { -1, -1, 0, 0 };
  }
  int i = note - kLo, row = i % 3, slot = i / 3;           // slot 0..12
  double slotW = (W - 40.0) / 13.0;
  int w = (int)(slotW * 0.62);
  int x = 20 + (int)(slot * slotW + row * slotW / 3.0);
  int rowH = (H - PANEL_H - 60) / 3;
  int h = (int)(rowH * (0.95 - 0.45 * (i / (double) kN)));
  int y = 30 + row * rowH;                                  // hang from the row's bar
  return { x, y, w, h };
}

struct Ctx {
  State* st;
  std::function<void(int, bool)> sink;                 // note events
  std::function<void(const std::string&)> paramSink;   // param-change JS expressions
  float level[128] {}; unsigned seen[128] {}; int mouseNote = -1;
  // enable-toggle memory: slider position to restore when re-enabled
  int lastSb = 35, lastGourd = 30, lastBuzz = 0;
  HBITMAP bmp = nullptr; int bw = 0, bh = 0;
};

// control ids
enum {
  ID_TR_PLUCK = 100, ID_TR_MASTER, ID_TR_SB, ID_TR_GOURD, ID_TR_GOURDF, ID_TR_BUZZ, ID_TR_BUZZC,
  ID_CB_SB, ID_CB_GOURD, ID_CB_BUZZ,
  ID_BTN_RATIO,
  // macros row (the locked identity: Resonance / Buzz / Brightness)
  ID_TR_MAC_RES, ID_TR_MAC_BUZZ, ID_TR_MAC_BRIGHT,
  // dev row (engine internals, not the product UI)
  ID_TR_ADSR_A, ID_TR_ADSR_R, ID_TR_ADSR_S, ID_TR_LFO_RATE, ID_TR_LFO_PITCH, ID_TR_LFO_MASTER, ID_TR_RANDOM, ID_TR_VELB,
};

// slider -> param adapters
inline double sliderMs(HWND h, int id, double lo, double hi) {
  int pos = (int) SendMessageA(GetDlgItem(h, id), TBM_GETPOS, 0, 0);
  return lo + (hi - lo) * pos / 100.0;
}

inline int hit(const State& st, int mx, int my, int W, int H) {
  if (!st.geom.empty()) {
    for (size_t i = st.geom.size(); i-- > 0;) {
      Rect r = tineRect(st, st.geom[i].note, W, H);
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return st.geom[i].note;
    }
    return -1;
  }
  for (int n = kHi; n >= kLo; --n) {
    Rect r = tineRect(st, n, W, H);
    if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return n;
  }
  return -1;
}

inline HWND mkTrack(HWND h, int id, int x, int y, int w, int lo, int hi, int pos) {
  HWND t = CreateWindowExA(0, TRACKBAR_CLASSA, "", WS_CHILD | WS_VISIBLE | TBS_HORZ | TBS_AUTOTICKS,
                           x, y, w, 30, h, (HMENU)(INT_PTR) id, GetModuleHandleA(nullptr), nullptr);
  SendMessageA(t, TBM_SETRANGE, TRUE, MAKELPARAM(lo, hi));
  SendMessageA(t, TBM_SETPOS, TRUE, pos);
  return t;
}
inline HWND mkLabel(HWND h, const char* text, int x, int y, int w) {
  return CreateWindowExA(0, "STATIC", text, WS_CHILD | WS_VISIBLE | SS_LEFT,
                         x, y, w, 16, h, nullptr, GetModuleHandleA(nullptr), nullptr);
}
inline HWND mkCheck(HWND h, int id, const char* text, int x, int y, int checked) {
  HWND c = CreateWindowExA(0, "BUTTON", text, WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX,
                           x, y, 110, 20, h, (HMENU)(INT_PTR) id, GetModuleHandleA(nullptr), nullptr);
  SendMessageA(c, BM_SETCHECK, checked ? BST_CHECKED : BST_UNCHECKED, 0);
  return c;
}

inline void buildPanel(HWND h, Ctx* c, int W, int H) {
  int py = H - PANEL_H;
  // left column: pluck + master
  mkLabel(h, "Pluck position", 14, py + 6, 120);
  mkTrack(h, ID_TR_PLUCK, 14, py + 24, 150, 0, 100, 30);
  mkLabel(h, "Master", 14, py + 64, 120);
  mkTrack(h, ID_TR_MASTER, 14, py + 82, 150, 0, 100, 40);
  // soundboard (the shared resonator bank)
  mkLabel(h, "SOUNDBOARD (resonator)", 200, py + 6, 180);
  mkCheck(h, ID_CB_SB, "Enable", 200, py + 22, 1);
  mkTrack(h, ID_TR_SB, 200, py + 44, 150, 0, 100, c->lastSb);
  // gourd
  mkLabel(h, "GOURD (deze)", 380, py + 6, 160);
  mkCheck(h, ID_CB_GOURD, "Enable", 380, py + 22, 1);
  mkTrack(h, ID_TR_GOURD, 380, py + 44, 130, 0, 100, c->lastGourd);
  mkLabel(h, "Freq", 380, py + 82, 60);
  mkTrack(h, ID_TR_GOURDF, 380, py + 100, 130, 80, 400, 170);
  // buzz
  mkLabel(h, "BUZZ", 545, py + 6, 120);
  mkCheck(h, ID_CB_BUZZ, "Enable", 545, py + 22, 0);
  mkTrack(h, ID_TR_BUZZ, 545, py + 44, 130, 0, 100, c->lastBuzz);
  mkLabel(h, "Character", 545, py + 82, 70);
  mkTrack(h, ID_TR_BUZZC, 545, py + 100, 130, 800, 8000, 3200);
  // ratio set toggle
  CreateWindowExA(0, "BUTTON", "Tine: cantilever", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                  710, py + 22, 140, 26, h, (HMENU)(INT_PTR) ID_BTN_RATIO, GetModuleHandleA(nullptr), nullptr);
  mkLabel(h, "PROVISIONAL physical model", 710, py + 60, 210);

  // ---- macros row (the three UI-facing knobs) ------------------------------
  int my = py + 118;
  mkLabel(h, "MACROS", 14, my, 120);
  mkLabel(h, "Resonance", 14, my + 18, 90);
  mkTrack(h, ID_TR_MAC_RES, 14, my + 36, 140, 0, 100, 50);
  mkLabel(h, "Buzz", 170, my + 18, 60);
  mkTrack(h, ID_TR_MAC_BUZZ, 170, my + 36, 120, 0, 100, 50);
  mkLabel(h, "Brightness", 310, my + 18, 90);
  mkTrack(h, ID_TR_MAC_BRIGHT, 310, my + 36, 130, 0, 100, 50);

  // ---- dev row: engine internals (not part of the product UI design) -------
  int dy = my + 78;
  mkLabel(h, "DEV: mod sources", 14, dy, 120);
  mkLabel(h, "ADSR attack", 14, dy + 18, 90);
  mkTrack(h, ID_TR_ADSR_A, 14, dy + 36, 140, 0, 100, 0);      // 0.2 ms .. 500 ms
  mkLabel(h, "Release", 14, dy + 70, 90);
  mkTrack(h, ID_TR_ADSR_R, 14, dy + 88, 140, 0, 100, 1);      // 5 ms .. 2 s
  mkLabel(h, "Sustain", 170, dy + 18, 70);
  mkTrack(h, ID_TR_ADSR_S, 170, dy + 36, 120, 0, 100, 100);   // 0..1
  mkLabel(h, "LFO rate", 170, dy + 70, 70);
  mkTrack(h, ID_TR_LFO_RATE, 170, dy + 88, 120, 1, 100, 10);  // 0.1 .. 20 Hz
  mkLabel(h, "LFO->Pitch", 310, dy + 18, 90);
  mkTrack(h, ID_TR_LFO_PITCH, 310, dy + 36, 130, 0, 100, 0);  // depth (semitone-ish)
  mkLabel(h, "LFO->Master", 310, dy + 70, 100);
  mkTrack(h, ID_TR_LFO_MASTER, 310, dy + 88, 130, 0, 100, 0); // tremolo depth
  mkLabel(h, "Random", 460, dy + 18, 80);
  mkTrack(h, ID_TR_RANDOM, 460, dy + 36, 120, 0, 100, 4);     // per-note jitter
  mkLabel(h, "Vel->Bright", 460, dy + 70, 90);
  mkTrack(h, ID_TR_VELB, 460, dy + 88, 120, 0, 200, 100);     // velocity brightness depth
  mkLabel(h, "DEV ONLY - not the product UI. Macros above map: resonance->soundboard+gourd, buzz->rattle, brightness->overtone tilt.", 14, dy + 122, 640);
}

inline void sendParam(HWND h, Ctx* c, const char* name, double value) {
  char buf[128];
  snprintf(buf, sizeof buf, "__mbira.setParam('%s',%.4f)", name, value);
  if (c->paramSink) c->paramSink(buf);
  (void) h;
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
      RECT rc; GetClientRect(h, &rc);
      RECT tines { 0, 0, rc.right, rc.bottom - PANEL_H };
      InvalidateRect(h, &tines, FALSE); return 0;
    }
    case WM_HSCROLL: {
      HWND src = (HWND) lp;
      if (!src) return 0;
      int id = (int) GetDlgCtrlID(src);
      int pos = (int) SendMessageA(src, TBM_GETPOS, 0, 0);
      switch (id) {
        case ID_TR_PLUCK:  sendParam(h, c, "pluckPos", pos / 100.0); break;
        case ID_TR_MASTER: sendParam(h, c, "master", 0.05 + 0.40 * pos / 100.0); break;
        case ID_TR_SB:     c->lastSb = pos; sendParam(h, c, "soundboard", pos / 100.0); break;
        case ID_TR_GOURD:  c->lastGourd = pos; sendParam(h, c, "gourdAmount", pos / 100.0); break;
        case ID_TR_GOURDF: sendParam(h, c, "gourdFreq", (double) pos); break;
        case ID_TR_BUZZ:   c->lastBuzz = pos; sendParam(h, c, "buzzIntensity", pos / 100.0); break;
        case ID_TR_BUZZC:  sendParam(h, c, "buzzChar", (double) pos); break;
        case ID_TR_MAC_RES: sendParam(h, c, "macro.resonance", sliderMs(h, ID_TR_MAC_RES, 0, 1)); break;
        case ID_TR_MAC_BUZZ: sendParam(h, c, "macro.buzz", sliderMs(h, ID_TR_MAC_BUZZ, 0, 1)); break;
        case ID_TR_MAC_BRIGHT: sendParam(h, c, "macro.brightness", sliderMs(h, ID_TR_MAC_BRIGHT, 0, 1)); break;
        case ID_TR_ADSR_A: sendParam(h, c, "adsr.attack", 0.0002 + 0.5 * sliderMs(h, ID_TR_ADSR_A, 0, 100)); break;
        case ID_TR_ADSR_R: sendParam(h, c, "adsr.release", 0.005 + 2.0 * sliderMs(h, ID_TR_ADSR_R, 0, 100)); break;
        case ID_TR_ADSR_S: sendParam(h, c, "adsr.sustain", sliderMs(h, ID_TR_ADSR_S, 0, 1)); break;
        case ID_TR_LFO_RATE: sendParam(h, c, "lfo.rate", 0.1 * sliderMs(h, ID_TR_LFO_RATE, 1, 200)); break;
        case ID_TR_LFO_PITCH: sendParam(h, c, "mod.lfoToPitch", 0.01 * sliderMs(h, ID_TR_LFO_PITCH, 0, 100)); break;
        case ID_TR_LFO_MASTER: sendParam(h, c, "mod.lfoToMaster", sliderMs(h, ID_TR_LFO_MASTER, 0, 1)); break;
        case ID_TR_RANDOM: sendParam(h, c, "random.amount", sliderMs(h, ID_TR_RANDOM, 0, 0.2)); break;
        case ID_TR_VELB: sendParam(h, c, "vel.bright", sliderMs(h, ID_TR_VELB, 0, 2)); break;
      }
      return 0;
    }
    case WM_COMMAND: {
      int id = LOWORD(wp), ev = HIWORD(wp);
      auto checked = [&](int cid) { return SendMessageA(GetDlgItem(h, cid), BM_GETCHECK, 0, 0) == BST_CHECKED; };
      if (ev == BN_CLICKED && id == ID_BTN_RATIO) {
        static int state = 0; state ^= 1;
        SetWindowTextA(GetDlgItem(h, ID_BTN_RATIO), state ? "Tine: classic (M1)" : "Tine: cantilever");
        if (c->paramSink) c->paramSink(state ? "__mbira.setRatioSet('classic')" : "__mbira.setRatioSet('cantilever')");
        return 0;
      }
      if (ev == BN_CLICKED && (id == ID_CB_SB || id == ID_CB_GOURD || id == ID_CB_BUZZ)) {
        bool on = checked(id);
        if (id == ID_CB_SB) {
          if (!on) { c->lastSb = (int) SendMessageA(GetDlgItem(h, ID_TR_SB), TBM_GETPOS, 0, 0); sendParam(h, c, "soundboard", 0.0); }
          else sendParam(h, c, "soundboard", c->lastSb / 100.0);
        }
        if (id == ID_CB_GOURD) {
          if (!on) { c->lastGourd = (int) SendMessageA(GetDlgItem(h, ID_TR_GOURD), TBM_GETPOS, 0, 0); sendParam(h, c, "gourdAmount", 0.0); }
          else sendParam(h, c, "gourdAmount", c->lastGourd / 100.0);
        }
        if (id == ID_CB_BUZZ) {
          if (!on) { c->lastBuzz = (int) SendMessageA(GetDlgItem(h, ID_TR_BUZZ), TBM_GETPOS, 0, 0); sendParam(h, c, "buzzIntensity", 0.0); }
          else sendParam(h, c, "buzzIntensity", (c->lastBuzz ? c->lastBuzz : 40) / 100.0);
        }
        return 0;
      }
      break;
    }
    case WM_LBUTTONDOWN: {
      RECT rc; GetClientRect(h, &rc);
      int my = HIWORD(lp);
      if (my >= rc.bottom - PANEL_H) break; // clicks in the panel area are for controls
      int n = hit(*c->st, LOWORD(lp), my, rc.right, rc.bottom);
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
      RECT rc; GetClientRect(h, &rc); int W = rc.right, H = rc.bottom - PANEL_H;
      if (W > 0 && H > 0) {
        if (!c->bmp || c->bw != W || c->bh != rc.bottom) {
          if (c->bmp) DeleteObject(c->bmp);
          c->bmp = CreateCompatibleBitmap(wdc, W, rc.bottom); c->bw = W; c->bh = rc.bottom;
        }
        HDC dc = CreateCompatibleDC(wdc); HGDIOBJ old = SelectObject(dc, c->bmp);
        HBRUSH bg = CreateSolidBrush(RGB(28, 22, 18)); RECT full { 0, 0, W, H }; FillRect(dc, &full, bg); DeleteObject(bg);
        int rowH = (H - 60) / 3;
        HBRUSH bar = CreateSolidBrush(RGB(90, 70, 50));
        for (int r = 0; r < 3; ++r) { RECT b { 10, 30 + r * rowH - 8, W - 10, 30 + r * rowH }; FillRect(dc, &b, bar); }
        DeleteObject(bar);
        HPEN pen = CreatePen(PS_SOLID, 1, RGB(20, 20, 20)); HGDIOBJ op = SelectObject(dc, pen);
        auto drawTine = [&](int n, Rect r) {
          float l = c->level[n];
          int rr = 90 + (int)(165 * l), gg = 95 + (int)(150 * l), bb = 105 - (int)(60 * l);
          HBRUSH br = CreateSolidBrush(RGB(rr > 255 ? 255 : rr, gg > 255 ? 255 : gg, bb));
          HGDIOBJ ob = SelectObject(dc, br);
          RoundRect(dc, r.x, r.y, r.x + r.w, r.y + r.h, 8, 8);
          SelectObject(dc, ob); DeleteObject(br);
        };
        if (!c->st->geom.empty()) {
          for (const auto& k : c->st->geom) drawTine(k.note, tineRect(*c->st, k.note, W, rc.bottom));
        } else {
          for (int n = kLo; n <= kHi; ++n) drawTine(n, tineRect(*c->st, n, W, rc.bottom));
        }
        SelectObject(dc, op); DeleteObject(pen);
        BitBlt(wdc, 0, 0, W, H, dc, 0, 0, SRCCOPY); // tine area ONLY - never over the panel
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
inline int run(State& st, std::function<void(int, bool)> sink,
               std::function<void(const std::string&)> paramSink = nullptr,
               double autoQuitS = 0) {
  Ctx ctx { &st, std::move(sink), std::move(paramSink) };
  INITCOMMONCONTROLSEX icc { sizeof icc, ICC_BAR_CLASSES };
  InitCommonControlsEx(&icc);
  WNDCLASSA wc {}; wc.lpfnWndProc = proc; wc.hInstance = GetModuleHandleA(nullptr);
  wc.hCursor = LoadCursorA(nullptr, IDC_ARROW); wc.lpszClassName = "MbiraWnd";
  RegisterClassA(&wc);
  HWND h = CreateWindowExA(0, "MbiraWnd", "MBIRA", WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPCHILDREN,
                           CW_USEDEFAULT, CW_USEDEFAULT, 1000, 640, nullptr, nullptr, wc.hInstance, nullptr);
  if (!h) return 1;
  SetWindowLongPtrA(h, GWLP_USERDATA, (LONG_PTR) &ctx);
  RECT rc; GetClientRect(h, &rc);
  buildPanel(h, &ctx, rc.right, rc.bottom); // after GWLP_USERDATA is set
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
