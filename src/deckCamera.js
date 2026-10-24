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

let API = null;
let DC = null;            /* panel state while open */

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
  if(!cam || !cam.calib || !Array.isArray(cam.calib.pts) || cam.calib.pts.length !== 4) return null;
  if(cam.calib.pts.some(p => !p)) return null;
  const line = Math.min(geo.bays.length - 2, Math.max(0, cam.calib.line | 0));
  const src = refPoints(geo, line), dst = cam.calib.pts.slice();
  (cam.calib.extra || []).forEach(e => {
    if(e && e.bay >= 0 && e.bay < geo.bays.length){ src.push([bayCentreX(geo, e.bay), geo.width / 2]); dst.push([e.u, e.v]); }
  });
  return homographyLS(src, dst);
}

/* ── panel ─────────────────────────────────────────────────── */
const STEP_TXT = [
  ['Aft edge · PORT',  'Where the aft edge of the deck meets the port side'],
  ['Aft edge · STBD',  'Where the aft edge of the deck meets the starboard side'],
  ['Bay line · PORT',  'The chosen bay line at the port side'],
  ['Bay line · STBD',  'The chosen bay line at the starboard side'],
];

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
          <div class="dc-empty-s">Start the camera, or open a photo or video taken from the camera position.</div>
        </div>
      </div>
      <aside class="dc-side">
        <div class="dc-body">
          <section class="dc-sec">
            <div class="dc-sec-title">Picture</div>
            <div class="dc-row">
              <select class="dc-select" id="dcDevice" aria-label="Camera"><option value="">Camera…</option></select>
              <button type="button" class="dc-btn" id="dcStart">Start</button>
            </div>
            <div class="dc-row">
              <button type="button" class="dc-btn dc-grow" id="dcOpen">Open photo or video…</button>
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

          <section class="dc-sec">
            <div class="dc-sec-title">Calibration <span class="dc-sec-meta" id="dcCalState"></span></div>
            <label class="dc-field"><span>Bay line used for points 3 and 4</span>
              <select class="dc-select" id="dcLine"></select></label>
            <ol class="dc-steps" id="dcSteps"></ol>
            <div class="dc-sub">More points — painted bay numbers <span class="dc-sec-meta">(the nearer the camera, the better)</span></div>
            <div class="dc-row">
              <select class="dc-select" id="dcExtraBay" aria-label="Bay number"></select>
              <button type="button" class="dc-btn" id="dcAddExtra">Place</button>
            </div>
            <ol class="dc-steps" id="dcExtras"></ol>
            <div class="dc-hint" id="dcHint">Click the picture to place the highlighted point. Drag a point to adjust it; arrow keys nudge it (Shift = ×10).</div>
            <div class="dc-row"><button type="button" class="dc-btn dc-quiet" id="dcResetPts">Clear points</button></div>
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
          <button type="button" class="dc-btn dc-primary" id="dcSave" disabled>Save calibration</button>
        </footer>
      </aside>
    </div>
  </div>`;
  document.body.appendChild(ov);
  bind(ov);
  return ov;
}

/* ── open / close ──────────────────────────────────────────── */
export function openDeckCamera(){
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
    placing: -1,            /* bay index while placing a bay-number point */
    step: 0, drag: -1, sel: -1, dirty: false,
    src: null, kind: '', stream: null, url: '', raf: 0,
    sw: 0, sh: 0,
  };
  DC.step = DC.pts.findIndex(p => !p); if(DC.step < 0) DC.step = 4;
  ov.querySelector('#dcTitle').textContent = API.vesselName();
  const ls = ov.querySelector('#dcLine');
  ls.innerHTML = '';
  for(let k = 0; k < geo.bays.length - 1; k++){
    const o = document.createElement('option');
    o.value = String(k);
    o.textContent = `Bay ${geo.labels[k]} | Bay ${geo.labels[k + 1]}  ·  ${boundaryX(geo, k).toFixed(2)} m from aft`;
    ls.appendChild(o);
  }
  ls.value = String(DC.line);
  const xb = ov.querySelector('#dcExtraBay');
  xb.innerHTML = '';
  for(let i = geo.bays.length - 1; i >= 0; i--){
    const o = document.createElement('option'); o.value = String(i); o.textContent = 'Bay ' + geo.labels[i] + ' number'; xb.appendChild(o);
  }
  ov.classList.add('open');
  document.body.classList.add('dc-open');
  renderSteps(); layout(); drawOverlay(); listDevices(false);
  setTimeout(() => ov.querySelector('#dcClose').focus(), 30);
}
function closeDeckCamera(){
  if(!DC) return;
  stopSource();
  DC.ov.classList.remove('open');
  document.body.classList.remove('dc-open');
  DC = null;
}
function stopSource(){
  if(!DC) return;
  cancelAnimationFrame(DC.raf); DC.raf = 0;
  if(DC.stream){ DC.stream.getTracks().forEach(t => t.stop()); DC.stream = null; }
  if(DC.src && DC.kind === 'video'){ try{ DC.src.pause(); }catch(e){} }
  if(DC.url){ URL.revokeObjectURL(DC.url); DC.url = ''; }
  DC.src = null; DC.kind = '';
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
    if(!devs.length){ sel.innerHTML = '<option value="">No camera found</option>'; return; }
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
  stopSource();
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      deviceId: id ? { exact: id } : undefined,
      width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } } });
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    DC.stream = stream; DC.src = v; DC.kind = 'live';
    DC.liveLabel = (stream.getVideoTracks()[0] || {}).label || '';
    setSourceSize(v.videoWidth, v.videoHeight);
    listDevices(true);
    loop();
  }catch(e){
    API.toast('Could not start the camera — ' + (e && e.name === 'NotAllowedError' ? 'access was refused' : 'is it plugged in?'), 'warn');
  }
}
function openFile(file){
  if(!DC || !file) return;
  stopSource();
  const url = URL.createObjectURL(file);
  DC.url = url;
  if(/^video\//.test(file.type) || /\.(mov|mp4|m4v|webm|mkv)$/i.test(file.name)){
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    v.addEventListener('loadeddata', () => {
      if(!DC || DC.src !== v) return;
      setSourceSize(v.videoWidth, v.videoHeight); loop();
    }, { once: true });
    v.addEventListener('error', () => API.toast('This video cannot be played here', 'warn'), { once: true });
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
  layout(); drawFrame(); drawOverlay();
}
function loop(){
  cancelAnimationFrame(DC.raf);
  const tick = () => {
    if(!DC || !DC.src) return;
    drawFrame();
    if(DC.kind === 'video') syncSeek();
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
  const { w, h } = DC.sw ? rotDims() : { w: 9, h: 16 };
  const pad = 24, aw = Math.max(10, sr.width - pad * 2), ah = Math.max(10, sr.height - pad * 2);
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
function drawFrame(){
  if(!DC || !DC.src || !DC.sw) return;
  const cv = DC.ov.querySelector('#dcCanvas'), ctx = cv.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.rotate(DC.rotation * Math.PI / 180);
  const r = DC.rotation % 180 !== 0;
  const dw = r ? cv.height : cv.width, dh = r ? cv.width : cv.height;
  try{ ctx.drawImage(DC.src, -dw / 2, -dh / 2, dw, dh); }catch(e){}
  ctx.restore();
}

function pairs(){
  const src = refPoints(DC.geo, DC.line), dst = DC.pts.slice();
  DC.extra.forEach(e => { src.push([bayCentreX(DC.geo, e.bay), DC.geo.width / 2]); dst.push(e.p); });
  return { src, dst };
}
function currentH(){
  if(DC.pts.some(p => !p)) return null;
  const { src, dst } = pairs();
  return homographyLS(src, dst);
}
/* Per-point error in deck metres (image point mapped back onto the deck
   vs where it should be). Only meaningful with more than 4 points. */
function residuals(H){
  const Hi = H && invert3(H);
  if(!Hi) return null;
  const { src, dst } = pairs();
  return src.map((r, i) => {
    const q = project(Hi, dst[i][0], dst[i][1]);
    return q ? Math.hypot(q[0] - r[0], q[1] - r[1]) : null;
  });
}

function drawOverlay(){
  if(!DC) return;
  const svg = DC.ov.querySelector('#dcSvg');
  const W = DC.fw || 1, Hh = DC.fh || 1, geo = DC.geo;
  const alpha = (+DC.ov.querySelector('#dcOvAlpha').value || 70) / 100;
  const showGrid = DC.ov.querySelector('#dcOvGrid').checked;
  const showCargo = DC.ov.querySelector('#dcOvCargo').checked;
  const H = currentH();
  const P = (X, Y) => { const p = H && project(H, X, Y); return p ? [p[0] * W, p[1] * Hh] : null; };
  const poly = pts => pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
  let out = '';
  if(H && DC.sw){
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
  /* picked points */
  DC.extra.forEach((e, k) => {
    const x = e.p[0] * W, y = e.p[1] * Hh, i = 4 + k;
    out += `<g class="dc-pt dc-pt-x${i === DC.sel ? ' sel' : ''}" data-i="${i}">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" class="dc-pt-halo"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="dc-pt-dot"/>
      <text x="${(x + 12).toFixed(1)}" y="${(y - 10).toFixed(1)}" class="dc-pt-n">${esc(geo.labels[e.bay])}</text></g>`;
  });
  DC.pts.forEach((p, i) => {
    if(!p) return;
    const x = p[0] * W, y = p[1] * Hh;
    out += `<g class="dc-pt${i === DC.sel ? ' sel' : ''}" data-i="${i}">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" class="dc-pt-halo"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" class="dc-pt-dot"/>
      <text x="${(x + 13).toFixed(1)}" y="${(y - 11).toFixed(1)}" class="dc-pt-n">${i + 1}</text></g>`;
  });
  svg.innerHTML = out;
  /* status */
  const st = DC.ov.querySelector('#dcCalState');
  const placed = DC.pts.filter(Boolean).length;
  DC.res = H ? residuals(H) : null;
  const worst = DC.res && DC.extra.length ? Math.max(...DC.res.filter(v => v != null)) : null;
  st.textContent = placed === 4
    ? (H ? (worst != null ? `· ready · worst point ${worst.toFixed(2)} m` : '· ready') : '· points do not form a deck')
    : `· ${placed} of 4`;
  renderResiduals();
  DC.ov.querySelector('#dcSave').disabled = !(H && DC.dirty) || !API.isOperator();
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
  if(DC.placing >= 0){ hint.textContent = `Click the centre of the painted number ${geo.labels[DC.placing]} on the deck.`; return; }
  hint.textContent = DC.step < 4
    ? `Click the picture: ${STEP_TXT[DC.step][1].toLowerCase()}.`
    : 'Drag a point to adjust it; arrow keys nudge the selected point (Shift = ×10). The bay lines should sit on the deck markings.';
}

function fmtRes(v){ return v == null ? '' : (v < 0.995 ? Math.round(v * 100) + ' cm' : v.toFixed(2) + ' m'); }
function resClass(v){ return v == null ? '' : v < 0.25 ? ' good' : v < 0.6 ? ' fair' : ' bad'; }
function renderResiduals(){
  if(!DC) return;
  const show = DC.res && DC.extra.length;
  DC.ov.querySelectorAll('#dcSteps .dc-step').forEach((li, i) => {
    const s = li.querySelector('.dc-step-s');
    s.className = 'dc-step-s' + (show ? resClass(DC.res[i]) : '');
    s.textContent = DC.pts[i] ? (show ? fmtRes(DC.res[i]) : '✓') : '';
  });
  const ol = DC.ov.querySelector('#dcExtras');
  ol.innerHTML = '';
  DC.extra.forEach((e, k) => {
    const v = DC.res ? DC.res[4 + k] : null;
    const li = el('li', 'dc-step done' + (DC.sel === 4 + k ? ' cur' : ''));
    li.innerHTML = `<span class="dc-step-n">${esc(DC.geo.labels[e.bay])}</span><span class="dc-step-t">Bay ${esc(DC.geo.labels[e.bay])} number</span><span class="dc-step-s${resClass(v)}">${fmtRes(v)}</span><button type="button" class="dc-del" title="Remove this point">✕</button>`;
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
  STEP_TXT.forEach(([t], i) => {
    const li = el('li', 'dc-step' + (DC.pts[i] ? ' done' : '') + (i === DC.step ? ' cur' : ''));
    li.innerHTML = `<span class="dc-step-n">${i + 1}</span><span class="dc-step-t">${esc(t)}</span><span class="dc-step-s">${DC.pts[i] ? '✓' : ''}</span>`;
    li.addEventListener('click', () => { DC.step = i; DC.placing = -1; DC.sel = DC.pts[i] ? i : -1; renderSteps(); drawOverlay(); });
    ol.appendChild(li);
  });
  renderResiduals();
}

/* ── pointer ───────────────────────────────────────────────── */
function toNorm(e){
  const r = DC.ov.querySelector('#dcFrame').getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}
function ptAt(i){ return i < 4 ? DC.pts[i] : (DC.extra[i - 4] && DC.extra[i - 4].p); }
function setPt(i, v){ if(i < 4) DC.pts[i] = v; else if(DC.extra[i - 4]) DC.extra[i - 4].p = v; }
function hitPoint(e){
  const r = DC.ov.querySelector('#dcFrame').getBoundingClientRect();
  let best = -1, bd = 16;
  for(let i = 0; i < 4 + DC.extra.length; i++){
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

function bind(ov){
  const $ = s => ov.querySelector(s);
  $('#dcClose').addEventListener('click', () => closeDeckCamera());
  $('#dcCancel').addEventListener('click', () => closeDeckCamera());
  $('#dcStart').addEventListener('click', () => startCamera());
  $('#dcDevice').addEventListener('change', () => { if(DC && DC.kind === 'live') startCamera(); });
  $('#dcOpen').addEventListener('click', () => $('#dcFile').click());
  $('#dcFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if(f) openFile(f); e.target.value = ''; });
  $('#dcRotL').addEventListener('click', () => rotate(-90));
  $('#dcRotR').addEventListener('click', () => rotate(90));
  $('#dcLine').addEventListener('change', e => { DC.line = +e.target.value; DC.dirty = true; drawOverlay(); });
  ['#dcOvGrid', '#dcOvCargo', '#dcOvAlpha'].forEach(s => $(s).addEventListener('input', () => drawOverlay()));
  $('#dcResetPts').addEventListener('click', () => { DC.pts = [null, null, null, null]; DC.extra = []; DC.placing = -1; DC.step = 0; DC.sel = -1; DC.dirty = true; renderSteps(); drawOverlay(); });
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
    if(!DC || !DC.sw || e.button !== 0) return;
    const n = toNorm(e);
    if(n[0] < 0 || n[1] < 0 || n[0] > 1 || n[1] > 1) return;
    const hit = hitPoint(e);
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
    if(DC.drag >= 0){
      const n = toNorm(e);
      setPt(DC.drag, [Math.min(1, Math.max(0, n[0])), Math.min(1, Math.max(0, n[1]))]);
      DC.dirty = true; drawOverlay();
    }
    const placing = DC.step < 4 || DC.placing >= 0 || DC.drag >= 0 || hitPoint(e) >= 0;
    if(placing) showLoupe(e); else $('#dcLoupe').hidden = true;
    stage.style.cursor = DC.drag >= 0 ? 'grabbing' : (hitPoint(e) >= 0 && DC.placing < 0 ? 'grab' : ((DC.step < 4 || DC.placing >= 0) && DC.sw ? 'crosshair' : 'default'));
  });
  const end = () => { if(DC){ DC.drag = -1; renderSteps(); } };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', () => { if(DC && DC.drag < 0) $('#dcLoupe').hidden = true; });

  ov.addEventListener('keydown', e => {
    if(!DC) return;
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeDeckCamera(); return; }
    const k = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }[e.key];
    if(k && DC.sel >= 0 && ptAt(DC.sel) && !/INPUT|SELECT/.test(document.activeElement.tagName)){
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1, p = ptAt(DC.sel);
      setPt(DC.sel, [Math.min(1, Math.max(0, p[0] + k[0] * s / DC.fw)), Math.min(1, Math.max(0, p[1] + k[1] * s / DC.fh))]);
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
  const H = currentH();
  if(!H){ API.toast('Place all four points first', 'warn'); return; }
  const prev = API.getCamera() || {};
  const d = DC.sw ? rotDims() : null;
  const cam = Object.assign({}, prev, {
    rotation: DC.rotation,
    calib: { pts: DC.pts.map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]), line: DC.line,
             extra: DC.extra.map(e => ({ bay: e.bay, u: Math.round(e.p[0] * 1e5) / 1e5, v: Math.round(e.p[1] * 1e5) / 1e5 })),
             aspect: d ? Math.round(d.w / d.h * 1e4) / 1e4 : (prev.calib && prev.calib.aspect) || 0,
             at: new Date().toISOString() },
  });
  if(DC.kind === 'live' && DC.liveLabel) cam.deviceLabel = DC.liveLabel;
  API.setCamera(cam);
  DC.savedAspect = cam.calib.aspect;
  DC.dirty = false;
  drawOverlay();
  API.toast('Camera calibration saved for ' + API.vesselName(), 'ok');
}

/* test hooks */
export const _dc = { state: () => DC, boundaryX, refPoints };
