/* Lift tracker (src/liftTrack.js) on synthetic deck footage:
   a textured load comes in over the top edge, crosses a textured deck,
   hovers, is set down; then another one is lifted off and leaves.
   Hand-held shake, sensor noise and uneven frame timing included.
   (Tuned on real bridge-camera clips, which are not kept in the repo.) */
import { createTracker } from '../src/liftTrack.js';

const W = 270, H = 480;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const deck = new Uint8Array(W * H * 3);
for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
  const k = (y * W + x) * 3, base = y < 60 ? 120 : 92;                 /* sea above the stern */
  const v = base + ((x >> 3) + (y >> 3)) % 2 * 10 + (y % 40 === 0 ? 70 : 0) + (rnd() * 8 | 0);
  deck[k] = v + 20; deck[k + 1] = v; deck[k + 2] = v - 15;
}
/* a few units standing on deck */
const box = (img, x0, y0, w, h, col, stripe) => {
  for(let y = Math.max(0, y0 | 0); y < Math.min(H, y0 + h); y++) for(let x = Math.max(0, x0 | 0); x < Math.min(W, x0 + w); x++){
    const k = (y * W + x) * 3, s = stripe && ((x - x0) % 8 < 2 || (y - y0) % 8 < 2) ? 60 : 0;
    img[k] = Math.min(255, col[0] + s); img[k + 1] = Math.min(255, col[1] + s); img[k + 2] = Math.min(255, col[2] + s);
  }
};
box(deck, 20, 250, 60, 50, [170, 60, 50], true);
box(deck, 190, 300, 55, 60, [60, 80, 170], true);

function frame(t, script){
  const img = Uint8Array.from(deck);
  script(img, t);
  /* shake + noise */
  const sx = Math.round(Math.sin(t * 1.7) * 2), sy = Math.round(Math.cos(t * 1.3) * 2), out = new Uint8Array(W * H * 4);
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
    const X = Math.min(W - 1, Math.max(0, x + sx)), Y = Math.min(H - 1, Math.max(0, y + sy)), q = (Y * W + X) * 3, o = (y * W + x) * 4;
    for(let c = 0; c < 3; c++) out[o + c] = Math.min(255, Math.max(0, img[q + c] + (rnd() * 10 - 5)));
    out[o + 3] = 255;
  }
  return out;
}
function run(script, dur){
  const tr = createTracker(), ev = [];
  let t = 0;
  while(t < dur){ tr.step(frame(t, script), W, H, t, 4); ev.push(...tr.takeEvents()); t += 0.1 + rnd() * 0.08; }
  ev.push(...tr.flush());
  return ev.filter(e => e.kind !== 'end');
}
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(info))); if(!ok) fails++; };

/* 1. landing: in over the top edge, down to (130, 330) bottom-centre ≈ (0.48, 0.79) */
const LAND = (img, t) => {
  const p = Math.min(1, Math.max(0, (t - 1) / 7));
  const x = 40 + p * 70, y = -60 + p * 330 + (t > 8 && t < 9.5 ? Math.sin(t * 6) * 3 : 0);
  box(img, x, y, 44, 40, [40, 90, 200], true);
};
let ev = run(LAND, 16);
const l = ev.filter(e => e.kind === 'landed');
check('one set-down reported', l.length === 1, ev);
check('set down where it stopped', l[0] && Math.abs(l[0].foot[0] - 132 / W) < 0.05 && Math.abs(l[0].foot[1] - 310 / H) < 0.05, l[0] && l[0].foot);
check('no lift-off invented', !ev.some(e => e.kind === 'lifted'), ev);

/* 2. lift-off: a unit standing at (100, 380) goes up and out over the top */
seed = 11;
const LIFT = (img, t) => {
  const p = Math.min(1.2, Math.max(0, (t - 3) / 6));
  box(img, 100 + p * 30, 340 - p * 420, 46, 42, [200, 140, 40], true);
};
ev = run(LIFT, 13);
const f = ev.filter(e => e.kind === 'lifted');
check('lift-off reported', f.length === 1, ev);
check('lifted from where it stood', f[0] && Math.abs(f[0].foot[0] - 123 / W) < 0.08 && Math.abs(f[0].foot[1] - 382 / H) < 0.08, f[0] && f[0].foot);
check('no set-down invented', !ev.some(e => e.kind === 'landed'), ev);

/* 3. nothing moves: nothing reported */
seed = 5;
ev = run(() => {}, 10);
check('still deck: no events', ev.length === 0, ev);

console.log(fails ? fails + ' failed' : 'all pass');
process.exit(fails ? 1 : 0);
