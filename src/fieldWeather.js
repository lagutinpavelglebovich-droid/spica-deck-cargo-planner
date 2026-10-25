/* ════════════════════════════════════════════════════════════
   FIELD WEATHER — v3.20 / v3.22
   Weather and sea state at the working locations, by their own
   coordinates (Vessel Setup → Locations → Position), not at the port.

   Data: Open-Meteo — forecast API (wind, gusts, rain, temperature,
   visibility) and marine API (Hs, wind sea, swell height / period /
   direction). One batched request per API for every location that has
   a position. Cached in localStorage; refreshed every 30 min while the
   planner is open. Only the coordinates of the locations are sent.
   "Windy" opens windy.com at the same point in the browser.
════════════════════════════════════════════════════════════ */

import { wmoToCondition } from './weather/api.js';
import { staticIconForCondition } from './weather/iconMap.js';
const URL_FC = 'https://api.open-meteo.com/v1/forecast';
const URL_MAR = 'https://marine-api.open-meteo.com/v1/marine';
const LS_CACHE = 'spicaTide_fieldWx';
const LS_UNIT = 'spicaTide_fieldWxUnit';
const MAX_AGE_MS = 30 * 60 * 1000;
const FC_DAYS = 5;
const TIMEOUT_MS = 12000;

let API = null, DATA = null, busy = false, timer = 0, lastErr = '', focusId = null;

const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

/* ── Units: wind in knots (as fetched) or m/s ─────────────────── */
export function windUnit(){ return lsGet(LS_UNIT, 'kn') === 'ms' ? 'ms' : 'kn'; }
export function setWindUnit(u){ lsSet(LS_UNIT, u === 'ms' ? 'ms' : 'kn'); render(); API && API.onUpdate && API.onUpdate(); }
const KN2MS = 0.514444;
export function windVal(kn, unit){ if(kn == null || !isFinite(kn)) return null; return (unit || windUnit()) === 'ms' ? kn * KN2MS : kn; }
export function windLbl(unit){ return (unit || windUnit()) === 'ms' ? 'm/s' : 'kn'; }

/* ── Colour scales: Windy's forecast-table gradients ────────────
   Copied from windy.com (client v51.3.2, module "additional-colors":
   windDetail, wavesDetail, periodDetail — read on 2026-10-25). These
   are the bright scales of Windy's forecast table and Compare
   forecasts: calm wind light grey, 4 m/s cyan, 6 green, 10 orange,
   19 pink, then purple; waves transparent below 0.1 m, lavender at 1 m,
   orange at 2.5 m fading to white; swell period cream → light green.
   Linear interpolation between the stops, exactly as Windy does. */
const WIND_DETAIL = [[0,[243,243,243,1]],[3,[243,243,243,1]],[4,[0,200,254,1]],[6,[0,230,0,1]],[10,[254,174,0,1]],[19,[254,0,150,1]],[100,[151,50,222,1]]];
const WAVE_DETAIL = [[0,[255,255,255,0]],[0.1,[255,255,255,0]],[1,[180,180,255,1]],[2.5,[254,174,0,1]],[20,[255,255,255,1]]];
const PERIOD_DETAIL = [[0,[255,255,255,0]],[5,[255,255,255,0]],[10,[255,237,180,1]],[20,[180,255,180,1]]];
function ramp(stops, v){
  if(v == null || !isFinite(v)) return null;
  if(v <= stops[0][0]) return stops[0][1];
  for(let i = 1; i < stops.length; i++){
    if(v <= stops[i][0]){
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
      return ca.map((c, k) => k < 3 ? Math.round(c + (cb[k] - c) * t) : +(c + (cb[k] - c) * t).toFixed(3));
    }
  }
  return stops[stops.length - 1][1];
}
const rgba = c => c ? `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` : 'transparent';
/* solid version (over white) for the small pills in the header / cards */
const solid = c => c ? `rgb(${c.slice(0, 3).map(x => Math.round(x * c[3] + 255 * (1 - c[3]))).join(',')})` : 'transparent';
const INK = '#17191d';            /* Windy writes dark text on its bands */
const windRGBA = kn => ramp(WIND_DETAIL, kn == null ? null : kn * KN2MS);
const waveRGBA = m => ramp(WAVE_DETAIL, m);
const periodRGBA = s => ramp(PERIOD_DETAIL, s);
/* Colour (bg + text) for a wind speed in knots / a wave height in m */
export function windColor(kn){ const c = windRGBA(kn); return { bg: solid(c), fg: c ? INK : 'inherit' }; }
export function waveColor(m){ const c = waveRGBA(m); return { bg: solid(c), fg: c ? INK : 'inherit' }; }
/* Most probable maximum of ~1000 waves (≈ 3 h): Hmax ≈ 1.86 · Hs */
export const HMAX_K = 1.86;

/* ── Coordinates: parse what an officer types or copies from ECDIS ── */
export function parseLatLon(str){
  if(str == null) return null;
  let s = String(str).trim().toUpperCase().replace(/[’′‘`]/g, "'").replace(/[”″]/g, '"');
  if(!s) return null;
  if(/[NSEW]/.test(s)) s = s.replace(/(\d),(\d)/g, '$1.$2');   /* decimal commas in "27,4N" */
  const ok = (la, lo) => (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) ? { lat: +la.toFixed(5), lon: +lo.toFixed(5) } : null;
  /* degrees [minutes [seconds]] hemisphere, twice */
  const part = '(\\d{1,3}(?:\\.\\d+)?)\\s*[°D\\s]?\\s*(?:(\\d{1,2}(?:\\.\\d+)?)\\s*\'?\\s*(?:(\\d{1,2}(?:\\.\\d+)?)\\s*"?)?)?\\s*';
  let m = s.match(new RegExp('^' + part + '([NS])[\\s,;/]*' + part + '([EW])$'));
  if(m){
    const v = (d, mi, se) => (+d) + (mi ? +mi / 60 : 0) + (se ? +se / 3600 : 0);
    const la = v(m[1], m[2], m[3]) * (m[4] === 'S' ? -1 : 1);
    const lo = v(m[5], m[6], m[7]) * (m[8] === 'W' ? -1 : 1);
    return ok(la, lo);
  }
  /* hemisphere first: N 58 27.4 E 000 15.2 */
  m = s.match(new RegExp('^([NS])\\s*' + part + '[\\s,;/]*([EW])\\s*' + part + '$'));
  if(m){
    const v = (d, mi, se) => (+d) + (mi ? +mi / 60 : 0) + (se ? +se / 3600 : 0);
    return ok(v(m[2], m[3], m[4]) * (m[1] === 'S' ? -1 : 1), v(m[6], m[7], m[8]) * (m[5] === 'W' ? -1 : 1));
  }
  /* plain decimals: 58.4567, -0.2535 */
  m = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if(m) return ok(+m[1], +m[2]);
  return null;
}
export function formatLatLon(lat, lon){
  const f = (v, pos, neg, w) => {
    const a = Math.abs(v), d = Math.floor(a), mi = (a - d) * 60;
    return `${String(d).padStart(w, '0')}°${mi.toFixed(2).padStart(5, '0')}'${v < 0 ? neg : pos}`;
  };
  return `${f(lat, 'N', 'S', 2)} ${f(lon, 'E', 'W', 3)}`;
}
export function windyUrl(lat, lon, waves){
  const p = `${lat.toFixed(3)},${lon.toFixed(3)},8`;
  return waves ? `https://www.windy.com/-Waves-waves?waves,${p}` : `https://www.windy.com/?${p}`;
}

/* ── Fetching ─────────────────────────────────────────────────── */
async function getJson(url){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try{
    const r = await fetch(url, { signal: ctrl.signal });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function located(){
  return (API ? API.locations() : []).filter(l => isFinite(l.lat) && isFinite(l.lon));
}
const posKey = locs => locs.map(l => l.id + '@' + l.lat.toFixed(3) + ',' + l.lon.toFixed(3)).join('|');

export async function refresh(force){
  const locs = located();
  if(!locs.length || busy) return DATA;
  const key = posKey(locs);
  if(!force && DATA && DATA.key === key && DATA.days === FC_DAYS && Date.now() - DATA.at < MAX_AGE_MS) return DATA;
  busy = true; render();
  try{
    const lat = locs.map(l => l.lat.toFixed(4)).join(','), lon = locs.map(l => l.lon.toFixed(4)).join(',');
    const common = `latitude=${lat}&longitude=${lon}&timezone=UTC&timeformat=unixtime&forecast_days=${FC_DAYS}`;
    const [fc, mar] = await Promise.all([
      getJson(`${URL_FC}?${common}&wind_speed_unit=kn&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,is_day`),
      getJson(`${URL_MAR}?${common}&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height,swell_wave_direction,swell_wave_period`).catch(() => null),
    ]);
    const fcA = Array.isArray(fc) ? fc : [fc], marA = mar ? (Array.isArray(mar) ? mar : [mar]) : [];
    const out = {};
    locs.forEach((l, i) => {
      const f = fcA[i] && fcA[i].hourly, m = marA[i] && marA[i].hourly;
      if(!f || !Array.isArray(f.time)) return;
      const idx = new Map(m && Array.isArray(m.time) ? m.time.map((t, k) => [t, k]) : []);
      const pick = (arr, k) => (arr && k != null && arr[k] != null) ? arr[k] : null;
      out[l.id] = f.time.map((t, k) => {
        const mk = idx.get(t);
        return { t: t * 1000,
          ws: f.wind_speed_10m[k], wg: f.wind_gusts_10m[k], wd: f.wind_direction_10m[k],
          ta: f.temperature_2m[k], pr: f.precipitation[k], wc: f.weather_code[k], vis: pick(f.visibility, k), day: pick(f.is_day, k),
          hs: pick(m && m.wave_height, mk), hd: pick(m && m.wave_direction, mk), tp: pick(m && m.wave_period, mk),
          ww: pick(m && m.wind_wave_height, mk),
          sw: pick(m && m.swell_wave_height, mk), sd: pick(m && m.swell_wave_direction, mk), sp: pick(m && m.swell_wave_period, mk) };
      });
    });
    DATA = { at: Date.now(), key, days: FC_DAYS, loc: out, marine: !!mar };
    lsSet(LS_CACHE, DATA);
    lastErr = mar ? '' : 'Sea state not available right now — wind only';
  }catch(e){
    lastErr = (e && e.name === 'AbortError') ? 'No answer from Open-Meteo (timeout)' : 'Could not reach Open-Meteo — ' + String(e && e.message || e).slice(0, 80);
  }finally{
    busy = false;
    render();
    API && API.onUpdate && API.onUpdate();
  }
  return DATA;
}

export function initFieldWeather(api){
  API = api;
  DATA = lsGet(LS_CACHE, null);
  if(DATA && !DATA.loc) DATA = null;
  clearInterval(timer);
  timer = setInterval(() => { if(located().length) refresh(false); }, 5 * 60 * 1000);
  setTimeout(() => { if(located().length) refresh(false); }, 1500);
}

/* Row for "now" (the current hour) */
function nowRow(id){
  const rows = DATA && DATA.loc && DATA.loc[id];
  if(!rows || !rows.length) return null;
  const t = Date.now();
  let best = rows[0];
  for(const r of rows){ if(r.t <= t + 30 * 60000) best = r; else break; }
  return best;
}
/* Short summary for the location card and the header */
export function fieldWxSummary(id){
  const r = nowRow(id);
  if(!r) return null;
  const u = windUnit();
  return { ws: Math.round(windVal(r.ws, u)), wg: Math.round(windVal(r.wg, u)), unit: windLbl(u), dir: compass(r.wd), wd: r.wd,
           hs: r.hs != null ? r.hs : null, hmax: r.hs != null ? r.hs * HMAX_K : null,
           wc: windColor(r.ws), hc: waveColor(r.hs), stale: Date.now() - DATA.at > 3 * 3600000, at: DATA.at };
}
/* Sky / atmosphere at a location right now (drives the animated
   background and the header icon instead of the port weather). */
export function fieldWxCondition(id){
  const r = nowRow(id);
  if(!r || r.wc == null) return null;
  let day = r.day;
  if(day == null){ const h = new Date(r.t).getUTCHours(); day = h >= 7 && h < 17 ? 1 : 0; }   /* older cache: rough North Sea daylight */
  const c = wmoToCondition(r.wc, day === 1 || day === true);
  return { condition: c.condition, intensity: c.intensity, temperature: r.ta != null ? Math.round(r.ta) : null, code: r.wc };
}
export function hasPosition(id){ return located().some(l => l.id === id); }

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function compass(d){ return d == null || !isFinite(d) ? '—' : COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
/* Arrow pointing where the wind / sea goes (downwind), like on Windy */
export function arrowSvg(d, size){
  if(d == null || !isFinite(d)) return '';
  return `<svg class="fwx-arr" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><g transform="rotate(${(d + 180) % 360} 8 8)"><path d="M8 1.5 L12 9 L8.9 8 L8.9 14.5 L7.1 14.5 L7.1 8 L4 9 Z" fill="currentColor"/></g></svg>`;
}
const arrow = arrowSvg;
const fmt1 = v => v == null || !isFinite(v) ? '—' : (+v).toFixed(1);
const fmt0 = v => v == null || !isFinite(v) ? '—' : String(Math.round(v));
const hhmm = t => new Date(t).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit', hour12:false });
const dayLbl = t => new Date(t).toLocaleDateString(undefined, { weekday:'short', day:'numeric' });

/* ── Panel ────────────────────────────────────────────────────── */
function ensurePanel(){
  let ov = document.getElementById('fwxOv');
  if(ov) return ov;
  ov = document.createElement('div');
  ov.id = 'fwxOv'; ov.className = 'fwx-ov';
  ov.innerHTML = `
    <div class="fwx" role="dialog" aria-modal="true" aria-labelledby="fwxTitle">
      <div class="fwx-head">
        <div class="fwx-head-text">
          <div class="fwx-kicker">Field weather</div>
          <div class="fwx-title" id="fwxTitle">Weather at the working locations</div>
          <div class="fwx-meta" id="fwxMeta"></div>
        </div>
        <div class="fwx-unit" role="radiogroup" aria-label="Wind unit"><button type="button" data-u="kn">kn</button><button type="button" data-u="ms">m/s</button></div>
        <button type="button" class="fwx-btn" id="fwxRefresh">Refresh</button>
        <button type="button" class="fwx-x" id="fwxClose" title="Close (Esc)">✕</button>
      </div>
      <div class="fwx-body" id="fwxBody"></div>
      <div class="fwx-foot">Forecast: Open-Meteo (ECMWF, DWD, Met Office and other national models) · Hmax ≈ 1.86 × Hs, the highest of about 1000 waves (≈ 3 h) · colours: Windy's forecast-table scales · times are this computer's local time · only the coordinates of the locations are sent</div>
    </div>`;
  document.body.appendChild(ov);
  /* v3.26.2 — while the forecast is open the app behind it holds still:
     no full-screen blur and no ambient animation under the panel, so the
     GPU spends every frame on the tables (the blur had to be redrawn each
     frame the sky / atmosphere behind it moved) */
  let paused = [];
  new MutationObserver(() => {
    const open = ov.classList.contains('open');
    document.documentElement.classList.toggle('fwx-open', open);
    if(open){
      paused = [...document.querySelectorAll('svg')].filter(s => !ov.contains(s) && s.pauseAnimations && !s.animationsPaused());
      paused.forEach(s => s.pauseAnimations());
    } else {
      if(PAN.raf){ cancelAnimationFrame(PAN.raf); PAN.raf = 0; PAN.last = 0; }
      if(PAN.ac) PAN.ac.abort();
      PAN.coast = false; PAN.x = PAN.target;
      paused.forEach(s => { if(s.isConnected && document.documentElement.getAttribute('data-motion') !== 'off') s.unpauseAnimations(); });
      paused = [];
    }
  }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  const close = () => { ov.classList.remove('open'); };
  ov.addEventListener('mousedown', e => { if(e.target === ov) close(); });
  ov.querySelector('#fwxClose').addEventListener('click', close);
  ov.querySelector('#fwxRefresh').addEventListener('click', () => refresh(true));
  ov.addEventListener('keydown', e => { if(e.key === 'Escape'){ e.stopPropagation(); close(); } });
  ov.querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', () => setWindUnit(b.dataset.u)));
  ov.addEventListener('click', e => {
    const a = e.target.closest('[data-url]');
    if(a){ e.preventDefault(); API.openUrl(a.dataset.url); }
    const s = e.target.closest('[data-setup]');
    if(s){ ov.classList.remove('open'); API.openSetup(); }
  });
  return ov;
}

export function openFieldWeather(id){
  focusId = id || null;
  PAN.x = PAN.target = 0; PAN.vel = 0; PAN.coast = false;
  const ov = ensurePanel();
  ov.classList.add('open');
  ov.tabIndex = -1; ov.focus();
  render();
  refresh(false);
  if(focusId) setTimeout(() => ov.querySelector(`.fwx-loc[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block:'start', behavior:'smooth' }), 80);
}

function render(){
  const ov = document.getElementById('fwxOv');
  if(!ov || !ov.classList.contains('open') || !API) return;
  const body = ov.querySelector('#fwxBody'), meta = ov.querySelector('#fwxMeta');
  const all = API.locations(), active = new Set(API.activeIds());
  const withPos = all.filter(l => isFinite(l.lat) && isFinite(l.lon));
  const noPos = all.filter(l => !(isFinite(l.lat) && isFinite(l.lon)));
  const u = windUnit();
  ov.querySelectorAll('[data-u]').forEach(b => b.classList.toggle('on', b.dataset.u === u));
  ov.querySelector('#fwxRefresh').disabled = busy || !withPos.length;
  ov.querySelector('#fwxRefresh').textContent = busy ? 'Updating…' : 'Refresh';
  meta.textContent = busy ? 'Updating from Open-Meteo…'
    : DATA ? `Updated ${hhmm(DATA.at)}${Date.now() - DATA.at > 3 * 3600000 ? ' — old, check the connection' : ''}${lastErr ? ' · ' + lastErr : ''}`
    : lastErr || (withPos.length ? 'Not loaded yet' : '');
  if(!withPos.length){
    body.innerHTML = `<div class="fwx-empty"><b>No positions yet.</b> Add the position of each platform / FPSO in
      Vessel Setup → Locations (e.g. <code>58 27.4N 000 15.2E</code> straight from the ECDIS), then the weather and sea state
      for that exact spot show up here, on the location cards and in the header.
      <div><button type="button" class="fwx-btn" data-setup="1">Open Vessel Setup</button></div></div>`;
    return;
  }
  const order = withPos.slice().sort((a, b) => ((b.id === focusId) - (a.id === focusId)) || (active.has(b.id) - active.has(a.id)));
  body.innerHTML = order.map(l => card(l, active.has(l.id), u)).join('') +
    (noPos.length ? `<div class="fwx-nopos">No position: ${noPos.map(l => esc(l.name)).join(', ')} — <a href="#" data-setup="1">add in Vessel Setup</a></div>` : '');
  wireTables(body);
}

/* ── Forecast table in the style of Windy "Compare forecasts" ────
   One white table per location on the dark panel: days split by thin
   lines, 3-hourly columns at 00 03 06 … local time, sky icon and air
   temperature, then wind, gusts and direction, then the sea. Every
   coloured row is ONE smooth gradient (stops at the column centres)
   instead of separate tiles, so weather windows read at a glance.
   Moving the mouse draws a red time slice through every table at once;
   the tables scroll together. */
const COLW = 46;
const skyIcon = x => {
  if(x.wc == null) return '';
  let day = x.day;
  if(day == null){ const h = new Date(x.t).getUTCHours(); day = h >= 7 && h < 17 ? 1 : 0; }
  return staticIconForCondition(wmoToCondition(x.wc, day === 1 || day === true).condition);
};
function band(cols, f){
  if(!cols.length) return 'transparent';
  const st = cols.map((x, i) => `${rgba(f(x))} ${Math.round(i * COLW + COLW / 2)}px`);
  return `linear-gradient(to right, ${st.join(', ')})`;
}
function columns(rows){
  const now = Date.now();
  return (rows || []).filter(x => x.t > now - 3 * 3600000 && new Date(x.t).getHours() % 3 === 0).slice(0, FC_DAYS * 8);
}
function table(rows, u){
  const cols = columns(rows);
  if(!cols.length) return '';
  const marine = cols.some(x => x.hs != null);
  const W = cols.length * COLW;
  const v = (val, f) => val == null || !isFinite(val) ? '' : f(val);
  /* `cf` = colour of the band under the cell: where it is (almost) transparent the text takes the table colour */
  const cellsOf = (f, cf) => cols.map(x => { const c = cf ? cf(x) : null; return `<span class="fw-c${cf && (!c || c[3] < .45) ? ' lo' : ''}">${f(x)}</span>`; }).join('');
  const dayKey = t => new Date(t).toDateString();
  const seps = [], days = [];
  cols.forEach((x, i) => {
    if(i === 0 || dayKey(x.t) !== dayKey(cols[i - 1].t)){
      if(i > 0) seps.push(i * COLW);
      days.push({ x: i * COLW, lbl: new Date(x.t).toLocaleDateString('en-GB', { weekday:'long', day:'numeric' }) });
    }
  });
  const nowX = Math.round(COLW / 2 + (Date.now() - cols[0].t) / (3 * 3600000) * COLW);
  const U = windLbl(u);
  const lab = (k, unit) => `<div class="fw-l">${k}${unit ? ` <small>${unit}</small>` : ''}</div>`;
  const rowsDef = [
    ['days', '', `<div class="fw-r fw-days">${days.map(d => `<span class="fw-day" style="left:${d.x}px">${esc(d.lbl)}</span>`).join('')}</div>`],
    ['hour', lab('Hours'), `<div class="fw-r fw-hour">${cellsOf(x => new Date(x.t).getHours())}</div>`],
    ['icon', '', `<div class="fw-r fw-icon">${cellsOf(x => { const s = skyIcon(x); return s ? `<img src="${s}" alt="">` : ''; })}</div>`],
    ['temp', lab('Temperature', '°C'), `<div class="fw-r fw-temp">${cellsOf(x => v(x.ta, t => Math.round(t) + '°'))}</div>`],
    ['wind', lab('Wind', U), `<div class="fw-r fw-band fw-wind" style="background:${band(cols, x => windRGBA(x.ws))}">${cellsOf(x => v(windVal(x.ws, u), Math.round), x => windRGBA(x.ws))}</div>`],
    ['gust', lab('Gusts', U), `<div class="fw-r fw-band fw-gust" style="background:${band(cols, x => windRGBA(x.wg))}">${cellsOf(x => v(windVal(x.wg, u), Math.round), x => windRGBA(x.wg))}</div>`],
    ['dir', lab('Direction'), `<div class="fw-r fw-dir">${cellsOf(x => `<span title="${compass(x.wd)} ${fmt0(x.wd)}°">${arrow(x.wd, 15)}</span>`)}</div>`],
  ];
  if(marine) rowsDef.push(
    ['hs', lab('Waves Hs', 'm'), `<div class="fw-r fw-band fw-hs" style="background:${band(cols, x => waveRGBA(x.hs))}">${cellsOf(x => v(x.hs, fmt1), x => waveRGBA(x.hs))}</div>`],
    ['hmax', lab('Hmax ≈', 'm'), `<div class="fw-r fw-band fw-hmax" style="background:${band(cols, x => waveRGBA(x.hs != null ? x.hs * HMAX_K : null))}">${cellsOf(x => v(x.hs != null ? x.hs * HMAX_K : null, fmt1), x => waveRGBA(x.hs != null ? x.hs * HMAX_K : null))}</div>`],
    ['swell', lab('Swell', 'm'), `<div class="fw-r fw-band fw-swell" style="background:${band(cols, x => waveRGBA(x.sw))}">${cellsOf(x => x.sw == null ? '' : `${x.sd != null ? arrow(x.sd, 11) : ''}${fmt1(x.sw)}`, x => waveRGBA(x.sw))}</div>`],
    ['period', lab('Swell period', 's'), `<div class="fw-r fw-band fw-period" style="background:${band(cols, x => periodRGBA(x.sp))}">${cellsOf(x => v(x.sp, Math.round), x => periodRGBA(x.sp))}</div>`],
  );
  return `<div class="fw-tbl">
    <div class="fw-legend">${rowsDef.map(r => `<div class="fw-lrow fw-lrow-${r[0]}">${r[1]}</div>`).join('')}</div>
    <div class="fw-scroll"><div class="fw-grid" style="width:${W}px">
      ${rowsDef.map(r => r[2]).join('')}
      ${seps.map(x => `<i class="fw-sep" style="left:${x}px"></i>`).join('')}
      ${nowX > 0 && nowX < W ? `<i class="fw-now" style="left:${nowX}px"></i>` : ''}
      <i class="fw-slice"></i>
    </div><div class="fw-pan" hidden><i class="fw-pan-th"></i></div></div>
  </div>`;
}
function card(l, isActive, u){
  const rows = DATA && DATA.loc && DATA.loc[l.id];
  const r = nowRow(l.id);
  const U = windLbl(u);
  const links = `<button type="button" class="fwx-link" data-url="${esc(windyUrl(l.lat, l.lon, false))}">Windy</button>
    <button type="button" class="fwx-link" data-url="${esc(windyUrl(l.lat, l.lon, true))}">Windy · waves</button>`;
  const pill = (val, c, unit) => `<b class="fw-pill" style="background:${c.bg};color:${c.fg}">${val}${unit ? `<small>${unit}</small>` : ''}</b>`;
  const now = r ? `<div class="fw-nowline"><span class="fw-nowk">Now</span>
      ${pill(fmt0(windVal(r.ws, u)), windColor(r.ws), U)}<span class="fw-nowt">gust</span>${pill(fmt0(windVal(r.wg, u)), windColor(r.wg))}
      <span class="fw-nowt fw-nowdir">${arrow(r.wd, 14)} ${compass(r.wd)} ${fmt0(r.wd)}°</span>
      ${r.hs != null ? `<span class="fw-nowt">Hs</span>${pill(fmt1(r.hs), waveColor(r.hs), 'm')}<span class="fw-nowt">Hmax ≈</span>${pill(fmt1(r.hs * HMAX_K), waveColor(r.hs * HMAX_K), 'm')}` : ''}
      ${r.sw != null ? `<span class="fw-nowt">swell <b>${fmt1(r.sw)} m · ${fmt0(r.sp)} s</b>${r.sd != null ? ` from ${compass(r.sd)}` : ''}</span>` : ''}
      ${r.ww != null ? `<span class="fw-nowt">wind sea <b>${fmt1(r.ww)} m</b></span>` : ''}
      <span class="fw-nowt">air <b>${fmt0(r.ta)}°C</b> · vis <b>${r.vis != null ? (r.vis >= 10000 ? '10+ km' : (r.vis / 1000).toFixed(1) + ' km') : '—'}</b></span>
    </div>` : '';
  const head = `<div class="fwx-loc-head"><span class="fwx-dot" style="background:${esc(l.c || '#9aa0a8')}"></span>
    <span class="fwx-name">${esc(l.name)}</span>${isActive ? '<span class="fwx-act">on this trip</span>' : ''}
    <span class="fwx-pos">${esc(formatLatLon(l.lat, l.lon))}</span><span class="fwx-sp"></span>${links}</div>`;
  const body = r ? `<div class="fw-card">${table(rows, u)}</div>`
    : `<div class="fw-card fw-card-wait">${busy ? 'Loading…' : 'No data yet — press Refresh'}</div>`;
  return `<section class="fwx-loc${l.id === focusId ? ' focus' : ''}" data-id="${esc(l.id)}">${head}${now}${body}</section>`;
}
/* v3.26.2 — the tables pan together on the compositor.
   Native scrollers were kept in step from the scroll event, so every
   table but the one under the mouse trailed a frame behind and the whole
   panel shuddered. Now there is ONE horizontal position for all tables:
   each grid is moved with translate3d in the same animation frame, wheel
   and trackpad input glide to their target, a drag pans 1:1 and coasts
   on release, and a thin shared bar under each table shows and moves the
   position. The red time slice follows the mouse while the tables move. */
const PAN = { x: 0, target: 0, raf: 0, last: 0, vel: 0, coast: false, mouseX: null, hoverGrid: null };
const motionOff = () => document.documentElement.getAttribute('data-motion') === 'off';
function wireTables(body){
  /* a re-render (refresh, unit switch) replaces the tables: drop the old
     frame loop and size watcher, keep the position */
  if(PAN.raf){ cancelAnimationFrame(PAN.raf); PAN.raf = 0; PAN.last = 0; }
  if(PAN.ro){ PAN.ro.disconnect(); PAN.ro = null; }
  if(PAN.io){ PAN.io.disconnect(); PAN.io = null; }
  if(PAN.ac) PAN.ac.abort();                 /* drops a drag in progress with the old tables */
  const ac = PAN.ac = new AbortController(), sig = { signal: ac.signal };
  PAN.coast = false; PAN.mouseX = null; PAN.hoverGrid = null;
  body.classList.remove('fw-panning', 'fw-moving');
  const tbls = [...body.querySelectorAll('.fw-tbl')].map(t => {
    const scroll = t.querySelector('.fw-scroll'), grid = t.querySelector('.fw-grid');
    const hour = grid.querySelector('.fw-hour');
    return { scroll, grid, slice: grid.querySelector('.fw-slice'), cells: hour ? [...hour.children] : [], on: -1,
             bar: t.querySelector('.fw-pan'), thumb: t.querySelector('.fw-pan-th') };
  });
  if(!tbls.length) return;
  /* sizes are read once (and on resize), never inside the frame loop —
     reading layout after writing transforms would force a reflow per table */
  let M = 0;
  const measure = () => {
    tbls.forEach(t => { t.vw = t.scroll.clientWidth; t.gw = t.grid.offsetWidth; t.max = Math.max(0, t.gw - t.vw); t.bw = t.bar ? t.bar.parentNode.clientWidth - 16 : 0; });
    M = Math.max(0, ...tbls.map(t => t.max));
  };
  measure();
  const maxX = () => M;
  const clamp = v => Math.min(maxX(), Math.max(0, v));
  PAN.target = clamp(PAN.target); PAN.x = clamp(PAN.x);

  const show = i => tbls.forEach(t => {
    const n = t.cells.length, idx = (i == null || i >= n) ? -1 : i;
    if(idx === t.on) return;
    if(t.on >= 0 && t.cells[t.on]) t.cells[t.on].classList.remove('on');
    t.on = idx;
    if(idx < 0){ t.slice.classList.remove('vis'); return; }
    t.cells[idx].classList.add('on');
    t.slice.style.transform = `translate3d(${idx * COLW + COLW / 2}px,0,0)`;
    t.slice.classList.add('vis');
  });
  const sliceFromMouse = () => {
    if(PAN.mouseX == null || !PAN.hoverGrid) return;
    /* grid left = its scroll box left (cached per hover) minus the pan */
    const t = tbls.find(o => o.grid === PAN.hoverGrid); if(!t) return;
    if(t.left == null) t.left = t.scroll.getBoundingClientRect().left;
    const x = PAN.mouseX - (t.left - Math.min(PAN.x, t.max));
    show(Math.max(0, Math.floor(x / COLW)));
  };
  const paint = () => {
    const m = M;
    tbls.forEach(t => {
      if(t.vis === false) return;          /* off-screen tables catch up when they scroll into view */
      t.grid.style.transform = `translate3d(${-Math.min(PAN.x, t.max)}px,0,0)`;
      if(t.bar){
        const show = t.max > 1;
        if(t.bar.hidden === show) t.bar.hidden = !show;
        if(show){
          const tw = Math.max(36, t.vw / t.gw * t.bw), room = t.bw - tw;
          if(t.tw !== tw){ t.tw = tw; t.thumb.style.width = tw + 'px'; }
          t.thumb.style.transform = `translate3d(${m ? PAN.x / m * room : 0}px,0,0)`;
        }
      }
    });
  };
  const tick = now => {
    const dt = Math.min(48, now - (PAN.last || now)); PAN.last = now;
    if(PAN.coast){
      PAN.target = clamp(PAN.target + PAN.vel * dt);
      PAN.vel *= Math.pow(0.92, dt / 16.67);
      if(Math.abs(PAN.vel) < 0.02 || PAN.target === 0 || PAN.target === maxX()) PAN.coast = false;
    }
    const k = motionOff() ? 1 : 1 - Math.pow(1 - 0.2, dt / 16.67);
    PAN.x += (PAN.target - PAN.x) * k;
    if(Math.abs(PAN.target - PAN.x) < 0.4) PAN.x = PAN.target;
    paint(); sliceFromMouse();
    if(PAN.x !== PAN.target || PAN.coast){ PAN.raf = requestAnimationFrame(tick); body.classList.add('fw-moving'); }
    else { PAN.raf = 0; PAN.last = 0; body.classList.remove('fw-moving'); }
  };
  const kick = () => { if(!PAN.raf) PAN.raf = requestAnimationFrame(tick); };
  const panTo = (v, instant) => { PAN.coast = false; PAN.target = clamp(v); if(instant) PAN.x = PAN.target; kick(); };

  tbls.forEach(t => {
    /* wheel: sideways (trackpad / tilt wheel) or Shift + wheel pans; a plain
       vertical wheel keeps scrolling the panel up and down */
    t.scroll.addEventListener('wheel', e => {
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? t.scroll.clientWidth : 1;
      let dx = e.deltaX * unit;
      if(e.shiftKey && !dx) dx = e.deltaY * unit;
      if(!dx || Math.abs(dx) < Math.abs(e.deltaY * unit) && !e.shiftKey) return;
      const m = maxX();
      if((dx < 0 && PAN.target <= 0) || (dx > 0 && PAN.target >= m)) return;
      e.preventDefault();
      panTo(PAN.target + dx);
    }, { passive: false, signal: ac.signal });
    /* drag to pan (as on Windy), coasting on release */
    t.grid.addEventListener('pointerdown', e => {
      if(e.button !== 0 || !e.isPrimary || e.target.closest('a,button,input,select')) return;
      const x0 = e.clientX, y0 = e.clientY, p0 = PAN.target; let lx = e.clientX, lt = performance.now(), moved = false;
      PAN.coast = false; PAN.vel = 0;
      const mv = ev => {
        if(ev.pointerId !== e.pointerId) return;
        if(!moved && (Math.abs(ev.clientX - x0) < 4 || Math.abs(ev.clientX - x0) < Math.abs(ev.clientY - y0))) return;
        if(!moved){ moved = true; t.grid.setPointerCapture?.(e.pointerId); body.classList.add('fw-panning'); }
        const nt = performance.now(), d = nt - lt;
        if(d > 0) PAN.vel = PAN.vel * 0.6 + (-(ev.clientX - lx) / d) * 0.4;
        lx = ev.clientX; lt = nt;
        panTo(p0 - (ev.clientX - x0), true);
      };
      const g = new AbortController(), gs = { signal: g.signal };
      ac.signal.addEventListener('abort', () => g.abort(), gs);
      const up = ev => {
        g.abort();
        body.classList.remove('fw-panning');
        if(ev && ev.type === 'pointerup' && moved && !motionOff() && performance.now() - lt < 90 && Math.abs(PAN.vel) > 0.08){
          PAN.coast = true; PAN.vel = Math.max(-4, Math.min(4, PAN.vel)); kick(); }
      };
      addEventListener('pointermove', mv, gs); addEventListener('pointerup', up, gs); addEventListener('pointercancel', up, gs);
      t.grid.addEventListener('lostpointercapture', up, gs); addEventListener('blur', up, gs);
    }, sig);
    t.grid.addEventListener('mousemove', e => { PAN.mouseX = e.clientX; PAN.hoverGrid = t.grid; sliceFromMouse(); }, sig);
    t.grid.addEventListener('mouseenter', () => { t.left = null; }, sig);
    t.grid.addEventListener('mouseleave', () => { PAN.mouseX = null; PAN.hoverGrid = null; show(null); }, sig);
    /* the bar: drag the thumb or click the track to jump there */
    t.bar?.addEventListener('pointerdown', e => {
      if(e.button !== 0) return;
      e.preventDefault();
      const r = t.bar.getBoundingClientRect(), tw = t.thumb.offsetWidth, room = Math.max(1, r.width - tw);
      t.bw = r.width;
      const th = t.thumb.getBoundingClientRect();
      const grab = e.target === t.thumb ? e.clientX - th.left : tw / 2;
      const at = cx => (cx - r.left - grab) / room * maxX();
      if(e.target !== t.thumb) panTo(at(e.clientX));
      t.bar.setPointerCapture?.(e.pointerId);
      const mv = ev => panTo(at(ev.clientX), true);
      const up = () => { t.bar.removeEventListener('pointermove', mv); t.bar.removeEventListener('pointerup', up); t.bar.removeEventListener('pointercancel', up); };
      t.bar.addEventListener('pointermove', mv); t.bar.addEventListener('pointerup', up); t.bar.addEventListener('pointercancel', up);
      t.bar.addEventListener('lostpointercapture', up);
    }, sig);
  });
  /* ← → also pan while the panel has focus */
  const ov = body.closest('.fwx-ov');
  if(ov && !ov._fwKeys){
    ov._fwKeys = true;
    ov.addEventListener('keydown', e => {
      if(e.target.closest('input,select,textarea,[contenteditable]') || e.altKey || e.ctrlKey || e.metaKey) return;
      if(!PAN.panTo) return;
      if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){ e.preventDefault(); PAN.panTo(PAN.target + (e.key === 'ArrowRight' ? 1 : -1) * COLW * 4); }
      else if(e.key === 'Home'){ e.preventDefault(); PAN.panTo(0); }
      else if(e.key === 'End'){ e.preventDefault(); PAN.panTo(1e9); }
    });
  }
  PAN.panTo = panTo;
  PAN.repaint = () => { measure(); tbls.forEach(t => { t.left = null; t.tw = null; }); PAN.target = clamp(PAN.target); PAN.x = PAN.target; paint(); };
  /* window resize, the panel's own scrollbar appearing, late fonts — any
     change of the visible width re-measures */
  if(typeof ResizeObserver === 'function'){
    let first = true;
    PAN.ro = new ResizeObserver(() => { if(first){ first = false; return; } PAN.repaint(); });
    PAN.ro.observe(tbls[0].scroll);
  }
  /* only tables in (or near) view keep a GPU layer and follow every frame */
  const root = body.closest('.fwx-body') || body;
  if(typeof IntersectionObserver === 'function'){
    PAN.io = new IntersectionObserver(ents => ents.forEach(en => {
      const t = tbls.find(o => o.scroll === en.target); if(!t) return;
      t.vis = en.isIntersecting;
      t.grid.style.transform = t.vis ? `translate3d(${-Math.min(PAN.x, t.max)}px,0,0)` : `translateX(${-Math.min(PAN.x, t.max)}px)`;
      t.grid.classList.toggle('fw-live', t.vis);
    }), { root, rootMargin: '240px 0px' });
    tbls.forEach(t => PAN.io.observe(t.scroll));
  }
  paint();
}

/* test hooks */
export const _fwx = { parseLatLon, formatLatLon, state: () => DATA, set: d => { DATA = d; }, render, windColor, waveColor };
