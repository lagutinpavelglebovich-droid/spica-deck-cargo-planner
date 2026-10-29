/* ════════════════════════════════════════════════════════════
   LIFT TRACKER — v3.40
   Follows the one load that moves over a still deck, frame by frame,
   the way a drone's subject lock does — live while a video plays or the
   bridge camera runs.

     1. steady  — the hand-held shake is measured against the deck
                  (integer shift on a sparse grid of deck edges) and the
                  frame is read in deck-steady coordinates;
     2. change  — every pixel keeps its usual colour and how much it
                  usually varies (sea, rain): only a clear change counts,
                  thin things (the crane wire) are dropped, the open
                  lattice of a basket is closed into one shape;
     3. lock    — a shape that keeps moving for a few frames is locked;
                  from then on it is followed by its own picture
                  (normalised correlation) plus the change shape around
                  it, so it stays locked when it hovers or stands still,
                  and the deck under it is not learned as background;
     4. events  — the lock ends still on the deck → LANDED at its foot;
                  it started still and left → LIFTED from there.

   Pure code on RGBA/RGB pixel arrays — no DOM, unit-tested in
   tools/test-lift-track.mjs on real deck videos.
════════════════════════════════════════════════════════════ */

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function createTracker(opts = {}){
  const O = Object.assign({
    minArea: 0.003,       /* of the frame — smaller is a person or the hook */
    maxArea: 0.25,
    lockFrames: 3,        /* frames a moving shape must persist to lock */
    lockMove: 0.012,      /* of the frame height it must move meanwhile */
    stillDisp: 0.012,     /* foot moved less than this (frame height) in 1 s = still */
    setS: 1.5,            /* still this long = set down (shown as landing) */
    settleS: 5,           /* still this long = landed for good, the lock ends */
    quietS: 25,
    minTravel: 0.06,      /* frame heights a lock must travel to count as a lift */           /* no new lock on a landed load for this long (slings, people) */
    lostS: 1.2,
  }, opts);
  let W = 0, H = 0, N = 0, mu = null, sd = null, cur = null, gray = null, prevGray = null, fg = null, tmp = null, tmp2 = null;
  let off = [0, 0], frames = 0, track = null, cands = [], quiet = [], dropped = [], landedAt = [], nextId = 1;
  const events = [];

  function init(w, h){
    W = w; H = h; N = w * h;
    mu = new Float32Array(N * 3); cur = new Float32Array(N * 3); sd = new Float32Array(N).fill(8);
    gray = new Float32Array(N); prevGray = new Float32Array(N);
    fg = new Uint8Array(N); tmp = new Uint8Array(N); tmp2 = new Uint8Array(N);
    frames = 0; off = [0, 0]; track = null; cands = []; quiet = []; dropped = []; landedAt = [];
  }

  /* ── 1. steady: shift of this frame against the background ── */
  function measureShift(px, ch, dt){
    if(frames < 2) return off;
    /* the deck's edges (learned picture, away from the load and the sea) */
    const box = track ? track.box : null, samp = [];
    for(let y = 8; y < H - 8; y += 3) for(let x = 8; x < W - 8; x += 3){
      const k = y * W + x;
      if(sd[k] > 14) continue;
      if(box && x > box.x - 6 && x < box.x + box.w + 6 && y > box.y - 6 && y < box.y + box.h + 6) continue;
      const gx = Math.abs(mu[(k + 1) * 3 + 1] - mu[(k - 1) * 3 + 1]) + Math.abs(mu[(k + W) * 3 + 1] - mu[(k - W) * 3 + 1]);
      if(gx < 18) continue;
      samp.push(x, y, mu[k * 3] * 0.299 + mu[k * 3 + 1] * 0.587 + mu[k * 3 + 2] * 0.114);
    }
    if(samp.length < 120) return off;
    const cost = (ox, oy) => {
      let e = 0, n = 0;
      for(let i = 0; i < samp.length; i += 3){
        const sx = samp[i] + ox, sy = samp[i + 1] + oy;
        if(sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const q = (sy * W + sx) * ch;
        e += Math.abs(px[q] * 0.299 + px[q + 1] * 0.587 + px[q + 2] * 0.114 - samp[i + 2]); n++;
      }
      return n < 40 ? Infinity : e / n;
    };
    /* a longer gap between frames allows a bigger shake: coarse, then fine */
    const R = Math.min(12, 3 + Math.ceil((dt || 0.1) * 25));
    let best = { e: cost(off[0], off[1]), ox: off[0], oy: off[1] };
    for(let dy = -R; dy <= R; dy += 2) for(let dx = -R; dx <= R; dx += 2){
      if(!dx && !dy) continue;
      const e = cost(off[0] + dx, off[1] + dy);
      if(e < best.e) best = { e, ox: off[0] + dx, oy: off[1] + dy };
    }
    const c0 = best;
    for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++){
      if(!dx && !dy) continue;
      const e = cost(c0.ox + dx, c0.oy + dy);
      if(e < best.e) best = { e, ox: c0.ox + dx, oy: c0.oy + dy };
    }
    return [best.ox, best.oy];
  }

  /* ── 2. change mask in background coordinates ── */
  function change(px, ch, learn){
    const [ox, oy] = off, box = track ? track.box : null;
    const aMu = frames < 8 ? 0.35 : 0.03, aSd = frames < 8 ? 0.2 : 0.02;
    for(let y = 0; y < H; y++){
      const sy = y + oy;
      for(let x = 0; x < W; x++){
        const k = y * W + x, sx = x + ox;
        if(sy < 0 || sy >= H || sx < 0 || sx >= W){ fg[k] = 0; gray[k] = 0; continue; }
        const q = (sy * W + sx) * ch, r = px[q], g = px[q + 1], b = px[q + 2];
        gray[k] = r * 0.299 + g * 0.587 + b * 0.114; cur[k * 3] = r; cur[k * 3 + 1] = g; cur[k * 3 + 2] = b;
        if(frames === 0){ mu[k * 3] = r; mu[k * 3 + 1] = g; mu[k * 3 + 2] = b; fg[k] = 0; continue; }
        const d = Math.max(Math.abs(r - mu[k * 3]), Math.abs(g - mu[k * 3 + 1]), Math.abs(b - mu[k * 3 + 2]));
        const on = d > Math.max(22, 3.2 * sd[k]);
        fg[k] = on ? 1 : 0;
        if(!learn) continue;
        /* the deck under a locked load is not learned — it stays "changed" */
        if(box && x >= box.x - 3 && x <= box.x + box.w + 3 && y >= box.y - 3 && y <= box.y + box.h + 3) continue;
        const a = on ? aMu * 0.15 : aMu;
        mu[k * 3] += a * (r - mu[k * 3]); mu[k * 3 + 1] += a * (g - mu[k * 3 + 1]); mu[k * 3 + 2] += a * (b - mu[k * 3 + 2]);
        sd[k] += aSd * (Math.min(d, 60) - sd[k]); if(sd[k] < 3) sd[k] = 3;
      }
    }
  }
  let sm = null, sm2 = null;
  function smooth(src, ch){
    if(!sm || sm.length !== N * 3){ sm = new Uint8ClampedArray(N * 3); sm2 = new Uint16Array(N * 3); }
    for(let y = 0; y < H; y++){
      const r = y * W;
      for(let x = 0; x < W; x++){
        const a = (r + Math.max(0, x - 1)) * ch, b = (r + x) * ch, c = (r + Math.min(W - 1, x + 1)) * ch, o = (r + x) * 3;
        sm2[o] = src[a] + src[b] + src[c]; sm2[o + 1] = src[a + 1] + src[b + 1] + src[c + 1]; sm2[o + 2] = src[a + 2] + src[b + 2] + src[c + 2];
      }
    }
    for(let y = 0; y < H; y++){
      const u = Math.max(0, y - 1) * W, m = y * W, d = Math.min(H - 1, y + 1) * W;
      for(let x = 0; x < W; x++){
        const o = (m + x) * 3, a = (u + x) * 3, c = (d + x) * 3;
        sm[o] = (sm2[a] + sm2[o] + sm2[c]) / 9; sm[o + 1] = (sm2[a + 1] + sm2[o + 1] + sm2[c + 1]) / 9; sm[o + 2] = (sm2[a + 2] + sm2[o + 2] + sm2[c + 2]) / 9;
      }
    }
    return sm;
  }
  function erode(src, dst){
    dst.fill(0);
    for(let y = 1; y < H - 1; y++) for(let x = 1; x < W - 1; x++){
      const k = y * W + x;
      dst[k] = src[k] & src[k - 1] & src[k + 1] & src[k - W] & src[k + W];
    }
  }
  function dilate(src, dst, r){
    /* separable box dilation */
    tmp2.fill(0);
    for(let y = 0; y < H; y++){
      let run = -1e9;
      for(let x = 0; x < W; x++){ if(src[y * W + x]) run = x; if(x - run <= r) tmp2[y * W + x] = 1; }
      run = 1e9;
      for(let x = W - 1; x >= 0; x--){ if(src[y * W + x]) run = x; if(run - x <= r) tmp2[y * W + x] = 1; }
    }
    dst.fill(0);
    for(let x = 0; x < W; x++){
      let run = -1e9;
      for(let y = 0; y < H; y++){ if(tmp2[y * W + x]) run = y; if(y - run <= r) dst[y * W + x] = 1; }
      run = 1e9;
      for(let y = H - 1; y >= 0; y--){ if(tmp2[y * W + x]) run = y; if(run - y <= r) dst[y * W + x] = 1; }
    }
  }
  /* components of the cleaned mask: thin lines gone, lattice closed */
  const lab = { a: null };
  function blobs(){
    erode(fg, tmp);                    /* drops the wire and speckle */
    dilate(tmp, fg, 4);                /* closes a basket's open frame */
    if(!lab.a || lab.a.length !== N) lab.a = new Int32Array(N);
    const L = lab.a; L.fill(0);
    const out = [], st = [];
    let id = 0;
    for(let k0 = 0; k0 < N; k0++){
      if(!fg[k0] || L[k0]) continue;
      id++; L[k0] = id; st.push(k0);
      let x0 = W, x1 = 0, y0 = H, y1 = 0, n = 0, sx = 0, sy = 0;
      while(st.length){
        const k = st.pop(), x = k % W, y = (k - x) / W; n++; sx += x; sy += y;
        if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
        if(x > 0 && fg[k - 1] && !L[k - 1]){ L[k - 1] = id; st.push(k - 1); }
        if(x < W - 1 && fg[k + 1] && !L[k + 1]){ L[k + 1] = id; st.push(k + 1); }
        if(y > 0 && fg[k - W] && !L[k - W]){ L[k - W] = id; st.push(k - W); }
        if(y < H - 1 && fg[k + W] && !L[k + W]){ L[k + W] = id; st.push(k + W); }
      }
      /* undo the 4-px dilation on the box (erosion already took 1) */
      const b = { x: x0 + 3, y: y0 + 3, w: Math.max(2, x1 - x0 - 5), h: Math.max(2, y1 - y0 - 5), n, cx: sx / n, cy: sy / n, id };
      if(n < O.minArea * N || n > O.maxArea * N) continue;
      /* long thin bands: a rail or deck edge shaken by the hand-held camera */
      if(Math.max(b.w, b.h) > 3.5 * Math.min(b.w, b.h)) continue;
      /* a shape across most of the picture is the camera or a rail in front of it, not a load */
      if(b.w > W * 0.6 || b.h > H * 0.5) continue;
      out.push(b);
    }
    return out;
  }

  /* ── 3. lock: own picture (NCC) around the prediction ── */
  function takeTemplate(box){
    const s = Math.max(1, Math.ceil(Math.max(box.w, box.h) / 40));
    const tw = Math.max(4, Math.floor(box.w / s)), th = Math.max(4, Math.floor(box.h / s));
    const t = new Float32Array(tw * th);
    let m = 0;
    for(let j = 0; j < th; j++) for(let i = 0; i < tw; i++){
      const x = clamp(Math.round(box.x + i * s), 0, W - 1), y = clamp(Math.round(box.y + j * s), 0, H - 1);
      const v = gray[y * W + x]; t[j * tw + i] = v; m += v;
    }
    m /= t.length;
    let v2 = 0; for(let i = 0; i < t.length; i++){ t[i] -= m; v2 += t[i] * t[i]; }
    return { t, tw, th, s, norm: Math.sqrt(v2) || 1 };
  }
  /* T at scale sc with its top-left at (x0, y0) */
  function ncc(T, x0, y0, sc = 1){
    const { t, tw, th, s } = T, st = s * sc;
    let m = 0;
    for(let j = 0; j < th; j++){ const y = Math.round(y0 + j * st) * W; for(let i = 0; i < tw; i++) m += gray[y + Math.round(x0 + i * st)]; }
    m /= t.length;
    let c = 0, v2 = 0;
    for(let j = 0; j < th; j++){
      const y = Math.round(y0 + j * st) * W;
      for(let i = 0; i < tw; i++){ const d = gray[y + Math.round(x0 + i * st)] - m; c += d * t[j * tw + i]; v2 += d * d; }
    }
    return c / ((Math.sqrt(v2) || 1) * T.norm);
  }
  /* best place (and size: the load grows as it comes closer, shrinks as it
     is lowered away from the camera; off by default — the change shape
     tells the size more reliably on real deck video) */
  function search(T, px, py, R){
    let best = { s: -2, x: px, y: py, sc: 1 };
    const st = R > 14 ? 2 : 1;
    const look = (x, y, sc) => {
      const tw = T.tw * T.s * sc, th = T.th * T.s * sc;
      if(x < 0 || y < 0 || x + tw >= W - 1 || y + th >= H - 1) return;
      const v = ncc(T, x, y, sc);
      if(v > best.s) best = { s: v, x, y, sc };
    };
    for(let dy = -R; dy <= R; dy += st) for(let dx = -R; dx <= R; dx += st) look(Math.round(px + dx), Math.round(py + dy), 1);
    if(st > 1){ const b = best; for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++) look(b.x + dx, b.y + dy, 1); }
    const b0 = best, cw = T.tw * T.s, ch = T.th * T.s;
    if(O.scaleSearch) for(const sc of [0.92, 1.08]){
      /* keep the centre */
      const bx = b0.x + cw * (1 - sc) / 2, by = b0.y + ch * (1 - sc) / 2;
      for(let dy = -2; dy <= 2; dy++) for(let dx = -2; dx <= 2; dx++) look(Math.round(bx + dx), Math.round(by + dy), sc);
    }
    return best;
  }

  const foot = b => [(b.x + b.w / 2) / W, (b.y + b.h) / H];
  const toFrame = b => ({ x: (b.x + off[0]) / W, y: (b.y + off[1]) / H, w: b.w / W, h: b.h / H });
  const footFrame = b => [(b.x + b.w / 2 + off[0]) / W, (b.y + b.h + off[1]) / H];
  const iou = (a, b) => {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    return i / (a.w * a.h + b.w * b.h - i || 1);
  };

  function lockFrom(c, t){
    track = { id: nextId++, box: { x: c.box.x, y: c.box.y, w: c.box.w, h: c.box.h }, v: [0, 0], T: null, t0: c.t0, tLast: t,
      start: c.start, startBox: c.startBox, startBg: c.startBg, startPatch: c.startPatch, startStill: c.startStill, stillSince: null, path: [], score: 1, miss: 0, phase: 'moving',
      tLock: t, lockFoot: footFrame(c.box), travel: 0, area: c.box.w * c.box.h, fromRest: false };
    track.T = takeTemplate(track.box);
    /* it starts right beside a load set down not long ago: that load moving on */
    { const sb = c.startBg, cx = sb ? sb.x + sb.w / 2 : -1, cy = sb ? sb.y + sb.h / 2 : -1;
      const la = landedAt.filter(l => t - l.t < 120 && Math.hypot(cx - (l.box.x + l.box.w / 2), cy - (l.box.y + l.box.h / 2)) < 2.2 * Math.max(l.box.w, l.box.h)).pop();
      if(la) track.moves = la.id; }
    /* a lock dropped a moment ago right where this one begins is the same
       load (taking the strain, swinging off): keep where it all started */
    const sb = c.startBg, pr = dropped.find(d => t - d.t < 2.5 && sb && Math.abs((sb.x + sb.w / 2) - (d.box.x + d.box.w / 2)) < Math.max(sb.w, d.box.w) && Math.abs((sb.y + sb.h / 2) - (d.box.y + d.box.h / 2)) < Math.max(sb.h, d.box.h));
    if(pr){ Object.assign(track, { t0: pr.t0, start: pr.start, startBox: pr.startBox, startBg: pr.startBg, startPatch: pr.startPatch, fromRest: true }); }
  }

  function updateTrack(bl, t, dt){
    const tr = track, b = tr.box;
    /* predict */
    /* tr.v is in pixels per second: frames do not always come evenly */
    const px = b.x + tr.v[0] * dt, py = b.y + tr.v[1] * dt;
    const R = Math.round(clamp(6 + Math.hypot(tr.v[0], tr.v[1]) * dt * 1.5, 6, 40));
    const m = search(tr.T, px, py, R);
    /* change shapes near the prediction (the load, maybe split) */
    /* the shapes that mostly lie where the load should be now (not the sea
       or the hook beside it): their part inside the predicted box counts */
    const pb = { x: px - b.w * 0.15, y: py - b.h * 0.15, w: b.w * 1.3, h: b.h * 1.3 };
    const inside = o => { const x0 = Math.max(o.x, pb.x), y0 = Math.max(o.y, pb.y), x1 = Math.min(o.x + o.w, pb.x + pb.w), y1 = Math.min(o.y + o.h, pb.y + pb.h);
      return Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (o.w * o.h || 1); };
    /* the main shape (most of it where the load should be) and only small
       pieces fully inside with it (a basket's frame split by the threshold) */
    const ov = o => inside(o) * o.w * o.h;
    const main = bl.filter(o => inside(o) >= 0.5).sort((p, q) => ov(q) - ov(p))[0];
    const near = main ? [main].concat(bl.filter(o => o !== main && inside(o) >= 0.8)) : [];
    let u = null;
    near.forEach(o => { u = !u ? { x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h } : { x0: Math.min(u.x0, o.x), y0: Math.min(u.y0, o.y), x1: Math.max(u.x1, o.x + o.w), y1: Math.max(u.y1, o.y + o.h) }; });
    const ub = u && { x: u.x0, y: u.y0, w: u.x1 - u.x0, h: u.y1 - u.y0 };
    let nx = px, ny = py, nw = b.w, nh = b.h, ok = false;
    const sane = ub && ub.w < b.w * 1.5 + 6 && ub.h < b.h * 1.5 + 6 && ub.w > b.w * 0.5 && ub.h > b.h * 0.5;
    /* the size follows the change shape slowly (it grows as it comes closer,
       shrinks as it is lowered) — never jumps onto the neighbours */
    const gr = Math.min(0.15, 0.5 * dt), grow = (a, c) => a * clamp(c / a, 1 - gr, 1 + gr);   /* ≤ 50 % a second */
    const mb = { x: m.x, y: m.y, w: b.w, h: b.h };
    let anchored = false;
    /* set down: only its own picture may move it now (a re-lift); the slings,
       the hook going away and people around it must not drag the lock off */
    /* …unless its picture stops matching where it stood: it is moving off */
    if(tr.phase === 'down'){
      tr.weak = m.s < 0.78 ? (tr.weak || 0) + dt : 0;
      if(tr.weak > 0.4){ tr.phase = 'moving'; tr.stillSince = null; tr.weak = 0; }
    }
    const settled = tr.phase === 'down';
    if(settled){
      if((m.s > 0.75 || (m.s > 0.6 && sane && iou(mb, ub) >= 0.4)) && Math.hypot(m.x - b.x, m.y - b.y) > 1.5){ nx = m.x; ny = m.y; }
      ok = true;
    }else if(sane && (m.s <= 0.6 || iou(mb, ub) < 0.4)){
      /* its own picture went astray (it came in over the edge, turned, swung):
         the change shape is the load — follow it and learn its picture again */
      nw = grow(b.w, 0.6 * b.w + 0.4 * ub.w); nh = grow(b.h, 0.6 * b.h + 0.4 * ub.h);
      nx = ub.x + (ub.w - nw) / 2; ny = ub.y + (ub.h - nh) / 2; ok = true; anchored = true;
    }else if(m.s > 0.6){
      nx = m.x; ny = m.y; ok = true;
      if(sane){
        nw = grow(b.w, 0.7 * b.w + 0.3 * ub.w); nh = grow(b.h, 0.7 * b.h + 0.3 * ub.h);
        const ucx = ub.x + ub.w / 2, ucy = ub.y + ub.h / 2;
        nx = 0.5 * (m.x + b.w / 2) + 0.5 * ucx - nw / 2; ny = 0.5 * (m.y + b.h / 2) + 0.5 * ucy - nh / 2;
      }
    }
    if(ok){
      const vx = (nx - b.x) / dt, vy = (ny - b.y) / dt;
      tr.v = [0.6 * tr.v[0] + 0.4 * vx, 0.6 * tr.v[1] + 0.4 * vy];
      tr.box = { x: nx, y: ny, w: nw, h: nh };
      tr.miss = 0; tr.tLast = t; tr.score = m.s;
      /* refresh its picture while it is clearly matched (it turns and swings) */
      tr.nT = (tr.nT || 0) + 1;
      if(anchored || (m.s > 0.75 && tr.nT % 3 === 0)) tr.T = takeTemplate(tr.box);
    }else{
      tr.miss += dt; tr.v = [tr.v[0] * 0.8, tr.v[1] * 0.8];
      tr.box = { x: px, y: py, w: b.w, h: b.h };
    }
    /* still = the foot moved less than stillDisp over the last second */
    const f = footFrame(tr.box);
    tr.path.push({ t, foot: f });
    tr.travel = Math.max(tr.travel, Math.hypot((f[0] - tr.lockFoot[0]) * W / H, f[1] - tr.lockFoot[1]));
    tr.area = tr.box.w * tr.box.h;
    while(tr.path.length > 2 && tr.path[0].t < t - 30) tr.path.shift();
    const back = tr.path.find(p => p.t >= t - 1.0);
    const disp = back && t - back.t > 0.6 ? Math.hypot((f[0] - back.foot[0]) * W / H, f[1] - back.foot[1]) : 1;
    tr.disp = disp;
    if(disp < O.stillDisp){ if(!tr.stillSince) tr.stillSince = { t: back.t, foot: back.foot, box: toFrame(tr.box) }; }
    else tr.stillSince = null;
    const stillFor = tr.stillSince ? t - tr.stillSince.t : 0;
    tr.phase = stillFor >= O.setS ? 'down' : 'moving';
    if(tr.phase === 'down') tr.lastDown = Object.assign({}, tr.stillSince, { seen: t });
    const bb = tr.box;
    const ccx = bb.x + bb.w / 2 + off[0], ccy = bb.y + bb.h / 2 + off[1];
    /* it went over an edge: the lock is pressed against the side it was heading to */
    const ex = bb.x + off[0], ey = bb.y + off[1];
    const E = 6, atEdge = (ex < E && tr.v[0] <= 2) || (ey < E && tr.v[1] <= 2) || (ex + bb.w > W - E && tr.v[0] >= -2) || (ey + bb.h > H - E && tr.v[1] >= -2);
    /* held at the top edge of the picture (over the sea, beyond the stern) is not set down */
    if(ey < E){ tr.stillSince = null; tr.phase = 'moving'; }
    if(atEdge){ if(tr.edgeSince == null) tr.edgeSince = { t, v: Math.hypot(tr.v[0], tr.v[1]) }; }
    else tr.edgeSince = null;
    const out = ccx < 3 || ccy < 3 || ccx > W - 3 || ccy > H - 3 || (tr.edgeSince && tr.edgeSince.v > 6 && t - tr.edgeSince.t > 0.4);
    if(out || tr.miss > O.lostS) finish(t, out ? 'left' : 'lost');
    /* a lock that never really went anywhere was not a lift (shake, a person, a flapping cover) */
    else if(t - tr.tLock > 6 && tr.travel < O.minTravel * 0.5 && !tr.stillSince) finish(t, 'junk');
    else if(tr.stillSince && stillFor >= O.settleS) finish(t, 'settled');
  }
  function emit(kind, tr, foot, t, box){
    const e = { kind, id: tr.id, t, t0: tr.t0, foot, box };
    if(tr.moves) e.moves = tr.moves;           /* the same load, set down a moment ago, moved on */
    events.push(e);
  }
  /* change pixels inside a box given in background coordinates */
  function bgPatch(b){
    const T = { x: Math.floor(b.x), y: Math.floor(b.y), w: Math.max(2, Math.floor(b.w)), h: Math.max(2, Math.floor(b.h)) };
    T.g = new Float32Array(T.w * T.h);
    for(let j = 0; j < T.h; j++) for(let i = 0; i < T.w; i++){
      const x = clamp(T.x + i, 0, W - 1), y = clamp(T.y + j, 0, H - 1), k = y * W + x;
      T.g[j * T.w + i] = mu[k * 3] * 0.299 + mu[k * 3 + 1] * 0.587 + mu[k * 3 + 2] * 0.114;
    }
    return T;
  }
  function patchNcc(T){
    let ma = 0, mb = 0; const n = T.g.length;
    for(let j = 0; j < T.h; j++) for(let i = 0; i < T.w; i++){ ma += T.g[j * T.w + i]; mb += gray[clamp(T.y + j, 0, H - 1) * W + clamp(T.x + i, 0, W - 1)]; }
    ma /= n; mb /= n;
    let c = 0, va = 0, vb = 0;
    for(let j = 0; j < T.h; j++) for(let i = 0; i < T.w; i++){
      const a = T.g[j * T.w + i] - ma, b = gray[clamp(T.y + j, 0, H - 1) * W + clamp(T.x + i, 0, W - 1)] - mb;
      c += a * b; va += a * a; vb += b * b;
    }
    return c / (Math.sqrt(va * vb) || 1);
  }
  function changedIn(b){
    let n = 0, on = 0;
    for(let y = Math.max(0, Math.floor(b.y)); y < Math.min(H, b.y + b.h); y++)
      for(let x = Math.max(0, Math.floor(b.x)); x < Math.min(W, b.x + b.w); x++){ n++; if(fg[y * W + x]) on++; }
    return n ? on / n : 0;
  }
  function learnBox(b, pad = 3){
    for(let y = Math.max(0, Math.floor(b.y - pad)); y < Math.min(H, b.y + b.h + pad + 1); y++)
      for(let x = Math.max(0, Math.floor(b.x - pad)); x < Math.min(W, b.x + b.w + pad + 1); x++){
        const k = y * W + x;
        mu[k * 3] = cur[k * 3]; mu[k * 3 + 1] = cur[k * 3 + 1]; mu[k * 3 + 2] = cur[k * 3 + 2];
        sd[k] = Math.max(sd[k], 10);
      }
  }
  function finish(t, why){
    const tr = track; track = null;
    if(!tr) return;
    if(why === 'junk' || why === 'replaced'){
      dropped.unshift({ t, box: tr.box, t0: tr.t0, start: tr.start, startBox: tr.startBox, startBg: tr.startBg, startPatch: tr.startPatch });
      dropped.length = Math.min(dropped.length, 4);
      events.push({ kind: 'end', id: tr.id, t, why }); return;
    }
    /* set down now — or, when the video ends / is stopped, set down a moment ago
       (slings and people on it keep the lock twitching) */
    const sd0 = tr.stillSince && t - tr.stillSince.t >= O.setS ? tr.stillSince : (why === 'stopped' && tr.lastDown && t - tr.lastDown.seen < 3 ? tr.lastDown : null);
    const down = sd0 && tr.travel >= O.minTravel;
    if(down){
      emit('landed', tr, sd0.foot, sd0.t, sd0.box);
      /* the landed load is deck now; slings and people on it are not new lifts for a while */
      learnBox(tr.box);
      quiet.push({ id: tr.id, box: { x: tr.box.x - tr.box.w * 0.4, y: tr.box.y - tr.box.h * 0.6, w: tr.box.w * 1.8, h: tr.box.h * 1.8 }, until: t + O.quietS });
      landedAt.push({ id: tr.id, t, box: Object.assign({}, tr.box) });
      if(landedAt.length > 12) landedAt.shift();
    }else{
      /* it began where it stood on deck (not coming in over an edge) and the
         deck it left shows as changed there → lifted from that spot */
      const sb = tr.startBg, fromEdge = sb && (sb.y < 3 || sb.x < 3 || sb.x + sb.w > W - 3);
      /* what stood there before (learned background then) against the deck now */
      const ghost = sb ? Math.max(changedIn(sb), tr.startPatch ? 1 - Math.max(0, patchNcc(tr.startPatch)) : 0) : 0;
      /* the deck it left stays "changed" and still where it stood: that is where it came from */
      const p0 = tr.path[0] ? tr.path[0].foot : tr.start;
      const gone = why === 'left' || why === 'lost';
      const gh = !gone || tr.travel < O.minTravel * 2 ? null : cands.filter(c => c.n >= 8 && c.moved < 0.012)
        .map(c => ({ c, d: Math.hypot((c.box.x + c.box.w / 2 + off[0]) / W - p0[0], (c.box.y + c.box.h + off[1]) / H - p0[1]) }))
        .filter(o => o.d < 0.2).sort((x, y) => y.c.area - x.c.area)[0];
      if(gh){
        const gb = gh.c.box;
        emit('lifted', tr, [(gb.x + gb.w / 2 + off[0]) / W, (gb.y + gb.h + off[1]) / H], tr.t0, toFrame(gb));
        learnBox(gb, 4);
      }else if(sb && !fromEdge && gone && tr.travel >= O.minTravel * 2 && (ghost > 0.25 || tr.startStill || tr.fromRest) && Math.hypot(tr.path[tr.path.length - 1].foot[0] - tr.start[0], tr.path[tr.path.length - 1].foot[1] - tr.start[1]) > 0.05)
        emit('lifted', tr, tr.start, tr.t0, tr.startBox);
      if(sb && ghost > 0.25) learnBox(sb, 4);
    }
    events.push({ kind: 'end', id: tr.id, t, why });
    cands = [];
  }

  function acquire(bl, t){
    /* follow candidate shapes frame to frame; lock one that keeps moving */
    const next = [];
    quiet = quiet.filter(q => q.until > t);
    bl.forEach(o => {
      if(quiet.some(q => o.cx > q.box.x && o.cx < q.box.x + q.box.w && o.cy > q.box.y && o.cy < q.box.y + q.box.h)) return;
      let c = null, bi = 0.15;
      cands.forEach(k => { const v = iou(k.box, o); if(v > bi){ bi = v; c = k; } });
      if(c){
        const moved = Math.hypot(o.cx - c.cx0, o.cy - c.cy0) / H;
        next.push({ box: o, cx0: c.cx0, cy0: c.cy0, n: c.n + 1, t0: c.t0, start: c.start, startBox: c.startBox, startBg: c.startBg, startPatch: c.startPatch, startStill: c.startStill || (c.n < 3 && moved < 0.004), moved, area: o.n });
      }else next.push({ box: o, cx0: o.cx, cy0: o.cy, n: 1, t0: t, start: [foot(o)[0] + off[0] / W, foot(o)[1] + off[1] / H], startBox: toFrame(o), startBg: { x: o.x, y: o.y, w: o.w, h: o.h }, startPatch: bgPatch(o), startStill: false, moved: 0, area: o.n });
    });
    cands = next;
    return cands.filter(c => c.n >= O.lockFrames && c.moved >= O.lockMove).sort((a, b) => b.area - a.area)[0] || null;
  }

  return {
    /* px: RGBA (ch=4) or RGB (ch=3) of w×h; t: seconds. Returns the state. */
    step(px0, w, h, t, ch0 = 4){
      if(w !== W || h !== H || !mu) init(w, h);
      /* 3×3 smoothing: a browser's quick downscale leaves fine deck texture
         (gratings, rails) shimmering from frame to frame, which reads as change */
      const px = smooth(px0, ch0), ch = 3;
      const dt = this._t == null ? 0.1 : Math.max(0.01, t - this._t);
      if(this._t != null && t < this._t - 0.5) init(w, h);      /* jumped back in the video */
      this._t = t;
      /* a blank frame (video not decoded yet, camera starting) teaches nothing;
         a whole new picture (camera turned, another clip) starts afresh */
      let sum = 0, sum2 = 0, dm = 0, n = 0;
      for(let k = 0; k < w * h; k += 97){
        const q = k * ch, g = px[q] * 0.299 + px[q + 1] * 0.587 + px[q + 2] * 0.114;
        sum += g; sum2 += g * g; n++;
        if(frames) dm += Math.abs(g - (mu[k * 3] * 0.299 + mu[k * 3 + 1] * 0.587 + mu[k * 3 + 2] * 0.114));
      }
      const mean = sum / n;
      if(Math.sqrt(Math.max(0, sum2 / n - mean * mean)) < 4) return this.state();
      if(frames && dm / n > 45){ init(w, h); }
      off = measureShift(px, ch, dt);
      change(px, ch, true);
      frames++;
      if(frames < 4) return this.state();
      const bl = blobs();
      if(track) updateTrack(bl, t, dt);
      if(!track){ const r = acquire(bl, t); if(r){ lockFrom(r, t); cands = []; } }
      else{
        /* keep watching the rest: a bigger load moving clearly elsewhere wins
           over a lock that has hardly gone anywhere */
        const b = track.box;
        const r = acquire(bl.filter(o => o.cx < b.x - 4 || o.cx > b.x + b.w + 4 || o.cy < b.y - 4 || o.cy > b.y + b.h + 4), t);
        if(r && track.travel < O.minTravel && track.phase !== 'down'){ finish(t, 'replaced'); lockFrom(r, t); cands = []; }
      }
      return this.state();
    },
    state(){
      return {
        /* phase: 'moving' | 'down' (still ≥ setS: being set down / landed, final when the lock ends) */
        track: track ? { id: track.id, box: toFrame(track.box), foot: footFrame(track.box), score: track.score,
          phase: track.phase || 'moving', still: track.stillSince ? this._t - track.stillSince.t : 0,
          downAt: track.stillSince ? track.stillSince.foot : null, t0: track.t0 } : null,
        shift: off.slice(),
      };
    },
    takeEvents(){ return events.splice(0); },
    /* the video ended or was stopped: close the lock (a load set down counts as landed) */
    flush(){ if(track) finish(this._t || 0, 'stopped'); return events.splice(0); },
    reset(){ mu = null; },
    /* debugging */
    _mask(){ return fg; },
  };
}
