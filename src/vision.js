/* ════════════════════════════════════════════════════════════
   VISION — v3.17
   Offline text reading for the deck camera: PaddleOCR PP-OCRv4
   (DB text detection + SVTR/CTC recognition) on ONNX Runtime Web (WASM),
   with the same pre/post-processing as PaddleOCR itself. Models and the
   runtime are served from /ocr/ by the Vite plugin — nothing is fetched
   from the internet. Loaded lazily the first time it is needed.
════════════════════════════════════════════════════════════ */
let ORT = null, DET = null, REC = null, KEYS = null, loading = null;

export async function loadOcr(){
  if(DET && REC && KEYS) return true;
  if(loading) return loading;
  loading = (async () => {
    const mod = await import('onnxruntime-web');
    ORT = mod.InferenceSession ? mod : mod.default;
    ORT.env.wasm.wasmPaths = '/ocr/';
    ORT.env.wasm.numThreads = 1;              /* no cross-origin isolation in the WebView */
    ORT.env.logLevel = 'error';
    const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const [det, rec, keys] = await Promise.all([
      ORT.InferenceSession.create('/ocr/ppocr-det.onnx', opt),
      ORT.InferenceSession.create('/ocr/ppocr-rec.onnx', opt),
      fetch('/ocr/ppocr-keys.txt').then(r => r.text()),
    ]);
    DET = det; REC = rec;
    KEYS = ['blank', ...keys.split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l), ' '];
    return true;
  })();
  try{ return await loading; }catch(e){ loading = null; throw e; }
}

/* ── helpers ───────────────────────────────────────────────── */
/* v3.40 — also runs inside a Web Worker (visionWorker.js): OffscreenCanvas there */
const HAS_DOM = typeof document !== 'undefined';
function canvasOf(w, h){
  if(!HAS_DOM) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function toCanvas(img){
  if((typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)) return img;
  const c = canvasOf(img.width, img.height);
  if(typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap){ c.getContext('2d').drawImage(img, 0, 0); return c; }
  c.getContext('2d').putImageData(img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}
/* RGBA canvas pixels → CHW float tensor in BGR order, (x/255 − mean)/std */
function toTensor(ctx, w, h, mean, std){
  const d = ctx.getImageData(0, 0, w, h).data, n = w * h, out = new Float32Array(3 * n);
  for(let i = 0; i < n; i++){
    const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
    out[i]         = (b - mean[0]) / std[0];
    out[n + i]     = (g - mean[1]) / std[1];
    out[2 * n + i] = (r - mean[2]) / std[2];
  }
  return new ORT.Tensor('float32', out, [1, 3, h, w]);
}

/* Convex hull (monotone chain) of integer points. */
function hull(pts){
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for(const p of pts){ while(lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for(let i = pts.length - 1; i >= 0; i--){ const p = pts[i]; while(up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
/* Minimum-area rectangle around a hull (rotating edges). */
function minRect(h){
  if(h.length < 3){
    const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2,
             w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1, a: 0 };
  }
  let best = null;
  for(let i = 0; i < h.length; i++){
    const p = h[i], q = h[(i + 1) % h.length];
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]), c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for(const r of h){ const u = r[0] * c + r[1] * s, v = -r[0] * s + r[1] * c; if(u < x0) x0 = u; if(u > x1) x1 = u; if(v < y0) y0 = v; if(v > y1) y1 = v; }
    const area = (x1 - x0) * (y1 - y0);
    if(!best || area < best.area){
      const mu = (x0 + x1) / 2, mv = (y0 + y1) / 2;
      best = { area, a, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: mu * c - mv * s, cy: mu * s + mv * c };
    }
  }
  return best;
}

/* ── detection (DB) ────────────────────────────────────────── */
async function detect(src){
  const W0 = src.width, H0 = src.height;
  /* PaddleOCR default: smaller side up to 736, both sides multiple of 32, longer side ≤ 1600 */
  let s = Math.max(1, 736 / Math.min(W0, H0));
  if(Math.max(W0, H0) * s > 1600) s = 1600 / Math.max(W0, H0);
  const w = Math.max(32, Math.round(W0 * s / 32) * 32), h = Math.max(32, Math.round(H0 * s / 32) * 32);
  const c = canvasOf(w, h), ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  /* PaddleOCR normalises the BGR image with these values in that channel order */
  const t = toTensor(ctx, w, h, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
  const out = await DET.run({ [DET.inputNames[0]]: t });
  const prob = out[DET.outputNames[0]].data;               /* [1,1,h,w] */
  /* threshold 0.3, connected components (4-neighbour) */
  const lab = new Int32Array(w * h), boxes = [];
  const stack = [];
  for(let i = 0; i < w * h; i++){
    if(lab[i] || prob[i] <= 0.3) continue;
    const id = boxes.length + 1, pts = [];
    let sum = 0, n = 0;
    lab[i] = id; stack.push(i);
    while(stack.length){
      const k = stack.pop(), x = k % w, y = (k - x) / w;
      pts.push([x, y]); sum += prob[k]; n++;
      if(x > 0 && !lab[k - 1] && prob[k - 1] > 0.3){ lab[k - 1] = id; stack.push(k - 1); }
      if(x < w - 1 && !lab[k + 1] && prob[k + 1] > 0.3){ lab[k + 1] = id; stack.push(k + 1); }
      if(y > 0 && !lab[k - w] && prob[k - w] > 0.3){ lab[k - w] = id; stack.push(k - w); }
      if(y < h - 1 && !lab[k + w] && prob[k + w] > 0.3){ lab[k + w] = id; stack.push(k + w); }
    }
    boxes.push(null);
    if(n < 12 || sum / n < 0.6) continue;                   /* box_thresh 0.6 (PP-OCRv4) */
    const r = minRect(hull(pts));
    if(Math.min(r.w, r.h) < 3) continue;
    /* unclip 1.5: grow by area·ratio / perimeter on every side */
    const d = r.w * r.h * 1.5 / (2 * (r.w + r.h));
    boxes[boxes.length - 1] = { cx: r.cx, cy: r.cy, a: r.a, w: r.w + 2 * d, h: r.h + 2 * d, score: sum / n };
  }
  const sx = W0 / w, sy = H0 / h;
  return boxes.filter(Boolean).map(b => {
    /* back to source pixels (anisotropic rounding is tiny; use mean scale for sizes) */
    const k = (sx + sy) / 2;
    return { cx: b.cx * sx, cy: b.cy * sy, a: b.a, w: b.w * k, h: b.h * k, score: b.score };
  });
}

/* ── recognition (CTC) ─────────────────────────────────────── */
function cropBox(src, b, flip){
  /* long side horizontal; flip = read it upside down as well */
  let a = b.a, bw = b.w, bh = b.h;
  if(bh > bw){ a += Math.PI / 2; [bw, bh] = [bh, bw]; }
  if(flip) a += Math.PI;
  const H = 48, W = Math.max(16, Math.min(640, Math.round(H * bw / bh)));
  const c = canvasOf(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.scale(W / bw, H / bh);
  ctx.rotate(-a);
  ctx.translate(-b.cx, -b.cy);
  ctx.drawImage(src, 0, 0);
  return { ctx: c.getContext('2d'), W, H };
}
async function recognise(src, b, flip){
  const { ctx, W, H } = cropBox(src, b, flip);
  const t = toTensor(ctx, W, H, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  const out = await REC.run({ [REC.inputNames[0]]: t });
  const o = out[REC.outputNames[0]], [, T, C] = o.dims, p = o.data;
  let text = '', last = 0, sc = 0, n = 0;
  for(let i = 0; i < T; i++){
    let m = 0, mv = -1;
    for(let j = 0; j < C; j++){ const v = p[i * C + j]; if(v > mv){ mv = v; m = j; } }
    if(m !== 0 && m !== last){ text += KEYS[m] || ''; sc += mv; n++; }
    last = m;
  }
  return { text, score: n ? sc / n : 0 };
}

/* Read all text in an image (canvas / ImageData). → [{text, score, cx, cy, w, h, a}] */
export async function readText(img, { both = true, max = 40 } = {}){
  await loadOcr();
  const src = toCanvas(img);
  const boxes = await detect(src);
  const res = [];
  for(const b of boxes.slice(0, max)){
    const r1 = await recognise(src, b, false);
    const r2 = both ? await recognise(src, b, true) : { text: '', score: 0 };
    const r = r2.score > r1.score ? r2 : r1;
    if(r.text.trim()) res.push(Object.assign({ cx: b.cx, cy: b.cy, w: b.w, h: b.h, a: b.a }, r));
  }
  return res;
}
