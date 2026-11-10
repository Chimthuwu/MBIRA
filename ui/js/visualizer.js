/**
 * Live output visualizer — oscilloscope / spectrum / spectrogram.
 *
 * Ported from the PsydeClip visualizer (src/renderer/lib/visualizer.ts) and
 * reduced to what this panel needs: no history model, no MIDI lane, no
 * selection. The drawing language (background gradient, amber grid, glowing
 * trace, gradient bars, scrolling heatmap) is the same; the palette is the
 * MBIRA accent instead of PsydeClip's theme presets.
 *
 * Data comes from the native host's telemetry frame: ~1024 mono bus samples
 * at ~30 Hz plus the engine sample rate. That is ONE scope sweep (21 ms at
 * 48 kHz) and enough for a 1024-point FFT, so the three modes share one
 * capture. Nothing is faked: silence draws silence.
 */

const FFT_N = 1024;
const BINS = FFT_N / 2;

// ---- FFT tables (module scope: allocated once) ------------------------------
const HANN = new Float32Array(FFT_N);
let HANN_SUM = 0;
for (let i = 0; i < FFT_N; i++) {
  HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1));
  HANN_SUM += HANN[i];
}
const REV = new Uint16Array(FFT_N);
{
  let bits = 0;
  while ((1 << bits) < FFT_N) bits++;
  for (let i = 0; i < FFT_N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    REV[i] = r;
  }
}
const COS = new Float32Array(FFT_N / 2);
const SIN = new Float32Array(FFT_N / 2);
for (let i = 0; i < FFT_N / 2; i++) {
  COS[i] = Math.cos((-2 * Math.PI * i) / FFT_N);
  SIN[i] = Math.sin((-2 * Math.PI * i) / FFT_N);
}

const re = new Float32Array(FFT_N);
const im = new Float32Array(FFT_N);

/** Amplitude spectrum of one 1024-sample window (Hann-windowed). */
function spectrumOf(wave, out) {
  for (let i = 0; i < FFT_N; i++) {
    re[REV[i]] = wave[i] * HANN[i];
    im[REV[i]] = 0;
  }
  for (let size = 2; size <= FFT_N; size <<= 1) {
    const half = size >> 1;
    const step = FFT_N / size;
    for (let i = 0; i < FFT_N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const c = COS[k], s = SIN[k];
        const a = i + j, b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  // 2*mag / sum(win) = amplitude of a sinusoid at that bin.
  for (let i = 0; i < BINS; i++) {
    out[i] = (2 * Math.sqrt(re[i] * re[i] + im[i] * im[i])) / HANN_SUM;
  }
}

// ---- palette (MBIRA accent) -------------------------------------------------
const C = {
  bg0: '#0b0c0f', bg1: '#07080a',
  grid: 'rgba(240,166,60,0.07)', gridHi: 'rgba(240,166,60,0.18)',
  axis: 'rgba(168,164,155,0.45)',
  wave: '#f0a63c', waveHot: '#ffd98f',
  barLo: '#6b461a', barMid: '#f0a63c', barHi: '#ffd98f',
};
// Silence → background, peaks → ivory (same idea as PsydeClip's ramps).
const RAMP = [
  [0.00, 11, 12, 15],
  [0.18, 38, 22, 8],
  [0.42, 125, 83, 28],
  [0.68, 240, 166, 60],
  [0.86, 255, 217, 143],
  [1.00, 255, 250, 232],
];
function rampColor(n) {
  if (n <= RAMP[0][0]) return RAMP[0];
  for (let i = 1; i < RAMP.length; i++) {
    const [stop, r, g, b] = RAMP[i];
    if (n <= stop) {
      const [p, pr, pg, pb] = RAMP[i - 1];
      const t = (n - p) / (stop - p || 1);
      return [pr + (r - pr) * t, pg + (g - pg) * t, pb + (b - pb) * t];
    }
  }
  return RAMP[RAMP.length - 1];
}

const LOG_MIN = 40;

export function mountVisualizer(canvas, tabs = []) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let W = 0, H = 0, dpr = 1;
  let mode = 'osc';
  let sampleRate = 48000;
  let srFactor = 1;                // canvas pixels per CSS pixel (DPR)
  const wave = new Float32Array(FFT_N);
  const amp = new Float32Array(BINS);
  const level = new Float32Array(BINS);   // smoothed + peak-held, for the bars
  let spectro = null;               // { cvs, ctx } offscreen history
  let hasData = false;

  // ---- sizing --------------------------------------------------------------
  function resize() {
    const r = canvas.getBoundingClientRect();
    const cssW = Math.max(120, Math.round(r.width || 600));
    const cssH = Math.max(80, Math.round(r.height || 240));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width === Math.round(cssW * dpr) && canvas.height === Math.round(cssH * dpr)) return;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    W = cssW; H = cssH;
    srFactor = dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    spectro = null;              // buffer is sized to the panel
  }

  function spectroBuf() {
    if (spectro && spectro.cvs.width === W && spectro.cvs.height === H) return spectro;
    const cvs = document.createElement('canvas');
    cvs.width = Math.max(2, W); cvs.height = Math.max(2, H);
    const c = cvs.getContext('2d', { alpha: false });
    c.fillStyle = C.bg1; c.fillRect(0, 0, W, H);
    spectro = { cvs, ctx: c };
    return spectro;
  }

  // ---- frequency helpers ---------------------------------------------------
  const fMax = () => Math.min(16000, sampleRate / 2);
  const binHz = () => sampleRate / FFT_N;
  function freqAt(x, w) {
    const f0 = LOG_MIN, f1 = fMax();
    return f0 * Math.pow(f1 / f0, Math.max(0, Math.min(1, x / w)));
  }
  /** Peak amplitude over the bins covering [fa, fb] in `src`. */
  function bandAmp(src, fa, fb) {
    const lo = Math.max(1, Math.floor(fa / binHz()));
    const hi = Math.min(BINS - 1, Math.ceil(fb / binHz()));
    let m = 0;
    for (let i = lo; i <= hi; i++) if (src[i] > m) m = src[i];
    return m;
  }
  const toDb = (a) => 20 * Math.log10(a + 1e-9);

  // ---- grid / background ---------------------------------------------------
  function background() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg0); g.addColorStop(1, C.bg1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.grid;
    for (let i = 1; i < 10; i++) {
      const x = Math.round((W * i) / 10) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let i = 1; i < 8; i++) {
      const y = Math.round((H * i) / 8) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  function axisLabels() {
    ctx.fillStyle = C.axis;
    ctx.font = '9px "Cascadia Mono", Consolas, monospace';
    ctx.textBaseline = 'top';
    const f1 = fMax();
    for (const f of [100, 1000, 10000]) {
      if (f >= f1) continue;
      const x = (Math.log(f / LOG_MIN) / Math.log(f1 / LOG_MIN)) * W;
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, 3);
    }
  }

  // ---- modes ---------------------------------------------------------------
  function drawScope() {
    background();
    ctx.strokeStyle = C.gridHi;
    ctx.beginPath();
    ctx.moveTo(0, H / 2 + 0.5); ctx.lineTo(W, H / 2 + 0.5); ctx.stroke();

    // Trigger on the first rising zero crossing so the sweep stands still.
    let start = 0;
    for (let i = 0; i < FFT_N / 2; i++) if (wave[i] <= 0 && wave[i + 1] > 0) { start = i; break; }
    const n = FFT_N - start - 1;
    const gain = autoGain();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.wave;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(240,166,60,0.55)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * W;
      const v = Math.max(-1, Math.min(1, wave[start + i] * gain));
      const y = H / 2 + v * (H / 2 - 4);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** Constant-ish display gain: lift quiet plucks without letting chords clip. */
  function autoGain() {
    let peak = 0;
    for (let i = 0; i < FFT_N; i++) { const a = Math.abs(wave[i]); if (a > peak) peak = a; }
    if (peak < 1e-4) return 1;
    return Math.min(3.4, 0.72 / peak);
  }

  function drawSpectrum() {
    background();
    axisLabels();
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, C.barLo);
    grad.addColorStop(0.55, C.barMid);
    grad.addColorStop(1, C.barHi);
    ctx.fillStyle = grad;
    const step = 2;
    for (let x = 0; x < W; x += step) {
      const fa = freqAt(x, W), fb = freqAt(x + step, W);
      const db = toDb(bandAmp(level, fa, Math.max(fb, fa * 1.02)));
      let n = (db + 84) / 84;             // -84 dBFS .. 0 dBFS
      n = Math.max(0, Math.min(1, n));
      const h = Math.pow(n, 1.35) * (H - 6);
      if (h > 0.5) ctx.fillRect(x, H - h, step - 1, h);
    }
  }

  function pushSpectroColumn() {
    const { cvs, ctx: bctx } = spectroBuf();
    // Scroll one column left; 'copy' clears the vacated column instead of
    // ghosting the previous frame into it.
    bctx.globalCompositeOperation = 'copy';
    bctx.drawImage(cvs, -1, 0);
    bctx.globalCompositeOperation = 'source-over';
    const img = bctx.createImageData(1, H);
    const px = img.data;
    const f0 = LOG_MIN, f1 = fMax();
    for (let y = 0; y < H; y++) {
      const t = 1 - y / H;                // bottom = low frequency
      const fa = f0 * Math.pow(f1 / f0, t);
      const fb = f0 * Math.pow(f1 / f0, Math.min(1, t + 1 / H));
      const db = toDb(bandAmp(amp, fa, Math.max(fb, fa * 1.02)));
      let n = Math.max(0, Math.min(1, (db + 78) / 78));
      n = n * n;                          // contrast: floor sits at background
      const [r, g, b] = rampColor(n);
      const o = y * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
    bctx.putImageData(img, W - 1, 0);
  }

  function drawSpectrogram() {
    const { cvs } = spectroBuf();
    ctx.drawImage(cvs, 0, 0, W, H);
    axisLabels();
    // A soft right-edge "now" line, like the scan head.
    ctx.fillStyle = 'rgba(255,217,143,0.35)';
    ctx.fillRect(W - 1, 0, 1, H);
  }

  function draw() {
    if (!W || !H) resize();
    if (mode === 'osc') drawScope();
    else if (mode === 'spectrum') drawSpectrum();
    else drawSpectrogram();
  }

  // ---- loop ---------------------------------------------------------------
  let raf = 0;
  let last = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (document.visibilityState !== 'visible') { last = t; return; }
    const dt = last ? t - last : 16;
    last = t;
    resize();
    if (mode === 'spectrum') {
      // Bars fall back toward the floor between frames (30 Hz data, 60 Hz
      // paint), the way PsydeClip's analyser smoothing did.
      const decay = Math.pow(0.86, dt / 16.7);
      for (let i = 0; i < BINS; i++) level[i] *= decay;
      for (let i = 0; i < BINS; i++) if (amp[i] > level[i]) level[i] = amp[i];
    }
    draw();
  }

  // ---- public API ----------------------------------------------------------
  function setMode(next) {
    if (next !== 'osc' && next !== 'spectrum' && next !== 'spectrogram') return;
    mode = next;
    if (mode === 'spectrogram') {
      const { ctx: b } = spectroBuf();
      b.fillStyle = C.bg1; b.fillRect(0, 0, W, H);
    }
    for (const b of tabs) b.setAttribute('aria-pressed', String(b.dataset.viz === mode));
  }

  for (const b of tabs) {
    b.addEventListener('click', () => setMode(b.dataset.viz));
  }

  /** payload: { wave: number[] (-127..127), sr?: number } */
  function push(payload) {
    if (!payload || !payload.wave || !payload.wave.length) return;
    if (payload.sr) sampleRate = payload.sr;
    const src = payload.wave;
    for (let i = 0; i < FFT_N; i++) {
      const v = src[i] !== undefined ? src[i] : (src[src.length - 1] || 0);
      wave[i] = Math.max(-1, Math.min(1, v / 127));
    }
    hasData = true;
    spectrumOf(wave, amp);
    pushSpectroColumn();
  }

  // The scope box is fluid (it fills its panel row), so re-measure whenever the
  // layout changes instead of only on first frame: the bitmap must match the
  // CSS box or the trace would be stretched.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => resize()).observe(canvas);

  // Spectrogram needs its buffer even before the first frame arrives.
  resize();
  setMode('osc');
  raf = requestAnimationFrame(frame);

  return {
    push,
    setMode,
    get mode() { return mode; },
    get hasData() { return hasData; },
    destroy() { cancelAnimationFrame(raf); },
  };
}
