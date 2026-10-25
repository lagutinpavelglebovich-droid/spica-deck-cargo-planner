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

const URL_FC = 'https://api.open-meteo.com/v1/forecast';
const URL_MAR = 'https://marine-api.open-meteo.com/v1/marine';
const LS_CACHE = 'spicaTide_fieldWx';
const LS_UNIT = 'spicaTide_fieldWxUnit';
const MAX_AGE_MS = 30 * 60 * 1000;
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

/* ── Colour scales: Windy's own default gradients ────────────────
   Copied from windy.com (client v51.3.2, colors module `wind` and
   `waves`, read on 2026-10-25). Wind and gusts use the wind gradient
   by speed in m/s; Hs, Hmax and swell use the waves gradient by
   height in m — exactly as the Windy overlays and forecast tables do. */
const WIND_STOPS = [[0,[98,113,183]],[1,[57,97,159]],[3,[74,148,169]],[5,[77,141,123]],[7,[83,165,83]],[9,[53,159,53]],
  [11,[167,157,81]],[13,[159,127,58]],[15,[161,108,92]],[17,[129,58,78]],[19,[175,80,136]],[21,[117,74,147]],
  [24,[109,97,163]],[27,[68,105,141]],[29,[92,144,152]],[36,[125,68,165]],[46,[231,215,215]],[51,[219,212,135]],
  [77,[205,202,112]],[104,[128,128,128]]];
const WAVE_STOPS = [[0,[159,185,191]],[0.5,[48,157,185]],[1,[48,98,141]],[1.5,[56,104,191]],[2,[57,60,142]],[2.5,[187,90,191]],
  [3,[154,48,151]],[4,[133,48,48]],[5,[191,51,95]],[7,[191,103,87]],[10,[191,191,191]],[12,[154,127,155]]];
function ramp(stops, v){
  if(v == null || !isFinite(v)) return null;
  if(v <= stops[0][0]) return stops[0][1];
  for(let i = 1; i < stops.length; i++){
    if(v <= stops[i][0]){
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
    }
  }
  return stops[stops.length - 1][1];
}
const rgb = c => c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent';
const ink = c => !c ? 'inherit' : (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) > 170 ? '#16181c' : '#fff';
/* Colour (bg + text) for a wind speed in knots / a wave height in m */
export function windColor(kn){ const c = ramp(WIND_STOPS, kn == null ? null : kn * KN2MS); return { bg: rgb(c), fg: ink(c) }; }
export function waveColor(m){ const c = ramp(WAVE_STOPS, m); return { bg: rgb(c), fg: ink(c) }; }
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
  if(!force && DATA && DATA.key === key && Date.now() - DATA.at < MAX_AGE_MS) return DATA;
  busy = true; render();
  try{
    const lat = locs.map(l => l.lat.toFixed(4)).join(','), lon = locs.map(l => l.lon.toFixed(4)).join(',');
    const common = `latitude=${lat}&longitude=${lon}&timezone=UTC&timeformat=unixtime&forecast_days=3`;
    const [fc, mar] = await Promise.all([
      getJson(`${URL_FC}?${common}&wind_speed_unit=kn&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility`),
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
          ta: f.temperature_2m[k], pr: f.precipitation[k], wc: f.weather_code[k], vis: pick(f.visibility, k),
          hs: pick(m && m.wave_height, mk), hd: pick(m && m.wave_direction, mk), tp: pick(m && m.wave_period, mk),
          ww: pick(m && m.wind_wave_height, mk),
          sw: pick(m && m.swell_wave_height, mk), sd: pick(m && m.swell_wave_direction, mk), sp: pick(m && m.swell_wave_period, mk) };
      });
    });
    DATA = { at: Date.now(), key, loc: out, marine: !!mar };
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
  setTimeout(() => { if(located().length) refresh(false); }, 4000);
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
      <div class="fwx-foot">Forecast: Open-Meteo (ECMWF, DWD, Met Office and other national models) · Hmax ≈ 1.86 × Hs, the highest of about 1000 waves (≈ 3 h) · colours: Windy's own wind and waves scales · times are this computer's local time · only the coordinates of the locations are sent</div>
    </div>`;
  document.body.appendChild(ov);
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
}

const cell = (txt, c, cls) => `<div class="fwx-c${cls ? ' ' + cls : ''}" style="background:${c.bg};color:${c.fg}">${txt}</div>`;
function card(l, isActive, u){
  const rows = DATA && DATA.loc && DATA.loc[l.id];
  const r = nowRow(l.id);
  const U = windLbl(u);
  const links = `<button type="button" class="fwx-link" data-url="${esc(windyUrl(l.lat, l.lon, false))}">Windy</button>
    <button type="button" class="fwx-link" data-url="${esc(windyUrl(l.lat, l.lon, true))}">Windy · waves</button>`;
  const head = `<div class="fwx-loc-head"><span class="fwx-dot" style="background:${esc(l.c || '#9aa0a8')}"></span>
    <span class="fwx-name">${esc(l.name)}</span>${isActive ? '<span class="fwx-act">on this trip</span>' : ''}
    <span class="fwx-pos">${esc(formatLatLon(l.lat, l.lon))}</span><span class="fwx-sp"></span>${links}</div>`;
  if(!r) return `<section class="fwx-loc${l.id === focusId ? ' focus' : ''}" data-id="${esc(l.id)}">${head}<div class="fwx-wait">${busy ? 'Loading…' : 'No data yet — press Refresh'}</div></section>`;
  const wc = windColor(r.ws), gc = windColor(r.wg), hc = waveColor(r.hs), mc = waveColor(r.hs != null ? r.hs * HMAX_K : null);
  const now = `<div class="fwx-now">
      <div class="fwx-tile"><span class="fwx-k">Wind</span><span class="fwx-v" style="background:${wc.bg};color:${wc.fg}">${fmt0(windVal(r.ws, u))} <small>${U}</small></span>
        <span class="fwx-k">Gusts</span><span class="fwx-v fwx-v2" style="background:${gc.bg};color:${gc.fg}">${fmt0(windVal(r.wg, u))} <small>${U}</small></span></div>
      <div class="fwx-tile fwx-dir"><span class="fwx-k">Direction</span>${arrow(r.wd, 30)}<span class="fwx-dirtx">${compass(r.wd)} · ${fmt0(r.wd)}°</span></div>
      <div class="fwx-tile"><span class="fwx-k">Hs</span><span class="fwx-v" style="background:${hc.bg};color:${hc.fg}">${fmt1(r.hs)} <small>m</small></span>
        <span class="fwx-k">Hmax ≈</span><span class="fwx-v fwx-v2" style="background:${mc.bg};color:${mc.fg}">${r.hs != null ? fmt1(r.hs * HMAX_K) : '—'} <small>m</small></span></div>
      <div class="fwx-side">
        <div class="fwx-kv"><span>Swell</span><b>${r.sw != null ? fmt1(r.sw) + ' m · ' + fmt0(r.sp) + ' s' : '—'}</b>${r.sd != null ? `<i>${arrow(r.sd, 12)} from ${compass(r.sd)}</i>` : ''}</div>
        <div class="fwx-kv"><span>Wind sea</span><b>${r.ww != null ? fmt1(r.ww) + ' m' : '—'}</b><i>${r.tp != null ? 'period ' + fmt0(r.tp) + ' s' : ''}</i></div>
        <div class="fwx-kv"><span>Air</span><b>${fmt0(r.ta)}°C</b><span>Visibility</span><b>${r.vis != null ? (r.vis >= 10000 ? '10+ km' : (r.vis / 1000).toFixed(1) + ' km') : '—'}</b></div>
      </div>
    </div>`;
  /* next 48 h every 3 h — Windy-style rows */
  const t0 = Date.now() - 60 * 60000;
  const steps = (rows || []).filter(x => x.t >= t0).filter((x, k) => k % 3 === 0).slice(0, 17);
  let lastDay = '';
  const cols = steps.map(x => {
    const d = dayLbl(x.t), nd = d !== lastDay; lastDay = d;
    const hm = x.hs != null ? x.hs * HMAX_K : null;
    return `<div class="fwx-col${nd ? ' nd' : ''}">
      <div class="fwx-t">${nd ? `<span>${esc(d)}</span>` : '<span>&nbsp;</span>'}${hhmm(x.t)}</div>
      ${cell(fmt0(windVal(x.ws, u)), windColor(x.ws))}
      ${cell(fmt0(windVal(x.wg, u)), windColor(x.wg), 'fwx-g')}
      <div class="fwx-c fwx-d" title="${compass(x.wd)} ${fmt0(x.wd)}°">${arrow(x.wd, 16)}</div>
      ${cell(fmt1(x.hs), waveColor(x.hs), 'fwx-h')}
      ${cell(hm != null ? fmt1(hm) : '—', waveColor(hm), 'fwx-g')}
      ${x.sw != null ? cell(fmt1(x.sw) + '<small>&thinsp;' + fmt0(x.sp) + 's</small>', waveColor(x.sw), 'fwx-s') : '<div class="fwx-c fwx-s"></div>'}
    </div>`;
  }).join('');
  const keys = `<div class="fwx-tl-k"><div class="fwx-t">&nbsp;</div><div>Wind <small>${U}</small></div><div>Gusts <small>${U}</small></div><div>Direction</div>
    <div>Hs <small>m</small></div><div>Hmax <small>m</small></div><div>Swell <small>m · s</small></div></div>`;
  return `<section class="fwx-loc${l.id === focusId ? ' focus' : ''}" data-id="${esc(l.id)}">${head}${now}<div class="fwx-tl">${keys}<div class="fwx-tl-cols">${cols}</div></div></section>`;
}

/* test hooks */
export const _fwx = { parseLatLon, formatLatLon, state: () => DATA, set: d => { DATA = d; }, render, windColor, waveColor };
