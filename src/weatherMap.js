/* ════════════════════════════════════════════════════════════
   WIND & WAVES MAP — v3.27
   An animated forecast map of the working area, in the spirit of
   Windy: a colour field (wind speed or significant wave height), flowing
   streaks along the wind / the waves, the working locations as pins,
   a time line over the next 4 days and a read-out under the cursor.

   Data: Open-Meteo forecast (wind, gusts) and marine (Hs, direction,
   period) APIs on a regular grid over the working area, 3-hourly, fetched
   only when the map is opened and kept for 90 min (the last good set is
   kept for offline use). Only the grid coordinates are sent.
   Basemap: Natural Earth 1:10m land (public domain), clipped to the
   North Sea and bundled — no map tiles, works without the internet.
   Projection: Mercator. All drawing on canvases; pins are DOM.
════════════════════════════════════════════════════════════ */

import LAND from './weather/northSeaLand.json';
import { windUnit, setWindUnit, windLbl, HMAX_K } from './fieldWeather.js';

const URL_FC = 'https://api.open-meteo.com/v1/forecast';
const URL_MAR = 'https://marine-api.open-meteo.com/v1/marine';
const LS_DATA = 'spicaTide_wxMap';
const LS_LAYER = 'spicaTide_wxMapLayer';
const LS_VALS = 'spicaTide_wxMapValues';
const showVals = () => lsGet(LS_VALS, true) !== false;
const FRESH_MS = 90 * 60 * 1000;
const DAYS = 4;
const CHUNK = 150;               /* points per request (URL stays < 2 KB) */
const MAX_POINTS = 420;
const KN2MS = 0.514444;
const D2R = Math.PI / 180;

let API = null, ov = null, DATA = null, loading = false, err = '';
let layer = 'wind', tIdx = 0, playing = false, focusId = null;

const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const motion = () => document.documentElement.getAttribute('data-motion') || 'full';
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const compass = d => d == null || !isFinite(d) ? '—' : COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];

/* ── Mercator: world X = longitude, world Y = Mercator latitude (deg) ── */
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) / D2R;
const invMercY = y => (2 * Math.atan(Math.exp(y * D2R)) - Math.PI / 2) / D2R;

/* ── Colour scales ──────────────────────────────────────────────
   Wind: Windy's map gradient (m/s stops), deep blue calm → green →
   yellow / brown → red-purple storm. Waves: a calm-to-rough ramp in
   metres; no data (land, sheltered coast) stays transparent. */
const WIND_PAL = [[0,[98,113,183]],[1,[57,97,159]],[3,[74,148,169]],[5,[77,141,123]],[7,[83,165,83]],[9,[53,159,53]],[11,[167,157,81]],
  [13,[159,127,58]],[15,[161,108,92]],[17,[129,58,78]],[19,[175,80,136]],[21,[117,74,147]],[25,[109,70,170]],[30,[150,72,190]],[36,[215,190,225]]];
/* waves: the sea-state ramp of Ventusky — blue calm, green / yellow
   moderate, orange 4 m, red 6 m, deep maroon 9–10 m and up */
const WAVE_PAL = [[0,[38,70,170]],[0.5,[40,112,205]],[1,[45,160,215]],[1.5,[60,190,175]],[2,[110,200,105]],[2.5,[195,210,70]],[3,[232,192,58]],
  [4,[228,140,48]],[5,[214,96,56]],[6,[196,62,78]],[8,[156,34,72]],[10,[108,20,52]],[12,[74,12,40]]];
function lut(pal, max){
  const out = new Uint8ClampedArray(256 * 3);
  for(let i = 0; i < 256; i++){
    const v = i / 255 * max;
    let k = 1; while(k < pal.length - 1 && v > pal[k][0]) k++;
    const [a, ca] = pal[k - 1], [b, cb] = pal[k], t = Math.max(0, Math.min(1, (v - a) / (b - a || 1)));
    for(let c = 0; c < 3; c++) out[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * t;
  }
  return out;
}
const WIND_MAX = 36, WAVE_MAX = 12;          /* m/s, m */
const LUT = { wind: lut(WIND_PAL, WIND_MAX), waves: lut(WAVE_PAL, WAVE_MAX) };
const cssOf = (pal, v) => {
  let k = 1; while(k < pal.length - 1 && v > pal[k][0]) k++;
  const [a, ca] = pal[k - 1], [b, cb] = pal[k], t = Math.max(0, Math.min(1, (v - a) / (b - a || 1)));
  return `rgb(${ca.map((c, i) => Math.round(c + (cb[i] - c) * t)).join(',')})`;
};

/* ── The grid over the working area ──────────────────────────── */
function located(){ return (API ? API.locations() : []).filter(l => isFinite(l.lat) && isFinite(l.lon)); }
function wantedBox(aspect){
  const all = located(), act = new Set(API ? API.activeIds() : []);
  const pts = all.filter(l => act.has(l.id)).length ? all.filter(l => act.has(l.id)) : all;
  if(!pts.length) return null;
  let s = Math.min(...pts.map(p => p.lat)), n = Math.max(...pts.map(p => p.lat));
  let w = Math.min(...pts.map(p => p.lon)), e = Math.max(...pts.map(p => p.lon));
  const mlat = (s + n) / 2, mlon = (w + e) / 2;
  const hl = Math.max(3.4, (n - s) / 2 + 2.2), hw = Math.max(6.2, (e - w) / 2 + 3.8);
  s = mlat - hl; n = mlat + hl; w = mlon - hw; e = mlon + hw;
  /* match the map window's shape, so the forecast fills it edge to edge */
  if(aspect > 0){
    const y0 = mercY(s), y1 = mercY(n), needW = aspect * (y1 - y0);
    if(e - w < needW){ const c = (e + w) / 2; w = c - needW / 2; e = c + needW / 2; }
    else { const yc = (y0 + y1) / 2, hh = (e - w) / aspect / 2; s = invMercY(yc - hh); n = invMercY(yc + hh); }
  }
  const B = LAND.box;                          /* the bundled coastline covers this much */
  if(s < B.s){ n += B.s - s; s = B.s; } if(n > B.n){ s -= n - B.n; n = B.n; }
  if(w < B.w){ e += B.w - w; w = B.w; } if(e > B.e){ w -= e - B.e; e = B.e; }
  s = Math.max(B.s, s); w = Math.max(B.w, w);
  const c = Math.cos(((s + n) / 2) * D2R);
  let dlat = 0.4;
  while(((n - s) / dlat + 1) * ((e - w) / (dlat / c) + 1) > MAX_POINTS) dlat += 0.05;
  const dlon = +(dlat / c).toFixed(3);
  const ny = Math.floor((n - s) / dlat) + 1, nx = Math.floor((e - w) / dlon) + 1;
  return { s: +s.toFixed(2), w: +w.toFixed(2), dlat: +dlat.toFixed(3), dlon, nx, ny, n: +(s + (ny - 1) * dlat).toFixed(2), e: +(w + (nx - 1) * dlon).toFixed(2) };
}
const boxKey = b => b ? [b.s, b.w, b.dlat, b.dlon, b.nx, b.ny].join('|') : '';
function covers(b){       /* does the stored grid still hold every working location with a margin? */
  if(!DATA || !b) return false;
  const g = DATA.box;
  return located().filter(l => (API.activeIds() || []).includes(l.id)).every(l => l.lat > g.s + 0.8 && l.lat < g.n - 0.8 && l.lon > g.w + 1.2 && l.lon < g.e - 1.2);
}

async function getJson(url){
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 25000);
  try{ const r = await fetch(url, { signal: ctrl.signal }); if(!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally{ clearTimeout(t); }
}

/* stored compactly: one array per variable, [step][point], 1 decimal */
async function fetchGrid(box){
  const lat = [], lon = [];
  for(let i = 0; i < box.ny; i++) for(let j = 0; j < box.nx; j++){ lat.push((box.s + i * box.dlat).toFixed(3)); lon.push((box.w + j * box.dlon).toFixed(3)); }
  const N = lat.length, chunks = [];
  for(let k = 0; k < N; k += CHUNK) chunks.push([k, Math.min(N, k + CHUNK)]);
  const q = (a, b) => `latitude=${lat.slice(a, b).join(',')}&longitude=${lon.slice(a, b).join(',')}&timezone=UTC&timeformat=unixtime&forecast_days=${DAYS}&temporal_resolution=hourly_3`;
  const list = r => Array.isArray(r) ? r : [r];
  const fc = await Promise.all(chunks.map(([a, b]) => getJson(`${URL_FC}?${q(a, b)}&cell_selection=sea&wind_speed_unit=kn&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m`).then(list)));
  const mar = await Promise.all(chunks.map(([a, b]) => getJson(`${URL_MAR}?${q(a, b)}&hourly=wave_height,wave_direction,wave_period`).then(list).catch(() => null)));
  const F = fc.flat(), M = mar.every(Boolean) ? mar.flat() : null;
  const times = (F[0] && F[0].hourly && F[0].hourly.time || []).map(t => t * 1000);
  const T = times.length, mk = () => Array.from({ length: T }, () => new Array(N).fill(null));
  const out = { ws: mk(), wd: mk(), wg: mk(), hs: mk(), hd: mk(), tp: mk() };
  const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
  for(let p = 0; p < N; p++){
    const h = F[p] && F[p].hourly; if(!h) continue;
    for(let k = 0; k < T; k++){ out.ws[k][p] = r1(h.wind_speed_10m[k]); out.wd[k][p] = h.wind_direction_10m[k]; out.wg[k][p] = r1(h.wind_gusts_10m[k]); }
    const m = M && M[p] && M[p].hourly;
    if(m && Array.isArray(m.time)){
      const idx = new Map(m.time.map((t, i) => [t * 1000, i]));
      for(let k = 0; k < T; k++){ const i = idx.get(times[k]); if(i == null) continue;
        out.hs[k][p] = r1(m.wave_height[i]); out.hd[k][p] = m.wave_direction[i]; out.tp[k][p] = r1(m.wave_period[i]); }
    }
  }
  return { at: Date.now(), box, key: boxKey(box), times, marine: !!M, v: out };
}

/* typed fields per time step: east/north components (wind "to" and the
   direction the sea runs towards), so interpolation never trips on
   the 359° → 1° wrap */
let FIELD = null;
function buildField(){
  if(!DATA){ FIELD = null; return; }
  const { v, times } = DATA, N = DATA.box.nx * DATA.box.ny;
  const steps = times.map((t, k) => {
    const U = new Float32Array(N), V = new Float32Array(N), G = new Float32Array(N), H = new Float32Array(N),
          WX = new Float32Array(N), WY = new Float32Array(N), P = new Float32Array(N);
    for(let p = 0; p < N; p++){
      const s = v.ws[k][p], d = v.wd[k][p];
      if(s == null || d == null){ U[p] = V[p] = NaN; } else { U[p] = -s * Math.sin(d * D2R); V[p] = -s * Math.cos(d * D2R); }
      G[p] = v.wg[k][p] == null ? NaN : v.wg[k][p];
      const h = v.hs[k][p], hd = v.hd[k][p];
      if(h == null || hd == null){ H[p] = WX[p] = WY[p] = P[p] = NaN; }
      else { H[p] = h; WX[p] = -h * Math.sin(hd * D2R); WY[p] = -h * Math.cos(hd * D2R); P[p] = v.tp[k][p] == null ? NaN : v.tp[k][p]; }
    }
    return { U, V, G, H, WX, WY, P };
  });
  FIELD = { steps, cur: null, curT: -1 };
}
/* the field at a fractional time step — linear in time */
function fieldAt(t){
  if(!FIELD) return null;
  if(FIELD.curT === t && FIELD.cur) return FIELD.cur;
  const n = FIELD.steps.length, a = Math.max(0, Math.min(n - 1, Math.floor(t))), b = Math.min(n - 1, a + 1), f = Math.max(0, Math.min(1, t - a));
  const A = FIELD.steps[a], B = FIELD.steps[b];
  const cur = FIELD.cur || {};
  for(const key of ['U', 'V', 'G', 'H', 'WX', 'WY', 'P']){
    const x = A[key], y = B[key], o = cur[key] && cur[key].length === x.length ? cur[key] : (cur[key] = new Float32Array(x.length));
    if(f === 0 || a === b){ o.set(x); continue; }
    for(let i = 0; i < x.length; i++) o[i] = x[i] + (y[i] - x[i]) * f;
  }
  FIELD.cur = cur; FIELD.curT = t;
  return cur;
}
/* bilinear sample of one array at lon/lat; missing corners drop out */
function sample(arr, lon, lat){
  const B = DATA.box, gx = (lon - B.w) / B.dlon, gy = (lat - B.s) / B.dlat;
  if(gx < 0 || gy < 0 || gx > B.nx - 1 || gy > B.ny - 1) return NaN;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(B.nx - 1, x0 + 1), y1 = Math.min(B.ny - 1, y0 + 1), fx = gx - x0, fy = gy - y0;
  const a = arr[y0 * B.nx + x0], b = arr[y0 * B.nx + x1], c = arr[y1 * B.nx + x0], d = arr[y1 * B.nx + x1];
  let s = 0, w = 0;
  const add = (v, k) => { if(v === v){ s += v * k; w += k; } };
  add(a, (1 - fx) * (1 - fy)); add(b, fx * (1 - fy)); add(c, (1 - fx) * fy); add(d, fx * fy);
  return w > 0.35 ? s / w : NaN;
}

/* ── View (pan / zoom) ─────────────────────────────────────── */
const VIEW = { cx: 0, cy: 0, s: 60, fit: 60, W: 0, H: 0, dpr: 1 };
const toScreen = (lon, lat) => [(lon - VIEW.cx) * VIEW.s + VIEW.W / 2, (VIEW.cy - mercY(lat)) * VIEW.s + VIEW.H / 2];
const toLon = x => (x - VIEW.W / 2) / VIEW.s + VIEW.cx;
const toLat = y => invMercY(VIEW.cy - (y - VIEW.H / 2) / VIEW.s);
function fitView(){
  if(!DATA) return;
  const B = DATA.box, y0 = mercY(B.s), y1 = mercY(B.n);
  VIEW.fit = VIEW.s = Math.max(VIEW.W / (B.e - B.w), VIEW.H / (y1 - y0));      /* cover: no empty edges */
  VIEW.cx = (B.w + B.e) / 2; VIEW.cy = (y0 + y1) / 2;
}
function clampView(){
  if(!DATA) return;
  const B = DATA.box;
  VIEW.s = Math.max(VIEW.fit, Math.min(VIEW.fit * 7, VIEW.s));
  /* the view never leaves the forecast area */
  const hw = VIEW.W / 2 / VIEW.s, hh = VIEW.H / 2 / VIEW.s, y0 = mercY(B.s), y1 = mercY(B.n);
  VIEW.cx = B.e - B.w >= 2 * hw ? Math.max(B.w + hw, Math.min(B.e - hw, VIEW.cx)) : (B.w + B.e) / 2;
  VIEW.cy = y1 - y0 >= 2 * hh ? Math.max(y0 + hh, Math.min(y1 - hh, VIEW.cy)) : (y0 + y1) / 2;
}

/* ── Panel ─────────────────────────────────────────────────── */
function ensurePanel(){
  if(ov) return ov;
  ov = document.createElement('div');
  ov.className = 'wxm-ov'; ov.id = 'wxmOv'; ov.tabIndex = -1;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Wind and waves map');
  ov.innerHTML = `
    <div class="wxm">
      <div class="wxm-head">
        <div class="wxm-ttl"><div class="wxm-kicker">Field weather · map</div><div class="wxm-title">Wind &amp; waves</div><div class="wxm-meta" id="wxmMeta"></div></div>
        <div class="wxm-seg" role="radiogroup" aria-label="Layer">
          <button type="button" data-layer="wind"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 7h10a3 3 0 1 0-3-3M2 11h14a3 3 0 1 1-3 3M2 15h6"/></svg>Wind</button>
          <button type="button" data-layer="waves"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M1 8c2.5-3 4.5-3 7 0s4.5 3 7 0 3-2 4-1M1 14c2.5-3 4.5-3 7 0s4.5 3 7 0 3-2 4-1"/></svg>Waves</button>
        </div>
        <div class="wxm-unit" role="radiogroup" aria-label="Wind unit"><button type="button" data-u="kn">kn</button><button type="button" data-u="ms">m/s</button></div>
        <button type="button" class="wxm-btn" id="wxmTable" title="Forecast tables for every location">Tables</button>
        <button type="button" class="wxm-btn" id="wxmRefresh">Refresh</button>
        <button type="button" class="wxm-x" id="wxmClose" title="Close (Esc)">✕</button>
      </div>
      <div class="wxm-stage" id="wxmStage">
        <canvas class="wxm-c wxm-col"></canvas>
        <canvas class="wxm-c wxm-land"></canvas>
        <canvas class="wxm-c wxm-val"></canvas>
        <canvas class="wxm-c wxm-flow"></canvas>
        <div class="wxm-pins" id="wxmPins"></div>
        <div class="wxm-tip" id="wxmTip" hidden></div>
        <div class="wxm-legend" id="wxmLegend"></div>
        <div class="wxm-zoom"><button type="button" data-z="1" title="Zoom in">+</button><button type="button" data-z="-1" title="Zoom out">−</button><button type="button" data-z="0" title="Whole area">⤢</button><button type="button" class="wxm-valbtn" id="wxmVals" title="Values on the map (metres / knots)">12</button></div>
        <div class="wxm-state" id="wxmState" hidden></div>
      </div>
      <div class="wxm-time">
        <button type="button" class="wxm-play" id="wxmPlay" title="Play the forecast (Space)" aria-label="Play"><svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg></button>
        <div class="wxm-track" id="wxmTrack"><div class="wxm-days" id="wxmDays"></div><input type="range" id="wxmRange" min="0" max="0" step="0.01" value="0" aria-label="Forecast time"><i class="wxm-nowmark" id="wxmNowMark"></i></div>
        <div class="wxm-when" id="wxmWhen">—</div>
        <button type="button" class="wxm-btn wxm-now" id="wxmNow">Now</button>
      </div>
      <div class="wxm-foot">Forecast, not observations — not for navigation · Open-Meteo (ECMWF, DWD, Met Office and other models) on a ~0.4° grid, every 3 h · coastline: Natural Earth · only the grid coordinates are sent</div>
    </div>`;
  document.body.appendChild(ov);

  const $ = s => ov.querySelector(s);
  const close = () => closeMap();
  ov.addEventListener('mousedown', e => { if(e.target === ov) close(); });
  $('#wxmClose').addEventListener('click', close);
  $('#wxmRefresh').addEventListener('click', () => load(true));
  $('#wxmTable').addEventListener('click', () => { const id = focusId; closeMap(); API && API.openForecast && API.openForecast(id); });
  ov.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => setLayer(b.dataset.layer)));
  ov.querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', () => { setWindUnit(b.dataset.u); syncControls(); drawLegend(); drawValues(); pinsValues(); tipAgain(); }));
  $('#wxmVals').addEventListener('click', () => { lsSet(LS_VALS, !showVals()); syncControls(); drawValues(); });
  ov.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => {
    const z = +b.dataset.z;
    if(!z){ fitView(); } else { VIEW.s *= z > 0 ? 1.5 : 1 / 1.5; clampView(); }
    viewChanged(true);
  }));
  $('#wxmPlay').addEventListener('click', () => setPlaying(!playing));
  $('#wxmNow').addEventListener('click', () => { setPlaying(false); setTime(nowIdx()); });
  $('#wxmRange').addEventListener('input', e => { setPlaying(false); setTime(+e.target.value); });
  ov.addEventListener('keydown', e => {
    if(e.key === 'Escape'){ e.stopPropagation(); close(); return; }
    if(e.target.closest('input[type="text"],textarea')) return;
    if(e.key === ' '){ if(e.target.closest('button,input')) return; e.preventDefault(); setPlaying(!playing); }
    else if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
      if(e.target.id === 'wxmRange') return;      /* the slider moves itself */
      e.preventDefault(); setPlaying(false); setTime(Math.round(tIdx) + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });
  wireStage($('#wxmStage'));
  new ResizeObserver(() => { if(ov.classList.contains('open')) resize(); }).observe($('#wxmStage'));
  document.addEventListener('visibilitychange', () => { if(document.hidden) stopLoop(); else if(ov.classList.contains('open')) startLoop(); });
  /* the app behind holds still while the map is open (as for the tables) */
  let paused = [];
  new MutationObserver(() => {
    const open = ov.classList.contains('open');
    document.documentElement.classList.toggle('wxm-open', open);
    if(open){
      paused = [...document.querySelectorAll('svg')].filter(s => !ov.contains(s) && s.pauseAnimations && !s.animationsPaused());
      paused.forEach(s => s.pauseAnimations());
    } else {
      paused.forEach(s => { if(s.isConnected && motion() !== 'off') s.unpauseAnimations(); });
      paused = [];
    }
  }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  return ov;
}

export function openWeatherMap(id, wantLayer){
  focusId = id || null;
  ensurePanel();
  if(wantLayer === 'wind' || wantLayer === 'waves') layer = wantLayer;
  else layer = lsGet(LS_LAYER, 'wind') === 'waves' ? 'waves' : 'wind';
  if(!DATA){ DATA = lsGet(LS_DATA, null); if(DATA && (!DATA.v || !DATA.times)) DATA = null; buildField(); }
  ov.classList.add('open');
  ov.focus();
  syncControls(); drawLegend();
  requestAnimationFrame(() => {
    tIdx = nowIdx();               /* set the time first: the flow grid is built for it */
    resize(true);
    syncTime();
    startLoop();
    load(false);
  });
}
export function closeMap(){
  if(!ov) return;
  setPlaying(false);
  stopLoop();
  ov.classList.remove('open');
}
export function initWeatherMap(api){ API = api; }

function setLayer(l){
  if(l === layer) return;
  layer = l; lsSet(LS_LAYER, l);
  syncControls(); buildFlowGrid(); resetParticles(true); drawColour(); drawLand(); drawLegend(); placePins(); tipAgain();
  if(motion() === 'off') drawArrows();
}
function syncControls(){
  if(!ov) return;
  ov.querySelectorAll('[data-layer]').forEach(b => { b.classList.toggle('on', b.dataset.layer === layer); b.setAttribute('aria-checked', b.dataset.layer === layer); });
  const u = windUnit();
  ov.querySelectorAll('[data-u]').forEach(b => b.classList.toggle('on', b.dataset.u === u));
  ov.querySelector('.wxm-unit').style.visibility = layer === 'wind' ? '' : 'hidden';
  ov.querySelector('.wxm').dataset.layer = layer;
  const vb = ov.querySelector('#wxmVals'); vb.classList.toggle('on', showVals()); vb.setAttribute('aria-pressed', String(showVals()));
  const r = ov.querySelector('#wxmRefresh'); r.disabled = loading; r.textContent = loading ? 'Updating…' : 'Refresh';
  const meta = ov.querySelector('#wxmMeta');
  meta.textContent = loading && !DATA ? 'Loading the forecast grid…'
    : DATA ? `Updated ${new Date(DATA.at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}${Date.now() - DATA.at > 6 * 3600000 ? ' — old forecast' : ''}${loading ? ' · updating…' : ''}${err ? ' · ' + err : ''}${DATA.marine ? '' : ' · no sea state'}`
    : err || '';
  const st = ov.querySelector('#wxmState');
  const box = API ? wantedBox() : null;
  st.hidden = !!DATA;
  st.innerHTML = !box ? '<b>No positions yet.</b> Add the positions of the locations in Vessel Setup → Locations, and the map of their area appears here.'
    : loading ? '<span class="wxm-spin"></span>Loading wind and sea state for the working area…'
    : `<b>No forecast loaded.</b> ${esc(err || 'Check the connection and press Refresh.')}`;
}

async function load(force){
  const box = wantedBox(VIEW.W && VIEW.H ? VIEW.W / VIEW.H : 1.6);
  if(!box || loading) return;
  const fresh = DATA && Date.now() - DATA.at < FRESH_MS;
  if(!force && DATA && fresh && covers(box)) return;
  loading = true; err = ''; syncControls();
  try{
    const d = await fetchGrid(box);
    if(!d.times.length) throw new Error('empty answer');
    const first = !DATA || DATA.key !== d.key;
    DATA = d; buildField();
    if(!lsSet(LS_DATA, DATA)) console.warn('[wxMap] grid not cached (storage full)');
    if(ov && ov.classList.contains('open')){
      if(first) fitView();
      tIdx = nowIdx(); syncTime(); viewChanged(true);
    }
  }catch(e){
    err = e && e.name === 'AbortError' ? 'no answer from Open-Meteo' : 'could not reach Open-Meteo';
  }finally{
    loading = false; syncControls();
  }
}

/* ── Time line ─────────────────────────────────────────────── */
function nowIdx(){
  if(!DATA || !DATA.times.length) return 0;
  const t = Date.now(), T = DATA.times, n = T.length;
  if(t <= T[0]) return 0;
  for(let k = 1; k < n; k++) if(t < T[k]) return k - 1 + (t - T[k - 1]) / (T[k] - T[k - 1]);
  return n - 1;
}
function timeAt(i){
  const T = DATA.times, a = Math.max(0, Math.min(T.length - 1, Math.floor(i))), b = Math.min(T.length - 1, a + 1);
  return T[a] + (T[b] - T[a]) * (i - a);
}
function setTime(i){
  if(!DATA) return;
  tIdx = Math.max(0, Math.min(DATA.times.length - 1, i));
  syncTime();
  drawColour(); tipAgain(); pinsValues();
  /* the streaks must take the new time's wind too — before v3.27.3 only
     Play rebuilt the flow, so a jump kept the old speeds */
  flowSoon();
}
let flowRaf = 0;
function flowSoon(){
  if(flowRaf) return;
  flowRaf = requestAnimationFrame(() => { flowRaf = 0; buildFlowGrid(); if(motion() === 'off') drawArrows(); });
}
function syncTime(){
  if(!ov || !DATA || !DATA.times.length) return;
  const n = DATA.times.length, r = ov.querySelector('#wxmRange');
  r.max = n - 1; r.value = tIdx;
  const t = timeAt(tIdx), d = new Date(t);
  const dh = Math.round((t - Date.now()) / 3600000);
  ov.querySelector('#wxmWhen').innerHTML = `<b>${d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}</b> ${d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}
    <small>${Math.abs(dh) < 2 ? 'now' : (dh > 0 ? '+' : '') + dh + ' h'}</small>`;
  const days = ov.querySelector('#wxmDays');
  if(days.dataset.key !== String(DATA.at)){
    days.dataset.key = String(DATA.at);
    const T = DATA.times, out = [];
    for(let k = 0; k < n; k++){
      const dd = new Date(T[k]);
      if(k === 0 || dd.getDate() !== new Date(T[k - 1]).getDate()){
        const frac = k / (n - 1);
        out.push(`<span style="left:${(frac * 100).toFixed(2)}%">${dd.toLocaleDateString('en-GB', { weekday:'short', day:'numeric' })}</span>`);
      }
    }
    days.innerHTML = out.join('');
  }
  const nm = ov.querySelector('#wxmNowMark'), ni = nowIdx();
  nm.style.left = `calc(${(ni / (n - 1) * 100).toFixed(2)}% )`;
  r.style.setProperty('--p', (tIdx / (n - 1) * 100).toFixed(2) + '%');
}
let playT0 = 0;
function setPlaying(p){
  playing = !!p && !!DATA;
  if(!ov) return;
  const b = ov.querySelector('#wxmPlay');
  b.classList.toggle('on', playing);
  b.innerHTML = playing ? '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>' : '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>';
  b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if(playing && DATA && tIdx >= DATA.times.length - 1.01) setTime(0);
  playT0 = 0;
  if(playing) startLoop();
}

/* ── Canvases ──────────────────────────────────────────────── */
let CV = null;
function canvases(){
  if(CV) return CV;
  const st = ov.querySelector('#wxmStage');
  const [col, land, val, flow] = st.querySelectorAll('canvas');
  CV = { st, col, land, val, flow, cx: col.getContext('2d'), lx: land.getContext('2d'), vx: val.getContext('2d'), fx: flow.getContext('2d'),
         off: document.createElement('canvas') };
  CV.ox = CV.off.getContext('2d');
  return CV;
}
function resize(refit){
  const c = canvases(), r = c.st.getBoundingClientRect();
  if(!r.width || !r.height) return;
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);      /* flow canvas is capped: smooth on a small GPU */
  const W = Math.round(r.width), H = Math.round(r.height);
  const changed = W !== VIEW.W || H !== VIEW.H || dpr !== VIEW.dpr;
  const oldW = VIEW.W, oldH = VIEW.H;
  VIEW.W = W; VIEW.H = H; VIEW.dpr = dpr;
  for(const cv of [c.col, c.land, c.val, c.flow]){ cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  if(refit || !oldW){ fitView(); }
  else if(changed && DATA){ const k = Math.min(W / oldW, H / oldH); VIEW.fit *= k; VIEW.s *= k; clampView(); }
  viewChanged(true);
}
let vcRaf = 0;
function viewChanged(now){
  const run = () => { vcRaf = 0; placePins(); drawColour(); drawLand(); buildFlowGrid(); resetParticles(true); if(motion() === 'off') drawArrows(); };
  if(now){ cancelAnimationFrame(vcRaf); run(); }
  else if(!vcRaf) vcRaf = requestAnimationFrame(run);
}

/* colour field at 1/4 resolution, smoothed up — Mercator is separable,
   so every column has one longitude and every row one latitude */
function drawColour(){
  if(!CV) return;
  const { col, cx, off, ox } = CV;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.clearRect(0, 0, col.width, col.height);
  if(!DATA || !FIELD) return;
  const F = fieldAt(tIdx);
  const q = 4, w = Math.ceil(VIEW.W / q), h = Math.ceil(VIEW.H / q);
  if(off.width !== w || off.height !== h){ off.width = w; off.height = h; CV.img = null; }
  const img = CV.img || (CV.img = ox.createImageData(w, h)), px = img.data;
  const L = LUT[layer], max = layer === 'wind' ? WIND_MAX : WAVE_MAX;
  const lons = new Float32Array(w), lats = new Float32Array(h);
  for(let x = 0; x < w; x++) lons[x] = toLon(x * q + q / 2);
  for(let y = 0; y < h; y++) lats[y] = toLat(y * q + q / 2);
  for(let y = 0; y < h; y++){
    for(let x = 0; x < w; x++){
      let v;
      if(layer === 'wind'){ const u = sample(F.U, lons[x], lats[y]), vv = sample(F.V, lons[x], lats[y]); v = Math.hypot(u, vv) * KN2MS; }
      else v = sample(F.H, lons[x], lats[y]);
      const o = (y * w + x) * 4;
      if(!(v === v)){ px[o + 3] = 0; continue; }
      const i = Math.max(0, Math.min(255, Math.round(v / max * 255))) * 3;
      px[o] = L[i]; px[o + 1] = L[i + 1]; px[o + 2] = L[i + 2]; px[o + 3] = 255;
    }
  }
  ox.putImageData(img, 0, 0);
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
  cx.drawImage(off, 0, 0, w, h, 0, 0, w * q * VIEW.dpr, h * q * VIEW.dpr);
  drawValues();
}

/* numbers on the map, as on Ventusky: a staggered lattice of the value
   under each point (Hs in m, wind in kn or m/s), dark on light colours,
   white on dark ones; places with no data stay empty */
function drawValues(){
  if(!CV) return;
  const { val, vx } = CV, d = VIEW.dpr;
  vx.setTransform(1, 0, 0, 1, 0, 0);
  vx.clearRect(0, 0, val.width, val.height);
  if(!DATA || !FIELD || !showVals()) return;
  const F = fieldAt(tIdx), wind = layer === 'wind', u = windUnit();
  const gx = 96, gy = 50;
  vx.font = `500 ${12 * d}px system-ui, "Segoe UI", sans-serif`;
  vx.textAlign = 'center'; vx.textBaseline = 'middle';
  const pins = [...(ov.querySelectorAll('.wxm-pin') || [])].map(b => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(b.style.transform || ''); return m ? [+m[1], +m[2]] : null; }).filter(Boolean);
  /* keep clear of the legend and the zoom buttons */
  const sr = CV.st.getBoundingClientRect();
  const keep = [...ov.querySelectorAll('.wxm-legend, .wxm-zoom')].map(e => { const r = e.getBoundingClientRect(); return [r.left - sr.left - 10, r.top - sr.top - 10, r.right - sr.left + 10, r.bottom - sr.top + 10]; });
  let row = 0;
  for(let y = gy / 2 + 18; y < VIEW.H - 6; y += gy, row++){
    for(let x = (row % 2 ? gx : gx / 2); x < VIEW.W - 8; x += gx){
      if(pins.some(p => Math.abs(p[0] - x) < 60 && Math.abs(p[1] - y) < 16)) continue;   /* the pins keep their label */
      if(keep.some(k => x > k[0] && x < k[2] && y > k[1] && y < k[3])) continue;
      const lon = toLon(x), lat = toLat(y);
      let v, t, c;
      if(wind){
        const ws = Math.hypot(sample(F.U, lon, lat), sample(F.V, lon, lat)); if(!(ws === ws)) continue;
        v = ws * KN2MS; t = String(Math.round(u === 'ms' ? ws * KN2MS : ws)); c = WIND_PAL;
      } else {
        v = sample(F.H, lon, lat); if(!(v === v)) continue;
        t = v.toFixed(1); c = WAVE_PAL;
      }
      const rgb = cssOf(c, v).match(/\d+/g).map(Number);
      const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      vx.fillStyle = lum > 0.58 ? 'rgba(22,26,32,.72)' : 'rgba(255,255,255,.86)';
      vx.fillText(t, x * d, y * d);
    }
  }
}

/* land, coastline, graticule */
let LANDPATH = null;
function landPath(){
  if(LANDPATH) return LANDPATH;
  const p = new Path2D(), u = LAND.unit;
  for(const r of LAND.rings){
    for(let i = 0; i < r.length; i += 2){ const x = r[i] * u, y = mercY(r[i + 1] * u); i ? p.lineTo(x, y) : p.moveTo(x, y); }
    p.closePath();
  }
  return (LANDPATH = p);
}
function drawLand(){
  if(!CV) return;
  const { land, lx } = CV, d = VIEW.dpr;
  lx.setTransform(1, 0, 0, 1, 0, 0);
  lx.clearRect(0, 0, land.width, land.height);
  /* world → screen: x' = (X − cx)·s + W/2, y' = (cy − Y)·s + H/2 */
  lx.setTransform(VIEW.s * d, 0, 0, -VIEW.s * d, (VIEW.W / 2 - VIEW.cx * VIEW.s) * d, (VIEW.H / 2 + VIEW.cy * VIEW.s) * d);
  const P = landPath();
  lx.fillStyle = layer === 'waves' ? 'rgba(52,56,64,.96)' : 'rgba(22,26,32,.34)';
  lx.fill(P, 'evenodd');
  lx.lineWidth = 1.1 / VIEW.s; lx.lineJoin = 'round';
  lx.strokeStyle = 'rgba(255,255,255,.62)';
  lx.stroke(P);
  lx.setTransform(1, 0, 0, 1, 0, 0);
  /* graticule every 1° (2° when zoomed out) with edge labels */
  const step = VIEW.s < 70 ? 2 : 1;
  lx.strokeStyle = 'rgba(255,255,255,.09)'; lx.lineWidth = d;
  lx.fillStyle = 'rgba(255,255,255,.55)'; lx.font = `${10.5 * d}px system-ui, "Segoe UI", sans-serif`;
  lx.beginPath();
  const lon0 = Math.ceil(toLon(0) / step) * step, lon1 = toLon(VIEW.W);
  for(let lo = lon0; lo <= lon1; lo += step){ const x = Math.round(toScreen(lo, 0)[0] * d) + .5; lx.moveTo(x, 0); lx.lineTo(x, land.height); }
  const lat0 = Math.ceil(toLat(VIEW.H) / step) * step, lat1 = toLat(0);
  for(let la = lat0; la <= lat1; la += step){ const y = Math.round(toScreen(0, la)[1] * d) + .5; lx.moveTo(0, y); lx.lineTo(land.width, y); }
  lx.stroke();
  lx.textBaseline = 'top';
  for(let lo = lon0; lo <= lon1; lo += step){ const x = toScreen(lo, 0)[0] * d; lx.fillText(`${Math.abs(lo)}°${lo < 0 ? 'W' : lo > 0 ? 'E' : ''}`, x + 4 * d, 6 * d); }
  lx.textBaseline = 'top';
  for(let la = lat0; la <= lat1; la += step){ const y = toScreen(0, la)[1] * d; lx.fillText(`${la}°N`, 6 * d, y + 3 * d); }
}

/* screen-space flow grid (every 5 px): velocity in px/s, built when the
   view or the time changes; particles read it bilinearly */
const FG = { step: 5, w: 0, h: 0, vx: null, vy: null, ok: null, t: -1 };
function buildFlowGrid(){
  if(!DATA || !FIELD) return;
  const F = fieldAt(tIdx), q = FG.step, w = Math.ceil(VIEW.W / q) + 1, h = Math.ceil(VIEW.H / q) + 1;
  if(FG.w !== w || FG.h !== h){ FG.w = w; FG.h = h; FG.vx = new Float32Array(w * h); FG.vy = new Float32Array(w * h); FG.ok = new Uint8Array(w * h); FG.hs = new Float32Array(w * h); }
  const lons = new Float32Array(w), lats = new Float32Array(h), sec = new Float32Array(h);
  for(let x = 0; x < w; x++) lons[x] = toLon(x * q);
  for(let y = 0; y < h; y++){ lats[y] = toLat(y * q); sec[y] = 1 / Math.cos(lats[y] * D2R); }
  /* conformal: a north/east metre is the same number of pixels; the
     scale grows by 1/cos(lat). Calm and slow, as on Windy: at the fit
     zoom 20 kn drifts about 14 px/s (green areas), a 45 kn gale about
     45 px/s, 8 kn barely creeps. */
  const kW = 0.0082 * VIEW.s * Math.sqrt(VIEW.fit / VIEW.s);
  for(let y = 0; y < h; y++){
    for(let x = 0; x < w; x++){
      const i = y * w + x;
      let ex, ny, k;
      if(layer === 'wind'){
        ex = sample(F.U, lons[x], lats[y]); ny = sample(F.V, lons[x], lats[y]);
        /* streak speed grows faster than the wind (speed^1.5, equal at
           20 kn): 10 kn drifts, 40 kn races — 8× apart, not 4×, so the
           eye reads calm and gale at once, as on Windy */
        const m = Math.hypot(ex, ny);
        k = kW * sec[y] * Math.sqrt(Math.max(1.5, m) / 20);
      }
      else {
        const hx = sample(F.WX, lons[x], lats[y]), hy = sample(F.WY, lons[x], lats[y]), hh = Math.hypot(hx, hy);
        const per = sample(F.P, lons[x], lats[y]);
        /* the sea runs with its period (deep water: faster for longer waves) — illustrative */
        const spd = (per === per ? Math.max(4, per) : 7) * 0.9;
        ex = hh > 0 ? hx / hh * spd : NaN; ny = hh > 0 ? hy / hh * spd : NaN; k = kW * sec[y] * 1.6;
        FG.hs[i] = sample(F.H, lons[x], lats[y]);
      }
      if(ex === ex && ny === ny){ FG.vx[i] = ex * k; FG.vy[i] = -ny * k; FG.ok[i] = 1; }
      else { FG.vx[i] = FG.vy[i] = 0; FG.ok[i] = 0; }
    }
  }
  FG.t = tIdx;
}
function flowAt(x, y, out){
  const q = FG.step, gx = x / q, gy = y / q, x0 = gx | 0, y0 = gy | 0;
  if(x0 < 0 || y0 < 0 || x0 >= FG.w - 1 || y0 >= FG.h - 1) return false;
  const i = y0 * FG.w + x0;
  if(!FG.ok[i] || !FG.ok[i + 1] || !FG.ok[i + FG.w] || !FG.ok[i + FG.w + 1]) return false;
  const fx = gx - x0, fy = gy - y0, a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
  out[0] = FG.vx[i] * a + FG.vx[i + 1] * b + FG.vx[i + FG.w] * c + FG.vx[i + FG.w + 1] * d;
  out[1] = FG.vy[i] * a + FG.vy[i + 1] * b + FG.vy[i + FG.w] * c + FG.vy[i + FG.w + 1] * d;
  return true;
}

/* ── Particles ─────────────────────────────────────────────
   Each streak is its own short history (the last ~1.4 s of positions,
   sampled at a fixed rate), drawn fresh every frame from bright head to
   faint tail. No fading buffer, so slow streaks stay crisp and leave no
   ghost lines, and a streak's length shows its speed. */
const HK = 16, HSTEP = 0.09;                 /* history points, seconds between them */
const PT = { n: 0, x: null, y: null, age: null, life: null, hx: null, hy: null, len: null, cap: 0, head: 0, acc: 0, budget: 1 };
function targetCount(){
  const area = VIEW.W * VIEW.H, m = motion();
  const base = layer === 'wind' ? Math.min(2600, area / 320) : Math.min(700, area / 1700);
  return Math.max(250, Math.round(base * (m === 'calm' ? 0.55 : 1) * PT.budget));
}
function spawn(i, anyAge){
  PT.x[i] = -1;
  for(let tries = 0; tries < 12; tries++){
    const x = Math.random() * VIEW.W, y = Math.random() * VIEW.H;
    if(flowAt(x, y, _v)){ PT.x[i] = x; PT.y[i] = y; break; }
  }
  PT.life[i] = layer === 'wind' ? 3 + Math.random() * 4 : 2.6 + Math.random() * 2.4;
  PT.age[i] = anyAge ? Math.random() * PT.life[i] : 0;
  PT.len[i] = 0;
}
const _v = [0, 0];
function resetParticles(clear){
  if(!CV) return;
  const n = targetCount();
  if(!PT.x || PT.cap < n){
    PT.cap = Math.max(n, 600);
    PT.x = new Float32Array(PT.cap); PT.y = new Float32Array(PT.cap); PT.age = new Float32Array(PT.cap); PT.life = new Float32Array(PT.cap);
    PT.hx = new Float32Array(PT.cap * HK); PT.hy = new Float32Array(PT.cap * HK); PT.len = new Uint8Array(PT.cap);
  }
  PT.n = n;
  for(let i = 0; i < n; i++) spawn(i, true);
  if(clear){ const { fx, flow } = CV; fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, flow.width, flow.height); }
}
const BUCKETS = 4;                            /* head → tail in 4 shades */
function stepParticles(dt){
  const { fx, flow } = CV, d = VIEW.dpr;
  const n = PT.n, X = PT.x, Y = PT.y, A = PT.age, Lf = PT.life, HX = PT.hx, HY = PT.hy, LEN = PT.len;
  /* move */
  for(let i = 0; i < n; i++){
    A[i] += dt;
    if(A[i] > Lf[i] || X[i] < 0 || !flowAt(X[i], Y[i], _v)){ spawn(i, false); continue; }
    X[i] += _v[0] * dt; Y[i] += _v[1] * dt;
  }
  /* remember a point every HSTEP seconds (one shared ring head) */
  PT.acc += dt;
  if(PT.acc >= HSTEP){
    PT.acc %= HSTEP;
    PT.head = (PT.head + 1) % HK;
    const h = PT.head;
    for(let i = 0; i < n; i++){ HX[i * HK + h] = X[i]; HY[i * HK + h] = Y[i]; if(LEN[i] < HK) LEN[i]++; }
  }
  /* draw */
  fx.setTransform(1, 0, 0, 1, 0, 0);
  fx.clearRect(0, 0, flow.width, flow.height);
  const wind = layer === 'wind';
  if(!wind){ drawCrescents(); return; }
  fx.lineWidth = (wind ? 1.2 : 2.2) * d; fx.lineCap = 'round'; fx.lineJoin = 'round';
  const per = Math.ceil(HK / BUCKETS), h = PT.head;
  for(let b = 0; b < BUCKETS; b++){
    fx.beginPath();
    for(let i = 0; i < n; i++){
      if(X[i] < 0) continue;
      const L = LEN[i]; if(!L) continue;
      const j0 = b * per, j1 = Math.min(L, j0 + per);
      if(j0 >= j1) continue;
      /* segment j joins point j-1 (j = 0: the live head) to history point j */
      let px = j0 === 0 ? X[i] : HX[i * HK + ((h - j0 + 1 + HK * 2) % HK)];
      let py = j0 === 0 ? Y[i] : HY[i * HK + ((h - j0 + 1 + HK * 2) % HK)];
      fx.moveTo(px * d, py * d);
      for(let j = j0; j < j1; j++){
        const k = i * HK + ((h - j + HK * 2) % HK);
        const qx = HX[k], qy = HY[k];
        if(Math.abs(qx - px) > 60 || Math.abs(qy - py) > 60) break;   /* never draw across a respawn */
        fx.lineTo(qx * d, qy * d); px = qx; py = qy;
      }
    }
    const a = wind ? [0.92, 0.6, 0.34, 0.14][b] : [0.62, 0.42, 0.24, 0.1][b];
    fx.strokeStyle = `rgba(255,255,255,${a})`;
    fx.stroke();
  }
}
/* Waves as Ventusky draws them: crescent wave fronts, bowed the way the
   sea runs, bigger where the sea is higher, fading in and out as they
   travel — direction, height and colour read together at a glance. */
function drawCrescents(){
  const { fx } = CV, d = VIEW.dpr, n = PT.n, X = PT.x, Y = PT.y, A = PT.age, Lf = PT.life;
  const zoom = Math.sqrt(VIEW.s / VIEW.fit);
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  for(let i = 0; i < n; i++){
    if(X[i] < 0 || !flowAt(X[i], Y[i], _v)) continue;
    const m = Math.hypot(_v[0], _v[1]); if(!m) continue;
    const ux = _v[0] / m, uy = _v[1] / m;
    const q = FG.step, gi = Math.min(FG.w * FG.h - 1, ((Y[i] / q) | 0) * FG.w + ((X[i] / q) | 0));
    const hs = FG.hs[gi] === FG.hs[gi] ? FG.hs[gi] : 1;
    const R = Math.min(36, (6 + hs * 2.6) * zoom) * d;
    const t = A[i] / Lf[i], a = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));    /* fade in, fade out */
    const b = a > 0.8 ? 0 : a > 0.55 ? 1 : a > 0.3 ? 2 : 3;
    const th = Math.atan2(uy, ux), cx = X[i] * d, cy = Y[i] * d, sw = 1.05;
    const p = paths[b];
    /* outer edge: an arc bowed forward; inner edge: the same arc set back */
    p.moveTo(cx + Math.cos(th - sw) * R, cy + Math.sin(th - sw) * R);
    p.arc(cx, cy, R, th - sw, th + sw);
    const bx = cx - ux * R * 0.34, by = cy - uy * R * 0.34;
    p.arc(bx, by, R * 0.97, th + sw * 0.93, th - sw * 0.93, true);
    p.closePath();
  }
  const alpha = [0.8, 0.56, 0.34, 0.15];
  for(let b = 0; b < 4; b++){ fx.fillStyle = `rgba(255,255,255,${alpha[b]})`; fx.fill(paths[b]); }
}
/* Animations → Off: a still field of arrows instead of streaks */
function drawArrows(){
  if(!CV || !DATA) return;
  const { fx, flow } = CV, d = VIEW.dpr, g = 46;
  fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, flow.width, flow.height);
  buildFlowGrid();
  fx.strokeStyle = 'rgba(255,255,255,.8)'; fx.lineWidth = 1.3 * d; fx.lineCap = 'round';
  fx.beginPath();
  for(let y = g / 2; y < VIEW.H; y += g) for(let x = g / 2; x < VIEW.W; x += g){
    if(!flowAt(x, y, _v)) continue;
    const m = Math.hypot(_v[0], _v[1]); if(!m) continue;
    const ux = _v[0] / m, uy = _v[1] / m, L = 13;
    const x0 = x - ux * L / 2, y0 = y - uy * L / 2, x1 = x + ux * L / 2, y1 = y + uy * L / 2;
    fx.moveTo(x0 * d, y0 * d); fx.lineTo(x1 * d, y1 * d);
    fx.moveTo((x1 - ux * 5 - uy * 3.5) * d, (y1 - uy * 5 + ux * 3.5) * d); fx.lineTo(x1 * d, y1 * d); fx.lineTo((x1 - ux * 5 + uy * 3.5) * d, (y1 - uy * 5 - ux * 3.5) * d);
  }
  fx.stroke();
}

/* ── Frame loop ────────────────────────────────────────────── */
let raf = 0, last = 0, lastCol = 0, perf = { acc: 0, n: 0, t: 0 };
function startLoop(){ if(!raf && ov && ov.classList.contains('open')){ last = 0; raf = requestAnimationFrame(frame); } }
function stopLoop(){ cancelAnimationFrame(raf); raf = 0; }
function frame(now){
  raf = 0;
  if(!ov || !ov.classList.contains('open') || document.hidden) return;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
  last = now;
  if(playing && DATA){
    /* 3 h of forecast per 1.4 s */
    const n = DATA.times.length;
    let t = tIdx + dt / 1.4;
    if(t >= n - 1){ t = n - 1; setPlaying(false); }
    tIdx = t; syncTime();
    /* the colour field is the heavy part: ~20 redraws a second is plenty for a 1.4 s step */
    if(now - lastCol > 48 || !playing){ lastCol = now; drawColour(); pinsValues(); tipAgain(); }
    if(Math.abs(FG.t - tIdx) > 0.08) buildFlowGrid();
  }
  /* safety net: whatever moved the time, the streaks follow it */
  else if(DATA && FG.vx && FG.t !== tIdx && !flowRaf) buildFlowGrid();
  const m = motion();
  if(m !== 'off' && DATA && FG.vx){
    stepParticles(dt);
    /* keep it smooth on a small GPU: fewer streaks if frames run long */
    perf.acc += dt; perf.n++;
    if(perf.acc > 1.2){
      const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
      if(avg > 0.034 && PT.budget > 0.35){ PT.budget *= 0.8; PT.n = Math.min(PT.n, targetCount()); }
      else if(avg < 0.019 && PT.budget < 1){ PT.budget = Math.min(1, PT.budget * 1.1); const n = targetCount(); if(n > PT.n && n <= PT.cap){ for(let i = PT.n; i < n; i++) spawn(i, true); PT.n = n; } }
    }
  }
  if(m !== 'off' || playing) raf = requestAnimationFrame(frame);
}

/* ── Stage interaction: drag to pan, wheel to zoom, read-out ─ */
let tipXY = null;
function wireStage(st){
  st.addEventListener('wheel', e => {
    if(!DATA) return;
    e.preventDefault();
    const r = st.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const lon = toLon(mx), Y = VIEW.cy - (my - VIEW.H / 2) / VIEW.s;
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    VIEW.s *= Math.exp(-dy * 0.0016); clampView();
    VIEW.cx = lon - (mx - VIEW.W / 2) / VIEW.s; VIEW.cy = Y + (my - VIEW.H / 2) / VIEW.s; clampView();
    viewChanged(false);
  }, { passive: false });
  st.addEventListener('pointerdown', e => {
    if(e.button !== 0 || !DATA || e.target.closest('.wxm-pin,.wxm-zoom,.wxm-legend')) return;
    const x0 = e.clientX, y0 = e.clientY, cx0 = VIEW.cx, cy0 = VIEW.cy;
    let moved = false;
    st.setPointerCapture(e.pointerId);
    const mv = ev => {
      if(!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true; st.classList.add('grab');
      VIEW.cx = cx0 - (ev.clientX - x0) / VIEW.s; VIEW.cy = cy0 + (ev.clientY - y0) / VIEW.s; clampView();
      viewChanged(false);
    };
    const up = () => { st.classList.remove('grab'); st.removeEventListener('pointermove', mv); st.removeEventListener('pointerup', up); st.removeEventListener('pointercancel', up); st.removeEventListener('lostpointercapture', up); };
    st.addEventListener('pointermove', mv); st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up); st.addEventListener('lostpointercapture', up);
  });
  st.addEventListener('dblclick', e => {
    if(!DATA || e.target.closest('.wxm-pin,.wxm-zoom')) return;
    const r = st.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const lon = toLon(mx), Y = VIEW.cy - (my - VIEW.H / 2) / VIEW.s;
    VIEW.s *= 1.6; clampView(); VIEW.cx = lon - (mx - VIEW.W / 2) / VIEW.s; VIEW.cy = Y + (my - VIEW.H / 2) / VIEW.s; clampView();
    viewChanged(true);
  });
  st.addEventListener('mousemove', e => { const r = st.getBoundingClientRect(); tipXY = [e.clientX - r.left, e.clientY - r.top]; tipAgain(); });
  st.addEventListener('mouseleave', () => { tipXY = null; tipAgain(); });
}
let tipRaf = 0;
function tipAgain(){
  if(tipRaf) return;
  tipRaf = requestAnimationFrame(() => {
    tipRaf = 0;
    const tip = ov && ov.querySelector('#wxmTip');
    if(!tip) return;
    if(!tipXY || !DATA || !FIELD || tipXY[1] < 0){ tip.hidden = true; return; }
    const [x, y] = tipXY, lon = toLon(x), lat = toLat(y), F = fieldAt(tIdx);
    const u = windUnit(), U = windLbl(u), cv = kn => u === 'ms' ? kn * KN2MS : kn;
    const ue = sample(F.U, lon, lat), vn = sample(F.V, lon, lat), g = sample(F.G, lon, lat);
    const h = sample(F.H, lon, lat), hx = sample(F.WX, lon, lat), hy = sample(F.WY, lon, lat), p = sample(F.P, lon, lat);
    const ws = Math.hypot(ue, vn), wfrom = (Math.atan2(-ue, -vn) / D2R + 360) % 360, hfrom = (Math.atan2(-hx, -hy) / D2R + 360) % 360;
    const arr = from => `<svg class="wxm-ta" viewBox="0 0 16 16" aria-hidden="true"><g transform="rotate(${(from + 180) % 360} 8 8)"><path d="M8 1.5 L12 9 L8.9 8 L8.9 14.5 L7.1 14.5 L7.1 8 L4 9 Z" fill="currentColor"/></g></svg>`;
    const pos = `${Math.abs(lat).toFixed(2)}°N ${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'W' : 'E'}`;
    const wind = ws === ws ? `<div class="wxm-tr${layer === 'wind' ? ' on' : ''}"><i style="background:${cssOf(WIND_PAL, ws * KN2MS)}"></i><b>${Math.round(cv(ws))}</b> ${U}${g === g ? ` · gust ${Math.round(cv(g))}` : ''} · ${arr(wfrom)} from ${compass(wfrom)}</div>` : '';
    const sea = h === h ? `<div class="wxm-tr${layer === 'waves' ? ' on' : ''}"><i style="background:${cssOf(WAVE_PAL, h)}"></i>Hs <b>${h.toFixed(1)}</b> m · max ≈ ${(h * HMAX_K).toFixed(1)}${p === p ? ` · ${Math.round(p)} s` : ''} · ${arr(hfrom)} from ${compass(hfrom)}</div>`
      : `<div class="wxm-tr wxm-tr-na${layer === 'waves' ? ' on' : ''}">no sea-state data here</div>`;
    if(!wind && h !== h){ tip.hidden = true; return; }
    tip.innerHTML = `${wind}${sea}<div class="wxm-tpos">${pos}</div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.transform = `translate(${Math.round(x + 16 + tw > VIEW.W ? x - tw - 14 : x + 16)}px, ${Math.round(Math.max(6, Math.min(VIEW.H - th - 6, y - th / 2)))}px)`;
  });
}

/* ── Pins: the working locations ─────────────────────────── */
function placePins(){
  const box = ov && ov.querySelector('#wxmPins');
  if(!box) return;
  const act = new Set(API ? API.activeIds() : []);
  const locs = located().filter(l => {
    const [x, y] = toScreen(l.lon, l.lat); return x > -20 && y > -20 && x < VIEW.W + 20 && y < VIEW.H + 20;
  }).sort((a, b) => act.has(a.id) - act.has(b.id));
  if(box.dataset.key !== locs.map(l => l.id).join('|')){
    box.dataset.key = locs.map(l => l.id).join('|');
    box.innerHTML = locs.map(l => `<button type="button" class="wxm-pin${act.has(l.id) ? ' act' : ''}${l.id === focusId ? ' focus' : ''}" data-id="${esc(l.id)}"
      title="${esc(l.name)} — open the forecast table"><i style="background:${esc(l.c || '#9aa0a8')}"></i><span class="wxm-pn">${esc(l.name)}</span><span class="wxm-pv"></span></button>`).join('');
    box.querySelectorAll('.wxm-pin').forEach(b => b.addEventListener('click', () => { closeMap(); API && API.openForecast && API.openForecast(b.dataset.id); }));
  }
  /* labels: keep the busy ones from piling up — a label that would
     overlap an earlier (more important) one is hidden until zoomed in */
  const placed = [];
  [...box.children].reverse().forEach(b => {
    const l = located().find(o => o.id === b.dataset.id); if(!l) return;
    const [x, y] = toScreen(l.lon, l.lat);
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    const rect = { x0: x - 6, x1: x + 48 + b.querySelector('.wxm-pn').textContent.length * 7, y0: y - 11, y1: y + 11 };
    const clash = placed.some(p => rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0);
    b.classList.toggle('quiet', clash && !b.classList.contains('act'));
    if(!clash || b.classList.contains('act')) placed.push(rect);
  });
  pinsValues();
}
function pinsValues(){
  const box = ov && ov.querySelector('#wxmPins');
  if(!box || !DATA || !FIELD) return;
  const F = fieldAt(tIdx), u = windUnit(), cv = kn => u === 'ms' ? kn * KN2MS : kn;
  box.querySelectorAll('.wxm-pin').forEach(b => {
    const l = located().find(o => o.id === b.dataset.id); if(!l) return;
    const pv = b.querySelector('.wxm-pv');
    let t = '';
    if(layer === 'wind'){ const ws = Math.hypot(sample(F.U, l.lon, l.lat), sample(F.V, l.lon, l.lat)); if(ws === ws) t = `${Math.round(cv(ws))} ${windLbl(u)}`; }
    else { const h = sample(F.H, l.lon, l.lat); if(h === h) t = `${h.toFixed(1)} m`; }
    if(pv.textContent !== t) pv.textContent = t;
  });
}

/* ── Legend ───────────────────────────────────────────────── */
function drawLegend(){
  const el = ov && ov.querySelector('#wxmLegend');
  if(!el) return;
  if(layer === 'wind'){
    const u = windUnit(), ticks = u === 'ms' ? [0, 5, 10, 15, 20, 25, 30] : [0, 10, 20, 30, 40, 50, 60];
    const maxU = u === 'ms' ? WIND_MAX : WIND_MAX / KN2MS;
    const stops = WIND_PAL.map(([v, c]) => `rgb(${c.join(',')}) ${(v / WIND_MAX * 100).toFixed(1)}%`).join(',');
    el.innerHTML = `<div class="wxm-lk">Wind, ${windLbl(u)}</div><div class="wxm-lbar" style="background:linear-gradient(to right,${stops})">${ticks.filter(t => t <= maxU).map(t => `<span style="left:${(t / maxU * 100).toFixed(1)}%">${t}</span>`).join('')}</div>`;
  } else {
    const ticks = [0, 1, 2, 3, 4, 6, 8, 10, 12];
    const stops = WAVE_PAL.map(([v, c]) => `rgb(${c.join(',')}) ${(v / WAVE_MAX * 100).toFixed(1)}%`).join(',');
    el.innerHTML = `<div class="wxm-lk">Waves Hs, m</div><div class="wxm-lbar" style="background:linear-gradient(to right,${stops})">${ticks.map(t => `<span style="left:${(t / WAVE_MAX * 100).toFixed(1)}%">${t}</span>`).join('')}</div>`;
  }
}

/* test hooks */
export const _wxm = { get DATA(){ return DATA; }, set DATA(d){ DATA = d; buildField(); }, VIEW, PT, FG, wantedBox, fieldAt: t => fieldAt(t), get tIdx(){ return tIdx; }, setTime, setLayer, load };
