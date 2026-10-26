/* ══════════════════════════════════════════════════════════════════════
   v3.14 — UNIVERSAL MANIFEST / BACKLOAD READER
   Reads the many shapes platforms send (Excel with any layout, Word
   tables, text PDFs and scanned PDFs) into plain table sections:

     { title, sheetName, manifestNo, platformHint, direction:'BL'|'L'|null,
       rows:[{ ccu, desc, contents, pkg, wt, dg, un, qty, dest, landing }] }

   Everything runs on this computer: Excel through SheetJS, Word through
   a zip reader (fflate), PDF text through pdf.js, scanned PDF through
   Tesseract (WASM + English data shipped with the app under /ocr/).
   No network. The app turns rows into Imported-queue items.
══════════════════════════════════════════════════════════════════════ */
import * as XLSX from 'xlsx';
import { unzipSync, strFromU8 } from 'fflate';
/* pdf.js legacy build: polyfilled for older WebView2 / WKWebView engines */
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/* ── Header vocabulary: normalised header text → role ──────────────── */
const ROLE_WORDS = {
  ccu:      ['ccu','ccu i/d #','ccu i/d','ccu id','ccu no','ccu number','ccu / lifts','ccu/lifts','unit id','unit no','unit number','container','container no','container id','number','id','unit','asset','asset no','asset id'],
  desc:     ['description','item description','type','desc','cargo description'],
  contents: ['contents','content','cargo','remarks'],
  pkg:      ['package','packaging','package type'],
  wt:       ['wgt','weight','wt','weight tonne','weight tonnes','weight (t)','weight (te)','weight t','est wt','est wt (t)','gross weight','gross wt','tonnes','te','wt (t)','gross'],
  dg:       ['dg','dg class','d.g. class','d.g class','dg classes','class','imdg','imdg class','hazard','hazard class',"dg's",'dgs','d.g.'],
  un:       ['un no','un','un number','un no.'],
  qty:      ['qty','quantity','qty.'],
  dest:     ['destination','final destination','vendor','company','send to','consignee','supplier'],
  landing:  ['location','landing area','comments / landing area','landing','comments'],
  idx:      ['#','lift','no','no.','item no','line','item','items'],
};
const HEADER_LOOKUP = (() => {
  const m = new Map();
  Object.entries(ROLE_WORDS).forEach(([role, words]) => words.forEach(w => m.set(w, role)));
  return m;
})();
const normH = v => String(v == null ? '' : v).replace(/ /g, ' ').replace(/[\r\n]+/g, ' ')
  .replace(/\s+/g, ' ').trim().toLowerCase().replace(/[:\s]+$/, '');
const cellStr = v => {
  if(v == null) return '';
  if(typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
  return String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
};

/* Role of one header cell ('' when it is not a known header word). */
function headerRole(cell){
  const h = normH(cell);
  if(!h || h.length > 40) return '';
  if(HEADER_LOOKUP.has(h)) return HEADER_LOOKUP.get(h);
  const h2 = h.replace(/[^a-z0-9/# ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if(HEADER_LOOKUP.has(h2)) return HEADER_LOOKUP.get(h2);
  if(/^ccu\b/.test(h2) || /\bunit (id|no)\b/.test(h2)) return 'ccu';
  if(/\bdescription\b/.test(h2)) return 'desc';
  if(/^(gross )?(weight|wgt|wt)\b/.test(h2)) return 'wt';
  if(/^d\.?g\.?\b/.test(h) || /\bimdg\b/.test(h2) || /\bhazard\b/.test(h2)) return 'dg';
  if(/\bdestination\b/.test(h2)) return 'dest';
  return '';
}
/* A row is a header when ≥2 distinct roles appear and one is ccu or desc. */
function headerMap(row){
  const map = {}, used = new Set();
  row.forEach((c, i) => {
    const r = headerRole(c);
    if(r && !(r in map)){ map[r] = i; used.add(r); }
  });
  const roles = Object.keys(map).filter(r => r !== 'idx');
  return (roles.length >= 2 && (map.ccu != null || map.desc != null)) ? map : null;
}

/* ── Cell value classifiers (for header-less tables) ───────────────── */
const RE_CCU = /^(?=.*\d)[A-Z0-9]{1,6}(?:[\s\-/.][A-Z0-9]{1,6}){0,3}$/i;
function looksCCU(s){
  s = String(s || '').trim();
  if(s.length < 3 || s.length > 18) return false;
  if(/^\d{1,2}$/.test(s)) return false;                       /* item numbers */
  if(/^\d+\.\d+$/.test(s)) return false;                      /* weights */
  return RE_CCU.test(s);
}
const looksWeight = s => /^\d{1,2}([.,]\d{1,3})?$/.test(String(s || '').trim()) && parseFloat(String(s).replace(',', '.')) <= 40;
const looksText = s => /[a-z]{3,}/i.test(String(s || '')) && !looksCCU(s);

/* Guess roles for a table without a usable header row. */
function inferColumns(rows, hint){
  let width = 0; for(const r of rows){ if(r && r.length > width) width = r.length; }   /* no spread: 200k rows overflow the call stack */
  const stat = Array.from({ length: width }, () => ({ n:0, ccu:0, wt:0, txt:0, idx:0, dec:0, vals:new Set() }));
  rows.forEach(r => r.forEach((c, i) => {
    const s = cellStr(c); if(!s) return;
    const st = stat[i]; st.n++;
    if(looksCCU(s)) st.ccu++;
    if(looksWeight(s)){ st.wt++; st.vals.add(s); if(/[.,]/.test(s)) st.dec++; }
    if(looksText(s)) st.txt++;
    if(/^\d{1,3}$/.test(s)) st.idx++;
  }));
  const map = Object.assign({}, hint || {});
  const free = i => !Object.values(map).includes(i);
  const best = (key, min) => {
    let bi = -1, bv = 0;
    stat.forEach((st, i) => { if(!free(i) || st.n < 2) return; const v = st[key] / st.n; if(v > bv){ bv = v; bi = i; } });
    return bv >= min ? bi : -1;
  };
  /* the running item number column is not a CCU */
  stat.forEach((st, i) => { if(st.n >= 2 && st.idx / st.n > 0.9 && free(i) && map.idx == null) map.idx = i; });
  if(map.ccu == null){ const i = best('ccu', 0.6); if(i >= 0) map.ccu = i; }
  /* weights vary and usually carry decimals; a column of "1"s is a quantity */
  stat.forEach(st => { if(st.vals.size <= 1 && !st.dec) st.wt = 0; });
  if(map.wt == null){ const i = best('wt', 0.6); if(i >= 0) map.wt = i; }
  const textCols = stat.map((st, i) => ({ i, v: st.n ? st.txt / st.n : 0, n: st.n }))
    .filter(o => free(o.i) && o.n >= 2 && o.v >= 0.6).map(o => o.i);
  if(map.desc == null && textCols.length) map.desc = textCols.shift();
  if(map.dest == null && textCols.length) map.dest = textCols.shift();
  if(map.contents == null && textCols.length) map.contents = textCols.shift();
  return (map.ccu != null) ? map : null;
}

/* ── Rows → records ─────────────────────────────────────────────────── */
function pick(row, map, role){ return map[role] != null ? cellStr(row[map[role]]) : ''; }
/* v3.37 — locale-aware numbers. Manifests come from many offices:
   "1,234.5", "1.234,5", "12 500", "2,5", "2,350". preferThousands decides
   the one ambiguous shape (a single separator followed by exactly three
   digits): thousands in a kg column, decimals in a tonnes column. */
export function parseNumberLocale(raw, preferThousands){
  let s = String(raw == null ? '' : raw).trim().replace(/[\u00a0\u2009\u202f' ]/g, '');
  s = s.replace(/[^\d.,+-]/g, '');
  if(!s || !/\d/.test(s) || /[+-]/.test(s.slice(1))) return NaN;
  const hasC = s.includes(','), hasD = s.includes('.');
  const grouped = sep => new RegExp('^[+-]?\\d{1,3}(\\' + sep + '\\d{3})+$').test(s);
  if(hasC && hasD){
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if(hasC || hasD){
    const sep = hasC ? ',' : '.';
    const count = s.split(sep).length - 1;
    if(count > 1) s = grouped(sep) ? s.split(sep).join('') : 'x';
    else if(grouped(sep) && preferThousands) s = s.replace(sep, '');
    else s = s.replace(sep, '.');
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}
/* Weight in tonnes. An explicit unit in the cell wins, then the column
   header; with no unit at all, values over unknownKgAbove are taken as kg
   (manifests without units are usually kg; no PSV deck lift weighs 60 t+).
   Negative or unreadable → 0 (shown as "no weight", never silently flipped). */
export function parseWeightTonnes(raw, headerText, unknownKgAbove = 60){
  const str = String(raw == null ? '' : raw).trim();
  if(!str) return 0;
  const unitTxt = str.replace(/[\d.,\s+-]/g, ' ');
  const cellKg = /kg/i.test(unitTxt);
  const cellT = !cellKg && /\b(t|te|tonnes?|tons?|mt)\b/i.test(unitTxt);
  const h = String(headerText || '');
  const hdrKg = /kg/i.test(h);
  const hdrT = !hdrKg && /(\(t\)|\bt\b|\btonnes?\b|\btons?\b|\bte\b|\bmt\b)/i.test(h);
  const kg = cellKg || (!cellT && hdrKg);
  const t = cellT || (!cellKg && hdrT);
  const v = parseNumberLocale(str, kg || (!t && unknownKgAbove != null));
  if(!Number.isFinite(v) || v < 0) return 0;
  if(kg) return Math.round(v / 100) / 10;
  if(t) return v;
  if(unknownKgAbove != null && v > unknownKgAbove) return Math.round(v / 100) / 10;
  return v;
}
function parseWeight(s, headerText){ return parseWeightTonnes(s, headerText, 60); }
const NA = /^(n\/?a|nil|none|tbc|tba|-+|—)$/i;
function rowToRecord(row, map, wtHeader){
  const r = {
    ccu: pick(row, map, 'ccu'), desc: pick(row, map, 'desc'), contents: pick(row, map, 'contents'),
    pkg: pick(row, map, 'pkg'), dg: pick(row, map, 'dg'), un: pick(row, map, 'un'),
    dest: pick(row, map, 'dest'), landing: pick(row, map, 'landing'),
    qty: parseInt(pick(row, map, 'qty'), 10) || 1,
    wt: parseWeight(pick(row, map, 'wt'), wtHeader),
  };
  ['ccu','dg','un','contents','pkg'].forEach(k => { if(NA.test(r[k])) r[k] = ''; });
  if(!r.ccu && !r.desc) return null;
  if(r.ccu && headerRole(r.ccu) && headerRole(r.desc)) return null;   /* repeated header */
  /* a lone label row (e.g. "TOTAL") is not cargo */
  if(!r.ccu && /^(total|totals|sub ?total|signature|signed|date)\b/i.test(r.desc)) return null;
  return r;
}
/* Title-like row: a single long text cell (section heading). */
function titleOf(row){
  const vals = row.map(cellStr).filter(Boolean);
  if(vals.length === 1 && vals[0].length >= 8 && /[a-z]{3}/i.test(vals[0])) return vals[0];
  return '';
}

/* Split a grid into sections (title / header changes) and read rows. */
function readGrid(grid, sheetName, docMeta){
  const sections = [];
  let cur = null, map = null, wtHeader = '', title = '';
  const meta = Object.assign({}, docMeta);
  const flush = () => { if(cur && cur.rows.length) sections.push(cur); cur = null; };
  const start = () => { cur = { title, sheetName, rows: [], meta: Object.assign({}, meta) }; };
  /* metadata pairs anywhere above the table: "Platform: X", "MANIFEST NO: Y" */
  const scanMeta = row => {
    row.forEach((c, i) => {
      const h = normH(c);
      const next = () => { for(let k = i + 1; k < row.length; k++){ const v = cellStr(row[k]); if(v) return v; } return ''; };
      if(/^platform$|^installation$|^location$|^from platform$/.test(h)) { const v = next(); if(v) meta.platform = v; }
      if(/^vessel$/.test(h)) { const v = next(); if(v) meta.vessel = v; }
      const m = String(c || '').match(/manifest\s*(?:no\.?|number)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
      if(m) meta.manifestNo = m[1];
    });
  };
  const pending = [];        /* rows seen before any header (for inference) */
  grid.forEach(row => {
    if(!row || !row.some(c => cellStr(c))) return;
    const t = titleOf(row);
    if(t){ scanMeta(row); title = t; flush(); map = null; return; }
    const hm = headerMap(row);
    if(hm){ flush(); map = hm; wtHeader = map.wt != null ? cellStr(row[map.wt]) : ''; start(); return; }
    if(!map){ scanMeta(row); pending.push(row); return; }
    const rec = rowToRecord(row, map, wtHeader);
    if(rec) cur.rows.push(rec);
  });
  flush();
  /* No header anywhere: infer columns from the content of the rows. */
  if(!sections.length && pending.length >= 2){
    /* a partial header (one known word, e.g. "DG's") still pins that column */
    const hint = {};
    pending.slice(0, 3).forEach(r => r.forEach((c, i) => { const ro = headerRole(c); if(ro && hint[ro] == null) hint[ro] = i; }));
    const body = pending.filter(r => !r.some(c => headerRole(c)));
    const imap = inferColumns(body, hint);
    if(imap){
      const sec = { title, sheetName, rows: [], meta: Object.assign({}, meta), inferred: true };
      body.forEach(r => { const rec = rowToRecord(r, imap, ''); if(rec && rec.ccu) sec.rows.push(rec); });
      if(sec.rows.length) sections.push(sec);
    }
  }
  return sections;
}

/* ── Format readers → grids ────────────────────────────────────────── */
function gridsFromWorkbook(buf){
  const wb = XLSX.read(buf, { type:'array' });
  return wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:'', raw:true, blankrows:false }),
  }));
}

function gridsFromDocx(buf){
  const files = unzipSync(new Uint8Array(buf), { filter: f => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'];
  if(!xml) throw new Error('Not a Word document');
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const textOf = el => Array.from(el.getElementsByTagNameNS(W, 'p'))
    .map(p => Array.from(p.getElementsByTagNameNS(W, 't')).map(t => t.textContent).join(''))
    .filter(Boolean).join(' ');
  const grids = [];
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  let lastPara = '';
  Array.from(body ? body.childNodes : []).forEach(node => {
    if(node.localName === 'p'){
      const t = Array.from(node.getElementsByTagNameNS(W, 't')).map(x => x.textContent).join('').trim();
      if(t) lastPara = t;
    }
    if(node.localName !== 'tbl') return;
    const rows = [];
    Array.from(node.getElementsByTagNameNS(W, 'tr')).forEach(tr => {
      if(tr.parentNode !== node) return;                      /* skip nested tables' rows */
      const row = [];
      Array.from(tr.childNodes).filter(n => n.localName === 'tc').forEach(tc => {
        row.push(textOf(tc));
        const gs = tc.getElementsByTagNameNS(W, 'gridSpan')[0];
        const span = gs ? parseInt(gs.getAttributeNS(W, 'val') || gs.getAttribute('w:val'), 10) || 1 : 1;
        for(let k = 1; k < span; k++) row.push('');
      });
      rows.push(row);
    });
    grids.push({ name: lastPara || 'Table ' + (grids.length + 1), rows });
  });
  return grids;
}

/* Words with boxes → rows of cells (shared by PDF text and OCR). */
function gridFromWords(words, pageW){
  if(!words.length) return [];
  const hs = words.map(w => w.h).sort((a, b) => a - b);
  const mh = hs[Math.floor(hs.length / 2)] || 10;
  words.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const lines = [];
  words.forEach(w => {
    const cy = w.y + w.h / 2, L = lines[lines.length - 1];
    if(L && Math.abs(cy - L.cy) < mh * 0.6){ L.words.push(w); L.cy = (L.cy * (L.words.length - 1) + cy) / L.words.length; }
    else lines.push({ cy, words: [w] });
  });
  /* words → cells: join neighbours closer than ~1.2 character heights */
  const lineCells = lines.map(L => {
    const ws = L.words.sort((a, b) => a.x - b.x), cells = [];
    ws.forEach(w => {
      const c = cells[cells.length - 1];
      if(c && w.x - (c.x1) < mh * 1.1){ c.t += ' ' + w.t; c.x1 = w.x + w.w; }
      else cells.push({ t: w.t, x0: w.x, x1: w.x + w.w });
    });
    return cells;
  });
  /* column anchors: cluster cell left edges and centres across lines */
  const xs = [];
  lineCells.forEach(cs => cs.forEach(c => xs.push((c.x0 + c.x1) / 2)));
  xs.sort((a, b) => a - b);
  const tol = Math.max(mh * 2.2, pageW * 0.025), cols = [];
  xs.forEach(x => { const c = cols[cols.length - 1]; if(c && x - c.max < tol){ c.max = x; c.sum += x; c.n++; } else cols.push({ min:x, max:x, sum:x, n:1 }); });
  const centres = cols.map(c => c.sum / c.n);
  return lineCells.map(cs => {
    const row = new Array(centres.length).fill('');
    cs.forEach(c => {
      const cx = (c.x0 + c.x1) / 2;
      let bi = 0, bd = Infinity;
      centres.forEach((m, i) => { const d = Math.abs(m - cx); if(d < bd){ bd = d; bi = i; } });
      row[bi] = row[bi] ? row[bi] + ' ' + c.t : c.t;
    });
    return row;
  });
}

let _pdfjs = null;
async function loadPdfjs(){
  if(_pdfjs) return _pdfjs;
  const lib = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const pdfjs = lib.default || lib;
  pdfjs.GlobalWorkerOptions.workerSrc = String(pdfWorkerUrl);
  _pdfjs = pdfjs;
  return pdfjs;
}
let _ocrWorker = null;
async function ocrWorker(onProgress){
  if(_ocrWorker) return _ocrWorker;
  const T = await import('tesseract.js');
  const createWorker = T.createWorker || (T.default && T.default.createWorker);
  const base = new URL('ocr/', document.baseURI).href;
  _ocrWorker = await createWorker('eng', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base.replace(/\/$/, ''),
    gzip: true,
    workerBlobURL: false,
    logger: m => { if(onProgress && m && m.status === 'recognizing text') onProgress(Math.round((m.progress || 0) * 100)); },
  });
  return _ocrWorker;
}

export let OCR_PSM = '11', OCR_W = 3000, OCR_CONF = 40, OCR_CELL_H = 64;
export function _setCellH(v){ OCR_CELL_H = v; }
export function _setOcr(w, c){ OCR_W = w; OCR_CONF = c; }
export function _setPsm(v){ OCR_PSM = String(v); }
/* Binarise + remove table rulings in place. */
function cleanScan(ctx, W, H){
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const dark = new Uint8Array(W * H);
  for(let i = 0, j = 0; i < d.length; i += 4, j++){
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    dark[j] = g < 160 ? 1 : 0;
  }
  const kill = new Uint8Array(W * H);
  const hMin = Math.round(W * 0.06), vMin = Math.round(Math.max(H, W) * 0.025);
  for(let y = 0; y < H; y++){                      /* horizontal rulings */
    let run = 0;
    for(let x = 0; x <= W; x++){
      if(x < W && dark[y * W + x]) run++;
      else { if(run >= hMin) for(let k = x - run; k < x; k++) kill[y * W + k] = 1; run = 0; }
    }
  }
  for(let x = 0; x < W; x++){                      /* vertical rulings */
    let run = 0;
    for(let y = 0; y <= H; y++){
      if(y < H && dark[y * W + x]) run++;
      else { if(run >= vMin) for(let k = y - run; k < y; k++) kill[k * W + x] = 1; run = 0; }
    }
  }
  const ink = new Uint8Array(W * H);
  for(let j = 0, i = 0; j < dark.length; j++, i += 4){
    const on = dark[j] && !kill[j];
    ink[j] = on ? 1 : 0;
    const v = on ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  /* Ruling positions: rows / columns where most pixels were a ruling. */
  const hCount = new Uint32Array(H), vCount = new Uint32Array(W);
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++) if(kill[y * W + x]){ hCount[y]++; vCount[x]++; }
  const lines = (count, len, minFrac) => {
    const out = []; let s0 = -1;
    for(let i = 0; i <= count.length; i++){
      const on = i < count.length && count[i] >= len * minFrac;
      if(on && s0 < 0) s0 = i;
      if(!on && s0 >= 0){ out.push(Math.round((s0 + i - 1) / 2)); s0 = -1; }
    }
    return out;
  };
  const hl = lines(hCount, W, 0.25);
  const span = hl.length >= 2 ? hl[hl.length - 1] - hl[0] : H;
  const vl = lines(vCount, span, 0.5);
  return { ink, W, H, hl, vl };
}

/* Tidy one OCR'd cell: drop stray marks ("oo", "~", ".") next to real text. */
function cleanOcrCell(t){
  let s = String(t || '').replace(/[|\[\]{}~_`'"“”‘’]/g, ' ').replace(/\s+/g, ' ').trim();
  const toks = s.split(' ').filter(Boolean);
  const real = toks.filter(x => x.length >= 3 || /^\d+([.,]\d+)?$/.test(x));
  if(real.length && real.length < toks.length) s = toks.filter(x => x.length >= 3 || /^\d+([.,]\d+)?$/.test(x) || /^[A-Za-z]{2}$/.test(x) && false).join(' ');
  s = s.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)]+$/g, '');
  /* "cM1482" → "CM1482" (lower-case first letter of an upper-case code) */
  if(/^[a-z][A-Z]+\d/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/* Ruled table → per-cell OCR (single-line mode) — far more reliable on
   scanned manifests than whole-page reading. Returns null without a grid. */
async function ocrRuledTable(worker, canvas, scan){
  const { ink, W, hl, vl } = scan;
  if(hl.length < 3 || vl.length < 3) return null;
  await worker.setParameters({ tessedit_pageseg_mode: '7', preserve_interword_spaces: '1' });
  const rows = [];
  for(let r = 0; r < hl.length - 1; r++){
    const y0 = hl[r] + 4, y1 = hl[r + 1] - 4;
    if(y1 - y0 < 12) continue;
    const row = [];
    for(let c = 0; c < vl.length - 1; c++){
      const x0 = vl[c] + 4, x1 = vl[c + 1] - 4;
      if(x1 - x0 < 8){ row.push(''); continue; }
      /* ink box inside the cell (skips empty cells and line debris) */
      let n = 0, bx0 = x1, by0 = y1, bx1 = x0, by1 = y0;
      for(let y = y0; y < y1; y++) for(let x = x0; x < x1; x++){
        if(ink[y * W + x]){ n++; if(x < bx0) bx0 = x; if(x > bx1) bx1 = x; if(y < by0) by0 = y; if(y > by1) by1 = y; }
      }
      if(n < 60 || by1 - by0 < 10){ row.push(''); continue; }
      /* crop with a white margin and read at a few sizes; codes and weights
         (anything with a digit) are decided by majority vote */
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
      const readAt = async target => {
        const k = Math.max(1, Math.min(3, target / bh));
        const pad = 14, cw = Math.round(bw * k) + pad * 2, chh = Math.round(bh * k) + pad * 2;
        const cell = document.createElement('canvas');
        cell.width = cw; cell.height = chh;
        const cx = cell.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, chh);
        cx.imageSmoothingEnabled = true;
        cx.drawImage(canvas, bx0, by0, bw, bh, pad, pad, Math.round(bw * k), Math.round(bh * k));
        const { data } = await worker.recognize(cell);
        return cleanOcrCell(data.text);
      };
      const first = await readAt(OCR_CELL_H);
      if(/\d/.test(first)){
        const votes = [first, await readAt(1), await readAt(44)];
        const tally = {};
        votes.forEach(v => { tally[v] = (tally[v] || 0) + 1; });
        let win = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || votes.indexOf(a) - votes.indexOf(b))[0];
        /* "14" vs "1.4": a reading that only adds the decimal point wins */
        const dotted = votes.find(v => v.includes('.') && v.replace('.', '') === win);
        if(dotted) win = dotted;
        row.push(win);
      } else row.push(first);
    }
    if(row.some(Boolean)) rows.push(row);
  }
  return rows.length ? rows : null;
}

async function gridsFromPdf(buf, onProgress){
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported:false }).promise;
  const grids = [];
  let scanned = false;
  for(let p = 1; p <= pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str && it.str.trim());
    if(items.map(i => i.str).join('').replace(/\s/g, '').length > 30){
      const words = items.map(it => {
        const [, , , d, e, f] = it.transform;
        const h = Math.abs(d) || it.height || 8;
        return { t: it.str.trim(), x: e, y: vp.height - f - h, w: it.width || h * it.str.length * 0.5, h };
      });
      grids.push({ name: 'Page ' + p, rows: gridFromWords(words, vp.width) });
      continue;
    }
    /* scanned page → OCR. Render at ~3000 px, binarise and erase the
       table rulings (long straight dark runs) so Tesseract sees words,
       not grid lines; sparse-text mode returns every word with its box. */
    scanned = true;
    if(onProgress) onProgress({ phase:'ocr', page:p, pages:pdf.numPages, pct:0 });
    const scale = Math.min(8, OCR_W / vp.width);
    const v2 = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v2.width); canvas.height = Math.round(v2.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvas, canvasContext: ctx, viewport: v2 }).promise;
    const scan = cleanScan(ctx, canvas.width, canvas.height);
    const worker = await ocrWorker(pct => onProgress && onProgress({ phase:'ocr', page:p, pages:pdf.numPages, pct }));
    const ruled = await ocrRuledTable(worker, canvas, scan);
    if(ruled){ grids.push({ name: 'Page ' + p, rows: ruled, ocr: true }); continue; }
    await worker.setParameters({ tessedit_pageseg_mode: OCR_PSM, preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    const words = (data.words || []).filter(w => w.text && w.text.trim() && w.confidence > OCR_CONF && /[A-Za-z0-9]/.test(w.text)).map(w => ({
      t: w.text.trim().replace(/^[|\[\]()]+|[|\[\]()]+$/g, ''), x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0,
    })).filter(w => w.t);
    grids.push({ name: 'Page ' + p, rows: gridFromWords(words, canvas.width), ocr: true });
  }
  return { grids, scanned };
}

/* ── Direction / manifest helpers ───────────────────────────────────── */
export function guessDirection(...texts){
  for(const t of texts){
    const s = String(t || '').toUpperCase();
    if(!s) continue;
    if(/BACK\s*-?\s*LOAD|\bINBOUND\b|\bRETURN/.test(s)) return 'BL';
    if(/\bOFF\s*-?\s*LOAD|\bOUTBOUND\b|\bLOAD\s*-?\s*(OUT|LIST)\b|\bDELIVERY\b/.test(s)) return 'L';
  }
  return null;
}
function manifestFrom(...texts){
  for(const t of texts){
    const m = String(t || '').match(/manifest\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z]*-?\d[A-Z0-9\-]*)/i)
      || String(t || '').match(/\b(MAN-\d{3,}|[A-Z]{2,4}-\d{2,4})\b/);
    if(m) return m[1];
  }
  return '';
}

export const _debug = { grids: null };
/* ── Public entry ───────────────────────────────────────────────────── */
export async function readManifestFile(file, onProgress){
  const name = file.name || 'file';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const buf = await file.arrayBuffer();
  let grids = [], kind = ext, scanned = false;
  if(['xlsx','xlsm','xls','csv','ods'].includes(ext)) grids = gridsFromWorkbook(buf);
  else if(ext === 'docx') grids = gridsFromDocx(buf);
  else if(ext === 'pdf'){ const r = await gridsFromPdf(buf, onProgress); grids = r.grids; scanned = r.scanned; kind = scanned ? 'pdf (scanned)' : 'pdf'; }
  else throw new Error('Unsupported file type: .' + ext);

  _debug.grids = grids;
  const fileBase = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  const out = [];
  grids.forEach(g => {
    readGrid(g.rows, g.name, {}).forEach(sec => {
      const title = sec.title || '';
      sec.direction = guessDirection(title, g.name, fileBase);
      sec.manifestNo = sec.meta.manifestNo || manifestFrom(title, g.name, fileBase);
      sec.platformHint = [sec.meta.platform, title, g.name, fileBase].filter(Boolean);
      sec.vessel = sec.meta.vessel || '';
      out.push(sec);
    });
  });
  /* merge "PAGE 1 OF 2" / "PAGE 2 OF 2" continuations of the same section */
  const merged = [];
  out.forEach(sec => {
    const key = (sec.sheetName + '|' + (sec.title || '').replace(/\(?\s*page\s*\d+\s*of\s*\d+\s*\)?/i, '').trim()).toUpperCase();
    const prev = merged.find(m => m._key === key);
    /* a PDF page without its own title continues the previous page's table */
    const last = merged[merged.length - 1];
    const cont = last && /^Page \d+$/.test(sec.sheetName) && sec.sheetName !== 'Page 1'
      && (!sec.title || sec.inferred) && (!sec.direction || !last.direction || sec.direction === last.direction);
    if(prev) prev.rows.push(...sec.rows);
    else if(cont) last.rows.push(...sec.rows);
    else { sec._key = key; merged.push(sec); }
  });
  /* a later scanned / repeated table may restate the same CCUs — keep first */
  return { kind, scanned, fileName: name, sections: merged.filter(s => s.rows.length) };
}
