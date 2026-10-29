/* node tools/test-cam-model.mjs — synthetic camera: a known homography and
   lens; the solver must get them back from partial lines and points. */
import { solveH, makeModel, residuals, autoLens, distort, undistort, apply3, equationCount } from '../src/camModel.js';
let fail = 0;
const ok = (n, c, i = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n, c ? '' : i); if(!c) fail++; };
const geo = { length: 54.92, width: 15 };
const a = 1080 / 1920;
/* a bridge camera looking aft: stern far (top), deck foreshortened */
const Htrue = [-0.0102, 0.0005, 0.86, 0.0000, -0.0095, 0.40, 0.0000, -0.0285, 0.48];
/* we need deck→image: build from a plausible pinhole instead */
function camH(){
  /* camera at bridge (X = 60, Y = 7.5, Z = 14), looking aft and down */
  const C = [60, 7.5, 14], f = 1.15;
  const look = [-1, 0, -0.62]; const n = Math.hypot(...look); const z = look.map(v => v / n);
  const xr = [0, -1, 0];                       /* image right = deck −Y (port on the right looking aft) */
  const yr = [z[1] * xr[2] - z[2] * xr[1], z[2] * xr[0] - z[0] * xr[2], z[0] * xr[1] - z[1] * xr[0]].map(v => -v);
  const R = [xr, yr, z];
  /* plane Z = 0: [x y w] = K R [X - Cx, Y - Cy, -Cz] */
  const col = j => [R[0][j], R[1][j], R[2][j]];
  const t = R.map(r => -(r[0] * C[0] + r[1] * C[1] + r[2] * C[2]));
  const K = [f / a * 0.5, 0, 0.5, 0, f * 0.5, 0.5, 0, 0, 1];
  const M = [col(0)[0], col(1)[0], t[0], col(0)[1], col(1)[1], t[1], col(0)[2], col(1)[2], t[2]];
  const mul = (A, B) => { const Cm = new Array(9).fill(0); for(let r = 0; r < 3; r++) for(let c = 0; c < 3; c++) for(let k = 0; k < 3; k++) Cm[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]; return Cm; };
  const H = mul(K, M); return H.map(v => v / H[8]);
}
const H0 = camH();
const kTrue = -0.14;
const img = (X, Y, k = kTrue) => { const p = apply3(H0, X, Y); return distort([p[0], p[1]], k, a); };
const corners = [[0, 0], [0, 15], [54.92, 0], [54.92, 15]].map(([X, Y]) => img(X, Y));
console.log('deck corners in picture:', corners.map(p => p.map(v => v.toFixed(2)).join(',')).join('  '));

/* 1 — guides only: port & stbd crash-barrier feet seen only between 8–30 m,
   the 3/2 joint (45.47) and the 9/8 joint seen only near the centre */
const guide = (axis, val, from, to) => [from, (from + to) / 2, to].map(s => ({ type: axis, val, img: axis === 'y' ? img(s, val) : img(val, s) }));
const cons = [...guide('y', 0, 8, 30), ...guide('y', 15, 8, 30), ...guide('x', 45.47, 5, 10), ...guide('x', 17.97, 4, 11)];
ok('12 equations from 4 partial lines', equationCount(cons) === 12);
const H = solveH(cons, geo, kTrue, a);
const m = makeModel(H, null, kTrue, a);
const err = Math.max(...[[0, 0], [54.92, 15], [27, 7.5], [5, 3]].map(([X, Y]) => { const p = m.toImage(X, Y), q = img(X, Y); return Math.hypot(p[0] - q[0], p[1] - q[1]); }));
ok('lines only: model reproduces the camera (incl. hidden corners)', err < 1e-6, err);
const back = m.toDeck(...img(33, 4.2));
ok('picture → deck round trip', Math.hypot(back[0] - 33, back[1] - 4.2) < 1e-6, back);

/* 2 — lens estimated from the lines (mid handles carry the curvature) */
const kEst = autoLens(cons, geo, a);
ok('auto lens finds k', kEst != null && Math.abs(kEst - kTrue) < 0.01, kEst);
const Hwrong = solveH(cons, geo, 0, a);
const rw = Math.max(...residuals(cons, Hwrong, 0, a));
const rr = Math.max(...residuals(cons, solveH(cons, geo, kEst, a), kEst, a));
ok('residuals drop with the right lens', rr < rw / 5, [rw, rr]);

/* 3 — mixed: two points outside the picture + two lines */
const pts = [{ type: 'pt', deck: [0, 0], img: img(0, 0) }, { type: 'pt', deck: [0, 15], img: img(0, 15) }];
/* stern corners clicked (even outside the picture), both crash-barrier feet
   and one joint: 4 + 1 + 1 + 2 independent equations */
const mix = [...pts, ...guide('y', 0, 10, 25), ...guide('y', 15, 10, 25), ...guide('x', 45.47, 6, 9)];
const Hm = solveH(mix, geo, kTrue, a);
ok('mixed points + lines solve', !!Hm && Math.max(...residuals(mix, Hm, kTrue, a)) < 1e-6);

/* 4 — degenerate inputs refused (a line through an already clicked point adds
   only its direction: stern corners + both edges is not enough) */
ok('stern corners + both edges only → no solution', solveH([...pts, ...guide('y', 0, 10, 25), ...guide('y', 15, 10, 25)], geo, kTrue, a) === null);
ok('only longitudinal lines → no solution', solveH([...guide('y', 0, 8, 30), ...guide('y', 15, 8, 30), ...guide('y', 7.5, 8, 30)], geo, kTrue, a) === null);
ok('too few equations → no solution', solveH(guide('y', 0, 8, 30), geo, 0, a) === null);

/* 4b — with click noise (≈2 px on a 1080 px picture) */
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const noisy = cs => cs.map(c => Object.assign({}, c, { img: [c.img[0] + rnd() * 0.004, c.img[1] + rnd() * 0.0025] }));
const Hn = solveH(noisy(mix), geo, kTrue, a);
const mn = Hn && makeModel(Hn, null, kTrue, a);
const en = mn ? Math.max(...[[5, 7.5], [27, 7.5], [40, 3]].map(([X, Y]) => { const d = mn.toDeck(...img(X, Y)); return Math.hypot(d[0] - X, d[1] - Y); })) : Infinity;
ok('noisy clicks: deck error stays small (< 0.6 m)', en < 0.6, en);
ok('noisy degenerate set still refused', solveH(noisy([...pts, ...guide('y', 0, 10, 25), ...guide('y', 15, 10, 25)]), geo, kTrue, a) === null);

/* 5 — lens round trip and fine-tune identity */
const p0 = [0.93, 0.08], u = undistort(distort(p0, -0.2, a), -0.2, a);
ok('distort/undistort round trip', Math.hypot(u[0] - p0[0], u[1] - p0[1]) < 1e-9);
const mt = makeModel(H, { dx: 0.05, dy: 0, rot: 0, scale: 1, tv: 0, th: 0 }, kTrue, a);
const q1 = mt.toImage(20, 5), q0 = m.toImage(20, 5), back2 = mt.toDeck(...q1);
ok('fine-tune moves the overlay and stays invertible', Math.abs(q1[0] - q0[0]) > 0.01 && Math.hypot(back2[0] - 20, back2[1] - 5) < 1e-6);
console.log(fail ? fail + ' FAILED' : 'all pass');
process.exit(fail ? 1 : 0);
