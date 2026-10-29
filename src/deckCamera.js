/* ════════════════════════════════════════════════════════════
   DECK CAMERA — v3.16
   Workspace for the bridge camera: calibrate the camera view to the
   deck plan (planar homography), and lay the plan over the picture.

   Coordinates
   • Deck: metres. X along the deck from the AFT edge (0) to the bow,
     Y across from the PORT side (0) to STBD (deckWidthM) — the same
     frame the planner canvas uses (left = aft, top = port).
   • Image: normalised (u, v) in 0…1 of the ROTATED source frame, so a
     calibration survives a resolution change of the same camera.

   Calibration = 4 picked points:
     1 aft edge × PORT   2 aft edge × STBD
     3 bay line × PORT   4 bay line × STBD      (bay line chosen in a list)
   Everything stays on this computer; no frame ever leaves the app.

   The app hands an API in initDeckCamera() so this module never
   touches planner state directly.
════════════════════════════════════════════════════════════ */

import { solveH, makeModel, residuals as camResiduals, autoLens, equationCount, T_NONE, isIdentityT } from './camModel.js';

let API = null;
let DC = null;            /* panel state while open */
let CAM = null;           /* live camera — outlives the panel while recording */
let REC = null;           /* recording in progress */

export function initDeckCamera(api){ API = api; }

/* ── maths ─────────────────────────────────────────────────── */
/* Solve A·x = b (n×n) by Gaussian elimination with partial pivoting. */
function solve(A, b){
  const n = b.length;
  const M = A.map((r, i) => r.concat([b[i]]));
  for(let c = 0; c < n; c++){
    let p = c;
    for(let r = c + 1; r < n; r++) if(Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if(Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for(let r = 0; r < n; r++){
      if(r === c) continue;
      const f = M[r][c] / M[c][c];
      for(let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
/* Homography from 4 (X,Y)→(u,v) pairs; returns 9 numbers (h33 = 1). */
export function homographyFrom4(src, dst){
  const A = [], b = [];
  for(let i = 0; i < 4; i++){
    const [X, Y] = src[i], [u, v] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? h.concat([1]) : null;
}
/* Least-squares homography for n ≥ 4 pairs (Hartley-normalised, h33 = 1). */
export function homographyLS(src, dst){
  const n = src.length;
  if(n < 4) return null;
  if(n === 4) return homographyFrom4(src, dst);
  const norm = P => {
    const cx = P.reduce((a, p) => a + p[0], 0) / n, cy = P.reduce((a, p) => a + p[1], 0) / n;
    const md = P.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / n || 1;
    const k = Math.SQRT2 / md;
    return { T: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1], P: P.map(p => [k * (p[0] - cx), k * (p[1] - cy)]) };
  };
  const a = norm(src), b = norm(dst);
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const add = (row, y) => { for(let i = 0; i < 8; i++){ Atb[i] += row[i] * y; for(let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } };
  for(let i = 0; i < n; i++){
    const [X, Y] = a.P[i], [u, v] = b.P[i];
    add([X, Y, 1, 0, 0, 0, -u * X, -u * Y], u);
    add([0, 0, 0, X, Y, 1, -v * X, -v * Y], v);
  }
  const h = solve(AtA, Atb);
  if(!h) return null;
  const Hn = h.concat([1]);
  const Ti = invert3(b.T);
  if(!Ti) return null;
  const H = mul3(mul3(Ti, Hn), a.T);
  return H.map(v => v / H[8]);
}
function mul3(A, B){
  const C = new Array(9).fill(0);
  for(let r = 0; r < 3; r++) for(let c = 0; c < 3; c++) for(let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return C;
}
export function project(H, X, Y){
  const w = H[6] * X + H[7] * Y + H[8];
  if(w <= 1e-9) return null;                       /* behind the camera */
  return [(H[0] * X + H[1] * Y + H[2]) / w, (H[3] * X + H[4] * Y + H[5]) / w];
}
export function invert3(H){
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if(Math.abs(det) < 1e-15) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e,
               B, a * i - c * g, -(a * f - c * d),
               C, -(a * h - b * g), a * e - b * d].map(v => v / det);
  return inv;
}

/* Deck reference positions (metres). Bay boundary k = the joint after
   render index k (between bay k and k+1), measured at the joint centre. */
function boundaryX(geo, k){
  let x = 0;
  for(let i = 0; i <= k; i++) x += geo.bays[i];
  return x + k * geo.joint + geo.joint / 2;
}
function bayCentreX(geo, i){
  let x = 0;
  for(let j = 0; j < i; j++) x += geo.bays[j] + geo.joint;
  return x + geo.bays[i] / 2;
}
function defaultLine(geo){ return Math.max(0, geo.bays.length - 3); }
function refPoints(geo, line){
  const xl = boundaryX(geo, line), W = geo.width;
  return [[0, 0], [0, W], [xl, 0], [xl, W]];
}

/* Calibration stored on the vessel → homography, or null. */
export function calibrationH(cam, geo){
  if(!cam || !cam.calib) return null;
  const c = cam.calib, line = Math.min(geo.bays.length - 2, Math.max(0, c.line | 0));
  const pts = Array.isArray(c.pts) ? c.pts : [], ref = refPoints(geo, line), cons = [];
  pts.forEach((p, i) => { if(p && i < 4) cons.push({ type: 'pt', img: p, deck: ref[i] }); });
  (c.extra || []).forEach(e => { if(e && e.bay >= 0 && e.bay < geo.bays.length) cons.push({ type: 'pt', img: [e.u, e.v], deck: [bayCentreX(geo, e.bay), geo.width / 2] }); });
  (c.guides || []).forEach(g => { const f = featLine(geo, g.f); if(f) (g.p || []).forEach(p => cons.push({ type: f.axis, val: f.val, img: p })); });
  return solveH(cons, geoLen(geo), c.k || 0, c.aspect || 9 / 16);
}

/* v3.39 — guide lines: deck lines a guide can be drawn along */
function geoLen(geo){ return { length: geo.bays.reduce((a, b) => a + b, 0) + geo.joint * (geo.bays.length - 1), width: geo.width }; }
function featLine(geo, f){
  const L = geoLen(geo).length, W = geo.width;
  if(f === 'port')  return { axis: 'y', val: 0, name: 'Port deck edge', short: 'Port edge' };
  if(f === 'stbd')  return { axis: 'y', val: W, name: 'Starboard deck edge', short: 'Stbd edge' };
  if(f === 'stern') return { axis: 'x', val: 0, name: 'Stern edge', short: 'Stern' };
  if(f === 'fwd')   return { axis: 'x', val: L, name: 'Forward end of the deck', short: 'Fwd end' };
  const m = /^j(\d+)$/.exec(String(f || ''));
  if(m && +m[1] < geo.bays.length - 1){ const k = +m[1]; return { axis: 'x', val: boundaryX(geo, k), name: `Bay ${geo.labels[k]}/${geo.labels[k + 1]} joint`, short: `${geo.labels[k]}/${geo.labels[k + 1]}` }; }
  return null;
}
function featOptions(geo){
  const o = [['port', 'Port deck edge — foot of the crash barrier'], ['stbd', 'Starboard deck edge — foot of the crash barrier'], ['stern', 'Stern edge']];
  for(let k = 0; k < geo.bays.length - 1; k++) o.push(['j' + k, `Bay ${geo.labels[k]} / Bay ${geo.labels[k + 1]} joint`]);
  o.push(['fwd', 'Forward end of the deck']);
  return o;
}
const GH = 1000;            /* handle id base for guide handles: GH + guide × 3 + handle */

/* ── panel ─────────────────────────────────────────────────── */
/* v3.38.1 — plain names: what to click, in deck words (was "Bay line · PORT") */
function stepTexts(){
  const g = DC.geo, k = DC.line, a = g.labels[k], b = g.labels[k + 1];
  return [
    ['Stern corner · port',      'the corner where the stern edge of the deck meets the PORT side'],
    ['Stern corner · starboard', 'the corner where the stern edge of the deck meets the STARBOARD side'],
    [`Bay ${a}/${b} joint · port`,      `where the joint between Bay ${a} and Bay ${b} meets the PORT side`],
    [`Bay ${a}/${b} joint · starboard`, `where the joint between Bay ${a} and Bay ${b} meets the STARBOARD side`],
  ];
}

/* Deck map drawn the way a bridge camera sees the deck: looking aft, stern
   at the top, PORT on the right. The point to click next is ringed. */
function renderMap(){
  if(!DC) return;
  const box = DC.ov.querySelector('#dcMap'); if(!box) return;
  const selG = DC.sel >= GH ? DC.guides[Math.floor((DC.sel - GH) / 3)] : null;
  const feat = DC.drawing ? DC.drawing.f : selG ? selG.f : '';
  const sig = [DC.step, DC.placing, DC.line, DC.pts.map(p => p ? 1 : 0).join(''), DC.extra.map(e => e.bay).join(','), DC.guides.map(g => g.f).join(','), feat].join('|');
  if(box._sig === sig) return;   /* drawOverlay runs per video frame */
  box._sig = sig;
  const g = DC.geo, L = g.bays.reduce((a, b) => a + b, 0) + g.joint * (g.bays.length - 1), Wm = g.width;
  const X0 = 16, Y0 = 16, DH = 236, DW = Math.round(DH * Wm / L);
  const PX = m => Y0 + m / L * DH;               /* along the deck → down the map */
  const PY = w => X0 + (1 - w / Wm) * DW;        /* PORT (w = 0) on the right   */
  let o = `<svg viewBox="0 0 ${X0 * 2 + DW} ${Y0 + DH + 16}" role="img" aria-label="Deck seen from the bridge looking aft — where to click next">`;
  o += `<text class="m-end" x="${X0 + DW / 2}" y="${Y0 - 5}" text-anchor="middle">STERN</text>`;
  o += `<rect class="m-deck" x="${X0}" y="${Y0}" width="${DW}" height="${DH}" rx="3"/>`;
  for(let k = 0; k < g.bays.length - 1; k++){
    const y = PX(boundaryX(g, k)).toFixed(1);
    o += `<line class="m-joint${k === DC.line ? ' sel' : ''}" x1="${X0}" y1="${y}" x2="${X0 + DW}" y2="${y}"/>`;
  }
  for(let i = 0; i < g.bays.length; i++) o += `<text class="m-bay" x="${X0 + DW / 2}" y="${(PX(bayCentreX(g, i)) + 3).toFixed(1)}">${esc(g.labels[i])}</text>`;
  o += `<text class="m-side" x="${X0 + DW + 3}" y="${Y0 + DH / 2}" transform="rotate(90 ${X0 + DW + 3} ${Y0 + DH / 2})" text-anchor="middle" dy="-1">PORT</text>`;
  o += `<text class="m-side" x="${X0 - 3}" y="${Y0 + DH / 2}" transform="rotate(-90 ${X0 - 3} ${Y0 + DH / 2})" text-anchor="middle" dy="-1">STBD</text>`;
  o += `<text class="m-end" x="${X0 + DW / 2}" y="${Y0 + DH + 12}" text-anchor="middle">BRIDGE</text>`;
  /* guide lines drawn, and the one being drawn / selected */
  const fl = f => { const L2 = featLine(g, f); if(!L2) return ''; return L2.axis === 'x'
    ? `x1="${X0 - 2}" y1="${PX(L2.val).toFixed(1)}" x2="${X0 + DW + 2}" y2="${PX(L2.val).toFixed(1)}"`
    : `x1="${PY(L2.val).toFixed(1)}" y1="${Y0 - 2}" x2="${PY(L2.val).toFixed(1)}" y2="${Y0 + DH + 2}"`; };
  DC.guides.forEach(gd => { if(gd.f !== feat) o += `<line class="m-guide" ${fl(gd.f)}/>`; });
  if(feat) o += `<line class="m-guide on" ${fl(feat)}/>`;
  const ref = refPoints(g, DC.line);
  DC.pts.forEach((p, i) => { if(p) o += `<g class="m-done"><circle cx="${PY(ref[i][1]).toFixed(1)}" cy="${PX(ref[i][0]).toFixed(1)}" r="4.5"/><text x="${PY(ref[i][1]).toFixed(1)}" y="${(PX(ref[i][0]) + 2.8).toFixed(1)}" text-anchor="middle">${i + 1}</text></g>`; });
  DC.extra.forEach(e => { o += `<circle class="m-xdone" cx="${PY(Wm / 2).toFixed(1)}" cy="${PX(bayCentreX(g, e.bay)).toFixed(1)}" r="3.5"/>`; });
  let t = null;
  if(DC.drawing) t = null;
  else if(DC.placing >= 0) t = [bayCentreX(g, DC.placing), Wm / 2];
  else if(DC.step < 4) t = ref[DC.step];
  if(t) o += `<circle class="m-target" cx="${PY(t[1]).toFixed(1)}" cy="${PX(t[0]).toFixed(1)}" r="7"/><circle class="m-target-dot" cx="${PY(t[1]).toFixed(1)}" cy="${PX(t[0]).toFixed(1)}" r="2.5"/>`;
  box.innerHTML = o + '</svg>';
  const cap = DC.ov.querySelector('#dcMapCap');
  if(cap){
    cap.textContent = DC.drawing ? `Draw along: ${featLine(g, DC.drawing.f).name} (highlighted on the map) — press, drag along it, release`
      : DC.placing >= 0 ? `Click the middle of Bay ${g.labels[DC.placing]} on the centreline (its painted number)`
      : DC.step < 4 ? `Click ${stepTexts()[DC.step][1]}`
      : DC.pts.every(Boolean) ? 'All 4 points placed. Check that the drawn bay lines sit on the deck joints in the picture; drag a point to correct it.'
      : 'Check that the drawn deck sits on the picture. Drag any point or line handle to correct it, add guide lines, or click a corner step to place it.';
  }
}

function el(tag, cls, html){ const e = document.createElement(tag); if(cls) e.className = cls; if(html != null) e.innerHTML = html; return e; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

function buildPanel(){
  let ov = document.getElementById('dcOv');
  if(ov) return ov;
  ov = el('div', 'dc-ov');
  ov.id = 'dcOv';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Deck camera');
  ov.innerHTML = `
  <div class="dc-shell">
    <header class="dc-head">
      <div class="dc-head-text"><div class="dc-kicker">Deck camera</div><div class="dc-title" id="dcTitle">—</div></div>
      <nav class="dc-tabs" id="dcTabs" role="tablist">
        <button type="button" role="tab" data-tab="calib" class="sel">Calibrate</button>
        <button type="button" role="tab" data-tab="watch">Watch lifts</button>
        <button type="button" role="tab" data-tab="record">Record video</button>
      </nav>
      <button type="button" class="dc-x" id="dcClose" title="Close (Esc)">✕</button>
    </header>
    <div class="dc-main">
      <div class="dc-stage" id="dcStage">
        <div class="dc-frame" id="dcFrame">
          <canvas id="dcCanvas"></canvas>
          <svg id="dcSvg" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
        <canvas class="dc-loupe" id="dcLoupe" width="168" height="168" hidden></canvas>
        <div class="dc-empty" id="dcEmpty">
          <div class="dc-empty-t">No picture yet</div>
          <div class="dc-empty-s">Start the live camera, or open a video or photo taken from the camera position (Picture, on the right).</div>
        </div>
        <div class="dc-shot-cap" id="dcShotCap" hidden>Saved calibration picture — open a video or start the camera to see it live</div>
      </div>
      <aside class="dc-side">
        <div class="dc-body">
          <section class="dc-sec">
            <div class="dc-sec-title">Picture <span class="dc-sec-meta" id="dcSrcState"></span></div>
            <div class="dc-src-lbl">Live camera</div>
            <div class="dc-row">
              <select class="dc-select" id="dcDevice" aria-label="Camera"><option value="">Looking for cameras…</option></select>
              <button type="button" class="dc-btn" id="dcStart">Start camera</button>
            </div>
            <div class="dc-src-lbl">or a file — a video or photo taken from the camera position</div>
            <div class="dc-row">
              <button type="button" class="dc-btn dc-grow" id="dcOpen">Open video or photo…</button>
              <input type="file" id="dcFile" accept="image/*,video/*" hidden>
            </div>
            <div class="dc-row dc-video" id="dcVideoRow" hidden>
              <button type="button" class="dc-btn dc-icon" id="dcPlay" title="Play / pause">▶</button>
              <input type="range" id="dcSeek" min="0" max="1000" value="0" aria-label="Position">
              <span class="dc-time" id="dcTime">0:00</span>
            </div>
            <div class="dc-row">
              <span class="dc-lbl">Rotate</span>
              <button type="button" class="dc-btn dc-icon" id="dcRotL" title="Rotate left">⟲</button>
              <button type="button" class="dc-btn dc-icon" id="dcRotR" title="Rotate right">⟳</button>
              <span class="dc-meta" id="dcRes"></span>
            </div>
          </section>

          <section class="dc-sec dc-pane" data-pane="record" hidden>
            <div class="dc-sec-title">Record video <span class="dc-sec-meta" id="dcRecState"></span></div>
            <div class="dc-note">Saves what the <b>live camera</b> sees to a video file in a folder you choose, so a lift can be watched again later. Next to the video it writes a small log of the moves you make on the plan, with their times. Not needed for Watch lifts. Keeps recording when this window is closed.</div>
            <div class="dc-hint warn" id="dcRecNeed" hidden>Recording works with the live camera only — start it in Picture above. A video file is already a recording: open it in Watch lifts.</div>
            <label class="dc-field"><span>Folder</span>
              <div class="dc-row"><span class="dc-path" id="dcRecDir">Not chosen</span><button type="button" class="dc-btn" id="dcRecDirBtn">Choose…</button></div></label>
            <label class="dc-field"><span>Quality</span>
              <select class="dc-select" id="dcRecQ">
                <option value="8">Standard · 8 Mbit/s · about 3.6 GB per hour</option>
                <option value="12" selected>High · 12 Mbit/s · about 5.4 GB per hour</option>
                <option value="20">Best · 20 Mbit/s · about 9 GB per hour</option>
              </select></label>
            <button type="button" class="dc-rec-btn" id="dcRecBtn"><span class="dc-rec-dot"></span><span id="dcRecBtnT">Start recording</span></button>
            <div class="dc-rec-stats" id="dcRecStats" hidden>
              <div><span>Time</span><b id="dcRecTime">0:00:00</b></div>
              <div><span>Size</span><b id="dcRecSize">0 MB</b></div>
              <div><span>Plan moves</span><b id="dcRecEv">0</b></div>
            </div>
            <div class="dc-hint" id="dcRecHint"></div>
          </section>

          <section class="dc-sec dc-pane" data-pane="watch" hidden>
            <div class="dc-sec-title">Watch lifts <span class="dc-sec-meta" id="dcWState"></span></div>
            <div class="dc-note">Play the video or start the camera. The load moving on the hook is locked and followed; its number is read when it can be seen; the shadow on the deck shows where it is coming down. Set-downs and lift-offs are listed below with the bay. A load list is not needed — when there is one, the number read is checked against it.</div>
            <div class="dc-w-now" id="dcWNow">
              <div class="dc-w-thumb" id="dcWThumb"></div>
              <div class="dc-w-main">
                <div class="dc-w-num" id="dcWNum">—</div>
                <div class="dc-w-where" id="dcWWhere"></div>
                <div class="dc-w-phase" id="dcWPhase"></div>
              </div>
            </div>
            <div class="dc-row dc-w-ctl">
              <label class="dc-check dc-inline"><input type="checkbox" id="dcWOn" checked> Lock on loads</label>
              <select class="dc-select dc-sm" id="dcWRate" aria-label="Playback speed" title="Playback speed">
                <option value="1" selected>1×</option><option value="2">2×</option><option value="0.5">½×</option>
              </select>
            </div>
            <div class="dc-sub">Lifts <span class="dc-sec-meta" id="dcWCount"></span></div>
            <div class="dc-an-list" id="dcWList"></div>
          </section>

          <section class="dc-sec dc-pane" data-pane="calib">
            <div class="dc-sec-title">Calibration <span class="dc-sec-meta" id="dcCalState"></span></div>
            <div class="dc-note">Tie the picture to the deck plan with 4 points. The map shows the deck as the bridge camera sees it, looking aft: click in the picture the spot ringed on the map.</div>
            <div class="dc-cal">
              <div class="dc-map" id="dcMap"></div>
              <div class="dc-cal-r">
                <div class="dc-map-cap" id="dcMapCap"></div>
                <ol class="dc-steps" id="dcSteps"></ol>
              </div>
            </div>
            <label class="dc-check"><input type="checkbox" id="dcRoomy"> Room around the picture — to place corners that are outside it</label>
            <label class="dc-field"><span>Joint for points 3 and 4 — pick one you can see clearly, far from the stern</span>
              <select class="dc-select" id="dcLine"></select></label>
            <div class="dc-sub">Guide lines <span class="dc-sec-meta">(when corners are hidden by cargo or outside the picture)</span></div>
            <div class="dc-note">Draw a line over a deck line you can see — even a short stretch of it: press, drag along it, release. If the lens bends the line, drag its middle handle onto it. Both deck edges and two cross lines are enough without any corner points.</div>
            <div class="dc-row">
              <select class="dc-select" id="dcGuideFeat" aria-label="Deck line"></select>
              <button type="button" class="dc-btn" id="dcGuideDraw">Draw line</button>
            </div>
            <ol class="dc-steps" id="dcGuides"></ol>
            <div class="dc-sub">Optional · bay centres <span class="dc-sec-meta">(more accuracy — points near the camera help most)</span></div>
            <div class="dc-note">Click the middle of a bay on the centreline, where its number is painted.</div>
            <div class="dc-row">
              <select class="dc-select" id="dcExtraBay" aria-label="Bay"></select>
              <button type="button" class="dc-btn" id="dcAddExtra">Place</button>
            </div>
            <ol class="dc-steps" id="dcExtras"></ol>
            <div class="dc-hint" id="dcHint">Click the picture to place the highlighted point. Drag a point to adjust it; arrow keys nudge it (Shift = ×10).</div>
            <details class="dc-tune" id="dcTune">
              <summary>Fine-tune — lens and transform</summary>
              <div class="dc-tune-row"><span>Lens curvature</span><input type="range" id="dcTk" min="-0.35" max="0.35" step="0.005"><output id="dcTkV"></output><button type="button" class="dc-btn dc-sm" id="dcTkAuto" title="Bend the lens until all points and lines agree">Auto</button></div>
              <div class="dc-tune-row"><span>Move ←→</span><input type="range" id="dcTdx" min="-0.25" max="0.25" step="0.002"><output id="dcTdxV"></output></div>
              <div class="dc-tune-row"><span>Move ↑↓</span><input type="range" id="dcTdy" min="-0.25" max="0.25" step="0.002"><output id="dcTdyV"></output></div>
              <div class="dc-tune-row"><span>Rotate</span><input type="range" id="dcTrot" min="-10" max="10" step="0.1"><output id="dcTrotV"></output></div>
              <div class="dc-tune-row"><span>Size</span><input type="range" id="dcTscale" min="0.8" max="1.2" step="0.002"><output id="dcTscaleV"></output></div>
              <div class="dc-tune-row"><span>Tilt top / bottom</span><input type="range" id="dcTtv" min="-0.5" max="0.5" step="0.005"><output id="dcTtvV"></output></div>
              <div class="dc-tune-row"><span>Tilt left / right</span><input type="range" id="dcTth" min="-0.5" max="0.5" step="0.005"><output id="dcTthV"></output></div>
              <div class="dc-row"><button type="button" class="dc-btn dc-quiet" id="dcTreset">Reset fine-tune</button></div>
              <div class="dc-note">Fine-tune moves the drawn deck over the picture by hand. Prefer points and guide lines — they tell the camera where the deck really is; use these sliders for the last few centimetres.</div>
            </details>
            <div class="dc-row"><button type="button" class="dc-btn dc-quiet" id="dcResetPts">Clear points and lines</button></div>
          </section>

          <section class="dc-sec">
            <div class="dc-sec-title">Overlay</div>
            <label class="dc-check"><input type="checkbox" id="dcOvGrid" checked> Deck outline and bay lines</label>
            <label class="dc-check"><input type="checkbox" id="dcOvCargo" checked> Cargo from the plan</label>
            <label class="dc-field"><span>Overlay strength</span><input type="range" id="dcOvAlpha" min="15" max="100" value="70"></label>
          </section>
        </div>
        <footer class="dc-foot">
          <button type="button" class="dc-btn dc-quiet" id="dcCancel">Close</button>
          <button type="button" class="dc-btn dc-primary dc-pane" data-pane="calib" id="dcSave" disabled>Save calibration</button>
        </footer>
      </aside>
    </div>
  </div>`;
  document.body.appendChild(ov);
  bind(ov);
  return ov;
}

/* ── open / close ──────────────────────────────────────────── */
export function openDeckCamera(tab){
  if(!API) return;
  const ov = buildPanel();
  const geo = API.geo();
  const cam = API.getCamera() || {};
  DC = {
    ov, geo,
    rotation: [0, 90, 180, 270].includes(cam.rotation) ? cam.rotation : 0,
    line: cam.calib && Number.isInteger(cam.calib.line) ? Math.min(geo.bays.length - 2, cam.calib.line) : defaultLine(geo),
    pts: cam.calib && Array.isArray(cam.calib.pts) && cam.calib.pts.length === 4 ? cam.calib.pts.map(p => p && [p[0], p[1]]) : [null, null, null, null],
    savedAspect: cam.calib && cam.calib.aspect || 0,
    extra: cam.calib && Array.isArray(cam.calib.extra) ? cam.calib.extra.filter(e => e && e.bay < geo.bays.length).map(e => ({ bay: e.bay, p: [e.u, e.v] })) : [],
    guides: cam.calib && Array.isArray(cam.calib.guides) ? cam.calib.guides.filter(g => g && featLine(geo, g.f) && Array.isArray(g.p) && g.p.length === 3).map(g => ({ f: g.f, p: g.p.map(q => [q[0], q[1]]), mid: !!g.mid })) : [],
    k: cam.calib && Number.isFinite(cam.calib.k) ? cam.calib.k : 0,
    tf: Object.assign({}, T_NONE, cam.calib && cam.calib.tf || {}),
    drawing: null,          /* { f, p0, p1 } while a guide line is being drawn */
    placing: -1,            /* bay index while placing a bay-number point */
    step: 0, drag: -1, sel: -1, dirty: false,
    src: null, kind: '', stream: null, url: '', raf: 0,
    sw: 0, sh: 0,
  };
  DC.step = DC.pts.findIndex(p => !p); if(DC.step < 0 || (DC.guides.length && DC.pts.every(p => !p))) DC.step = 4;
  ov.querySelector('#dcTitle').textContent = API.vesselName();
  const ls = ov.querySelector('#dcLine');
  ls.innerHTML = '';
  for(let k = 0; k < geo.bays.length - 1; k++){
    const o = document.createElement('option');
    o.value = String(k);
    o.textContent = `Bay ${geo.labels[k]} / Bay ${geo.labels[k + 1]} joint  ·  ${boundaryX(geo, k).toFixed(1)} m from the stern`;
    ls.appendChild(o);
  }
  ls.value = String(DC.line);
  const gf = ov.querySelector('#dcGuideFeat');
  gf.innerHTML = featOptions(geo).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  syncTune();
  const xb = ov.querySelector('#dcExtraBay');
  xb.innerHTML = '';
  for(let i = geo.bays.length - 1; i >= 0; i--){
    const o = document.createElement('option'); o.value = String(i); o.textContent = 'Bay ' + geo.labels[i] + ' centre'; xb.appendChild(o);
  }
  ov.classList.add('open');
  document.body.classList.add('dc-open');
  loadShot(cam);
  DC.wOn = ov.querySelector('#dcWOn').checked; DC.wEvents = []; watchReset();
  ov.querySelector('#dcEmpty').hidden = !!DC.shot;
  ov.querySelector('#dcShotCap').hidden = !DC.shot;
  ov.querySelector('#dcVideoRow').hidden = true;
  srcState();
  renderSteps(); layout(); drawFrame(); drawOverlay(); listDevices(false);
  setTab(tab || (REC ? 'record' : cam.calib ? 'watch' : 'calib'));
  if(CAM) attachLive();
  recRender();
  setTimeout(() => ov.querySelector('#dcClose').focus(), 30);
}
function setTab(t){
  if(!DC) return;
  DC.tab = t;
  DC.ov.querySelectorAll('#dcTabs button').forEach(b => b.classList.toggle('sel', b.dataset.tab === t));
  DC.ov.querySelectorAll('.dc-pane').forEach(p => { p.hidden = p.dataset.pane !== t; });
  if(t !== 'calib'){ DC.placing = -1; DC.drawing = null; }
  if(t === 'watch') watchStart();
  layout(); drawFrame(); drawOverlay(); recRender(); watchRender();
}
function closeDeckCamera(){
  if(!DC) return;
  stopSource();
  if(!REC) stopCam();                /* keep the camera only while recording */
  DC.ov.classList.remove('open');
  document.body.classList.remove('dc-open');
  DC = null;
  recRender();
}
function stopSource(){
  if(!DC) return;
  cancelAnimationFrame(DC.raf); DC.raf = 0;
  if(DC.src && DC.kind === 'video'){ try{ DC.src.pause(); }catch(e){} }
  if(DC.url){ URL.revokeObjectURL(DC.url); DC.url = ''; }
  DC.src = null; DC.kind = '';
}
function stopCam(){
  if(!CAM) return;
  CAM.stream.getTracks().forEach(t => t.stop());
  CAM = null;
}
function attachLive(){
  if(!DC || !CAM) return;
  stopSource();
  DC.src = CAM.video; DC.kind = 'live';
  DC.ov.querySelector('#dcVideoRow').hidden = true;
  setSourceSize(CAM.video.videoWidth, CAM.video.videoHeight);
  loop();
}

/* A photo / video dropped on the window while the panel is open. */
export function dropFileToDeckCamera(file){ if(DC) openFile(file); }

/* ── sources ───────────────────────────────────────────────── */
async function listDevices(afterPermission){
  if(!DC || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try{
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const sel = DC.ov.querySelector('#dcDevice'), cur = sel.value;
    sel.innerHTML = '';
    DC.ov.querySelector('#dcStart').disabled = !devs.length;
    if(!devs.length){ sel.innerHTML = '<option value="">No camera on this computer</option>'; return; }
    devs.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId; o.textContent = d.label || ('Camera ' + (i + 1));
      sel.appendChild(o);
    });
    const pref = API.getCamera() && API.getCamera().deviceLabel;
    const byLabel = pref && devs.find(d => d.label === pref);
    sel.value = cur || (byLabel ? byLabel.deviceId : devs[0].deviceId);
  }catch(e){}
}
async function startCamera(){
  if(!DC) return;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ API.toast('Camera is not available here', 'warn'); return; }
  const id = DC.ov.querySelector('#dcDevice').value;
  if(CAM && (!id || CAM.deviceId === id) && CAM.stream.active){ attachLive(); return; }
  if(REC){ API.toast('Stop the recording before switching camera', 'warn'); return; }
  stopSource(); stopCam();
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      deviceId: id ? { exact: id } : undefined,
      width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } } });
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    const tr = stream.getVideoTracks()[0] || {};
    const st = tr.getSettings ? tr.getSettings() : {};
    CAM = { stream, video: v, label: tr.label || '', deviceId: st.deviceId || id };
    DC.liveLabel = CAM.label;
    attachLive();
    listDevices(true);
    recRender();
  }catch(e){
    API.toast('Could not start the camera — ' + (e && e.name === 'NotAllowedError' ? 'access was refused' : 'is it plugged in?'), 'warn');
  }
}
function openFile(file){
  if(!DC || !file) return;
  stopSource();
  DC.wEvents = []; watchReset();
  const url = URL.createObjectURL(file);
  DC.url = url;
  if(/^video\//.test(file.type) || /\.(mov|mp4|m4v|webm|mkv)$/i.test(file.name)){
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    v.addEventListener('loadeddata', () => {
      if(!DC || DC.src !== v) return;
      setSourceSize(v.videoWidth, v.videoHeight); loop();
    }, { once: true });
    v.addEventListener('error', () => API.toast('This video cannot be played here' + (/\.mov$/i.test(file.name) ? ' — an iPhone HEVC video may need converting to MP4 (H.264)' : ''), 'warn'), { once: true });
    v.addEventListener('ended', () => { if(DC && DC.src === v) watchFlush(); });
    v.addEventListener('play', () => { if(DC && DC.src === v){ try{ v.playbackRate = +DC.ov.querySelector('#dcWRate').value || 1; }catch(_){} } });
    DC.src = v; DC.kind = 'video';
  }else{
    const img = new Image();
    img.onload = () => { if(!DC || DC.src !== img) return; setSourceSize(img.naturalWidth, img.naturalHeight); drawFrame(); };
    img.onerror = () => API.toast('This picture cannot be opened', 'warn');
    img.src = url;
    DC.src = img; DC.kind = 'image';
  }
  DC.ov.querySelector('#dcVideoRow').hidden = DC.kind !== 'video';
}
function setSourceSize(w, h){
  DC.sw = w; DC.sh = h;
  DC.ov.querySelector('#dcEmpty').hidden = true;
  DC.ov.querySelector('#dcShotCap').hidden = true;
  srcState();
  layout(); drawFrame(); drawOverlay();
}
function loop(){
  cancelAnimationFrame(DC.raf);
  const tick = () => {
    if(!DC || !DC.src) return;
    drawFrame();
    if(DC.kind === 'video') syncSeek();
    watchTick();
    DC.raf = requestAnimationFrame(tick);
  };
  DC.raf = requestAnimationFrame(tick);
}

/* ── layout & drawing ──────────────────────────────────────── */
function rotDims(){
  const r = DC.rotation % 180 !== 0;
  return { w: r ? DC.sh : DC.sw, h: r ? DC.sw : DC.sh };
}
function layout(){
  if(!DC) return;
  const stage = DC.ov.querySelector('#dcStage');
  const frame = DC.ov.querySelector('#dcFrame');
  const sr = stage.getBoundingClientRect();
  const { w, h } = DC.sw ? rotDims() : DC.savedAspect ? { w: DC.savedAspect * 1000, h: 1000 } : { w: 9, h: 16 };
  /* "room around the picture": space to place hidden corners beside it */
  const pad = DC.roomy ? Math.round(Math.min(sr.width, sr.height) * 0.2) : 24, aw = Math.max(10, sr.width - pad * 2), ah = Math.max(10, sr.height - pad * 2);
  const s = Math.min(aw / w, ah / h);
  const fw = Math.round(w * s), fh = Math.round(h * s);
  frame.style.width = fw + 'px'; frame.style.height = fh + 'px';
  DC.fw = fw; DC.fh = fh;
  const cv = DC.ov.querySelector('#dcCanvas'), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(fw * dpr); cv.height = Math.round(fh * dpr);
  const svg = DC.ov.querySelector('#dcSvg');
  svg.setAttribute('viewBox', `0 0 ${fw} ${fh}`);
  const res = DC.ov.querySelector('#dcRes');
  res.textContent = DC.sw ? `${rotDims().w} × ${rotDims().h}` : '';
}
/* the source turned by the mount rotation, filling w × h of ctx */
function drawRotated(ctx, w, h){
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(DC.rotation * Math.PI / 180);
  const r = DC.rotation % 180 !== 0;
  const dw = r ? h : w, dh = r ? w : h;
  try{ ctx.drawImage(DC.src, -dw / 2, -dh / 2, dw, dh); }catch(e){}
  ctx.restore();
}
function drawFrame(){
  if(!DC) return;
  const cv = DC.ov.querySelector('#dcCanvas'), ctx = cv.getContext('2d');
  if(DC.src && DC.sw){ ctx.clearRect(0, 0, cv.width, cv.height); drawRotated(ctx, cv.width, cv.height); return; }
  /* v3.40 — no picture: the still the calibration was made on */
  ctx.clearRect(0, 0, cv.width, cv.height);
  if(DC.shot && DC.shot.complete && DC.shot.naturalWidth) ctx.drawImage(DC.shot, 0, 0, cv.width, cv.height);
}
/* v3.40 — a still of the calibration picture, kept on this computer, so the
   calibration can be looked at without the video it was made on */
const shotKey = () => 'spicaTide_camShot_' + String(API.vesselName() || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function saveShot(at){
  if(!DC || !DC.src || !DC.sw) return;
  const d = rotDims(), k = Math.min(1, 720 / Math.max(d.w, d.h));
  const c = document.createElement('canvas'); c.width = Math.round(d.w * k); c.height = Math.round(d.h * k);
  drawRotated(c.getContext('2d'), c.width, c.height);
  try{ lsSet(shotKey(), JSON.stringify({ at, img: c.toDataURL('image/jpeg', 0.72) })); }catch(e){}
}
function loadShot(cam){
  DC.shot = null;
  try{
    const j = JSON.parse(lsGet(shotKey(), 'null'));
    if(!j || !j.img || !cam.calib || j.at !== cam.calib.at) return;
    const im = new Image();
    im.onload = () => { if(DC && DC.shot === im && !DC.src){ layout(); drawFrame(); drawOverlay(); } };
    im.src = j.img; DC.shot = im;
  }catch(e){}
}

/* v3.39 — every clicked point and every guide handle is one constraint;
   any mix that pins the deck down gives a model (camModel.js). */
function aspect(){ if(DC.sw){ const d = rotDims(); return d.w / d.h; } return DC.savedAspect || 9 / 16; }
function constraints(){
  const g = DC.geo, ref = refPoints(g, DC.line), cons = [];
  DC.pts.forEach((p, i) => { if(p) cons.push({ type: 'pt', img: p, deck: ref[i], id: i }); });
  DC.extra.forEach((e, k) => cons.push({ type: 'pt', img: e.p, deck: [bayCentreX(g, e.bay), g.width / 2], id: 4 + k }));
  DC.guides.forEach((gd, gi) => { const f = featLine(g, gd.f); if(f) gd.p.forEach((q, hi) => cons.push({ type: f.axis, val: f.val, img: q, id: GH + gi * 3 + hi })); });
  return cons;
}
function currentModel(){
  const cons = constraints();
  const H = solveH(cons, geoLen(DC.geo), DC.k, aspect());
  DC.cons = cons; DC.H = H;
  return H ? makeModel(H, DC.tf, DC.k, aspect()) : null;
}
/* error per constraint id, in deck metres */
function residualMap(){
  const m = new Map();
  if(!DC.H) return m;
  const r = camResiduals(DC.cons, DC.H, DC.k, aspect());
  DC.cons.forEach((c, i) => { const key = c.id >= GH ? 'g' + Math.floor((c.id - GH) / 3) : c.id; m.set(key, Math.max(m.get(key) || 0, r[i] == null ? 99 : r[i])); });
  return m;
}
/* why there is no model yet — in deck words */
function missingText(){
  const cons = DC.cons || constraints(), n = equationCount(cons);
  const xs = new Set(), ys = new Set();
  cons.forEach(c => { if(c.type !== 'y') xs.add(Math.round((c.type === 'pt' ? c.deck[0] : c.val) * 10)); if(c.type !== 'x') ys.add(Math.round((c.type === 'pt' ? c.deck[1] : c.val) * 10)); });
  if(!n) return 'Place corner points, or draw guide lines along deck edges you can see.';
  if(xs.size < 2) return 'Add a cross line further along the deck — a bay joint, or the stern edge.';
  if(ys.size < 2) return 'Add a line along the other deck edge (foot of the crash barrier).';
  if(n < 8) return `Add ${8 - n} more: another point, or a guide line (each line counts 2–3).`;
  return 'These points and lines do not fix the deck yet — add a cross line (a bay joint) away from the ones you have.';
}

function drawOverlay(){
  if(!DC) return;
  const svg = DC.ov.querySelector('#dcSvg');
  const W = DC.fw || 1, Hh = DC.fh || 1, geo = DC.geo;
  const alpha = (+DC.ov.querySelector('#dcOvAlpha').value || 70) / 100;
  const showGrid = DC.ov.querySelector('#dcOvGrid').checked;
  const showCargo = DC.ov.querySelector('#dcOvCargo').checked;
  const MDL = currentModel(), H = MDL && MDL.H;
  const P = (X, Y) => { const p = MDL && MDL.toImage(X, Y); return p && Math.abs(p[0]) < 4 && Math.abs(p[1]) < 4 ? [p[0] * W, p[1] * Hh] : null; };
  const poly = pts => pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
  let out = '';
  if(H && (DC.sw || DC.savedAspect)){
    const L = geo.length, Wd = geo.width;
    if(showCargo){
      API.cargo().forEach(c => {
        const q = [P(c.x0, c.y0), P(c.x1, c.y0), P(c.x1, c.y1), P(c.x0, c.y1)];
        if(q.some(v => !v)) return;
        const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2;
        const sz = Math.max(8, Math.min(22, Math.abs(q[1][0] - q[0][0]) / Math.max(4, String(c.ccu || '').length) * 1.5));
        out += `<polygon class="dc-cargo" points="${poly(q)}" style="fill:${esc(c.color)};fill-opacity:${(0.42 * alpha).toFixed(2)};stroke:${esc(c.color)};stroke-opacity:${alpha.toFixed(2)}"/>`;
        if(c.ccu) out += `<text class="dc-cargo-t" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" style="font-size:${sz.toFixed(1)}px;opacity:${Math.min(1, alpha + .2).toFixed(2)}">${esc(c.ccu)}</text>`;
      });
    }
    if(showGrid){
      /* outline, sampled so a part behind the camera is skipped cleanly */
      const seg = (x0, y0, x1, y1, cls) => {
        const n = 24; let d = '', pen = false;
        for(let i = 0; i <= n; i++){
          const p = P(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
          if(!p){ pen = false; continue; }
          d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); pen = true;
        }
        return d ? `<path class="${cls}" d="${d}" style="stroke-opacity:${alpha.toFixed(2)}"/>` : '';
      };
      out += seg(0, 0, L, 0, 'dc-edge') + seg(0, Wd, L, Wd, 'dc-edge') + seg(0, 0, 0, Wd, 'dc-edge') + seg(L, 0, L, Wd, 'dc-edge');
      for(let k = 0; k < geo.bays.length - 1; k++){
        const x = boundaryX(geo, k);
        out += seg(x, 0, x, Wd, k === DC.line ? 'dc-line dc-line-ref' : 'dc-line');
      }
      geo.bays.forEach((_, i) => {
        const x = bayCentreX(geo, i), p = P(x, Wd / 2), q = P(x + 1, Wd / 2);
        if(!p || !q || p[1] < -20 || p[1] > Hh + 20) return;
        const sz = Math.max(9, Math.min(30, Math.hypot(q[0] - p[0], q[1] - p[1]) * 1.1));
        out += `<text class="dc-bay" x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" style="font-size:${sz.toFixed(1)}px;opacity:${Math.min(1, alpha + .15).toFixed(2)}">${esc(geo.labels[i])}</text>`;
      });
      const pp = P(1.2, Wd * 0.08), ps = P(1.2, Wd * 0.92);
      if(pp) out += `<text class="dc-side-t" x="${pp[0].toFixed(1)}" y="${pp[1].toFixed(1)}" style="opacity:${alpha.toFixed(2)}">PORT</text>`;
      if(ps) out += `<text class="dc-side-t" x="${ps[0].toFixed(1)}" y="${ps[1].toFixed(1)}" style="opacity:${alpha.toFixed(2)}">STBD</text>`;
    }
  }
  /* v3.40 — Watch lifts: the lock on the load, its shadow on the deck, and
     where the last loads were set down */
  if(DC.tab === 'watch' && DC.w){
    const Pn = (X, Y) => { const p = MDL && MDL.toImage(X, Y); return p && Math.abs(p[0]) < 3 && Math.abs(p[1]) < 3 ? [p[0] * W, p[1] * Hh] : null; };
    const fpPoly = fp => { const q = fp.poly.map(c => Pn(c[0], c[1])); return q.some(v => !v) ? null : poly(q); };
    DC.wEvents.slice(0, 6).forEach((e, i) => {
      if(!e.fp || !MDL || e.movedOn) return;
      const pg = fpPoly(e.fp); if(!pg) return;
      const c = Pn(e.fp.centre[0], e.fp.centre[1]);
      out += `<polygon class="dc-w-past ${e.kind}" points="${pg}" style="opacity:${(1 - i * 0.13).toFixed(2)}"/>`;
      if(c) out += `<text class="dc-w-past-t" x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}">${esc(e.reading && e.reading.text ? e.reading.text : e.kind === 'landed' ? 'set down' : 'lifted')}</text>`;
    });
    const tr = DC.w.st && DC.w.st.track;
    if(tr){
      const fp = MDL ? footprint(tr.box, tr.foot) : null;
      const down = tr.phase === 'down';
      if(fp){
        const pg = fpPoly(fp);
        if(pg) out += `<polygon class="dc-w-shadow${down ? ' down' : ''}" points="${pg}"/>`;
        const c = Pn(fp.centre[0], fp.centre[1]);
        const f = [tr.foot[0] * W, tr.foot[1] * Hh];
        if(c && !down) out += `<line class="dc-w-drop" x1="${f[0].toFixed(1)}" y1="${f[1].toFixed(1)}" x2="${c[0].toFixed(1)}" y2="${c[1].toFixed(1)}"/>`;
      }
      /* lock brackets, like a camera's subject tracking */
      const x = tr.box.x * W, y = tr.box.y * Hh, w = tr.box.w * W, h = tr.box.h * Hh, k = Math.max(6, Math.min(18, Math.min(w, h) * 0.28));
      const br = (px, py, dx, dy) => `M${(px + dx * k).toFixed(1)} ${py.toFixed(1)}L${px.toFixed(1)} ${py.toFixed(1)}L${px.toFixed(1)} ${(py + dy * k).toFixed(1)}`;
      out += `<path class="dc-w-lock${down ? ' down' : ''}" d="${br(x, y, 1, 1)}${br(x + w, y, -1, 1)}${br(x, y + h, 1, -1)}${br(x + w, y + h, -1, -1)}"/>`;
      const rd = bestReading(tr.id);
      const lab = (rd && rd.text ? rd.text + (rd.sure ? '' : ' ?') : 'reading…') + (fp ? '  →  ' + whereOf(fp) : '');
      out += `<text class="dc-w-lab" x="${x.toFixed(1)}" y="${Math.max(12, y - 7).toFixed(1)}">${esc(lab)}</text>`;
    }
  }
  /* guide lines */
  const resM = residualMap();
  if(DC.tab === 'calib') DC.guides.forEach((gd, gi) => {
    const f = featLine(geo, gd.f); if(!f) return;
    const q = gd.p.map(p => [p[0] * W, p[1] * Hh]);
    const sel = DC.sel >= GH + gi * 3 && DC.sel < GH + gi * 3 + 3;
    out += `<g class="dc-guide${sel ? ' sel' : ''}"><polyline points="${q.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" class="dc-guide-l"/>`;
    q.forEach((p, hi) => { out += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${hi === 1 ? 4.5 : 6}" class="dc-guide-h${hi === 1 ? ' mid' : ''}${DC.sel === GH + gi * 3 + hi ? ' on' : ''}"/>`; });
    out += `<text x="${(q[0][0] + 9).toFixed(1)}" y="${(q[0][1] - 8).toFixed(1)}" class="dc-guide-t">${esc(f.short)}</text></g>`;
  });
  if(DC.drawing && DC.drawing.p0){
    const a = DC.drawing.p0, b = DC.drawing.p1 || a;
    out += `<line class="dc-guide-draw" x1="${(a[0] * W).toFixed(1)}" y1="${(a[1] * Hh).toFixed(1)}" x2="${(b[0] * W).toFixed(1)}" y2="${(b[1] * Hh).toFixed(1)}"/>`;
  }
  /* picked points */
  if(DC.tab === 'calib') DC.extra.forEach((e, k) => {
    const x = e.p[0] * W, y = e.p[1] * Hh, i = 4 + k;
    out += `<g class="dc-pt dc-pt-x${i === DC.sel ? ' sel' : ''}" data-i="${i}">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" class="dc-pt-halo"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="dc-pt-dot"/>
      <text x="${(x + 12).toFixed(1)}" y="${(y - 10).toFixed(1)}" class="dc-pt-n">${esc(geo.labels[e.bay])}</text></g>`;
  });
  if(DC.tab === 'calib') DC.pts.forEach((p, i) => {
    if(!p) return;
    const x = p[0] * W, y = p[1] * Hh;
    out += `<g class="dc-pt${i === DC.sel ? ' sel' : ''}" data-i="${i}">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" class="dc-pt-halo"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" class="dc-pt-dot"/>
      <text x="${(x + 13).toFixed(1)}" y="${(y - 11).toFixed(1)}" class="dc-pt-n">${i + 1}</text></g>`;
  });
  svg.innerHTML = out;
  renderMap();
  /* status */
  const st = DC.ov.querySelector('#dcCalState');
  DC.res = resM;
  const over = DC.cons && equationCount(DC.cons) > 8;
  const worst = H && over && resM.size ? Math.max(...resM.values()) : null;
  st.textContent = H
    ? '· ready' + (worst != null ? ` · worst ${fmtRes(worst)}` : '') + (isIdentityT(DC.tf) ? '' : ' · fine-tuned')
    : `· ${equationCount(DC.cons || [])} of 8`;
  st.title = H ? '' : missingText();
  renderResiduals();
  DC.ov.querySelector('#dcSave').disabled = !(H && DC.dirty) || !API.isOperator();
  const tka = DC.ov.querySelector('#dcTkAuto'); if(tka) tka.disabled = !(DC.cons && equationCount(DC.cons) >= 10);
  /* aspect warning */
  const hint = DC.ov.querySelector('#dcHint');
  if(DC.savedAspect && DC.sw){
    const a = rotDims().w / rotDims().h;
    hint.classList.toggle('warn', Math.abs(a - DC.savedAspect) > 0.02);
    if(Math.abs(a - DC.savedAspect) > 0.02){
      hint.textContent = 'This picture has a different shape from the one the camera was calibrated on — rotate it or place the points again.';
      return;
    }
  }
  hint.classList.remove('warn');
  if(DC.drawing){ hint.textContent = `${featLine(geo, DC.drawing.f).name}: press on the picture where you can see it, drag along it, release. Esc cancels.`; return; }
  if(!H && (DC.cons || []).length){ hint.textContent = missingText(); hint.classList.add('warn'); return; }
  if(DC.placing >= 0){ hint.textContent = `Click the middle of Bay ${geo.labels[DC.placing]} on the centreline (its painted number).`; return; }
  hint.textContent = DC.step < 4
    ? `Click the picture: ${stepTexts()[DC.step][1]}. Hidden by cargo or outside the picture? Click beside the picture where it would be, or skip it and use guide lines.`
    : 'Drag a point to adjust it; arrow keys nudge the selected point (Shift = ×10). The drawn bay lines should sit on the deck joints.';
}

function fmtRes(v){ return v == null ? '' : (v < 0.995 ? Math.round(v * 100) + ' cm' : v.toFixed(2) + ' m'); }
function resClass(v){ return v == null ? '' : v < 0.25 ? ' good' : v < 0.6 ? ' fair' : ' bad'; }
function renderResiduals(){
  if(!DC) return;
  const show = DC.H && DC.cons && equationCount(DC.cons) > 8;
  const rv = key => DC.res && DC.res.has(key) ? DC.res.get(key) : null;
  DC.ov.querySelectorAll('#dcSteps .dc-step').forEach((li, i) => {
    const s = li.querySelector('.dc-step-s');
    s.className = 'dc-step-s' + (show ? resClass(rv(i)) : '');
    s.textContent = DC.pts[i] ? (show ? fmtRes(rv(i)) : '✓') : '';
  });
  const gl = DC.ov.querySelector('#dcGuides');
  gl.innerHTML = '';
  DC.guides.forEach((gd, gi) => {
    const f = featLine(DC.geo, gd.f), v = show ? rv('g' + gi) : null;
    const sel = DC.sel >= GH + gi * 3 && DC.sel < GH + gi * 3 + 3;
    const li = el('li', 'dc-step done dc-gl' + (sel ? ' cur' : ''));
    li.innerHTML = `<span class="dc-step-n dc-gl-n">⁄</span><span class="dc-step-t">${esc(f ? f.name : gd.f)}</span><span class="dc-step-s${resClass(v)}">${v != null ? fmtRes(v) : '✓'}</span><button type="button" class="dc-del" title="Remove this line">✕</button>`;
    li.addEventListener('click', ev => {
      if(ev.target.closest('.dc-del')){ DC.guides.splice(gi, 1); DC.sel = -1; DC.dirty = true; drawOverlay(); return; }
      DC.sel = GH + gi * 3 + 1; drawOverlay();
    });
    gl.appendChild(li);
  });
  const ol = DC.ov.querySelector('#dcExtras');
  ol.innerHTML = '';
  DC.extra.forEach((e, k) => {
    const v = show ? rv(4 + k) : null;
    const li = el('li', 'dc-step done' + (DC.sel === 4 + k ? ' cur' : ''));
    li.innerHTML = `<span class="dc-step-n">${esc(DC.geo.labels[e.bay])}</span><span class="dc-step-t">Bay ${esc(DC.geo.labels[e.bay])} centre</span><span class="dc-step-s${resClass(v)}">${fmtRes(v)}</span><button type="button" class="dc-del" title="Remove this point">✕</button>`;
    li.addEventListener('click', ev => {
      if(ev.target.closest('.dc-del')){ DC.extra.splice(k, 1); DC.sel = -1; DC.dirty = true; drawOverlay(); return; }
      DC.sel = 4 + k; drawOverlay();
    });
    ol.appendChild(li);
  });
}
function renderSteps(){
  const ol = DC.ov.querySelector('#dcSteps');
  ol.innerHTML = '';
  stepTexts().forEach(([t], i) => {
    const li = el('li', 'dc-step' + (DC.pts[i] ? ' done' : '') + (i === DC.step ? ' cur' : ''));
    li.innerHTML = `<span class="dc-step-n">${i + 1}</span><span class="dc-step-t">${esc(t)}</span><span class="dc-step-s">${DC.pts[i] ? '✓' : ''}</span>${DC.pts[i] ? '<button type="button" class="dc-del" title="Remove this point (hidden or not needed)">✕</button>' : ''}`;
    li.addEventListener('click', ev => {
      if(ev.target.closest('.dc-del')){ DC.pts[i] = null; DC.step = i; DC.sel = -1; DC.dirty = true; renderSteps(); drawOverlay(); return; }
      DC.step = i; DC.placing = -1; DC.drawing = null; DC.sel = DC.pts[i] ? i : -1; renderSteps(); drawOverlay();
    });
    ol.appendChild(li);
  });
  renderResiduals();
}

/* ── pointer ───────────────────────────────────────────────── */
function toNorm(e){
  const r = DC.ov.querySelector('#dcFrame').getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}
/* points may sit beside the picture (hidden corners): allowed range */
const LIM0 = -0.5, LIM1 = 1.5;   /* same range the vessel profile keeps */
const clampN = v => Math.min(LIM1, Math.max(LIM0, v));
function ptAt(i){
  if(i >= GH){ const g = DC.guides[Math.floor((i - GH) / 3)]; return g && g.p[(i - GH) % 3]; }
  return i < 4 ? DC.pts[i] : (DC.extra[i - 4] && DC.extra[i - 4].p);
}
function setPt(i, v){
  if(i >= GH){
    const g = DC.guides[Math.floor((i - GH) / 3)], h = (i - GH) % 3; if(!g) return;
    g.p[h] = v;
    if(h === 1) g.mid = true;                       /* the user bent it */
    else if(!g.mid) g.p[1] = [(g.p[0][0] + g.p[2][0]) / 2, (g.p[0][1] + g.p[2][1]) / 2];
    return;
  }
  if(i < 4) DC.pts[i] = v; else if(DC.extra[i - 4]) DC.extra[i - 4].p = v;
}
function allIds(){
  const ids = [0, 1, 2, 3];
  DC.extra.forEach((_, k) => ids.push(4 + k));
  DC.guides.forEach((_, gi) => ids.push(GH + gi * 3, GH + gi * 3 + 1, GH + gi * 3 + 2));
  return ids;
}
function hitPoint(e){
  const r = DC.ov.querySelector('#dcFrame').getBoundingClientRect();
  let best = -1, bd = 16;
  for(const i of allIds()){
    const p = ptAt(i);
    if(!p) continue;
    const d = Math.hypot(p[0] * r.width + r.left - e.clientX, p[1] * r.height + r.top - e.clientY);
    if(d < bd){ bd = d; best = i; }
  }
  return best;
}
function showLoupe(e){
  const lp = DC.ov.querySelector('#dcLoupe');
  if(!DC.sw){ lp.hidden = true; return; }
  const cv = DC.ov.querySelector('#dcCanvas');
  const fr = DC.ov.querySelector('#dcFrame').getBoundingClientRect();
  const sr = DC.ov.querySelector('#dcStage').getBoundingClientRect();
  const fx = (e.clientX - fr.left) / fr.width, fy = (e.clientY - fr.top) / fr.height;
  if(fx < 0 || fy < 0 || fx > 1 || fy > 1){ lp.hidden = true; return; }
  lp.hidden = false;
  const S = 168, Z = 3.2 / (window.devicePixelRatio || 1) * (cv.width / fr.width);
  const ctx = lp.getContext('2d');
  const cx = fx * cv.width, cy = fy * cv.height, half = S / 2 / Z;
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cv, cx - half, cy - half, half * 2, half * 2, 0, 0, S, S);
  ctx.strokeStyle = 'rgba(255,214,10,.95)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(S / 2, 8); ctx.lineTo(S / 2, S / 2 - 6); ctx.moveTo(S / 2, S / 2 + 6); ctx.lineTo(S / 2, S - 8);
  ctx.moveTo(8, S / 2); ctx.lineTo(S / 2 - 6, S / 2); ctx.moveTo(S / 2 + 6, S / 2); ctx.lineTo(S - 8, S / 2); ctx.stroke();
  ctx.restore();
  let lx = e.clientX - sr.left + 24, ly = e.clientY - sr.top + 24;
  if(lx + S > sr.width - 8) lx = e.clientX - sr.left - S - 24;
  if(ly + S > sr.height - 8) ly = e.clientY - sr.top - S - 24;
  lp.style.left = lx + 'px'; lp.style.top = ly + 'px';
}

function finishGuide(){
  const d = DC.drawing; if(!d || !d.p0 || !d.p1) return;
  const mid = [(d.p0[0] + d.p1[0]) / 2, (d.p0[1] + d.p1[1]) / 2];
  /* one line per deck feature: drawing it again replaces it */
  const ex = DC.guides.findIndex(g => g.f === d.f);
  const g = { f: d.f, p: [d.p0, mid, d.p1], mid: false };
  if(ex >= 0) DC.guides[ex] = g; else DC.guides.push(g);
  const gi = ex >= 0 ? ex : DC.guides.length - 1;
  DC.sel = GH + gi * 3 + 1; DC.drawing = null; DC.dirty = true;
  if(DC.pts.every(p => !p)) DC.step = 4;     /* working with lines: clicks no longer drop corner points */
  renderSteps(); renderMap(true); drawOverlay();
}
function syncTune(){
  if(!DC) return;
  const $ = q => DC.ov.querySelector(q), t = DC.tf;
  const set = (id, v, txt) => { const r = $(id); if(r && document.activeElement !== r) r.value = String(v); const o = $(id + 'V'); if(o) o.textContent = txt; };
  set('#dcTk', DC.k, (DC.k > 0 ? '+' : '') + DC.k.toFixed(3));
  set('#dcTdx', t.dx, (t.dx * 100).toFixed(1) + '%');
  set('#dcTdy', t.dy, (t.dy * 100).toFixed(1) + '%');
  set('#dcTrot', t.rot, t.rot.toFixed(1) + '°');
  set('#dcTscale', t.scale, Math.round(t.scale * 100) + '%');
  set('#dcTtv', t.tv, t.tv.toFixed(2));
  set('#dcTth', t.th, t.th.toFixed(2));
  const d = $('#dcTune'); if(d && (!isIdentityT(t) || DC.k) && !d.dataset.seen){ d.open = true; d.dataset.seen = '1'; }
}

function bind(ov){
  const $ = s => ov.querySelector(s);
  $('#dcClose').addEventListener('click', () => closeDeckCamera());
  $('#dcTabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if(b) setTab(b.dataset.tab); });
  $('#dcRecBtn').addEventListener('click', () => { if(REC) stopRecording(); else startRecording(); });
  $('#dcRecDirBtn').addEventListener('click', () => chooseRecFolder());
  $('#dcRecQ').addEventListener('change', e => lsSet('spicaTide_recQ', e.target.value));
  $('#dcWOn').addEventListener('change', e => { if(!DC) return; DC.wOn = e.target.checked; if(!DC.wOn) watchReset(); watchRender(); drawOverlay(); });
  $('#dcWRate').addEventListener('change', e => { if(DC && DC.kind === 'video'){ try{ DC.src.playbackRate = +e.target.value; }catch(_){} } });
  $('#dcCancel').addEventListener('click', () => closeDeckCamera());
  $('#dcStart').addEventListener('click', () => startCamera());
  $('#dcDevice').addEventListener('change', () => { if(DC && DC.kind === 'live') startCamera(); });
  $('#dcOpen').addEventListener('click', () => $('#dcFile').click());
  $('#dcFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if(f) openFile(f); e.target.value = ''; });
  $('#dcRoomy').addEventListener('change', e => { if(!DC) return; DC.roomy = e.target.checked; layout(); drawFrame(); drawOverlay(); });
  $('#dcRotL').addEventListener('click', () => rotate(-90));
  $('#dcRotR').addEventListener('click', () => rotate(90));
  $('#dcLine').addEventListener('change', e => { DC.line = +e.target.value; DC.dirty = true; renderSteps(); drawOverlay(); });
  ['#dcOvGrid', '#dcOvCargo', '#dcOvAlpha'].forEach(s => $(s).addEventListener('input', () => drawOverlay()));
  $('#dcResetPts').addEventListener('click', () => { DC.pts = [null, null, null, null]; DC.extra = []; DC.guides = []; DC.drawing = null; DC.placing = -1; DC.step = 0; DC.sel = -1; DC.dirty = true; renderSteps(); drawOverlay(); });
  $('#dcGuideDraw').addEventListener('click', () => {
    if(!DC || !DC.sw) return;
    DC.drawing = { f: $('#dcGuideFeat').value, p0: null, p1: null }; DC.placing = -1; DC.sel = -1;
    renderMap(true); drawOverlay();
  });
  $('#dcGuideFeat').addEventListener('change', () => { if(DC && DC.drawing){ DC.drawing.f = $('#dcGuideFeat').value; } renderMap(true); drawOverlay(); });
  const TUNE = [['#dcTk', 'k'], ['#dcTdx', 'dx'], ['#dcTdy', 'dy'], ['#dcTrot', 'rot'], ['#dcTscale', 'scale'], ['#dcTtv', 'tv'], ['#dcTth', 'th']];
  TUNE.forEach(([sel, key]) => $(sel).addEventListener('input', e => {
    if(!DC) return;
    const v = +e.target.value;
    if(key === 'k') DC.k = v; else DC.tf[key] = v;
    DC.dirty = true; syncTune(); drawOverlay();
  }));
  $('#dcTkAuto').addEventListener('click', () => {
    if(!DC) return;
    const k = autoLens(constraints(), geoLen(DC.geo), aspect());
    if(k == null){ API.toast('Add more points or guide lines first — at least 10 handles, spread over the picture', 'info'); return; }
    DC.k = k; DC.dirty = true; syncTune(); drawOverlay();
    API.toast(`Lens curvature set to ${k > 0 ? '+' : ''}${k.toFixed(3)}`, 'ok');
  });
  $('#dcTreset').addEventListener('click', () => { if(!DC) return; DC.tf = Object.assign({}, T_NONE); DC.dirty = true; syncTune(); drawOverlay(); });
  $('#dcAddExtra').addEventListener('click', () => {
    if(!DC || !DC.sw) return;
    DC.placing = +$('#dcExtraBay').value; DC.sel = -1; drawOverlay();
  });
  $('#dcSave').addEventListener('click', () => save());
  $('#dcPlay').addEventListener('click', () => {
    if(!DC || DC.kind !== 'video') return;
    if(DC.src.paused) DC.src.play().catch(() => {}); else DC.src.pause();
  });
  $('#dcSeek').addEventListener('input', e => {
    if(!DC || DC.kind !== 'video' || !DC.src.duration) return;
    DC.src.currentTime = DC.src.duration * (+e.target.value / 1000);
  });

  const stage = $('#dcStage');
  stage.addEventListener('pointerdown', e => {
    if(!DC || !DC.sw || e.button !== 0 || DC.tab !== 'calib') return;
    const n0 = toNorm(e);
    if(n0[0] < LIM0 || n0[1] < LIM0 || n0[0] > LIM1 || n0[1] > LIM1) return;
    const n = [clampN(n0[0]), clampN(n0[1])];
    const hit = hitPoint(e);
    if(DC.drawing){
      if(!DC.drawing.p0){ DC.drawing.p0 = n; DC.drawing.p1 = n; DC.drawing.down = true; }
      else { DC.drawing.p1 = n; finishGuide(); }
      stage.setPointerCapture(e.pointerId); showLoupe(e); drawOverlay(); return;
    }
    if(DC.placing >= 0){
      const b = DC.placing, ex = DC.extra.findIndex(x => x.bay === b);
      if(ex >= 0) DC.extra[ex].p = n; else DC.extra.push({ bay: b, p: n });
      DC.sel = 4 + (ex >= 0 ? ex : DC.extra.length - 1); DC.drag = DC.sel; DC.placing = -1; DC.dirty = true;
    }else if(hit >= 0){
      DC.drag = hit; DC.sel = hit;
    }else if(DC.step < 4){
      DC.pts[DC.step] = n; DC.sel = DC.step; DC.drag = DC.step; DC.dirty = true;
      DC.step = DC.pts.findIndex(p => !p); if(DC.step < 0) DC.step = 4;
      renderSteps();
    }else{
      DC.sel = -1;
    }
    stage.setPointerCapture(e.pointerId);
    showLoupe(e); drawOverlay();
  });
  stage.addEventListener('pointermove', e => {
    if(!DC) return;
    if(DC.drawing && DC.drawing.p0){
      const n = toNorm(e); DC.drawing.p1 = [clampN(n[0]), clampN(n[1])]; drawOverlay();
    }else if(DC.drag >= 0){
      const n = toNorm(e);
      setPt(DC.drag, [clampN(n[0]), clampN(n[1])]);
      DC.dirty = true; drawOverlay();
    }
    const placing = DC.tab === 'calib' && (DC.step < 4 || DC.placing >= 0 || DC.drag >= 0 || !!DC.drawing || hitPoint(e) >= 0);
    if(placing) showLoupe(e); else $('#dcLoupe').hidden = true;
    if(DC.tab !== 'calib'){ stage.style.cursor = 'default'; return; }
    stage.style.cursor = DC.drag >= 0 ? 'grabbing' : (hitPoint(e) >= 0 && DC.placing < 0 && !DC.drawing ? 'grab' : ((DC.step < 4 || DC.placing >= 0 || DC.drawing) && DC.sw ? 'crosshair' : 'default'));
  });
  const end = () => {
    if(!DC) return;
    /* press–drag–release draws the guide; a plain click waits for a second click */
    if(DC.drawing && DC.drawing.down && DC.drawing.p0 && DC.drawing.p1){
      DC.drawing.down = false;
      const dx = (DC.drawing.p1[0] - DC.drawing.p0[0]) * DC.fw, dy = (DC.drawing.p1[1] - DC.drawing.p0[1]) * DC.fh;
      if(Math.hypot(dx, dy) > 14) finishGuide();
      return;
    }
    DC.drag = -1; renderSteps();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', () => { if(DC && DC.drag < 0) $('#dcLoupe').hidden = true; });

  ov.addEventListener('keydown', e => {
    if(!DC) return;
    if(e.key === 'Escape'){
      e.preventDefault(); e.stopPropagation();
      if(DC.drawing || DC.placing >= 0){ DC.drawing = null; DC.placing = -1; renderMap(true); drawOverlay(); return; }
      closeDeckCamera(); return;
    }
    const k = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }[e.key];
    if(k && DC.sel >= 0 && ptAt(DC.sel) && !/INPUT|SELECT/.test(document.activeElement.tagName)){
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1, p = ptAt(DC.sel);
      setPt(DC.sel, [clampN(p[0] + k[0] * s / DC.fw), clampN(p[1] + k[1] * s / DC.fh)]);
      DC.dirty = true; drawOverlay();
    }
  });
  window.addEventListener('resize', () => { if(DC){ layout(); drawFrame(); drawOverlay(); } });
}

function rotate(d){
  if(!DC) return;
  DC.rotation = (DC.rotation + d + 360) % 360;
  /* rotate the picked points with the picture so they stay on the deck */
  const rp = p => p && (d > 0 ? [1 - p[1], p[0]] : [p[1], 1 - p[0]]);
  DC.pts = DC.pts.map(rp);
  DC.extra.forEach(e => { e.p = rp(e.p); });
  DC.guides.forEach(g => { g.p = g.p.map(rp); });
  DC.tf = Object.assign({}, T_NONE); syncTune();
  DC.dirty = true;
  layout(); drawFrame(); drawOverlay();
}
function syncSeek(){
  const v = DC.src;
  if(!v.duration) return;
  const s = DC.ov.querySelector('#dcSeek');
  if(document.activeElement !== s) s.value = String(Math.round(v.currentTime / v.duration * 1000));
  const t = Math.floor(v.currentTime);
  DC.ov.querySelector('#dcTime').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  DC.ov.querySelector('#dcPlay').textContent = v.paused ? '▶' : '❚❚';
}

function save(){
  if(!DC || !API.isOperator()) return;
  const M = currentModel();
  if(!M){ API.toast(missingText(), 'warn'); return; }
  const prev = API.getCamera() || {};
  const d = DC.sw ? rotDims() : null;
  const cam = Object.assign({}, prev, {
    rotation: DC.rotation,
    calib: { v: 2, pts: DC.pts.map(p => p ? [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5] : null), line: DC.line,
             guides: DC.guides.map(g => ({ f: g.f, mid: g.mid, p: g.p.map(q => [Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5]) })),
             k: DC.k, tf: isIdentityT(DC.tf) ? null : Object.assign({}, DC.tf),
             extra: DC.extra.map(e => ({ bay: e.bay, u: Math.round(e.p[0] * 1e5) / 1e5, v: Math.round(e.p[1] * 1e5) / 1e5 })),
             aspect: d ? Math.round(d.w / d.h * 1e4) / 1e4 : (prev.calib && prev.calib.aspect) || 0,
             at: new Date().toISOString() },
  });
  if(DC.kind === 'live' && CAM && CAM.label) cam.deviceLabel = CAM.label;
  API.setCamera(cam);
  saveShot(cam.calib.at);
  DC.savedAspect = cam.calib.aspect;
  DC.dirty = false;
  drawOverlay();
  API.toast('Camera calibration saved for ' + API.vesselName(), 'ok');
}

/* ════════════════════════════════════════════════════════════
   RECORDING
   MediaRecorder on the live camera, 2-second chunks appended straight to
   disk (Rust append_file_raw, raw bytes — no JSON), so a crash loses at
   most the last two seconds. Next to the video, <name>.json holds the
   vessel, calibration, load list, Imported queue, the deck at the start
   and a timed log of every change on the plan (place / move / status /
   remove) — ground truth for training the camera model.
════════════════════════════════════════════════════════════ */
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : v; }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const tauri = () => !!(window.__dcMock || API.isTauri());
const call = (c, a, o) => (window.__dcMock ? window.__dcMock(c, a, o) : API.invoke(c, a, o));
const MIMES = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
function pickMime(){ return (typeof MediaRecorder !== 'undefined' && MIMES.find(m => { try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } })) || ''; }
const pad = n => String(n).padStart(2, '0');
const fmtDur = s => `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)}`;
const fmtSize = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e7 ? Math.round(b / 1e6) + ' MB' : (b / 1e6).toFixed(1) + ' MB';
const sepOf = dir => (dir.includes('\\') && !dir.includes('/')) ? '\\' : '/';

async function chooseRecFolder(){
  if(window.__dcMock){ lsSet('spicaTide_recDir', window.__dcMockDir || '/rec'); recRender(); return true; }
  if(!API.isTauri()){ API.toast('In the browser the video is downloaded when you stop', 'info'); return true; }
  try{
    const dlg = await import('@tauri-apps/plugin-dialog');
    const d = await dlg.open({ directory: true, multiple: false, title: 'Folder for deck camera recordings' });
    const dir = typeof d === 'string' ? d : (d && d.path);
    if(!dir) return false;
    lsSet('spicaTide_recDir', dir); recRender(); return true;
  }catch(e){ API.toast('Could not choose the folder — ' + (e && e.message || e), 'warn'); return false; }
}

function cargoMap(){
  const m = new Map();
  API.cargo().forEach(c => m.set(String(c.id), c));
  return m;
}
const r2 = v => Math.round(v * 100) / 100;
function evOf(type, c, t){
  return { t, at: new Date().toISOString(), type, id: c.id, ccu: c.ccu || '', desc: c.desc || '', wt: c.wt || '',
           status: c.status || '', loc: c.loc || '', dg: c.dg || [],
           x0: r2(c.x0), x1: r2(c.x1), y0: r2(c.y0), y1: r2(c.y1) };
}
/* Called by the app after every saved change of the plan. */
export function onPlanChanged(){
  if(!REC) return;
  const now = cargoMap(), t = Math.round((performance.now() - REC.t0) / 10) / 100;
  now.forEach((c, id) => {
    const p = REC.prev.get(id);
    if(!p){ REC.events.push(evOf('place', c, t)); return; }
    if(Math.abs(p.x0 - c.x0) > 0.05 || Math.abs(p.y0 - c.y0) > 0.05 || Math.abs((p.x1 - p.x0) - (c.x1 - c.x0)) > 0.05) REC.events.push(evOf('move', c, t));
    else if(p.status !== c.status || p.loc !== c.loc || p.ccu !== c.ccu) REC.events.push(evOf('edit', c, t));
  });
  REC.prev.forEach((c, id) => { if(!now.has(id)) REC.events.push(evOf('remove', c, t)); });
  REC.prev = now;
  recRender();
}

function sidecar(final){
  const snap = API.snapshot();
  return JSON.stringify({
    schema: 1, kind: 'spica-tide-deck-recording', app: snap.app,
    vessel: snap.vessel, camera: API.getCamera(),
    video: { file: REC.file, mime: REC.mime, width: REC.w, height: REC.h, bitsPerSecond: REC.bps, deviceLabel: CAM ? CAM.label : '' },
    startedAt: REC.startedAt.toISOString(), endedAt: final ? new Date().toISOString() : null,
    durationS: Math.round((performance.now() - REC.t0) / 100) / 10,
    loadList: snap.loadList, queue: snap.queue,
    deckAtStart: REC.deckAtStart, events: REC.events,
  }, null, 1);
}
async function writeSidecar(final){
  if(!REC || !REC.jsonPath) return;
  try{ await call('write_file', { path: REC.jsonPath, contents: sidecar(final) }); }
  catch(e){ REC.err = 'Could not write the log file — ' + String(e && e.message || e).slice(0, 120); recRender(); }
}
async function writeChunk(blob){
  const buf = new Uint8Array(await blob.arrayBuffer());
  const n = await call('append_file_raw', buf, { headers: { 'x-path': encodeURIComponent(REC.path) } });
  if(REC) REC.bytes = typeof n === 'number' ? n : REC.bytes + buf.length;
}

async function startRecording(){
  if(REC) return;
  if(!API.isOperator()){ API.toast('Viewer mode — recording is not available', 'warn'); return; }
  if(!CAM){ API.toast('Start the camera first', 'warn'); return; }
  const mime = pickMime();
  if(!mime){ API.toast('This computer cannot record video here', 'warn'); return; }
  let dir = lsGet('spicaTide_recDir', '');
  if(tauri() && !dir){ if(!(await chooseRecFolder())) return; dir = lsGet('spicaTide_recDir', ''); if(!dir) return; }
  const bps = (+(DC && DC.ov.querySelector('#dcRecQ').value) || 12) * 1e6;
  const d = new Date();
  const slug = String(API.vesselName()).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'DECK';
  const base = `${slug}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  let rec;
  try{ rec = new MediaRecorder(CAM.stream, { mimeType: mime, videoBitsPerSecond: bps }); }
  catch(e){ API.toast('Could not start recording — ' + (e && e.message || e), 'warn'); return; }
  const sep = sepOf(dir);
  REC = {
    recorder: rec, mime, bps, file: base + '.' + ext,
    path: tauri() ? dir.replace(/[\\/]+$/, '') + sep + base + '.' + ext : '',
    jsonPath: tauri() ? dir.replace(/[\\/]+$/, '') + sep + base + '.json' : '',
    startedAt: d, t0: performance.now(), bytes: 0, events: [], prev: cargoMap(),
    deckAtStart: [], chain: Promise.resolve(), mem: [], err: '',
    w: CAM.video.videoWidth, h: CAM.video.videoHeight,
  };
  REC.deckAtStart = [...REC.prev.values()].map(c => evOf('onDeck', c, 0));
  if(tauri()){ try{ await call('ensure_dir', { path: dir }); }catch(e){} }
  rec.ondataavailable = e => {
    if(!REC || !e.data || !e.data.size) return;
    if(!tauri()){ REC.mem.push(e.data); REC.bytes += e.data.size; return; }
    const blob = e.data;
    REC.chain = REC.chain.then(() => writeChunk(blob)).catch(err => {
      if(!REC) return;
      REC.err = 'Writing the video failed — ' + String(err && err.message || err).slice(0, 140);
      API.toast(REC.err, 'warn');
      stopRecording();
    });
  };
  rec.onstop = () => finishRecording();
  rec.start(2000);
  REC.tick = setInterval(recRender, 1000);
  REC.flush = setInterval(() => writeSidecar(false), 30000);
  writeSidecar(false);
  API.sound && API.sound('start');
  recRender();
}
function stopRecording(){
  if(!REC || REC.stopping) return;
  REC.stopping = true;
  try{ if(REC.recorder.state !== 'inactive') REC.recorder.stop(); else finishRecording(); }catch(e){ finishRecording(); }
  recRender();
}
async function finishRecording(){
  if(!REC || REC.finished) return;
  REC.finished = true;
  clearInterval(REC.tick); clearInterval(REC.flush);
  try{ await REC.chain; }catch(e){}
  const r = REC;
  if(tauri()){
    await writeSidecar(true);
  }else{
    /* browser: hand the files over as downloads */
    const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); };
    dl(new Blob(r.mem, { type: r.mime.split(';')[0] }), r.file);
    dl(new Blob([sidecar(true)], { type: 'application/json' }), r.file.replace(/\.\w+$/, '.json'));
  }
  const msg = `Recording saved — ${r.file} · ${fmtDur((performance.now() - r.t0) / 1000)} · ${fmtSize(r.bytes)} · ${r.events.length} plan move${r.events.length === 1 ? '' : 's'}`;
  REC = null;
  if(!DC) stopCam();
  API.toast(msg, r.err ? 'warn' : 'ok');
  recRender();
}

function recRender(){
  /* app-wide pill while recording */
  let pill = document.getElementById('dcRecPill');
  if(REC){
    if(!pill){
      pill = document.createElement('button');
      pill.type = 'button'; pill.id = 'dcRecPill'; pill.className = 'dc-rec-pill';
      pill.title = 'Deck camera is recording — open';
      pill.addEventListener('click', () => openDeckCamera('record'));
      document.body.appendChild(pill);
    }
    const s = (performance.now() - REC.t0) / 1000;
    pill.innerHTML = `<span class="dc-rec-dot"></span>REC <b>${fmtDur(s)}</b><span class="dc-rec-pill-sz">${fmtSize(REC.bytes)}</span>`;
    pill.classList.toggle('stopping', !!REC.stopping);
  }else if(pill){ pill.remove(); }
  if(!DC) return;
  const $ = q => DC.ov.querySelector(q);
  const dir = lsGet('spicaTide_recDir', '');
  $('#dcRecDir').textContent = dir || (tauri() ? 'Not chosen' : 'Downloads (browser)');
  $('#dcRecDir').title = dir;
  $('#dcRecQ').value = lsGet('spicaTide_recQ', '12');
  $('#dcRecQ').disabled = !!REC;
  $('#dcRecDirBtn').disabled = !!REC;
  const btn = $('#dcRecBtn');
  btn.classList.toggle('on', !!REC);
  btn.disabled = (!REC && !CAM) || !!(REC && REC.stopping) || !API.isOperator();
  $('#dcRecBtnT').textContent = REC ? (REC.stopping ? 'Saving…' : 'Stop recording') : 'Start recording';
  $('#dcRecStats').hidden = !REC;
  if(REC){
    $('#dcRecTime').textContent = fmtDur((performance.now() - REC.t0) / 1000);
    $('#dcRecSize').textContent = fmtSize(REC.bytes);
    $('#dcRecEv').textContent = String(REC.events.length);
  }
  $('#dcRecState').textContent = REC ? '· recording' : '';
  $('#dcRecNeed').hidden = !!(REC || CAM);
  const hint = $('#dcRecHint');
  hint.classList.toggle('warn', !!(REC && REC.err));
  hint.textContent = REC && REC.err ? REC.err
    : REC ? `Writing ${REC.file}${REC.path ? '' : ' (downloaded when you stop)'}`
    : !CAM ? 'Start the camera above to record.'
    : !API.getCamera() || !API.getCamera().calib ? 'Tip: calibrate first — the recording then knows where every pixel is on the deck.'
    : `Camera ${CAM.video.videoWidth} × ${CAM.video.videoHeight} · ${pickMime().split(';')[0] || 'no recorder'}`;
}
window.addEventListener('beforeunload', () => { if(REC){ try{ REC.recorder.stop(); }catch(e){} } });

/* ════════════════════════════════════════════════════════════
   WATCH LIFTS — v3.40
   While the picture plays (video file or the live camera) the one load
   moving on the hook is locked and followed (liftTrack.js, ~10 times a
   second on a small copy of the frame); its number is read in a worker
   from a sharp crop of the full frame (ocrClient.js → PaddleOCR) and the
   readings vote; the deck under it (calibration) gives the bay and side
   and the shadow of where it is coming down. Set-downs and lift-offs are
   listed; with a load list / Imported queue the number is matched to a
   unit and can be placed or marked lifted with one click.
════════════════════════════════════════════════════════════ */
let LTM = null, OCRM = null, LRM = null;
const WEIGHTS = /\b(MGW|MAX\s*GROSS|GROSS|TARE|PAYLOAD|NET|KGS?|LBS?|SWL|WLL|MAX|CU\.?\s*M)\b/i;
const NRM = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clamp01 = v => Math.min(1, Math.max(0, v));
function srcState(){
  if(!DC) return;
  const e = DC.ov.querySelector('#dcSrcState');
  e.textContent = DC.kind === 'live' ? '· live camera' : DC.kind === 'video' ? '· video file' : DC.kind === 'image' ? '· photo' : DC.shot ? '· saved calibration picture' : '';
}
function watchReset(){
  if(!DC) return;
  DC.w = { tracker: null, st: null, lastT: -1, reads: new Map(), thumbs: new Map(), busy: false, ocrWall: 0, match: null, trackId: 0, deck: [], deckWall: -1e9 };
}
async function watchStart(){
  if(!DC) return;
  if(!DC.w) watchReset();
  try{
    if(!LTM) LTM = await import('./liftTrack.js');
    if(!LRM) LRM = await import('./liftReader.js');
    if(!OCRM) OCRM = await import('./ocrClient.js');
  }catch(e){ API.toast('Could not load the lift watcher — ' + String(e && e.message || e).slice(0, 120), 'warn'); }
  watchRender();
}
/* small copy of the displayed (rotated) frame for the tracker */
function grabWork(){
  const d = rotDims(), k = Math.min(1, 480 / Math.max(d.w, d.h));
  const w = Math.max(16, Math.round(d.w * k)), h = Math.max(16, Math.round(d.h * k));
  const c = DC.wc || (DC.wc = document.createElement('canvas'));
  if(c.width !== w || c.height !== h){ c.width = w; c.height = h; DC.wcx = null; }
  const x = DC.wcx || (DC.wcx = c.getContext('2d', { willReadFrequently: true }));
  drawRotated(x, w, h);
  return x.getImageData(0, 0, w, h);
}
/* sharp crop of the displayed frame (normalised box), up to `max` px */
function cropDisp(x0, y0, x1, y1, max){
  const d = rotDims(), cw = (x1 - x0) * d.w, ch = (y1 - y0) * d.h;
  const k = Math.min(2.5, Math.max(0.3, max / Math.max(cw, ch)));
  const c = document.createElement('canvas'); c.width = Math.max(8, Math.round(cw * k)); c.height = Math.max(8, Math.round(ch * k));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.translate(-x0 * d.w * k, -y0 * d.h * k);
  drawRotated(x, d.w * k, d.h * k);
  return c;
}
function watchTick(){
  const W_ = DC && DC.w;
  if(!W_ || !LTM || DC.tab !== 'watch' || !DC.wOn || !DC.src || !DC.sw || DC.kind === 'image') return;
  let t;
  if(DC.kind === 'video'){
    /* paused on a frame: a good moment to learn the numbers already on deck */
    if(DC.src.paused || DC.src.seeking){ if(!DC.src.seeking && DC.src.readyState >= 2) scanDeck(); return; }
    t = DC.src.currentTime;
  }
  else t = performance.now() / 1000;
  if(W_.lastT >= 0 && t >= W_.lastT && t - W_.lastT < 0.095) return;
  if(W_.lastT >= 0 && (t < W_.lastT - 0.3 || t > W_.lastT + 2.5)) W_.tracker = null;   /* jumped in the video */
  W_.lastT = t;
  if(!W_.tracker) W_.tracker = LTM.createTracker();
  const img = grabWork();
  W_.st = W_.tracker.step(img.data, img.width, img.height, t, 4);
  const tr = W_.st.track;
  if(tr && tr.id !== W_.trackId){
    W_.trackId = tr.id;
    /* candidates as they are now: the plan may have changed since the last lift */
    const cands = API.candidates();
    W_.match = cands.length && LRM ? LRM.makeMatcher(cands) : null;
  }
  W_.tracker.takeEvents().forEach(onTrackEvent);
  /* one reader: the load first, the deck scan in between */
  if(tr && !(W_.deckTile != null && W_.lastWasLoad)) maybeRead(tr); else scanDeck();
  watchRender(true);
  drawOverlay();
}
function watchFlush(){
  const W_ = DC && DC.w;
  if(!W_ || !W_.tracker) return;
  W_.tracker.flush().forEach(onTrackEvent);
  W_.st = null; watchRender(); drawOverlay();
}
/* the numbers painted on units standing on deck, read from the whole picture
   while nothing is on the hook: a load swinging over them must not be
   reported as one of them */
function scanDeck(){
  const W_ = DC.w;
  if(!OCRM || W_.busy) return;
  const now = performance.now();
  /* the whole picture in overlapping tiles (small stencils need the detail) */
  if(W_.deckTile == null){ if(now - W_.deckWall < 30000) return; W_.deckTile = 0; W_.deckNext = []; }
  const d = rotDims(), cols = d.w > d.h ? 4 : 3, rows = d.w > d.h ? 3 : 4, k = W_.deckTile;
  const cx = k % cols, cy = Math.floor(k / cols), ov = 0.06;
  const x0 = clamp01(cx / cols - ov), x1 = clamp01((cx + 1) / cols + ov), y0 = clamp01(cy / rows - ov), y1 = clamp01((cy + 1) / rows + ov);
  W_.busy = true; W_.lastWasLoad = false;
  const c = cropDisp(x0, y0, x1, y1, 1000), img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  OCRM.readTextAsync(img, { both: false, max: 60 }).then(res => {
    if(!DC || DC.w !== W_) return;
    (res || []).filter(q => q.score >= 0.6 && /\d/.test(q.text)).forEach(q => {
      const n = NRM(q.text);
      if(n.length >= 3) W_.deckNext.push({ n, x: x0 + q.cx / c.width * (x1 - x0), y: y0 + q.cy / c.height * (y1 - y0) });
    });
  }).catch(() => {}).finally(() => {
    if(!DC || DC.w !== W_) return;
    W_.busy = false;
    W_.deckTile++;
    if(W_.deckTile >= cols * rows){ W_.deck = W_.deckNext; W_.deckTile = null; W_.deckWall = performance.now(); }
  });
}
const sameText = (a, b) => a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)));
function maybeRead(tr){
  const W_ = DC.w;
  if(!OCRM || W_.busy) return;
  const now = performance.now();
  if(now - W_.ocrWall < 650) return;
  const b = tr.box, d = rotDims();
  if(b.w * d.w < 28 || b.h * d.h < 28) return;                     /* too small to hold a readable number */
  const pad = 0.12;
  const x0 = clamp01(b.x - b.w * pad), y0 = clamp01(b.y - b.h * pad), x1 = clamp01(b.x + b.w * (1 + pad)), y1 = clamp01(b.y + b.h * (1 + pad));
  if(x1 - x0 < 0.01 || y1 - y0 < 0.01) return;
  W_.busy = true; W_.ocrWall = now; W_.lastWasLoad = true;
  const id = tr.id, c = cropDisp(x0, y0, x1, y1, 900);
  /* a small picture of the load for its card */
  if(!W_.thumbs.has(id) || (W_.reads.get(id) || {}).n % 3 === 0){
    const k = Math.min(1, 160 / Math.max(c.width, c.height)), th = document.createElement('canvas');
    th.width = Math.max(1, Math.round(c.width * k)); th.height = Math.max(1, Math.round(c.height * k));
    th.getContext('2d').drawImage(c, 0, 0, th.width, th.height);
    W_.thumbs.set(id, th);
  }
  const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  /* the load itself inside the crop (text in the margin is a unit on deck) */
  const cx0 = (b.x - x0) / (x1 - x0), cx1 = (b.x + b.w - x0) / (x1 - x0), cy0 = (b.y - y0) / (y1 - y0), cy1 = (b.y + b.h - y0) / (y1 - y0);
  const match = W_.match, cw = c.width, ch = c.height;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  OCRM.readTextAsync(img, { both: true }).then(res => {
    if(!DC || DC.w !== W_) return;
    const rec = W_.reads.get(id) || { raw: new Map(), m: new Map(), n: 0 };
    rec.n++;
    /* every sighting keeps where it was in the picture and where the load was:
       a number painted on the load moves with it, one on a unit on deck does not */
    const vote = (map, key, w, at) => { const o = map.get(key) || { s: 0, occ: [] }; o.s += w; o.occ.push(at); map.set(key, o); };
    const parts = [];
    (res || []).forEach(q => {
      const u = q.cx / cw, v = q.cy / ch;
      if(q.score < 0.6 || u < cx0 || u > cx1 || v < cy0 || v > cy1) return;
      if(WEIGHTS.test(q.text)) return;
      const n = NRM(q.text);
      if(n.length < 2 || n.length > 14) return;
      const at = [x0 + u * (x1 - x0), y0 + v * (y1 - y0), bx, by];
      parts.push({ n, at });
      if(/\d/.test(n) && n.length >= 3) vote(rec.raw, n, q.score, at);
      if(match){ const m = match(q.text); if(m) vote(rec.m, m.c.ccu, m.how === 'text' ? 1 : m.how === 'near' ? 0.4 : 0.8, at); }
    });
    /* "AME" and "3130" read as two pieces → "AME3130" */
    parts.forEach(a => parts.forEach(c => { if(a !== c && /^[A-Z]{2,5}$/.test(a.n) && /^\d{3,7}$/.test(c.n)){ vote(rec.raw, a.n + c.n, 0.9, c.at); if(match){ const m = match(a.n + ' ' + c.n); if(m) vote(rec.m, m.c.ccu, 0.8, c.at); } } }));
    W_.reads.set(id, rec);
    watchRender(true);
  }).catch(() => {}).finally(() => { if(DC && DC.w === W_) W_.busy = false; });
}
/* best number for a lock: a unit on the lists, else the most read text */
function bestReading(id){
  const rec = DC.w.reads.get(id);
  if(!rec) return null;
  /* a reading that stays put in the picture while the load moves is a unit
     standing on deck under it — it hardly counts */
  const spread = pts => { const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length; return pts.reduce((a, p) => a + Math.hypot(p[0] - mx, p[1] - my), 0) / pts.length; };
  const deck = DC.w.deck || [];
  const weigh = (o, key) => {
    /* sightings right where the same text stood on deck before the load came */
    const occ = o.occ.filter(a => !deck.some(d => Math.hypot(d.x - a[0], d.y - a[1]) < 0.07 && sameText(d.n, NRM(key))));
    if(!occ.length) return 0;
    o = { s: o.s * occ.length / o.occ.length, occ };
    if(o.occ.length < 2) return o.s;
    const sAbs = spread(o.occ.map(a => [a[0], a[1]])), sRel = spread(o.occ.map(a => [a[0] - a[2], a[1] - a[3]]));
    const loadMoved = spread(o.occ.map(a => [a[2], a[3]]));
    return loadMoved > 0.01 && sAbs < 0.6 * sRel ? o.s * 0.15 : o.s;
  };
  const top = m => [...m.entries()].map(([k, o]) => [k, weigh(o, k)]).sort((a, b) => b[1] - a[1]);
  const mm = top(rec.m), rr = top(rec.raw);
  if(mm.length && mm[0][1] >= 1) return { text: mm[0][0], ccu: mm[0][0], sure: mm[0][1] >= 2 && (!mm[1] || mm[0][1] >= 2 * mm[1][1]), n: rec.n };
  /* free text (no list to check against) only once it was read twice */
  if(rr.length && rr[0][1] >= 1.5) return { text: rr[0][0].replace(/^([A-Z]+)(\d)/, '$1 $2'), ccu: null, sure: rr[0][1] >= 2.5 && (!rr[1] || rr[0][1] >= 2 * rr[1][1]), n: rec.n };
  return { text: '', n: rec.n };
}
/* deck footprint of a load: its foot (the near edge in the picture) and the
   width of its near edge; it reaches as far again away from the camera */
function footprint(box, foot){
  const M = currentModel(); if(!M) return null;
  const F = M.toDeck(foot[0], foot[1]), A = M.toDeck(box.x, box.y + box.h), B = M.toDeck(box.x + box.w, box.y + box.h);
  const U = M.toDeck(foot[0], Math.max(0, foot[1] - 0.02));
  if(!F || !A || !B || !U) return null;
  const g = DC.geo;
  if(F[0] < -2 || F[0] > g.length + 2 || F[1] < -2 || F[1] > g.width + 2) return null;
  const d = Math.min(13, Math.max(1, Math.hypot(A[0] - B[0], A[1] - B[1])));
  let ux = U[0] - F[0], uy = U[1] - F[1]; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  const c = [F[0] + ux * d / 2, F[1] + uy * d / 2];
  const px = -uy, py = ux;
  const corner = (a, b) => [c[0] + ux * a * d / 2 + px * b * d / 2, c[1] + uy * a * d / 2 + py * b * d / 2];
  return { centre: [Math.min(g.length, Math.max(0, c[0])), Math.min(g.width, Math.max(0, c[1]))], size: d,
    poly: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] };
}
function whereText(pt){
  if(!pt) return '';
  const g = DC.geo;
  let x = 0, bay = g.labels[g.bays.length - 1];
  for(let i = 0; i < g.bays.length; i++){ if(pt.x <= x + g.bays[i] + g.joint / 2){ bay = g.labels[i]; break; } x += g.bays[i] + g.joint; }
  const side = pt.y < g.width / 3 ? 'PORT' : pt.y > g.width * 2 / 3 ? 'STBD' : 'centre';
  return `Bay ${bay} · ${side}`;
}
const tFmt = s => `${Math.floor(s / 60)}:${pad(Math.floor(s) % 60)}`;
function whereOf(fp){ return fp ? whereText({ x: fp.centre[0], y: fp.centre[1] }) : ''; }
function onTrackEvent(e){
  if(!DC || (e.kind !== 'landed' && e.kind !== 'lifted')) return;
  const W_ = DC.w, fp = footprint(e.box, e.foot), rd = bestReading(e.id);
  let guess = null;
  if(e.kind === 'lifted' && fp){
    /* which planned unit stood there */
    const [X, Y] = fp.centre;
    const near = API.cargo().map(c => ({ c, d: Math.hypot(Math.max(c.x0 - X, 0, X - c.x1), Math.max(c.y0 - Y, 0, Y - c.y1)) }))
      .filter(o => o.d < 1.5 && o.c.ccu).sort((a, b) => a.d - b.d)[0];
    if(near) guess = near.c.ccu;
  }
  const ev = { id: e.id, kind: e.kind, t: e.t, live: DC.kind === 'live', at: new Date(), fp, where: whereOf(fp), reading: rd,
    thumb: W_.thumbs.get(e.id) || null, guess };
  /* the same load set down a moment ago and moved on: the earlier card is history */
  const prev = e.moves != null && DC.wEvents.find(o => o.id === e.moves);
  if(prev){
    prev.movedOn = true;
    if(!(rd && rd.text) && prev.reading && prev.reading.text) ev.reading = prev.reading;
    if(!ev.thumb) ev.thumb = prev.thumb;
    ev.movedFrom = prev.where;
  }
  DC.wEvents.unshift(ev);
  if(DC.wEvents.length > 60) DC.wEvents.length = 60;
  try{ API.sound(); }catch(_){}
  watchRender();
}
function watchRender(quick){
  if(!DC) return;
  const $ = q => DC.ov.querySelector(q);
  const W_ = DC.w, tr = W_ && W_.st && W_.st.track;
  const calibrated = !!currentModel();
  const st = $('#dcWState');
  st.textContent = !DC.wOn ? '· off' : !DC.src ? '· no picture' : DC.kind === 'image' ? '· needs a video or the camera'
    : (DC.kind === 'video' && DC.src.paused) ? '· press play' : tr ? (tr.phase === 'down' ? '· set down' : '· locked') : '· watching';
  /* the lift now */
  const num = $('#dcWNum'), where = $('#dcWWhere'), phase = $('#dcWPhase'), th = $('#dcWThumb');
  if(tr){
    const rd = bestReading(tr.id);
    num.textContent = rd && rd.text ? rd.text + (rd.sure ? '' : ' ?') : rd && rd.n >= 3 ? 'No number seen' : 'Reading the number…';
    num.classList.toggle('dim', !(rd && rd.text));
    const fp = footprint(tr.box, tr.foot);
    where.textContent = !calibrated ? 'Calibrate the camera to see the bay' : fp ? (tr.phase === 'down' ? '' : '→ ') + whereOf(fp) : 'Over the side';
    phase.textContent = tr.phase === 'down' ? `Set down ${Math.floor(tr.still)} s — confirming` : 'On the hook, moving';
    const t = W_.thumbs.get(tr.id);
    if(t && th.firstChild !== t){ th.innerHTML = ''; th.appendChild(t); }
  }else{
    num.textContent = '—'; num.classList.add('dim');
    where.textContent = DC.src && DC.kind !== 'image' ? (DC.kind === 'video' && DC.src.paused ? 'Press ▶ to play the video' : 'Waiting for a load on the hook') : 'Open a video or start the camera';
    phase.textContent = calibrated ? '' : 'Not calibrated — loads are followed, bays are not shown';
    th.innerHTML = '';
  }
  if(quick && W_ && W_.lastEvN === DC.wEvents.length) return;
  if(W_) W_.lastEvN = DC.wEvents.length;
  /* the list */
  $('#dcWCount').textContent = DC.wEvents.length ? `· ${DC.wEvents.length}` : '';
  const list = $('#dcWList');
  list.innerHTML = '';
  if(!DC.wEvents.length){ list.innerHTML = '<div class="dc-hint">Set-downs and lift-offs will appear here.</div>'; return; }
  DC.wEvents.forEach(e => {
    const card = el('div', 'dc-an-card');
    const rd = e.reading, ccu = rd && rd.ccu, txt = rd && rd.text;
    const info = ccu ? API.unitInfo(ccu) : {};
    const timeTxt = e.live ? e.at.toTimeString().slice(0, 5) : tFmt(e.t);
    const conf = ccu ? (rd.sure ? 'high' : 'low') : txt ? 'low' : 'none';
    const confTxt = ccu ? (rd.sure ? 'On the list' : 'On the list?') : txt ? (rd.sure ? 'Read' : 'Read?') : 'No number';
    card.innerHTML = `
      <div class="dc-an-thumb"></div>
      <div class="dc-an-main">
        <div class="dc-an-top"><span class="dc-an-ccu">${txt ? esc(txt) : e.guess ? esc(e.guess) + '?' : '—'}</span>
          <span class="dc-an-conf ${conf}">${e.guess && !txt ? 'Stood there' : confTxt}</span></div>
        <div class="dc-an-sub">${e.live ? `<span>${timeTxt}</span>` : `<button type="button" class="dc-an-time" title="Show in the video">${timeTxt}</button>`} · <b>${e.kind === 'landed' ? (e.movedFrom ? 'Moved to' : 'Set down') : 'Lifted off'}</b>${e.where ? ' · ' + esc(e.where) : ''}${e.movedFrom ? ` <span class="dc-an-note">(from ${esc(e.movedFrom)})</span>` : ''}</div>
        <div class="dc-an-act"></div>
      </div>`;
    if(e.thumb){ const c = document.createElement('canvas'); c.width = e.thumb.width; c.height = e.thumb.height; c.getContext('2d').drawImage(e.thumb, 0, 0); card.querySelector('.dc-an-thumb').appendChild(c); }
    const tb = card.querySelector('.dc-an-time');
    if(tb) tb.addEventListener('click', () => { if(DC && DC.kind === 'video'){ try{ DC.src.currentTime = Math.max(0, e.t - 1); }catch(_){} } });
    const act = card.querySelector('.dc-an-act');
    const addBtn = (label, fn, primary) => { const b = el('button', 'dc-btn dc-sm' + (primary ? ' dc-primary' : ''), esc(label)); b.type = 'button'; b.addEventListener('click', () => { if(fn() === false) return; e.done = label; watchRender(); drawOverlay(); }); act.appendChild(b); };
    if(e.movedOn){ card.classList.add('moved'); act.innerHTML = `<span class="dc-an-note">Moved on — see the newer card${e.done ? ' (✓ ' + esc(e.done) + ' here — move it on the plan)' : ''}</span>`; }
    else if(e.done){ act.innerHTML = `<span class="dc-an-done">✓ ${esc(e.done)}</span>`; }
    else if(API.isOperator()){
      const unit = ccu || (e.kind === 'lifted' ? e.guess : null);
      const ui = unit ? API.unitInfo(unit) : {};
      if(e.kind === 'lifted' && unit && ui.onDeck) addBtn('Mark ' + unit + ' lifted', () => API.markLifted(unit), !!(rd && rd.sure));
      if(e.kind === 'landed' && e.fp){
        if(ccu && info.inQueue) addBtn('Place ' + ccu + ' here', () => API.placeQueued(ccu, e.fp.centre[0], e.fp.centre[1]), rd.sure);
        else{
          /* nothing read / not on the lists: pick the unit from Imported */
          const q = API.queueUnits ? API.queueUnits() : [];
          if(q.length){
            const sel = el('select', 'dc-select dc-sm'); sel.setAttribute('aria-label', 'Unit from Imported');
            sel.innerHTML = '<option value="">Unit from Imported…</option>' + q.map(u => `<option>${esc(u)}</option>`).join('');
            act.appendChild(sel);
            addBtn('Place here', () => { if(!sel.value){ API.toast('Pick the unit from Imported first', 'info'); return false; } API.placeQueued(sel.value, e.fp.centre[0], e.fp.centre[1]); }, false);
          }
        }
      }
      if(!act.children.length && txt && !ccu) act.innerHTML = '<span class="dc-an-note">Not on the load list, Imported or deck — check the number</span>';
    }
    list.appendChild(card);
  });
}

/* test hooks */
export const _dc = { state: () => DC, rec: () => REC, cam: () => CAM, boundaryX, refPoints, onPlanChanged, footprint, watchFlush, cropDisp, ocr: () => OCRM };
