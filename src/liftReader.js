/* ════════════════════════════════════════════════════════════
   LIFT READER — v3.17
   Goes through a deck-camera video and finds every lift:
     1. motion — the moving load against the deck (small grey frames,
        global shift compensated so a hand-held clip works too);
     2. events — consecutive frames with a moving load = one lift;
     3. reading — the load is cropped from the full frame every 0.5 s
        and read with PaddleOCR (vision.js); every reading votes for
        a unit from the candidates (load list, Imported queue, deck),
        weighing the usual misreads (1/T, 0/O, 8/B…) and the digit group;
     4. where — the first / last still position of the load, mapped onto
        the deck through the camera calibration.
   Runs entirely on this computer.
════════════════════════════════════════════════════════════ */
import { readText, loadOcr } from './vision.js';

/* ── matching ──────────────────────────────────────────────── */
const N = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const CONF = new Set(['1T', 'T1', '1I', 'I1', 'IT', 'TI', '0O', 'O0', '0D', 'D0', 'OD', 'DO', '8B', 'B8', '5S', 'S5', '2Z', 'Z2',
                      '6G', 'G6', '0Q', 'Q0', '7T', 'T7', '1L', 'L1', '4A', 'A4', '3B', 'B3', '8S', 'S8', 'CG', 'GC', 'CL', 'LC']);
function wlev(a, b){
  let d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for(let i = 1; i <= a.length; i++){
    const p = d.slice(); d[0] = i;
    for(let j = 1; j <= b.length; j++){
      const sub = a[i - 1] === b[j - 1] ? 0 : (CONF.has(a[i - 1] + b[j - 1]) ? 0.3 : 1);
      d[j] = Math.min(p[j] + 1, d[j - 1] + 1, p[j - 1] + sub);
    }
  }
  return d[b.length];
}
function digitKey(ccu){
  const g = String(ccu || '').toUpperCase().replace(/CCT\s*23\s*-?/, 'CCT23 ').match(/\d{3,}/g);
  return g ? g[g.length - 1] : '';
}
/* the digits of a unit's id that come before its key group ("CCT23-820" → "23") */
function digitsBefore(ccu, key){
  const all = N(ccu).replace(/\D/g, '');
  return key && all.endsWith(key) ? all.slice(0, all.length - key.length) : '';
}
/* stencilled weights and capacities are not unit numbers */
const WEIGHT_WORDS = /\b(MGW|MAX\s*GROSS|GROSS|TARE|PAYLOAD|NET|KGS?|LBS?|SWL|WLL|MAX)\b/i;
/* Candidates → matcher. A reading votes for the best unit within cost 0.8,
   or by a unique digit group (≥ 3 digits) found in it. */
export function makeMatcher(cands){
  const list = cands.map(c => { const d = digitKey(c.ccu); return Object.assign({}, c, { n: N(c.ccu), d, pre: digitsBefore(c.ccu, d) }); }).filter(c => c.n.length >= 3);
  /* digit groups that point at exactly one candidate */
  const keys = list.filter(c => c.d && list.filter(o => o.d && (o.d.endsWith(c.d) || c.d.endsWith(o.d))).length === 1);
  return text => {
    const r = N(text);
    if(r.length < 3) return null;
    let best = null;
    for(const c of list){
      const L = c.n.length;
      for(const ln of [L - 1, L, L + 1]){
        if(ln < 3) continue;
        for(let i = 0; i <= Math.max(0, r.length - ln); i++){
          const cost = wlev(r.slice(i, i + ln), c.n);
          if(!best || cost < best.cost) best = { cost, c };
        }
      }
    }
    /* v3.37.2 — only look-alike substitutions (1/I, 0/O, 8/B…) count as a
       reading of the unit; one plainly wrong character ("ABC129" for
       ABC123) is a weaker "near" vote that alone cannot make a lift Sure */
    if(best && r.length >= best.c.n.length - 1){
      if(best.cost <= 0.8) return { c: best.c, how: 'text', cost: best.cost };
      /* an ISO id read without its check digit ("ABCU 123456" for ABCU 123456-7) */
      const cn = best.c.n;
      if(cn.length >= 8 && /\d$/.test(cn) && r.includes(cn.slice(0, -1))) return { c: best.c, how: 'text', cost: best.cost };
      if(best.c.n.length >= 6 && best.cost <= 1.0) return { c: best.c, how: 'near', cost: best.cost };
    }
    /* a digit group that ends with a candidate's number: "23820" → CCT23-820.
       v3.37.2: at least 4 digits, the extra leading digits must be the
       unit's own ("5820" is not CCT23-820), and weight stencils
       ("MGW 5820 KG", "TARE 1820") never vote. */
    if(WEIGHT_WORDS.test(String(text || ''))) return null;
    const dg = (r.replace(/O/g, '0').match(/\d{4,}/g) || []);
    for(const g of dg){
      const c = keys.find(k => g.endsWith(k.d) && g.length - k.d.length <= 3 && k.pre.endsWith(g.slice(0, g.length - k.d.length)));
      if(c) return { c, how: 'digits' };
    }
    return null;
  };
}

/* ── frames ───────────────────────────────────────────────── */
/* resolves true when the frame is there, false on a decode error or after
   3 s (a released or broken video used to hang the analysis forever) */
function seek(v, t){
  return new Promise(res => {
    let to = 0;
    const end = ok => { clearTimeout(to); v.removeEventListener('seeked', onOk); v.removeEventListener('error', onErr); res(ok); };
    const onOk = () => end(true), onErr = () => end(false);
    v.addEventListener('seeked', onOk);
    v.addEventListener('error', onErr);
    to = setTimeout(() => end(false), 3000);
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05));
  });
}
function grab(v, w, h){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, w, h);
  return c;
}
function grayOf(c){
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, g = new Float32Array(c.width * c.height);
  for(let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  /* 3×3 box blur */
  const w = c.width, h = c.height, o = new Float32Array(g.length);
  for(let y = 1; y < h - 1; y++) for(let x = 1; x < w - 1; x++){
    let s = 0; for(let j = -1; j <= 1; j++) for(let i = -1; i <= 1; i++) s += g[(y + j) * w + x + i];
    o[y * w + x] = s / 9;
  }
  return { g: o, w, h };
}
/* Global shift a→b (camera shake), ±R px, by mean absolute difference on a grid. */
function shiftOf(a, b, R = 6){
  let best = { dx: 0, dy: 0, e: Infinity };
  for(let dy = -R; dy <= R; dy++) for(let dx = -R; dx <= R; dx++){
    let e = 0, n = 0;
    for(let y = R + 4; y < a.h - R - 4; y += 3) for(let x = R + 4; x < a.w - R - 4; x += 3){
      e += Math.abs(a.g[y * a.w + x] - b.g[(y + dy) * b.w + x + dx]); n++;
    }
    e /= n;
    if(e < best.e) best = { dx, dy, e };
  }
  return best;
}
/* Moving blob in b vs a (after shift): largest component of |b − a| > T. */
function movingBlob(a, b, sh){
  const w = b.w, h = b.h, m = new Uint8Array(w * h), R = 8;
  for(let y = R; y < h - R; y++) for(let x = R; x < w - R; x++){
    const ay = y - sh.dy, ax = x - sh.dx;
    if(Math.abs(b.g[y * w + x] - a.g[ay * w + ax]) > 24) m[y * w + x] = 1;
  }
  /* dilate 2 */
  const d = new Uint8Array(w * h);
  for(let y = 2; y < h - 2; y++) for(let x = 2; x < w - 2; x++){
    if(!m[y * w + x]) continue;
    for(let j = -2; j <= 2; j++) for(let i = -2; i <= 2; i++) d[(y + j) * w + x + i] = 1;
  }
  const lab = new Int32Array(w * h); let best = null, id = 0; const st = [];
  for(let k = 0; k < w * h; k++){
    if(!d[k] || lab[k]) continue;
    id++; lab[k] = id; st.push(k);
    let x0 = w, x1 = 0, y0 = h, y1 = 0, n = 0;
    while(st.length){
      const q = st.pop(), x = q % w, y = (q - x) / w; n++;
      if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
      for(const nb of [q - 1, q + 1, q - w, q + w]) if(nb >= 0 && nb < w * h && d[nb] && !lab[nb]){ lab[nb] = id; st.push(nb); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if(bw < 12 || bh < 12 || bw > w * 0.8 || bh > h * 0.8) continue;
    if(n < w * h * 0.003) continue;
    if(!best || n > best.n) best = { x0, y0, x1, y1, n };
  }
  if(!best) return null;
  const r = { x: best.x0 / w, y: best.y0 / h, w: (best.x1 - best.x0 + 1) / w, h: (best.y1 - best.y0 + 1) / h };
  return Math.min(r.w, r.h) < 0.05 ? null : r;
}

/* ── main ─────────────────────────────────────────────────── */
/* video: HTMLVideoElement (loaded). opts: { candidates, onProgress(frac, info), shouldStop(), stepS, ocrStepS } */
export async function analyseVideo(video, opts){
  const { candidates = [], onProgress = () => {}, shouldStop = () => false } = opts || {};
  const stepS = opts && opts.stepS || 0.25, ocrStepS = opts && opts.ocrStepS || 0.25;
  await loadOcr();
  const match = makeMatcher(candidates);
  const W = video.videoWidth, H = video.videoHeight, dur = video.duration;
  /* a WebM recorded in the app can report Infinity until fully indexed */
  if(!Number.isFinite(dur) || dur <= 0) throw new Error('The video length is unknown — save the recording again or convert it to MP4');
  const SW = 270, SH = Math.round(SW * H / W);
  const samples = [];
  let prev = null, lastOcr = -1, seekFails = 0;
  const src0 = video.currentSrc;
  for(let t = 0; t < dur; t += stepS){
    if(shouldStop() || video.currentSrc !== src0) break;
    if(!(await seek(video, t))){ if(++seekFails >= 3) throw new Error('The video stopped decoding at ' + t.toFixed(1) + ' s'); continue; }
    if(shouldStop()) break;
    const small = grayOf(grab(video, SW, SH));
    let blob = null;
    if(prev){
      const sh = shiftOf(prev, small);
      blob = movingBlob(prev, small, sh);
    }
    const s = { t, blob, texts: [] };
    if(blob && t - lastOcr >= ocrStepS - 1e-6){
      lastOcr = t;
      const pad = 0.15;
      const x0 = Math.max(0, (blob.x - blob.w * pad)) * W, y0 = Math.max(0, (blob.y - blob.h * pad)) * H;
      const x1 = Math.min(1, blob.x + blob.w * (1 + pad)) * W, y1 = Math.min(1, blob.y + blob.h * (1 + pad)) * H;
      const cw = Math.max(8, x1 - x0), ch = Math.max(8, y1 - y0);
      const k = Math.max(1, Math.min(3, 800 / Math.max(cw, ch)));
      const crop = document.createElement('canvas'); crop.width = Math.round(cw * k); crop.height = Math.round(ch * k);
      crop.getContext('2d').drawImage(video, x0, y0, cw, ch, 0, 0, crop.width, crop.height);
      /* keep a small thumbnail per sample, not the full crop (≈8 MB each at 1080p) */
      { const tk = Math.min(1, 240 / Math.max(crop.width, crop.height)); const th = document.createElement('canvas');
        th.width = Math.max(1, Math.round(crop.width * tk)); th.height = Math.max(1, Math.round(crop.height * tk));
        th.getContext('2d').drawImage(crop, 0, 0, th.width, th.height); s.thumb = th; }
      const rot = document.createElement('canvas'); rot.width = crop.height; rot.height = crop.width;
      const rx = rot.getContext('2d'); rx.translate(rot.width, 0); rx.rotate(Math.PI / 2); rx.drawImage(crop, 0, 0);
      /* the crop has a margin around the load; text centred in the margin
         is usually a neighbouring unit on deck — it does not vote */
      const cx0 = (blob.x * W - x0) / cw, cx1 = ((blob.x + blob.w) * W - x0) / cw;
      const cy0 = (blob.y * H - y0) / ch, cy1 = ((blob.y + blob.h) * H - y0) / ch;
      const inCore = (u, v) => u >= cx0 && u <= cx1 && v >= cy0 && v <= cy1;
      const found = [];
      try{ (await readText(crop)).forEach(q => { found.push({ text: q.text, score: q.score, u: q.cx / crop.width, v: q.cy / crop.height }); }); }catch(e){}
      try{ (await readText(rot)).forEach(q => {
        /* rot = crop turned 90° clockwise: (X, Y) in rot → (Y, rot.width − X) in crop */
        found.push({ text: q.text, score: q.score, u: q.cy / rot.height, v: (rot.width - q.cx) / rot.width });
      }); }catch(e){}
      const bx = blob.x + blob.w / 2, by = blob.y + blob.h / 2;
      s.votes = [];
      found.forEach(q => {
        if(q.score < 0.5 || !inCore(q.u, q.v)) return;
        s.texts.push(q.text);
        const m = match(q.text);
        /* where the text is in the frame, and relative to the moving load */
        if(m) s.votes.push(Object.assign(m, { t, fx: (x0 + q.u * cw) / W, fy: (y0 + q.v * ch) / H, bx, by }));
      });
    }
    samples.push(s);
    prev = small;
    onProgress(Math.min(1, t / dur), { t, blob, texts: s.texts });
  }
  return { events: buildEvents(samples, stepS), duration: dur, width: W, height: H };
}

function buildEvents(samples, stepS){
  const evs = [];
  let cur = null, gap = 0;
  for(const s of samples){
    if(s.blob){
      if(!cur){ cur = { samples: [] }; evs.push(cur); }
      cur.samples.push(s); gap = 0;
    }else if(cur){
      gap += stepS;
      if(gap > 1.5){ cur = null; gap = 0; }
    }
  }
  return evs.filter(e => e.samples.length * stepS >= 1.5).map(e => {
    const groups = new Map();
    let nRead = 0;
    e.samples.forEach(s => (s.votes || []).forEach(v => {
      nRead++;
      const g = groups.get(v.c.ccu) || { c: v.c, votes: [] };
      g.votes.push(v); groups.set(v.c.ccu, g);
    }));
    /* Text painted on the load moves with it; a unit standing on deck under
       the load stays put in the frame. Static text barely votes. */
    const spread = pts => {
      const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return pts.reduce((a, p) => a + Math.hypot(p[0] - mx, p[1] - my), 0) / pts.length;
    };
    const tally = new Map();
    groups.forEach((g, k) => {
      let w = 1;
      if(g.votes.length >= 2){
        const sAbs = spread(g.votes.map(v => [v.fx, v.fy]));
        const sRel = spread(g.votes.map(v => [v.fx - v.bx, v.fy - v.by]));
        if(sAbs < 0.6 * sRel) w = 0.2;
      }
      g.n = g.votes.reduce((a, v) => a + (v.how === 'text' ? 1 : v.how === 'near' ? 0.4 : 0.8), 0) * w;
      g.textVotes = g.votes.filter(v => v.how === 'text').length;
      g.static = w < 1;
      tally.set(k, g);
    });
    const ranked = [...tally.values()].sort((a, b) => b.n - a.n);
    const top = ranked[0], second = ranked[1];
    /* "Sure" needs real readings of the unit's id, not only near misses or digit groups */
    const conf = !top ? 'none' : (top.n >= 4 && top.textVotes >= 2 && (!second || top.n >= 2.5 * second.n)) ? 'high' : top.n >= 2 ? 'low' : 'none';
    const first = e.samples[0], last = e.samples[e.samples.length - 1];
    const ctr = s => [s.blob.x + s.blob.w / 2, s.blob.y + s.blob.h];   /* bottom-centre */
    const still = arr => arr.length >= 3 && arr.every((s, i) => i === 0 || Math.hypot(ctr(s)[0] - ctr(arr[i - 1])[0], ctr(s)[1] - ctr(arr[i - 1])[1]) < 0.012);
    const endStill = still(e.samples.slice(-4)) || still(e.samples.slice(-5, -1));
    const startStill = still(e.samples.slice(0, 4)) || still(e.samples.slice(1, 5));
    const edge = s => s.blob.y < 0.02 || s.blob.x < 0.02 || s.blob.x + s.blob.w > 0.98;
    const kind = endStill && !edge(last) ? 'landed' : (startStill || edge(last)) ? 'lifted' : 'moved';
    /* where: the still load at the start (lifted) or at the end (landed);
       the very first frame of a lift is often the empty hook coming in */
    const ss = e.samples, n = ss.length;
    const pick = kind === 'landed'
      ? (still(ss.slice(-4)) ? ss[n - 1] : ss[Math.max(0, n - 2)])
      : (still(ss.slice(0, 4)) ? ss[0] : still(ss.slice(1, 5)) ? ss[1] : ss[Math.min(n - 1, 1)]);
    /* most frequent raw reading (shown when nothing on the lists matches) */
    const rawC = new Map();
    e.samples.forEach(s => {
      /* the reader often splits "AMF 215" into two pieces — try pairs too */
      const parts = s.texts.map(N).filter(Boolean), seen = new Set();
      const add = r => { if(r.length >= 4 && r.length <= 12 && /\d/.test(r) && /[A-Z]/.test(r) && !seen.has(r)){ seen.add(r); rawC.set(r, (rawC.get(r) || 0) + 1); } };
      parts.forEach((r, i) => { add(r); parts.forEach((q, j) => { if(i !== j && /^[A-Z]+$/.test(r) && /^\d+$/.test(q)) add(r + q); }); });
    });
    const rawTop = [...rawC.entries()].sort((a, b) => b[1] - a[1])[0];
    const thumbS = e.samples.filter(s => s.thumb).sort((a, b) => (b.votes || []).length - (a.votes || []).length)[0];
    return {
      t0: first.t, t1: last.t, kind, conf,
      unit: top ? top.c : null, votes: top ? Math.round(top.n * 10) / 10 : 0,
      alt: ranked.slice(1, 3).map(o => ({ ccu: o.c.ccu, votes: Math.round(o.n * 10) / 10 })),
      readings: nRead,
      raw: rawTop && rawTop[1] >= 2 ? rawTop[0] : '',
      at: ctr(pick),                                       /* normalised source frame */
      thumb: thumbS ? thumbS.thumb : null,
    };
  });
}
