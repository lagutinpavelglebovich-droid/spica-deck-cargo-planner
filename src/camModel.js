/* ════════════════════════════════════════════════════════════
   CAMERA MODEL — v3.39
   Maps the deck plan (metres) onto a camera picture and back.

     deck (X, Y)  ──H──▶  ideal picture  ──T──▶  adjusted  ──lens──▶  picture (u, v)

   • H   planar homography solved from any mix of
           points  (a known deck point clicked in the picture), and
           guides  (a line drawn over a known deck line — the foot of the
                    crash barrier, the stern edge, a bay joint — that may be
                    only partly visible; each handle on it is one equation).
         Two deck edges + two cross lines are enough; the corners may be
         hidden by cargo or outside the picture.
   • T   manual fine-tune (move, rotate, size, tilt) — Lightroom-style.
   • lens  one-parameter radial distortion about the picture centre
           (k > 0 pincushion, k < 0 barrel); can be estimated automatically
           when there are more equations than the 8 a homography needs.

   Picture coordinates are normalised 0…1 of the displayed (rotated)
   frame and may lie outside it (points placed beyond the picture).
   Pure functions — no DOM; unit-tested in tools/test-cam-model.mjs.
════════════════════════════════════════════════════════════ */

/* ── 3×3 helpers (row-major arrays of 9) ── */
export function mul3(A, B){
  const C = new Array(9).fill(0);
  for(let r = 0; r < 3; r++) for(let c = 0; c < 3; c++) for(let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return C;
}
export function inv3(H){
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if(!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  return [A, -(b * i - c * h), b * f - c * e,
          B, a * i - c * g, -(a * f - c * d),
          C, -(a * h - b * g), a * e - b * d].map(v => v / det);
}
export function apply3(H, x, y){
  const w = H[6] * x + H[7] * y + H[8];
  if(!(Math.abs(w) > 1e-12)) return null;
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w, w];
}
/* rel: a pivot smaller than rel × the largest diagonal entry means the
   constraints do not pin the unknowns down (rank-deficient, e.g. a line
   through an already clicked point) — refuse instead of guessing. */
function solveLin(A, b, rel = 0){
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  const scale = Math.max(...A.map((r, i) => Math.abs(r[i]))) || 1;
  for(let c = 0; c < n; c++){
    let p = c;
    for(let r = c + 1; r < n; r++) if(Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if(Math.abs(M[p][c]) < Math.max(1e-11, rel * scale)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for(let r = 0; r < n; r++){
      if(r === c) continue;
      const f = M[r][c] / M[c][c];
      if(f) for(let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/* ── lens ── radius measured in picture units scaled by the aspect so the
   model is round, normalised to the half-diagonal (r = 1 at a corner). */
export function distort(p, k, a){
  if(!k || !p) return p;
  const x = (p[0] - 0.5) * a, y = p[1] - 0.5, R2 = (a * a + 1) / 4;
  const f = 1 + k * (x * x + y * y) / R2;
  return [x * f / a + 0.5, y * f + 0.5];
}
export function undistort(p, k, a){
  if(!k || !p) return p;
  const xd = (p[0] - 0.5) * a, yd = p[1] - 0.5, R2 = (a * a + 1) / 4;
  const rd = Math.hypot(xd, yd);
  if(rd < 1e-12) return [p[0], p[1]];
  /* Newton on the radius: r·(1 + k·r²/R2) = rd */
  let r = rd;
  for(let i = 0; i < 30; i++){
    const f = r + k * r * r * r / R2 - rd, df = 1 + 3 * k * r * r / R2;
    if(!(df > 1e-6)) return null;
    const step = f / df; r -= step;
    if(Math.abs(step) < 1e-14) break;
  }
  if(!(r > 0) || !(1 + k * r * r / R2 > 0.05)) return null;
  const sc = r / rd;
  return [xd * sc / a + 0.5, yd * sc + 0.5];
}

/* ── manual fine-tune T (about the picture centre) ──
   t = { dx, dy (fraction of the picture), rot (degrees), scale (1 = none),
         tv, th (perspective tilt: top/bottom and left/right, ±1 ≈ strong) } */
export const T_NONE = { dx: 0, dy: 0, rot: 0, scale: 1, tv: 0, th: 0 };
export function isIdentityT(t){ return !t || (!t.dx && !t.dy && !t.rot && (t.scale == null || t.scale === 1) && !t.tv && !t.th); }
export function tMatrix(t, a){
  if(isIdentityT(t)) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const c = Math.cos((t.rot || 0) * Math.PI / 180), s = Math.sin((t.rot || 0) * Math.PI / 180), sc = t.scale || 1;
  /* work in a square frame centred on the picture: x' = (u - .5)·a, y' = v - .5 */
  const N = [a, 0, -0.5 * a, 0, 1, -0.5, 0, 0, 1], Ni = [1 / a, 0, 0.5, 0, 1, 0.5, 0, 0, 1];
  const P = [1, 0, 0, 0, 1, 0, (t.th || 0) * 0.6, (t.tv || 0) * 0.6, 1];
  const RS = [c * sc, -s * sc, (t.dx || 0) * a, s * sc, c * sc, (t.dy || 0), 0, 0, 1];
  return mul3(Ni, mul3(RS, mul3(P, N)));
}

/* ── solve H from mixed constraints ──
   cons: [{ type:'pt', img:[u,v], deck:[X,Y] } |
          { type:'x', img:[u,v], val:X }   (image point lies on deck line X = val)
          { type:'y', img:[u,v], val:Y } ]  (… on deck line Y = val)
   geo:  { length, width } for normalisation. k, a: lens and aspect.
   Returns H (deck → ideal picture, before T and lens) or null. */
export function equationCount(cons){ return cons.reduce((n, c) => n + (c.type === 'pt' ? 2 : 1), 0); }
export function solveH(cons, geo, k, a){
  if(equationCount(cons) < 8) return null;
  /* families: need ≥2 distinct X-lines/points and ≥2 distinct Y ones */
  const xs = new Set(), ys = new Set();
  cons.forEach(c => { if(c.type !== 'y') xs.add(Math.round((c.type === 'pt' ? c.deck[0] : c.val) * 100)); if(c.type !== 'x') ys.add(Math.round((c.type === 'pt' ? c.deck[1] : c.val) * 100)); });
  if(xs.size < 2 || ys.size < 2) return null;
  const L = geo.length || 1, W = geo.width || 1;
  /* normalisation: picture centred to ±1, deck to ±1 */
  const Ni = [2, 0, -1, 0, 2, -1, 0, 0, 1];
  const Nd = [2 / L, 0, -1, 0, 2 / W, -1, 0, 0, 1], Ndi = inv3(Nd);
  const rows = [], rhs = [];
  for(const c of cons){
    const q = undistort(c.img, k, a);
    if(!q) return null;
    const u = 2 * q[0] - 1, v = 2 * q[1] - 1;
    if(c.type === 'pt' || c.type === 'x'){
      const X = 2 * (c.type === 'pt' ? c.deck[0] : c.val) / L - 1;
      rows.push([u, v, 1, 0, 0, 0, -X * u, -X * v]); rhs.push(X);
    }
    if(c.type === 'pt' || c.type === 'y'){
      const Y = 2 * (c.type === 'pt' ? c.deck[1] : c.val) / W - 1;
      rows.push([0, 0, 0, u, v, 1, -Y * u, -Y * v]); rhs.push(Y);
    }
  }
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  rows.forEach((r, i) => { for(let p = 0; p < 8; p++){ Atb[p] += r[p] * rhs[i]; for(let q = 0; q < 8; q++) AtA[p][q] += r[p] * r[q]; } });
  const g = solveLin(AtA, Atb, 1e-7);
  if(!g || g.some(x => !Number.isFinite(x))) return null;
  const Gn = g.concat([1]);
  const G = mul3(Ndi, mul3(Gn, Ni));           /* picture (ideal) → deck */
  const H = inv3(G);
  if(!H) return null;
  /* the deck must lie in front of the camera: same sign of w at all corners */
  const ws = [[0, 0], [L, 0], [0, W], [L, W]].map(([X, Y]) => H[6] * X + H[7] * Y + H[8]);
  if(!(ws.every(w => w > 0) || ws.every(w => w < 0))) return null;
  return H.map(v => v / H[8]);
}

/* Model = { H, T, k, a } with forward / inverse mapping. */
export function makeModel(H, t, k, a){
  if(!H) return null;
  const T = tMatrix(t, a), Ti = inv3(T), Hi = inv3(H);
  if(!Ti || !Hi) return null;
  const HT = mul3(T, H), HTi = inv3(HT);
  return {
    H, k, a,
    /* deck metres → picture (u, v); null behind the camera */
    toImage(X, Y){
      const p = apply3(HT, X, Y);
      if(!p) return null;
      const w = H[6] * X + H[7] * Y + H[8];
      if(!(w > 1e-9)) return null;
      return distort([p[0], p[1]], k, a);
    },
    /* picture (u, v) → deck metres */
    toDeck(u, v){
      const q = undistort([u, v], k, a);
      if(!q || !HTi) return null;
      const p = apply3(HTi, q[0], q[1]);
      return p ? [p[0], p[1]] : null;
    },
  };
}

/* Error of each constraint in deck metres (point: distance; guide handle:
   distance from its deck line). Uses H only (before the manual fine-tune). */
export function residuals(cons, H, k, a){
  const G = H && inv3(H);
  return cons.map(c => {
    if(!G) return null;
    const q = undistort(c.img, k, a); if(!q) return null;
    const p = apply3(G, q[0], q[1]); if(!p) return null;
    if(c.type === 'pt') return Math.hypot(p[0] - c.deck[0], p[1] - c.deck[1]);
    return Math.abs((c.type === 'x' ? p[0] : p[1]) - c.val);
  });
}

/* Lens coefficient that makes the constraints agree best. Needs more
   equations than the 8 a homography uses, spread over the picture. */
export function autoLens(cons, geo, a, range = 0.45){
  if(equationCount(cons) < 10) return null;
  const cost = k => {
    const H = solveH(cons, geo, k, a); if(!H) return Infinity;
    const r = residuals(cons, H, k, a);
    return r.reduce((s, v) => s + (v == null ? 100 : v * v), 0);
  };
  let best = 0, bc = cost(0);
  for(let i = -20; i <= 20; i++){ const k = range * i / 20, c = cost(k); if(c < bc){ bc = c; best = k; } }
  let lo = best - range / 20, hi = best + range / 20;
  for(let it = 0; it < 30; it++){
    const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
    if(cost(m1) < cost(m2)) hi = m2; else lo = m1;
  }
  const k = (lo + hi) / 2;
  return Number.isFinite(cost(k)) ? Math.round(k * 1000) / 1000 : null;
}
