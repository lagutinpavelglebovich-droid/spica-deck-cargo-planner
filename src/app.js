/* ════════════════════════════════════════════════════════════
   SPICA TIDE — Deck Cargo Planning Application
   Bundled as ES module for Vite/Tauri.
   Original monolith: source/v1_current/source:v1_current.html
════════════════════════════════════════════════════════════ */

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

/* ════════════════════════════════════════════════════════════
   APP CONFIG — centralised settings layer
   All future configurable values live here.
   Never reference raw strings in UI code — always use SPICA_CONFIG.
════════════════════════════════════════════════════════════ */
const SPICA_CONFIG = {

  /* ── Admin ────────────────────────────────────────────────
     Admin password for header edit mode.
     Change this value to update the password — nowhere else. */
  ADMIN_PASSWORD: 'Pavel7114413',

  /* ── Brand / Header labels ─────────────────────────────────
     These are the default values. Once edited in admin mode
     they are persisted to localStorage under 'spicaTide_brand'. */
  BRAND: {
    name:     'SPICA TIDE',
    title:    'Deck Cargo Plan',
    subtitle: 'PSV · FAR SPICA · NEO Energy · North Sea',
  },

  /* ── PDF Export defaults ───────────────────────────────────
     Future: hook into buildPDF() for user-controlled presets. */
  PDF: {
    orientation: 'landscape',
    format:      'a4',
    scale:       3,
    margins:     { top:8, left:10, right:10 },
  },

  /* ── Theme ─────────────────────────────────────────────────
     Future: dark mode toggle, accent colour override. */
  THEME: {
    mode:   'light',   /* 'light' | 'dark' — future */
    accent: null,      /* null = use CSS default #486083 */
  },

  /* ── Deck display ──────────────────────────────────────────
     Future: snap-to-grid, default zoom level. */
  DECK: {
    snapToGrid:   false,
    defaultZoom:  null,   /* null = auto-fit on load */
  },

};

/* ── Load persisted brand labels from localStorage ── */
(function loadBrandConfig(){
  try{
    const saved = JSON.parse(localStorage.getItem('spicaTide_brand') || 'null');
    if(saved){
      if(saved.name)     SPICA_CONFIG.BRAND.name     = saved.name;
      if(saved.title)    SPICA_CONFIG.BRAND.title    = saved.title;
      if(saved.subtitle) SPICA_CONFIG.BRAND.subtitle = saved.subtitle;
    }
  }catch(e){}
})();

/* ── Apply brand labels to DOM on load ── */
function applyBrandLabels(){
  const el = {
    name: document.getElementById('brandName'),
    dcp:  document.getElementById('brandDcp'),
    sub:  document.getElementById('brandSub'),
  };
  if(el.name) el.name.textContent = SPICA_CONFIG.BRAND.name;
  if(el.dcp)  el.dcp.textContent  = SPICA_CONFIG.BRAND.title;
  if(el.sub)  el.sub.textContent  = SPICA_CONFIG.BRAND.subtitle;
}

/* ════════════════════════════════════════════════════════════
   ADMIN EDIT MODE
   Flow: click pencil → password modal → validate vs SPICA_CONFIG
   → enable inline editing → save to localStorage on exit
════════════════════════════════════════════════════════════ */
let ADMIN_ACTIVE = false;

function adminOpenModal(){
  const ov = document.getElementById('adminModalOv');
  const inp = document.getElementById('adminPwInput');
  const err = document.getElementById('adminPwErr');
  if(!ov) return;
  inp.value = '';
  err.classList.remove('show');
  ov.classList.add('open');
  setTimeout(() => inp.focus(), 120);
}

function adminCloseModal(){
  const ov = document.getElementById('adminModalOv');
  if(ov) ov.classList.remove('open');
}

function adminValidate(){
  const inp = document.getElementById('adminPwInput');
  const err = document.getElementById('adminPwErr');
  if(!inp) return;
  if(inp.value === SPICA_CONFIG.ADMIN_PASSWORD){
    adminCloseModal();
    adminEnterEditMode();
  } else {
    err.classList.add('show');
    inp.value = '';
    inp.focus();
    /* Brief shake animation */
    inp.style.transform = 'translateX(-4px)';
    setTimeout(() => { inp.style.transform = 'translateX(4px)'; }, 60);
    setTimeout(() => { inp.style.transform = ''; }, 120);
  }
}

function adminEnterEditMode(){
  ADMIN_ACTIVE = true;
  document.getElementById('adminModeBar').classList.add('active');

  /* Replace brand text nodes with editable inputs */
  const fields = [
    { id:'brandName', key:'name',     placeholder:'Vessel name'  },
    { id:'brandDcp',  key:'title',    placeholder:'Plan title'   },
    { id:'brandSub',  key:'subtitle', placeholder:'Descriptor'   },
  ];

  fields.forEach(({ id, key, placeholder }) => {
    const el = document.getElementById(id);
    if(!el || el.querySelector('input')) return;   /* already editing */

    const currentText = el.textContent.trim();
    el.textContent = '';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'brand-edit-field';
    inp.value = currentText;
    inp.placeholder = placeholder;
    inp.dataset.key = key;

    /* Commit on blur or Enter */
    const commit = () => {
      const val = inp.value.trim() || currentText;
      SPICA_CONFIG.BRAND[key] = val;
      el.textContent = val;
      adminSaveBrand();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if(e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
      if(e.key === 'Escape') { inp.value = currentText; inp.blur(); }
    });
    inp.addEventListener('mousedown', e => e.stopPropagation());

    el.appendChild(inp);
  });

  /* Focus first field */
  const first = document.querySelector('.brand-edit-field');
  if(first) first.focus();
}

function adminExitEditMode(){
  ADMIN_ACTIVE = false;
  document.getElementById('adminModeBar').classList.remove('active');

  /* Commit any still-focused inputs */
  document.querySelectorAll('.brand-edit-field').forEach(inp => inp.blur());

  adminSaveBrand();
}

function adminSaveBrand(){
  try{
    localStorage.setItem('spicaTide_brand', JSON.stringify(SPICA_CONFIG.BRAND));
  }catch(e){}
}

function bindAdmin(){
  /* Pencil button → open password modal */
  const editBtn = document.getElementById('brandEditBtn');
  if(editBtn) editBtn.addEventListener('click', e => {
    e.stopPropagation();
    if(ADMIN_ACTIVE) adminExitEditMode();
    else adminOpenModal();
  });

  /* Modal: close button */
  document.getElementById('adminModalClose')?.addEventListener('click', adminCloseModal);
  document.getElementById('adminModalCancel')?.addEventListener('click', adminCloseModal);

  /* Modal: backdrop click closes */
  document.getElementById('adminModalOv')?.addEventListener('click', e => {
    if(e.target === document.getElementById('adminModalOv')) adminCloseModal();
  });

  /* Modal: unlock button */
  document.getElementById('adminModalUnlock')?.addEventListener('click', adminValidate);

  /* Modal: Enter key submits */
  document.getElementById('adminPwInput')?.addEventListener('keydown', e => {
    if(e.key === 'Enter') adminValidate();
    if(e.key === 'Escape') adminCloseModal();
  });

  /* Exit admin mode */
  document.getElementById('adminModeExit')?.addEventListener('click', adminExitEditMode);

  /* Apply brand labels from config / localStorage */
  applyBrandLabels();
}

/* ════════════════════════════════════
   CONSTANTS
════════════════════════════════════ */
const M=31,ft=f=>Math.round(f*.3048*M);
const BW=[129,126,147,126,147,147,126,147,126,147,144,139];
const TW=BW.reduce((a,b)=>a+b,0);
const BL_=BW.reduce((acc,w,i)=>{acc.push(i===0?0:acc[i-1]+BW[i-1]);return acc;},[]);
const CVH=380,YS=CVH/15;

/* ════════════════════════════════════
   COLOR ENGINE — Smart Dynamic Palette
   Bleo Holm = grey family (mandatory)
   All others: smart auto-assigned from premium
   contrast-maximised palette at activation time.
   Internal L/BL/ROB are STRONGLY distinct (not
   just shades — real colour family shifts).
════════════════════════════════════ */

function h2r(hex){const n=parseInt(hex.replace('#',''),16);return[(n>>16)&255,(n>>8)&255,n&255];}
function rgb2hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h,s,l=(mx+mn)/2;if(mx===mn){h=s=0;}else{const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);switch(mx){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;default:h=((r-g)/d+4)/6;}}return[h*360,s,l];}
function hsl2rgb(h,s,l){h/=360;const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;const f=t=>{t<0&&(t+=1);t>1&&(t-=1);if(t<1/6)return p+(q-p)*6*t;if(t<.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};return[Math.round(f(h+1/3)*255),Math.round(f(h)*255),Math.round(f(h-1/3)*255)];}
function mixHex(c1,c2,t){const[r1,g1,b1]=h2r(c1),[r2,g2,b2]=h2r(c2);return`#${((1<<24)|(Math.round(r1*(1-t)+r2*t)<<16)|(Math.round(g1*(1-t)+g2*t)<<8)|Math.round(b1*(1-t)+b2*t)).toString(16).slice(1)}`;}
function isDark(hex){const[r,g,b]=h2r(hex);return(r*299+g*587+b*114)/1000<155;}
function darken(hex,t){return mixHex(hex,'#000000',t);}
function lighten(hex,t){return mixHex(hex,'#ffffff',t);}
function locById(id){return LOC_ALL.find(l=>l.id===id) || S.customLocs.find(l=>l.id===id);}

/* ── Premium Palette Pool ────────────────────────────────────
   30 high-quality, strongly distinct base colours.
   Grouped by hue family so the picker can enforce separation.
   Each entry: [hex, hue°, label]
   Apple/macOS inspired professional tones — no neons.
   ─────────────────────────────────────────────────────────── */
const PALETTE_POOL = [
  // Reds / Corals
  {h:'#c0392b', hue:4,   fam:'red'},
  {h:'#e74c3c', hue:6,   fam:'red'},
  // Oranges / Ambers
  {h:'#d35400', hue:23,  fam:'orange'},
  {h:'#e67e22', hue:28,  fam:'orange'},
  {h:'#c27b00', hue:38,  fam:'amber'},
  {h:'#b8860b', hue:43,  fam:'amber'},
  // Yellows / Olive
  {h:'#8b7536', hue:48,  fam:'olive'},
  {h:'#6b7a00', hue:58,  fam:'olive'},
  // Greens
  {h:'#27ae60', hue:145, fam:'green'},
  {h:'#1e8449', hue:140, fam:'green'},
  {h:'#148f6e', hue:160, fam:'teal-green'},
  {h:'#0e6655', hue:168, fam:'teal-green'},
  // Teals / Cyans
  {h:'#0e7490', hue:193, fam:'teal'},
  {h:'#0a7560', hue:170, fam:'teal'},
  {h:'#117a8b', hue:190, fam:'teal'},
  // Blues
  {h:'#1d4ed8', hue:225, fam:'blue'},
  {h:'#1a6db5', hue:210, fam:'blue'},
  {h:'#2563eb', hue:220, fam:'blue'},
  {h:'#0f4c81', hue:210, fam:'navy'},
  // Purples / Violets
  {h:'#7c3aed', hue:263, fam:'violet'},
  {h:'#6326b5', hue:270, fam:'violet'},
  {h:'#9333ea', hue:272, fam:'purple'},
  {h:'#6d28d9', hue:263, fam:'purple'},
  // Pinks / Magentas
  {h:'#be185d', hue:336, fam:'pink'},
  {h:'#9d174d', hue:340, fam:'pink'},
  {h:'#c2185b', hue:340, fam:'magenta'},
  // Browns / Warm Neutrals
  {h:'#78350f', hue:30,  fam:'brown'},
  {h:'#92400e', hue:25,  fam:'brown'},
  // Slates / Cool greys (not BLEO grey)
  {h:'#334155', hue:215, fam:'slate'},
  {h:'#475569', hue:215, fam:'slate'},
];

/* Hue distance (circular, 0–180) */
function hueDist(a, b){ const d=Math.abs(a-b); return d>180?360-d:d; }

/* Family distance score — different family = big bonus */
function famDist(fa, fb){ return fa===fb ? 0 : 60; }

/* Total perceptual distance between two palette entries */
function palDist(p1, p2){
  return hueDist(p1.hue, p2.hue) + famDist(p1.fam, p2.fam);
}

/* LOC_ALL: each location has a fixed preferred palette group.
   Within a group (e.g. Claymore trio), colours are pre-assigned
   so they stay related but still separated from each other.
   The 'pool' field = ordered list of PALETTE_POOL indices to prefer,
   tried in order until the best-contrast one is found at runtime.     */
const LOC_ALL=[
  /* Bleo Holm — ALWAYS grey, operational rule, no dynamic assignment */
  {id:'BLEO',      name:'Bleo Holm',      c:'#9aa0a8', fixed:true},
  /* Claymore group — violet/purple/indigo family */
  {id:'CLAY_CAP',  name:'Claymore CAP',   c:'#7c3aed', grp:'clay'},
  {id:'CLAY_CPP',  name:'Claymore CPP',   c:'#6326b5', grp:'clay'},
  {id:'CLAY_WOP',  name:'Claymore WOPS',  c:'#9333ea', grp:'clay'},
  {id:'CLAY_DRL',  name:'Claymore Drill', c:'#4338ca', grp:'clay'},
  /* Piper group — amber/brown/orange family (distinguishable trio) */
  {id:'PIPER',     name:'Piper',          c:'#c27b00', grp:'piper'},
  {id:'PIPER_DR',  name:'Piper Drilling', c:'#92400e', grp:'piper'},
  {id:'PIPER_WOP', name:'Piper WOPS',     c:'#d35400', grp:'piper'},
  /* Individuals — each gets a well-separated hue */
  {id:'SALT',      name:'Saltire',        c:'#c0392b'},  // strong red
  {id:'TART',      name:'Tartan',         c:'#1d4ed8'},  // strong blue
  {id:'BEAT',      name:'Beatrice',       c:'#be185d'},  // deep pink
  {id:'CLYDE',     name:'Clyde',          c:'#0e7490'},  // teal
  {id:'FULMAR',    name:'Fulmar',         c:'#1a6db5'},  // ocean blue
  {id:'AUK',       name:'Auk',            c:'#1e8449'},  // forest green
  {id:'MONTR',     name:'Montrose',       c:'#6b7a00'},  // olive
  {id:'ARBR',      name:'Arbroath',       c:'#148f6e'},  // teal-green
  {id:'GP3',       name:'GP3',            c:'#e67e22'},  // warm orange
];

/* ── Dynamic colour assignment ───────────────────────────────
   Holds runtime-assigned palette entries per location.
   Reset on page load; populated as locations are activated.
   ─────────────────────────────────────────────────────────── */
const DYN_COLORS = {};   // locId → { base: hex, palEntry: PALETTE_POOL item }

/* Get effective base colour for a location (dynamic or static) */
function getLocBase(locId){
  if(DYN_COLORS[locId]) return DYN_COLORS[locId].base;
  const loc = locById(locId);
  return loc ? loc.c : '#9aa0a8';
}

/* Assign dynamic colour to a location if not already assigned.
   Picks the palette entry with maximum distance from all already-
   active locations' assigned entries.                           */
function assignLocColor(locId){
  if(locId === 'BLEO') return;               // always fixed grey
  if(DYN_COLORS[locId]) return;              // already assigned
  const loc = locById(locId);
  if(!loc) return;

  /* Get palette entries already in use by other active locations */
  const usedEntries = S.activeLocs
    .filter(id => id !== locId && DYN_COLORS[id])
    .map(id => DYN_COLORS[id].palEntry);

  /* For group members (Claymore/Piper), find the palette entry
     closest to the location's static preferred colour first,
     but still separate from other already-used entries.          */
  const isGroupMember = !!loc.grp;

  /* Score each pool entry: higher = better candidate */
  let best = null, bestScore = -1;
  PALETTE_POOL.forEach(entry => {
    /* Skip entries already used by other locations */
    if(usedEntries.some(u => u===entry)) return;

    /* Distance from all used entries (min distance = how different) */
    let minDist = usedEntries.length
      ? Math.min(...usedEntries.map(u => palDist(entry, u)))
      : 999;

    /* For group members: add bonus for staying near preferred hue */
    let groupBonus = 0;
    if(isGroupMember){
      const prefHue = rgb2hsl(...h2r(loc.c))[0];
      const nearGroup = hueDist(entry.hue, prefHue);
      groupBonus = Math.max(0, 40 - nearGroup * 0.5);
    }

    const score = minDist + groupBonus;
    if(score > bestScore){ bestScore = score; best = entry; }
  });

  /* Fallback: if pool exhausted, use static colour */
  if(!best){
    DYN_COLORS[locId] = { base: loc.c, palEntry: {h:loc.c, hue:0, fam:'custom'} };
    return;
  }

  DYN_COLORS[locId] = { base: best.h, palEntry: best };
}

/* ── Three-status colour derivation ─────────────────────────
   L   = Load    → base colour (full vivid, represents destination)
   BL  = Backload→ STRONGLY shifted toward complementary hue
                   (NOT just darker — real hue change for instant ID)
   ROB = Remaining On Board → shifted toward a third hue family
   
   Strategy:
   - Get base HSL
   - BL: rotate hue +140° (complementary area), adjusted saturation
   - ROB: rotate hue +240° (triadic area), warm amber bias
   
   This guarantees L/BL/ROB are NEVER similar shades.
   ─────────────────────────────────────────────────────────── */
function locColors(base, locId){
  /* Bleo Holm: operational fixed grey family */
  if(locId === 'BLEO') return {
    L:   '#b8bcc2',   // light cool grey → Load
    BL:  '#4a7fa5',   // steel blue      → Backload (strongly different)
    ROB: '#b8935a',   // warm sandy gold → ROB (strongly different)
  };

  /* Use dynamically assigned colour if available */
  const effectiveBase = getLocBase(locId);
  return deriveStatusColors(effectiveBase);
}

/* Core derivation: given a base hex, produce L/BL/ROB trio
   with strong mutual contrast (different hue families).      */
function deriveStatusColors(baseHex){
  const [r,g,b] = h2r(baseHex);
  const [baseH, baseS, baseL] = rgb2hsl(r,g,b);

  /* ── Load: the full vivid base ── */
  const loadHex = baseHex;

  /* ── Backload: shift hue strongly toward blue-indigo territory
     If base is already blue-ish, shift toward green or magenta instead.
     Minimum hue distance from base: 110°                               */
  let blHue = baseH + 145;
  if(blHue >= 360) blHue -= 360;
  /* If BL ended up too close to base or ROB, push further */
  if(hueDist(blHue, baseH) < 90) blHue = (blHue + 60) % 360;
  const blS = Math.max(0.55, Math.min(0.85, baseS * 1.1));
  const blL = Math.max(0.32, Math.min(0.58, baseL * 0.95));
  const [blR,blG,blB] = hsl2rgb(blHue, blS, blL);
  const blHex = `#${((1<<24)|(blR<<16)|(blG<<8)|blB).toString(16).slice(1)}`;

  /* ── ROB: shift to a third hue family (triadic from base)
     Bias toward warm amber/gold — universally "staying behind" feel.
     If base is amber, shift to teal or magenta instead.               */
  let robHue = baseH + 255;
  if(robHue >= 360) robHue -= 360;
  /* Ensure ROB is well separated from both base and BL */
  const distFromBL = hueDist(robHue, blHue);
  const distFromBase = hueDist(robHue, baseH);
  if(distFromBL < 60 || distFromBase < 60) robHue = (robHue + 70) % 360;
  /* Warm orange bias: if ROB ends up near warm amber quadrant, keep it;
     otherwise nudge slightly toward 35° (amber) */
  const warmAnchor = 35;
  if(hueDist(robHue, warmAnchor) > 90 && hueDist(baseH, warmAnchor) > 60){
    robHue = (robHue * 0.5 + warmAnchor * 0.5 + 360) % 360;
  }
  const robS = Math.max(0.55, Math.min(0.80, baseS * 1.05));
  const robL = Math.max(0.36, Math.min(0.60, baseL * 1.0));
  const [robR,robG,robB] = hsl2rgb(robHue, robS, robL);
  const robHex = `#${((1<<24)|(robR<<16)|(robG<<8)|robB).toString(16).slice(1)}`;

  return { L: loadHex, BL: blHex, ROB: robHex };
}

/* ── Initialise dynamic colours for already-active locations on load ── */
function initDynColors(){
  /* Assign in order; each assignment excludes what's already taken */
  S.activeLocs.forEach(id => assignLocColor(id));
}

/* ── Create a custom location not in LOC_ALL ────────────────────────────
   Generates a unique id, picks a maximally-distinct colour from the pool,
   adds to S.customLocs, activates it, and persists.
   Returns the new location's id.                                         */
function createCustomLoc(name){
  /* Trim and validate */
  name = name.trim();
  if(!name) return null;

  /* Deduplicate: if a loc with this name already exists (LOC_ALL or custom), return it */
  const norm = s => s.toUpperCase().replace(/\s+/g,' ').trim();
  const existing = [...LOC_ALL, ...S.customLocs].find(l => norm(l.name) === norm(name));
  if(existing){
    /* Activate if not already */
    if(!S.activeLocs.includes(existing.id)){
      S.activeLocs.push(existing.id);
      assignLocColor(existing.id);
      if(!S.selLoc) S.selLoc = existing.id;
    }
    return existing.id;
  }

  /* Generate unique id: CUST_ + sanitised name + counter */
  const baseId = 'CUST_' + name.toUpperCase().replace(/[^A-Z0-9]/g,'_').slice(0,12);
  let id = baseId;
  let counter = 2;
  while(locById(id)){ id = baseId + '_' + counter++; }

  /* Pick a distinct colour from PALETTE_POOL — maximise distance from all in-use entries */
  const usedEntries = S.activeLocs
    .filter(lid => DYN_COLORS[lid])
    .map(lid => DYN_COLORS[lid].palEntry);
  let bestEntry = PALETTE_POOL[0];
  let bestDist  = -1;
  PALETTE_POOL.forEach(entry => {
    const minDist = usedEntries.length
      ? Math.min(...usedEntries.map(u => palDist(entry, u)))
      : 999;
    if(minDist > bestDist){ bestDist = minDist; bestEntry = entry; }
  });
  const baseColour = bestEntry.h;

  /* Register in customLocs */
  const newLoc = { id, name, c: baseColour, custom: true };
  S.customLocs.push(newLoc);

  /* Activate and assign colour */
  S.activeLocs.push(id);
  DYN_COLORS[id] = { base: baseColour, palEntry: bestEntry };
  if(!S.selLoc) S.selLoc = id;

  buildLocGrid();
  buildActiveLocStrip();
  save();
  return id;
}

/* Size lookup: name → {w,h} in logical canvas pixels
   Used when user changes Description in modal to auto-resize block */
/* ════════════════════════════════════
   REAL-WORLD CCU PRESET LIBRARY
   Source: offshore_ccu_dimensions_psv.md
   All dimensions in metres (metric only).
   M=31 px/m — convert: px = Math.round(metres * M)
   
   Each entry: { key, label, cat, length_m, width_m,
                 aliases[], approx?, wt_default }
   length_m = along deck long axis
   width_m  = across deck short axis
   
   These are DEFAULT footprints — user can always
   resize manually after placement.
════════════════════════════════════ */
const m2px   = metres => Math.round(metres * M);          // kept for backward compat (horizontal only)
const m2px_w = metres => Math.round(metres * M);          // horizontal: 31 px/m (along deck, aft→bow)
const m2px_h = metres => Math.round(metres * (CVH / 15)); // vertical:   25.33 px/m (across deck, port→stbd)

const CCU_PRESETS = [
  /* ── Containers ─────────────────────────────────────── */
  {key:'cont_mini_6',    label:'6ft Mini Container',      cat:'Container',
   length_m:1.83, width_m:1.83, wt_default:2.5,
   aliases:['mini container','6ft mini','6x6 container','mini']},

  {key:'cont_mini_std',  label:'Mini Container (DNV)',    cat:'Container',
   length_m:1.95, width_m:1.65, wt_default:2.5,
   aliases:['mini container dnv','mini dnv','mini ccu'], approx:true},

  {key:'cont_10x8',      label:"10ft × 8ft Container",   cat:'Container',
   length_m:3.00, width_m:2.43, wt_default:4.0,
   aliases:['10ft container','10x8 container','10 x 8','10ft','10×8','10 foot']},

  {key:'cont_10x8_ot',   label:"10ft Open Top",          cat:'Container',
   length_m:3.00, width_m:2.43, wt_default:3.2,
   aliases:['10ft open top','open top 10','10ft ot']},

  {key:'cont_10x8_hh',   label:"10ft Half Height",       cat:'Container',
   length_m:3.00, width_m:2.43, wt_default:3.5,
   aliases:['10ft half height','half height 10','10hh','10ft hh']},

  {key:'cont_10_dry',    label:"10ft Dry Goods",         cat:'Container',
   length_m:3.00, width_m:2.43, wt_default:3.0,
   aliases:['10ft dry goods','dry goods 10','dry goods']},

  {key:'cont_10_freeze', label:"10ft Freezer Container", cat:'Container',
   length_m:3.00, width_m:2.43, wt_default:3.8,
   aliases:['freezer container','reefer 10','10ft freezer']},

  {key:'cont_10_ins',    label:"10ft Insulated",         cat:'Container',
   length_m:3.05, width_m:2.44, wt_default:3.5,
   aliases:['10ft insulated','insulated 10']},

  {key:'cont_12x8_ot',   label:"12ft × 8ft Open Top",   cat:'Container',
   length_m:3.66, width_m:2.44, wt_default:3.2,
   aliases:['12ft open top','12x8 open top','12ft ot','12×8']},

  {key:'cont_20x8',      label:"20ft × 8ft Container",  cat:'Container',
   length_m:6.06, width_m:2.44, wt_default:6.0,
   aliases:['20ft container','20x8 container','20ft','20 x 8','20×8','20 foot']},

  {key:'cont_20x8_ot',   label:"20ft Open Top",         cat:'Container',
   length_m:6.00, width_m:2.43, wt_default:5.5,
   aliases:['20ft open top','open top 20','20ft ot']},

  {key:'cont_20x8_hh',   label:"20ft Half Height",      cat:'Container',
   length_m:6.06, width_m:2.44, wt_default:5.0,
   aliases:['20ft half height','20hh','half height 20']},

  {key:'cont_20_ins',    label:"20ft Insulated",        cat:'Container',
   length_m:6.10, width_m:2.44, wt_default:5.5,
   aliases:['20ft insulated','insulated 20']},

  {key:'cont_20_reefer', label:"20ft Reefer",           cat:'Container',
   length_m:6.10, width_m:2.44, wt_default:5.5,
   aliases:['20ft reefer','reefer 20','reefer']},

  {key:'cont_22x8_hh',   label:"22ft Half Height",     cat:'Container',
   length_m:6.70, width_m:2.44, wt_default:5.0,
   aliases:['22ft half height','22hh','22ft hh'], approx:true},

  {key:'cont_23x8_hh',   label:"23ft Half Height",     cat:'Container',
   length_m:7.00, width_m:2.44, wt_default:5.0,
   aliases:['23ft half height','23hh','23ft hh','23×8'], approx:true},

  {key:'cont_8ft',       label:"8ft Container",         cat:'Container',
   length_m:2.44, width_m:2.44, wt_default:3.0,
   aliases:['8ft container','8x8','8ft','8foot']},

  {key:'cont_5ft',       label:"5ft Container",         cat:'Container',
   length_m:1.52, width_m:1.52, wt_default:1.5,
   aliases:['5ft container','5x5','5ft','5foot']},

  /* ── Tool Houses / Modules ───────────────────────────── */
  {key:'mod_toolhouse_10', label:"Tool House 10ft",     cat:'Module',
   length_m:3.00, width_m:2.43, wt_default:4.0,
   aliases:['tool house','tool house 10','rigging loft','workshop 10','wireline unit']},

  {key:'mod_toolshack_15', label:"Tool Shack 15ft",     cat:'Module',
   length_m:4.57, width_m:2.44, wt_default:4.5,
   aliases:['tool shack','tool shack 15','15ft shack'], approx:true},

  {key:'mod_equip_frame',  label:"Equipment Frame 12ft",cat:'Module',
   length_m:3.66, width_m:2.44, wt_default:4.0,
   aliases:['equipment frame','equip frame','12ft frame']},

  {key:'mod_genset',       label:"Generator Set 10ft",  cat:'Module',
   length_m:3.00, width_m:2.43, wt_default:5.0,
   aliases:['generator set','genset','gen set']},

  {key:'mod_pipe_20x4',    label:"Pipe Bundle 20ft",    cat:'Module',
   length_m:6.10, width_m:1.22, wt_default:8.0,
   aliases:['pipe bundle','pipe bundle 20','pipe rack','20ft pipe']},

  /* ── Tanks ───────────────────────────────────────────── */
  {key:'tank_7x6_chem',    label:"7ft×6ft Chem. Tank",  cat:'Tank',
   length_m:2.13, width_m:1.83, wt_default:4.5,
   aliases:['7x6 chem tank','7x6 tank','chem tank 7x6','chemical tank 7x6','7ft chem']},

  {key:'tank_7x7_chem',    label:"7ft×7ft Chem. Tank",  cat:'Tank',
   length_m:2.13, width_m:2.13, wt_default:5.0,
   aliases:['7x7 chem tank','7x7 tank','chem tank 7x7','chemical tank 7x7']},

  {key:'tank_7x7_heli',    label:"7ft×7ft Heli Fuel",   cat:'Tank',
   length_m:2.13, width_m:2.13, wt_default:4.0,
   aliases:['heli fuel','helifuel','heli fuel tank','7x7 heli','helicopter fuel']},

  {key:'tank_8x8_tote',    label:"8ft Tote/Chem. Tank", cat:'Tank',
   length_m:2.44, width_m:2.44, wt_default:5.0,
   aliases:['8ft tote','tote tank 8','8ft tank','8x8 tank']},

  {key:'tank_2300l',       label:"2300L Chem. Tank",    cat:'Tank',
   length_m:2.15, width_m:1.90, wt_default:4.5,
   aliases:['2300l tank','2300 litre tank','2300 liter']},

  {key:'tank_4546l',       label:"4546L Chem. Tank",    cat:'Tank',
   length_m:2.75, width_m:1.85, wt_default:6.0,
   aliases:['4546l tank','4546 litre','4546 liter']},

  {key:'tank_8000l',       label:"8000L Chem. Tank",    cat:'Tank',
   length_m:2.99, width_m:2.44, wt_default:8.0,
   aliases:['8000l tank','8000 litre','8m3 tank']},

  {key:'tank_20000l',      label:"20000L Chem. Tank",   cat:'Tank',
   length_m:6.06, width_m:2.44, wt_default:18.0,
   aliases:['20000l tank','20kl tank','20000 litre']},

  {key:'tank_25bbl',       label:"25 BBL Vertical Tank",cat:'Tank',
   length_m:1.98, width_m:1.98, wt_default:3.0,
   aliases:['25bbl','25 bbl tank','25 barrel tank']},

  {key:'tank_50bbl',       label:"50 BBL Horiz. Tank",  cat:'Tank',
   length_m:3.05, width_m:2.44, wt_default:5.0,
   aliases:['50bbl','50 bbl','50 barrel']},

  {key:'tank_125bbl',      label:"125 BBL Horiz. Tank", cat:'Tank',
   length_m:6.10, width_m:2.44, wt_default:10.0,
   aliases:['125bbl','125 bbl','125 barrel']},

  {key:'tank_ibc_single',  label:"DNV Tote Tank / IBC", cat:'Tank',
   length_m:1.83, width_m:1.52, wt_default:3.0,
   aliases:['ibc','ibc carrier','tote tank','dnv tote','ibc open top','ibc 1000l','1000l ibc']},

  {key:'tank_ibc_quad',    label:"Quad DNV IBC Carrier",cat:'Tank',
   length_m:3.05, width_m:3.05, wt_default:8.0,
   aliases:['quad ibc','quad tote','4x ibc','quad dnv']},

  {key:'tank_350gal',      label:"350 Gal Tote Tank",   cat:'Tank',
   length_m:1.22, width_m:1.07, wt_default:2.0,
   aliases:['350gal','350 gallon','350 gal tote']},

  {key:'tank_550gal',      label:"550 Gal Tote Tank",   cat:'Tank',
   length_m:1.22, width_m:1.07, wt_default:2.5,
   aliases:['550gal','550 gallon','550 gal tote']},

  {key:'tank_waste_oil',   label:"Waste Oil Tank 2900L", cat:'Tank',
   length_m:2.15, width_m:1.90, wt_default:4.0,
   aliases:['waste oil tank','2900l waste','waste oil']},

  /* ── Baskets / Skips ─────────────────────────────────── */
  {key:'bsk_8x6',          label:"8ft×6ft Cargo Basket",cat:'Basket',
   length_m:2.44, width_m:1.83, wt_default:1.5,
   aliases:['8x6 basket','8x6 cargo basket','8ft basket','cargo basket 8x6','skip 8x6']},

  {key:'bsk_8x8_hh',       label:"8ft Half-Height Basket",cat:'Basket',
   length_m:2.44, width_m:2.44, wt_default:2.0,
   aliases:['8ft half height basket','8hh basket','8x8 hh']},

  {key:'bsk_10x8_hh',      label:"10ft Half-Height Basket",cat:'Basket',
   length_m:3.05, width_m:2.44, wt_default:2.5,
   aliases:['10ft half height basket','10hh basket','10ft hh basket']},

  {key:'bsk_12x8_hh',      label:"12ft Half-Height Basket",cat:'Basket',
   length_m:3.66, width_m:2.44, wt_default:2.8,
   aliases:['12ft half height basket','12hh basket','12ft hh basket']},

  {key:'bsk_16x8_hh',      label:"16ft Half-Height Basket",cat:'Basket',
   length_m:4.88, width_m:2.44, wt_default:3.5,
   aliases:['16ft half height basket','16hh basket','16ft hh basket']},

  {key:'bsk_24x8_hh',      label:"24ft Half-Height Basket",cat:'Basket',
   length_m:7.32, width_m:2.44, wt_default:5.0,
   aliases:['24ft half height basket','24hh basket','24ft hh basket']},

  {key:'bsk_4x4_sm',       label:"Small Basket 4ft",    cat:'Basket',
   length_m:1.22, width_m:1.22, wt_default:0.8,
   aliases:['4ft basket','small basket 4','4x4 basket']},

  {key:'bsk_8x4',          label:"Cargo Basket 8ft×4ft",cat:'Basket',
   length_m:2.44, width_m:1.22, wt_default:1.2,
   aliases:['8x4 basket','8ft 4ft basket','cargo basket 8x4']},

  {key:'bsk_10x4',         label:"Cargo Basket 10ft×4ft",cat:'Basket',
   length_m:3.05, width_m:1.22, wt_default:1.5,
   aliases:['10x4 basket','10ft 4ft basket','cargo basket 10x4']},

  {key:'bsk_16x4',         label:"Mid Basket 16ft×4ft", cat:'Basket',
   length_m:4.88, width_m:1.22, wt_default:2.0,
   aliases:['16x4 basket','16ft 4ft basket']},

  {key:'bsk_20x4',         label:"Mid Basket 20ft×4ft", cat:'Basket',
   length_m:6.10, width_m:1.22, wt_default:2.5,
   aliases:['20x4 basket','20ft 4ft basket','25x4 basket','25ft basket']},

  {key:'bsk_25x4',         label:"Long Basket 25ft×4ft",cat:'Basket',
   length_m:7.62, width_m:1.22, wt_default:3.0,
   aliases:['25x4 basket','25ft basket 4ft','long basket 25','pipe basket 25']},

  {key:'bsk_24x6',         label:"Cargo Basket 24ft×6ft",cat:'Basket',
   length_m:7.32, width_m:1.83, wt_default:3.5,
   aliases:['24x6 basket','24ft 6ft basket']},

  {key:'bsk_11x6',         label:"Basket / PCE Skid 11ft×6ft",cat:'Basket',
   length_m:3.35, width_m:1.83, wt_default:2.0,
   aliases:['11x6 basket','11ft basket','pce skid','11x6 skid'], approx:true},

  /* ── Skips / Waste ───────────────────────────────────── */
  {key:'skip_6x6_vac',     label:"6ft×6ft Vacuum Skip", cat:'Skip',
   length_m:1.83, width_m:1.83, wt_default:1.2,
   aliases:['6x6 vacuum skip','6ft vacuum skip','vacuum skip 6','vac skip 6']},

  {key:'skip_7x6_vac',     label:"7ft×6ft Vacuum Skip", cat:'Skip',
   length_m:2.13, width_m:1.83, wt_default:1.2,
   aliases:['7x6 vacuum skip','7ft vacuum skip','vacuum skip 7','vac skip 7']},

  {key:'skip_waste_13ft',  label:"Waste Skip 13ft",     cat:'Skip',
   length_m:3.90, width_m:1.88, wt_default:2.0,
   aliases:['waste skip','13ft skip','boat skip','waste basket','empty box skip','mud skip']},

  {key:'skip_waste_sm',    label:"Waste Skip (Small)",  cat:'Skip',
   length_m:2.80, width_m:1.82, wt_default:1.5,
   aliases:['small waste skip','waste skip small','closed top skip']},

  /* ── Transporters ────────────────────────────────────── */
  {key:'trans_12ft',       label:"Transporter 12ft",    cat:'Module',
   length_m:3.66, width_m:1.22, wt_default:2.0,
   aliases:['12ft transporter','transporter 12']},

  {key:'trans_15ft',       label:"Transporter 15ft",    cat:'Module',
   length_m:4.57, width_m:2.44, wt_default:3.0,
   aliases:['15ft transporter','transporter 15']},

  {key:'trans_24ft',       label:"Transporter 24ft",    cat:'Module',
   length_m:7.32, width_m:2.44, wt_default:4.0,
   aliases:['24ft transporter','transporter 24']},
];

/* ── Convert metres to canvas pixels (using deck scale M=31 px/m) ── */
function ccu2px(preset){
  return {
    w: m2px_w(preset.length_m),   // length runs aft→bow (horizontal)
    h: m2px_h(preset.width_m),    // width runs port→stbd (vertical)
  };
}

/* ── Lookup: find a CCU_PRESET by label or alias (case-insensitive) ──
   Returns the preset or null.                                         */
function findPreset(name){
  if(!name) return null;
  const q = name.toLowerCase().trim();
  return CCU_PRESETS.find(p =>
    p.label.toLowerCase()===q ||
    p.key===q ||
    (p.aliases && p.aliases.some(a=>a.toLowerCase()===q ||
                                    q.includes(a.toLowerCase()) ||
                                    a.toLowerCase().includes(q)))
  ) || null;
}

/* ── CLIB_SIZE: legacy lookup, now delegates to CCU_PRESETS ── */
function clibSize(name){
  const preset = findPreset(name);
  if(preset) return ccu2px(preset);
  return null;  // returns null for unknown → fallback to current block size
}

/* ═══ CLIB: Cargo Library items shown in the panel ═══
   Now references CCU_PRESETS for dimensions.
   Each item stores length_m/width_m for display,
   and w/h in canvas px for placement.                  */
const CLIB = CCU_PRESETS.map(p => ({
  cat:    p.cat,
  name:   p.label,
  key:    p.key,
  w:      m2px_w(p.length_m),   // horizontal: along deck
  h:      m2px_h(p.width_m),    // vertical: across deck
  wt:     p.wt_default,
  length_m: p.length_m,
  width_m:  p.width_m,
  approx: p.approx || false,
}));

/* ════════════════════════════════════
   CARGO LIBRARY PERSONALISATION
   Persisted separately under key 'spicaTide_libPrefs'
   so it never touches the main cargo state.
════════════════════════════════════ */
const LIB_PREFS = {
  favs:    new Set(),   // Set of item keys (CLIB key or custom name)
  order:   [],          // Array of item keys — full desired order
  aliases: {},          // key → custom display string
};

function libKey(item){ return item.key || item.name; }

function saveLibPrefs(){
  try{
    localStorage.setItem('spicaTide_libPrefs', JSON.stringify({
      favs:    [...LIB_PREFS.favs],
      order:   LIB_PREFS.order,
      aliases: LIB_PREFS.aliases,
    }));
  }catch(e){}
}

function loadLibPrefs(){
  try{
    const d=JSON.parse(localStorage.getItem('spicaTide_libPrefs')||'{}');
    if(d.favs)  LIB_PREFS.favs   = new Set(d.favs);
    if(d.order) LIB_PREFS.order  = d.order;
    if(d.aliases)LIB_PREFS.aliases=d.aliases;
  }catch(e){}
}

/* Sort a flat item array: favs first, then respect LIB_PREFS.order,
   unknowns append at end preserving their natural position.          */
function sortedLibItems(items){
  const order = LIB_PREFS.order;
  const favs  = LIB_PREFS.favs;

  const ranked = items.map(it=>({it, key:libKey(it), fav:favs.has(libKey(it))}));
  ranked.sort((a,b)=>{
    // Favs always first
    if(a.fav !== b.fav) return a.fav ? -1 : 1;
    // Within group: respect saved order
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    if(ai===-1 && bi===-1) return 0;
    if(ai===-1) return 1;
    if(bi===-1) return -1;
    return ai - bi;
  });
  return ranked.map(r=>r.it);
}

const S={activeLocs:['BLEO','TART'],selLoc:'BLEO',selStatus:'L',pending:null,cargo:[],customLib:[],customLocs:[],voyRemarks:''};

/* ════════════════════════════════════
   CARGO LIBRARY
════════════════════════════════════ */
const DG_DATA=[
  {cls:'1.1',nm:'Explosives',sub:'Mass explosion',bg:'#f97316',tc:'#fff',bc:'#c04000'},
  {cls:'1.2',nm:'Explosives',sub:'Projection hazard',bg:'#f97316',tc:'#fff',bc:'#c04000'},
  {cls:'1.3',nm:'Explosives',sub:'Fire hazard',bg:'#f97316',tc:'#fff',bc:'#c04000'},
  {cls:'1.4',nm:'Explosives',sub:'Minor hazard',bg:'#f97316',tc:'#fff',bc:'#c04000'},
  {cls:'1.5',nm:'Explosives',sub:'Very insensitive',bg:'#f97316',tc:'#fff',bc:'#c04000'},
  {cls:'1.6',nm:'Explosives',sub:'Extr. insensitive',bg:'#f97316',tc:'#fff',bc:'#c04000'},
  {cls:'2.1',nm:'Flamm. Gas',sub:'e.g. LPG',bg:'#ef4444',tc:'#fff',bc:'#991b1b'},
  {cls:'2.2',nm:'Non-fl. Gas',sub:'e.g. N₂',bg:'#22c55e',tc:'#fff',bc:'#14532d'},
  {cls:'2.3',nm:'Toxic Gas',sub:'e.g. chlorine',bg:'#e5e5e5',tc:'#111',bc:'#525252'},
  {cls:'3',nm:'Flamm. Liquid',sub:'e.g. methanol',bg:'#ef4444',tc:'#fff',bc:'#991b1b'},
  {cls:'4.1',nm:'Flamm. Solid',sub:'Flammable',bg:'#f0f0f0',tc:'#111',bc:'#c03030',stripe:'#ef4444'},
  {cls:'4.2',nm:'Spont. Comb.',sub:'Pyrophoric',bg:'#f0f0f0',tc:'#111',bc:'#c03030',stripe:'#ef4444'},
  {cls:'4.3',nm:'Dangerous Wet',sub:'Water reactive',bg:'#3b82f6',tc:'#fff',bc:'#1e3a8a'},
  {cls:'5.1',nm:'Oxidizing Agt',sub:'e.g. peroxides',bg:'#eab308',tc:'#111',bc:'#713f12'},
  {cls:'5.2',nm:'Org. Peroxide',sub:'Unstable',bg:'#f97316',tc:'#fff',bc:'#7c2d12',half:'#eab308'},
  {cls:'6.1',nm:'Toxic',sub:'Poisonous',bg:'#e5e5e5',tc:'#111',bc:'#404040'},
  {cls:'6.2',nm:'Infectious',sub:'Biological',bg:'#e5e5e5',tc:'#111',bc:'#404040'},
  {cls:'7',nm:'Radioactive',sub:'Radioactive',bg:'#eab308',tc:'#111',bc:'#713f12',half:'#f0f0f0'},
  {cls:'8',nm:'Corrosive',sub:'Acids/alkalis',bg:'#e5e5e5',tc:'#111',bc:'#171717',half:'#171717'},
  {cls:'9',nm:'Misc.',sub:'Other hazardous',bg:'#e5e5e5',tc:'#111',bc:'#404040',stripe:'#404040'},
];
function dgBg(d){
  if(d.stripe)return`repeating-linear-gradient(45deg,${d.bg},${d.bg} 4px,${d.stripe} 4px,${d.stripe} 8px)`;
  if(d.half)return`linear-gradient(180deg,${d.bg} 50%,${d.half} 50%)`;
  return d.bg;
}
/* ════════════════════════════════════
   FULL UKCS DG SEGREGATION MATRIX
   Source: UKCS Supplement §2.3, Rev 2 (2017)
   X=0 (none), A=1 (away from / 1 MINI),
   B=2 (separated from / 2 MINI),
   C=3 (separated by complete compartment / 3 MINI)
   * = see Class 1 intro (treated as C for planning)
   Matrix is symmetric — stored upper-triangle only,
   lookup always sorts [a,b] ascending.
════════════════════════════════════ */
const SEG_FULL = {
  /* Explosives 1.1/1.2/1.5 row */
  '1.1': {
    '1.3':0,'1.4':0,               /* * entries within group */
    '2.1':3,'2.2':2,'2.3':2,
    '3':3,'4.1':3,'4.2':3,'4.3':3,
    '5.1':3,'5.2':3,
    '6.1':2,'6.2':3,
    '7':2,'8':2,'9':0,
  },
  /* Explosives 1.3/1.6 row */
  '1.3': {
    '1.4':0,
    '2.1':3,'2.2':2,'2.3':2,
    '3':3,'4.1':3,'4.2':3,'4.3':3,
    '5.1':3,'5.2':3,
    '6.1':2,'6.2':3,
    '7':2,'8':2,'9':0,
  },
  /* Explosives 1.4 row */
  '1.4': {
    '2.1':2,'2.2':1,'2.3':1,
    '3':2,'4.1':2,'4.2':2,'4.3':2,
    '5.1':2,'5.2':2,
    '6.1':0,'6.2':2,
    '7':2,'8':2,'9':0,
  },
  /* Flammable Gases 2.1 */
  '2.1': {
    '2.2':0,'2.3':0,
    '3':2,'4.1':1,'4.2':2,'4.3':1,
    '5.1':2,'5.2':2,
    '6.1':0,'6.2':3,
    '7':2,'8':1,'9':0,
  },
  /* Non-Toxic Non-Flammable Gases 2.2 */
  '2.2': {
    '2.3':0,
    '3':1,'4.1':0,'4.2':1,'4.3':0,
    '5.1':0,'5.2':1,
    '6.1':1,'6.2':3,
    '7':1,'8':0,'9':0,
  },
  /* Poisonous Gases 2.3 */
  '2.3': {
    '3':0,'4.1':0,'4.2':2,'4.3':0,
    '5.1':0,'5.2':1,
    '6.1':2,'6.2':3,
    '7':1,'8':1,'9':0,
  },
  /* Flammable Liquids 3 */
  '3': {
    '4.1':0,'4.2':2,'4.3':0,
    '5.1':2,'5.2':2,
    '6.1':0,'6.2':3,
    '7':2,'8':0,'9':0,
  },
  /* Flammable Solids 4.1 */
  '4.1': {
    '4.2':1,'4.3':0,
    '5.1':1,'5.2':2,
    '6.1':0,'6.2':3,
    '7':2,'8':1,'9':0,
  },
  /* Spontaneously combustible 4.2 */
  '4.2': {
    '4.3':0,
    '5.1':2,'5.2':2,
    '6.1':1,'6.2':3,
    '7':2,'8':1,'9':0,
  },
  /* Dangerous when wet 4.3 */
  '4.3': {
    '5.1':2,'5.2':2,
    '6.1':0,'6.2':3,
    '7':1,'8':1,'9':0,
  },
  /* Oxidizing substances 5.1 */
  '5.1': {
    '5.2':2,
    '6.1':1,'6.2':3,
    '7':1,'8':2,'9':0,
  },
  /* Organic Peroxides 5.2 */
  '5.2': {
    '6.1':2,'6.2':3,
    '7':2,'8':2,'9':0,
  },
  /* Poisons 6.1 */
  '6.1': {
    '6.2':3,
    '7':1,'8':1,'9':0,
  },
  /* Infectious 6.2 */
  '6.2': {
    '7':0,'8':2,'9':0,
  },
  /* Radioactive 7 */
  '7': {
    '8':2,'9':0,
  },
  /* Corrosives 8 */
  '8': {
    '9':0,
  },
};

/* Normalise a DG class string for matrix lookup.
   "1.1","1.2","1.5" all map to "1.1" (same row).
   "1.3","1.6" → "1.3". "1.4" → "1.4".           */
function normDG(cls){
  if(!cls)return '';
  const s=String(cls).trim();
  if(['1.1','1.2','1.5'].includes(s))return '1.1';
  if(['1.3','1.6'].includes(s))return '1.3';
  return s;
}

/* Return segregation level (0–3) between two DG classes. */
function getSeg(a,b){
  if(!a||!b)return 0;
  const na=normDG(a),nb=normDG(b);
  if(na===nb)return 0;
  const[x,y]=[na,nb].sort();
  return(SEG_FULL[x]&&SEG_FULL[x][y]!=null)?SEG_FULL[x][y]:0;
}

/* MINI clearance in canvas px.
   MINI = 6ft × 6ft = 1.83m × 1.83m (CCU_PRESETS key 'cont_mini_6').
   Use the longer dimension (1.83m) as the unit distance.
   A=1 MINI, B=2 MINI, C=3 MINI                           */
function miniPx(){
  const mini=CCU_PRESETS.find(p=>p.key==='cont_mini_6');
  return mini ? m2px_w(mini.length_m) : m2px_w(1.83);  // fallback 1.83m
}

function segClearancePx(level){
  // level: 0=none, 1=1 MINI, 2=2 MINI, 3=3 MINI
  return Math.round(miniPx() * Math.max(0, level));
}

/* ── DG Drag Segregation Overlay ─────────────────────────
   Called during drag of a cargo block that has a DG class.
   Renders temporary red exclusion rectangles into #dgDragOverlay.
   dragCls  = DG class of the cargo being dragged
   excludeId = id of dragged cargo (skip it in the placed list)
   ─────────────────────────────────────────────────────── */
function showDragSegOverlay(dragCls, excludeId){
  const ovl=document.getElementById('dgDragOverlay');
  if(!ovl)return;
  ovl.innerHTML='';
  if(!dragCls)return;

  const ndrag=normDG(dragCls);
  const palette={
    1:'rgba(251,146,60,.28)',   // A — amber / 1 MINI
    2:'rgba(220,38,38,.32)',    // B — red   / 2 MINI
    3:'rgba(139,0,0,.42)',      // C — deep red / 3 MINI
  };
  const borderCol={1:'#f97316',2:'#dc2626',3:'#7f1d1d'};
  const levelLabel={1:'1 MINI','2':'2 MINI',2:'2 MINI',3:'3 MINI'};

  S.cargo.forEach(placed=>{
    if(placed.id===excludeId||!placed.dgClass)return;
    const level=getSeg(dragCls, placed.dgClass);
    if(level<1)return;

    const pad=segClearancePx(level);
    /* Expand placed cargo footprint by pad on all sides */
    const zx=Math.max(0,   placed.x - pad);
    const zy=Math.max(0,   placed.y - pad);
    const zx2=Math.min(TW, placed.x + placed.w + pad);
    const zy2=Math.min(CVH,placed.y + placed.h + pad);
    const zw=zx2-zx, zh=zy2-zy;

    const z=document.createElement('div');
    z.className='dg-drag-zone';
    z.style.cssText=[
      `left:${zx}px`,`top:${zy}px`,
      `width:${zw}px`,`height:${zh}px`,
      `background:${palette[level]||palette[2]}`,
      `border:2px dashed ${borderCol[level]||borderCol[2]}`,
      'position:absolute','pointer-events:none','z-index:8','border-radius:3px',
      'display:flex','align-items:center','justify-content:center',
    ].join(';');

    const lbl=document.createElement('span');
    lbl.style.cssText=[
      `font-family:'Manrope',sans-serif`,
      'font-size:9px','font-weight:700','letter-spacing:1px','text-transform:uppercase',
      `color:${borderCol[level]||borderCol[2]}`,
      'padding:1px 5px','border-radius:3px',
      'background:rgba(255,255,255,.85)','white-space:nowrap',
      'pointer-events:none',
    ].join(';');
    lbl.textContent=`${level} MINI · DG${placed.dgClass}`;
    z.appendChild(lbl);
    ovl.appendChild(z);
  });
}

function clearDragSegOverlay(){
  const ovl=document.getElementById('dgDragOverlay');
  if(ovl)ovl.innerHTML='';
}

/* ════════════════════════════════════
   CANVAS
════════════════════════════════════ */
function setupCanvas(){
  const cv=document.getElementById('cvDECK');
  cv.style.width=TW+'px';
  const HB_H=Math.round(2.16*YS);

  /* Bay stripes + ghost numbers */
  let x=0;
  BW.forEach((w,i)=>{
    if(i%2===0){const s=document.createElement('div');s.className='bay-stripe';s.style.left=x+'px';s.style.width=w+'px';cv.appendChild(s);}
    const bn=document.createElement('div');
    bn.className='bay-num';
    bn.style.cssText=`position:absolute;left:${x}px;width:${w}px;top:50%;transform:translateY(-50%);
      text-align:center;font-family:'Manrope',sans-serif;font-size:40px;font-weight:900;
      color:rgba(49,51,44,.14);pointer-events:none;z-index:1;user-select:none;line-height:1;`;
    bn.textContent=12-i;cv.appendChild(bn);x+=w;
  });

  /* Bay lines */
  x=0;BW.slice(0,-1).forEach(w=>{x+=w;const l=document.createElement('div');l.className='bay-line';l.style.left=x+'px';cv.appendChild(l);});

  /* Centre line + PORT/STBD */
  const cl=document.createElement('div');cl.className='center-line';cl.style.top=(CVH/2)+'px';cv.appendChild(cl);
  [{txt:'PORT ▶',top:'8px'},{txt:'STBD ▶',bottom:'8px'}].forEach(o=>{
    const el=document.createElement('div');el.className='side-lbl';
    Object.assign(el.style,o.top?{top:o.top}:{bottom:o.bottom});el.textContent=o.txt;cv.appendChild(el);
  });

  /* Zones */
  addZone(cv,0,0,20,CVH,'tiger','');
  addZone(cv,Math.round(BL_[2]+BW[2]*0.4),0,Math.round(BW[2]*0.6+BW[3]*0.55),HB_H,'hose','HOSE BAY');
  addZone(cv,BL_[2],CVH-HB_H,Math.round(BW[2]+BW[3]*0.88),HB_H,'hose','HOSE BAY');
  addZone(cv,TW-Math.round(4*M),0,Math.round(4*M),Math.round(3.75*YS),'store','STORE');

  /* DG limit */
  const DGX=BL_[10];
  const dgl=document.createElement('div');dgl.className='dg-limit-line';dgl.style.left=DGX+'px';cv.appendChild(dgl);
  ['top:2px','bottom:2px'].forEach(pos=>{const t=document.createElement('div');t.className='dg-limit-lbl';t.style.cssText=`left:${DGX}px;${pos};`;t.textContent='DG LIMIT';cv.appendChild(t);});

  /* No DG zone — large elegant label */
  const noDGw=TW-DGX;
  const nodg=document.createElement('div');
  nodg.style.cssText=`position:absolute;left:${DGX}px;top:0;width:${noDGw}px;height:100%;pointer-events:none;z-index:2;
    background:repeating-linear-gradient(45deg,rgba(220,38,38,.055),rgba(220,38,38,.055) 6px,transparent 6px,transparent 12px);
    border-left:2px dashed rgba(220,38,38,.45);`;
  cv.appendChild(nodg);

  /* Big NO DG CARGO label — rotated, centred in zone */
  const noDGlbl=document.createElement('div');
  noDGlbl.style.cssText=`position:absolute;pointer-events:none;z-index:5;
    left:${DGX}px;width:${noDGw}px;top:0;height:${CVH}px;
    display:flex;align-items:center;justify-content:center;`;
  noDGlbl.innerHTML=`<span style="font-family:'Manrope',sans-serif;font-size:22px;font-weight:900;
    letter-spacing:3px;text-transform:uppercase;color:rgba(180,30,30,.22);
    transform:rotate(-90deg);white-space:nowrap;">No DG Cargo</span>`;
  cv.appendChild(noDGlbl);

  /* ── METHANOL CURVE — precise circular arc via SVG A command ──
     Operational spec:
     - Start (anchor): halfway between outer PORT edge and midship centreline,
       in Bay 12 → x = BL_[0]+BW[0]/2 ≈ 64px, y = CVH/4 = 95px (port quarter-height)
     - The arc sweeps clockwise as a quarter-circle
     - End: STBD side (bottom), near right edge of Bay 10 → x = BL_[2]+BW[2] = 402, y = CVH = 380
     - Circle centre: computed so radius is consistent
     
     For a true circular arc from (sx,sy) to (ex,ey) with radius R:
     We use SVG arc notation: A rx ry x-rotation large-arc-flag sweep-flag ex ey
     
     Choose: start at (65, 95), end at (402, 380)
     Horizontal distance: 337px, vertical: 285px
     Diagonal: sqrt(337²+285²) ≈ 441px → radius ≈ 290 for a clean quarter arc
     Using R=340 gives a naturally sweeping curve across Bay 12-11-10-9 area.
  */
  const svgNS='http://www.w3.org/2000/svg';
  const msvg=document.createElementNS(svgNS,'svg');
  msvg.setAttribute('width',TW);
  msvg.setAttribute('height',CVH);
  msvg.style.cssText='position:absolute;top:0;left:0;pointer-events:none;z-index:4;overflow:visible;';

  /* Anchor point: Bay 12 PORT half-width midpoint */
  /* ── Methanol zone arc — original R=340 circle, extended to Bay12 left edge
     Original arc: M 64 95 A 340 340 0 0 1 402 380  (same circle, R=340)
     Extended:     M 0 102 A 340 340 0 0 1 402 380
     The point (0,102) is on the exact same circle as the original arc —
     computed from circle center (66.5, 435.0) at radius 340.
     This continues the original curve seamlessly to the deck left edge. */
  const mEndX = BL_[3];   // = 402 — Bay9 left boundary
  const mEndY = CVH;       // = 380 — STBD bottom edge

  const arcPath=document.createElementNS(svgNS,'path');
  /* Same circle (R=340), extended start to x=0 on Bay12 left edge */
  arcPath.setAttribute('d',`M 0 102 A 340 340 0 0 1 ${mEndX} ${mEndY}`);
  arcPath.setAttribute('stroke','rgba(202,158,0,0.28)');  /* original amber-yellow, 28% */
  arcPath.setAttribute('stroke-width','6');               /* original width */
  arcPath.setAttribute('fill','none');
  arcPath.setAttribute('stroke-linecap','round');

  msvg.appendChild(arcPath);

  /* Methanol label — subtle, inside the arc area near Bay12 */
  const mtxt=document.createElementNS(svgNS,'text');
  mtxt.setAttribute('x', 14);           /* Bay12 left area, near arc start */
  mtxt.setAttribute('y', 88);           /* just above the arc at x≈64, y≈95 */
  mtxt.setAttribute('font-family','Manrope,sans-serif');
  mtxt.setAttribute('font-size','9.5');
  mtxt.setAttribute('font-weight','700');
  mtxt.setAttribute('letter-spacing','1.5');
  mtxt.setAttribute('fill','rgba(133,97,0,0.40)');
  mtxt.setAttribute('text-anchor','start');
  mtxt.textContent='METHANOL ZONE';
  msvg.appendChild(mtxt);

  cv.appendChild(msvg);

  /* Lashing dollies */
  [0,BL_[2],BL_[3],BL_[6],BL_[9],BL_[10],TW].forEach(lx=>{addDolly(cv,lx,0);addDolly(cv,lx,CVH);});
  [BL_[1]+Math.round(BW[1]/2),BL_[4]+Math.round(BW[4]/2),BL_[7]+Math.round(BW[7]/2),BL_[11]+Math.round(BW[11]/2)]
    .forEach(lx=>{addDring(cv,lx,0);addDring(cv,lx,CVH);});

  /* Skip */
  const skip=document.createElement('div');skip.className='ships-skip';
  skip.style.cssText=`left:${BL_[10]+8}px;top:5px;width:82px;height:50px;`;
  skip.innerHTML="Ship's<br>Waste<br>Skip";cv.appendChild(skip);

  /* DG exclusion overlay (pending placement) */
  const dgo=document.createElement('div');dgo.id='dgExclOverlay';
  dgo.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:8;';
  cv.appendChild(dgo);

  /* DG drag segregation overlay (live during block drag) */
  const dgd=document.createElement('div');dgd.id='dgDragOverlay';
  dgd.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:9;';
  cv.appendChild(dgd);

  cv.addEventListener('mousedown',e=>{
    if(!S.pending||e.target.closest('.cb'))return;
    e.preventDefault();
    const r=cv.getBoundingClientRect();
    placeAt((e.clientX-r.left)/zoomLevel,(e.clientY-r.top)/zoomLevel);
  });
}

function addZone(cv,x,y,w,h,type,label){const z=document.createElement('div');z.className=`zone z-${type}`;z.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;z.innerHTML=`<span class="z-lbl">${label}</span>`;cv.appendChild(z);}
function addDolly(cv,x,y){const d=document.createElement('div');d.className='lp-dolly';d.style.left=x+'px';d.style.top=y+'px';cv.appendChild(d);}
function addDring(cv,x,y){const d=document.createElement('div');d.className='lp-dring';d.style.left=x+'px';d.style.top=y+'px';cv.appendChild(d);}

/* ════════════════════════════════════
   DATE PICKER
════════════════════════════════════ */
let calDate=new Date();
let selDate=new Date();

function fmtDate(d){return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});}
function setDateDisplay(){document.getElementById('dateBtn').textContent=fmtDate(selDate);}

function renderCalendar(){
  const y=calDate.getFullYear(),m=calDate.getMonth();
  document.getElementById('calMonthLbl').textContent=new Date(y,m,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const grid=document.getElementById('calGrid');grid.innerHTML='';
  ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d=>{const el=document.createElement('div');el.className='cal-day-lbl';el.textContent=d;grid.appendChild(el);});
  const first=new Date(y,m,1);
  let dow=(first.getDay()+6)%7; // Mon=0
  for(let i=0;i<dow;i++){const el=document.createElement('div');el.className='cal-day other-month';const prev=new Date(y,m,-(dow-i-1));el.textContent=prev.getDate();grid.appendChild(el);}
  const days=new Date(y,m+1,0).getDate();
  const today=new Date();
  for(let d=1;d<=days;d++){
    const el=document.createElement('div');el.className='cal-day';
    const isToday=d===today.getDate()&&m===today.getMonth()&&y===today.getFullYear();
    const isSel=d===selDate.getDate()&&m===selDate.getMonth()&&y===selDate.getFullYear();
    if(isSel)el.classList.add('sel');else if(isToday)el.classList.add('today');
    el.textContent=d;
    el.onclick=()=>{selDate=new Date(y,m,d);setDateDisplay();renderCalendar();document.getElementById('calPopup').classList.remove('open');save();};
    grid.appendChild(el);
  }
}

function positionCalPopup(){
  const btn=document.getElementById('dateBtn');
  const r=btn.getBoundingClientRect();
  const pop=document.getElementById('calPopup');
  pop.style.top=(r.bottom+6)+'px';
  pop.style.right=(window.innerWidth-r.right)+'px';
  pop.style.left='auto';
}

function bindDatePicker(){
  setDateDisplay();
  document.getElementById('dateBtn').onclick=e=>{
    e.stopPropagation();positionCalPopup();
    calDate=new Date(selDate);renderCalendar();
    document.getElementById('calPopup').classList.toggle('open');
  };
  document.getElementById('calPrev').onclick=e=>{e.stopPropagation();calDate=new Date(calDate.getFullYear(),calDate.getMonth()-1,1);renderCalendar();};
  document.getElementById('calNext').onclick=e=>{e.stopPropagation();calDate=new Date(calDate.getFullYear(),calDate.getMonth()+1,1);renderCalendar();};
  document.addEventListener('click',e=>{if(!document.getElementById('calPopup').contains(e.target)&&e.target!==document.getElementById('dateBtn'))document.getElementById('calPopup').classList.remove('open');});
}

/* ════════════════════════════════════
   LOCATIONS COLLAPSIBLE PANEL
════════════════════════════════════ */
function bindLocsPanel(){
  const row=document.getElementById('locsRow');
  document.getElementById('locsToggleBar').onclick=()=>{row.classList.toggle('collapsed');};
}

function positionDrawer(){
  const locsRow=document.getElementById('locsRow');
  const r=locsRow.getBoundingClientRect();
  const drawer=document.getElementById('locDrawer');
  drawer.style.top=r.bottom+'px';
}

function buildLocGrid(){
  const g=document.getElementById('locGrid');g.innerHTML='';

  /* Helper: build one location card with toggle + delete */
  function makeLocOpt(loc, isCustom){
    const inUse=S.activeLocs.includes(loc.id);
    const displayColor=getLocBase(loc.id);
    const el=document.createElement('div');
    el.className='loc-opt'+(inUse?' in-use':'');
    el.style.setProperty('--lc',displayColor);

    const customTag=isCustom?`<div class="loc-opt-custom-tag">custom</div>`:'';
    const chk=`<div class="loc-opt-chk">✓</div>`;
    el.innerHTML=`
      <div class="loc-opt-dot"></div>
      <div class="loc-opt-name">${loc.name}</div>
      ${isCustom?customTag:chk}
      ${!isCustom?'':chk}
      <button class="loc-opt-del" title="Delete location">␡</button>`;

    /* Toggle active state on card click (not delete button) */
    el.addEventListener('click', e=>{
      if(e.target.closest('.loc-opt-del')) return;
      toggleLoc(loc.id);
    });

    /* Delete button */
    el.querySelector('.loc-opt-del').addEventListener('click', e=>{
      e.stopPropagation();
      showLocDeleteDlg(loc.id);
    });

    return el;
  }

  /* Built-in locations */
  LOC_ALL.forEach(loc=>g.appendChild(makeLocOpt(loc, false)));

  /* Custom locations */
  S.customLocs.forEach(loc=>g.appendChild(makeLocOpt(loc, true)));

  /* "+ Add custom location" button */
  const addBtn=document.createElement('div');
  addBtn.className='loc-opt loc-opt-add';
  addBtn.innerHTML=`<div class="loc-opt-add-icon">＋</div><div class="loc-opt-name">Add location…</div>`;
  addBtn.onclick=e=>{
    e.stopPropagation();
    const name=prompt('Enter new location name:','');
    if(!name||!name.trim()) return;
    const newId=createCustomLoc(name.trim());
    if(newId) buildLocGrid();
  };
  g.appendChild(addBtn);
}

function toggleLoc(id){
  if(S.activeLocs.includes(id)){
    if(S.cargo.some(c=>c.platform===id)){alert(`Remove cargo for "${locById(id)?.name}" first.`);return;}
    S.activeLocs=S.activeLocs.filter(x=>x!==id);
    /* Free the dynamic colour slot so it can be reused */
    delete DYN_COLORS[id];
    if(S.selLoc===id)S.selLoc=S.activeLocs[0]||null;
  }else{
    S.activeLocs.push(id);
    /* Assign dynamic colour immediately, considering all already-active */
    assignLocColor(id);
    if(!S.selLoc)S.selLoc=id;
  }
  buildLocGrid();buildActiveLocStrip();save();
}

/* ════════════════════════════════════════════════════════════
   LOCATION QUICK FILTER  v38.16
   
   Click a loc-card in the header → isolate that platform.
   All other cargo blocks dim (opacity + desaturate).
   Second click on the same card → clear filter.
   
   Implementation: injected <style id="locFilterStyle"> rule.
   No re-render needed — pure CSS class toggling on .cb elements.
   
   data-loc="BLEO" attribute stamped on each .cb in renderBlock.
   Filter applies/clears via applyLocFilter(id) / clearLocFilter().
════════════════════════════════════════════════════════════ */

let LOC_FILTER = null; /* currently filtered location id, or null */

function applyLocFilter(id){
  LOC_FILTER = id;

  /* Inject CSS that dims all .cb not matching the filter */
  let styleEl = document.getElementById('locFilterStyle');
  if(!styleEl){
    styleEl = document.createElement('style');
    styleEl.id = 'locFilterStyle';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent =
    `.cb:not([data-loc="${id}"]){opacity:.18;filter:saturate(0);pointer-events:none;}` +
    `.cb[data-loc="${id}"]{z-index:20;}`;

  /* Mark loc-cards */
  document.querySelectorAll('.loc-card').forEach(card => {
    card.classList.toggle('loc-filtered', card.dataset.locId === id);
  });

  /* Mark toggle bar */
  const bar = document.getElementById('locsToggleBar');
  if(bar) bar.classList.add('filter-active');
}

function clearLocFilter(){
  LOC_FILTER = null;

  const styleEl = document.getElementById('locFilterStyle');
  if(styleEl) styleEl.textContent = '';

  document.querySelectorAll('.loc-card').forEach(c => c.classList.remove('loc-filtered'));
  const bar = document.getElementById('locsToggleBar');
  if(bar) bar.classList.remove('filter-active');
}

function buildActiveLocStrip(){
  const strip=document.getElementById('activeLocStrip');strip.innerHTML='';
  const cnt=document.getElementById('locsCount');
  cnt.textContent=S.activeLocs.length;
  if(!S.activeLocs.length){
    strip.innerHTML='<div style="display:flex;align-items:center;padding:0 20px;font-size:11px;color:var(--txt3);">No locations — click ⊕ to add</div>';
    return;
  }
  S.activeLocs.forEach(id=>{
    const loc=locById(id);if(!loc)return;

    /* Only deck cargo counts — not queue, not library */
    const mine=S.cargo.filter(c=>c.platform===id);

    /* Compute per-status data — only statuses with ≥1 item are rendered */
    const statuses=[
      {key:'L',   label:'L'},
      {key:'BL',  label:'BL'},
      {key:'ROB', label:'ROB'},
    ].map(s=>{
      const items=mine.filter(c=>c.status===s.key);
      const wt=items.reduce((a,c)=>a+(parseFloat(c.wt)||0),0);
      return {...s, count:items.length, wt};
    }).filter(s=>s.count>0);  // ← only present statuses

    const effectiveBase=getLocBase(id);
    const cols=locColors(effectiveBase,id);

    /* Card element — always rendered */
    const el=document.createElement('div');
    el.className='loc-card'+(S.selLoc===id?' sel':'');
    el.style.setProperty('--lc',effectiveBase);

    /* Name row — always visible */
    const head=document.createElement('div');
    head.className='loc-card-head';
    head.innerHTML=`<div class="loc-card-dot"></div><div class="loc-card-name">${loc.name}</div>`;

    /* Status pill strip — only present statuses */
    const pillStrip=document.createElement('div');
    pillStrip.className='loc-card-pills';

    if(statuses.length===0){
      /* Empty: no cargo on deck for this location */
      const empty=document.createElement('div');
      empty.className='loc-card-empty';
      empty.textContent='no cargo on deck';
      pillStrip.appendChild(empty);
    } else {
      statuses.forEach(s=>{
        const bgCol=cols[s.key];
        const pill=document.createElement('div');
        pill.className='loc-pill';
        pill.style.background=bgCol;
        /* Derive border from colour */
        pill.style.borderColor=darken(bgCol,.15);

        const wtStr=s.wt>0?s.wt.toFixed(1)+'T':'';
        pill.innerHTML=
          `<span class="loc-pill-lbl">${s.label}</span>`+
          `<span class="loc-pill-val">${s.count}</span>`+
          (wtStr?`<span class="loc-pill-wt">${wtStr}</span>`:'');
        pillStrip.appendChild(pill);
      });
    }

    /* Remove button */
    const rm=document.createElement('div');
    rm.className='loc-card-rm';rm.textContent='×';
    rm.addEventListener('click',e=>{e.stopPropagation();toggleLoc(id);});

    el.appendChild(head);
    el.appendChild(pillStrip);
    el.appendChild(rm);
    /* data-loc-id for filter targeting */
    el.dataset.locId = id;
    el.addEventListener('click', e => {
      /* Ignore if remove button was clicked */
      if(e.target.closest('.loc-card-rm')) return;
      /* Toggle filter: second click on active filter → clear */
      if(LOC_FILTER === id){
        clearLocFilter();
      } else {
        /* Set as sel loc (existing behaviour) + apply filter */
        S.selLoc = id;
        applyLocFilter(id);
        buildActiveLocStrip();
      }
    });
    strip.appendChild(el);
  });

  /* Re-apply filter highlight if a filter is currently active */
  if(LOC_FILTER){
    document.querySelectorAll('.loc-card').forEach(card => {
      card.classList.toggle('loc-filtered', card.dataset.locId === LOC_FILTER);
    });
    const bar = document.getElementById('locsToggleBar');
    if(bar) bar.classList.add('filter-active');
  }
}

/* ════════════════════════════════════
   LOCATION DELETE DIALOG
   Premium Apple-style confirmation.
   Works for both built-in and custom locations.
════════════════════════════════════ */

/* Checks whether a location id is in use:
   - on deck (S.cargo)
   - in import queue (IMPORT_QUEUE)
   Returns { deckCount, queueCount, total }                */
function locUsageCount(id){
  const deckCount  = S.cargo.filter(c=>c.platform===id).length;
  const queueCount = IMPORT_QUEUE.filter(q=>q.locId===id).length;
  return { deckCount, queueCount, total: deckCount+queueCount };
}

function showLocDeleteDlg(id){
  const loc = locById(id);
  if(!loc) return;

  const usage   = locUsageCount(id);
  const colour  = getLocBase(id);
  const blocked = usage.total > 0;

  /* Populate header */
  document.getElementById('locDelLocNameText').textContent = loc.name;
  document.getElementById('locDelLocDot').style.background = colour;

  /* Icon */
  const icon = document.getElementById('locDelIcon');
  if(blocked){
    icon.className = 'loc-del-icon blocked';
    icon.textContent = '⚠';
  } else {
    icon.className = 'loc-del-icon destructive';
    icon.textContent = '🗑';
  }

  /* Title + message */
  const title = document.getElementById('locDelTitle');
  const msg   = document.getElementById('locDelMsg');
  const info  = document.getElementById('locDelInfo');

  if(blocked){
    title.textContent = 'Cannot Delete Location';
    msg.className     = 'loc-del-msg blocked-msg';
    msg.innerHTML     = `<b>${escHtml(loc.name)}</b> is currently assigned to cargo and cannot be deleted.`;
    /* Build detail line */
    const parts = [];
    if(usage.deckCount)  parts.push(`${usage.deckCount} item${usage.deckCount!==1?'s':''} on deck`);
    if(usage.queueCount) parts.push(`${usage.queueCount} item${usage.queueCount!==1?'s':''} in Import Queue`);
    info.textContent = `Remove or reassign the following first: ${parts.join(' and ')}.`;
    info.className   = 'loc-del-info visible';
  } else {
    title.textContent = 'Delete Location?';
    msg.className     = 'loc-del-msg';
    const isBuiltIn = !!LOC_ALL.find(l=>l.id===id);
    if(isBuiltIn){
      msg.innerHTML = `Are you sure you want to remove <b>${escHtml(loc.name)}</b> from this voyage? It can be re-added later from the locations panel.`;
    } else {
      msg.innerHTML = `Are you sure you want to permanently delete the custom location <b>${escHtml(loc.name)}</b>? This cannot be undone.`;
    }
    info.className = 'loc-del-info'; // hidden
  }

  /* Buttons */
  const btns = document.getElementById('locDelBtns');
  btns.innerHTML = '';

  if(blocked){
    /* Only OK button — no destructive action available */
    const ok = document.createElement('button');
    ok.className = 'loc-del-btn ok-only';
    ok.textContent = 'OK';
    ok.onclick = closeLocDeleteDlg;
    btns.appendChild(ok);
  } else {
    const cancel = document.createElement('button');
    cancel.className = 'loc-del-btn cancel';
    cancel.textContent = 'Cancel';
    cancel.onclick = closeLocDeleteDlg;

    const del = document.createElement('button');
    del.className = 'loc-del-btn confirm-del';
    del.textContent = 'Delete';
    del.onclick = ()=>{ execDeleteLoc(id); closeLocDeleteDlg(); };

    btns.appendChild(cancel);
    btns.appendChild(del);
  }

  document.getElementById('locDelOv').classList.add('open');
}

function closeLocDeleteDlg(){
  document.getElementById('locDelOv').classList.remove('open');
}

function execDeleteLoc(id){
  /* Safety check — never delete if cargo still assigned */
  if(locUsageCount(id).total > 0) return;

  /* Deactivate from voyage */
  S.activeLocs = S.activeLocs.filter(x=>x!==id);
  delete DYN_COLORS[id];
  if(S.selLoc===id) S.selLoc = S.activeLocs[0]||null;

  /* Remove from customLocs if it's custom (built-ins are never purged from LOC_ALL) */
  S.customLocs = S.customLocs.filter(l=>l.id!==id);

  buildLocGrid();
  buildActiveLocStrip();
  save();
}

function bindLocDeleteDlg(){
  /* Close on overlay click */
  document.getElementById('locDelOv').addEventListener('click', e=>{
    if(e.target===document.getElementById('locDelOv')) closeLocDeleteDlg();
  });
  /* Escape key */
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape' && document.getElementById('locDelOv').classList.contains('open')){
      closeLocDeleteDlg();
    }
  });
}

function bindLocDrawer(){
  const drawer=document.getElementById('locDrawer');
  const btn=document.getElementById('btnAddLoc');
  btn.addEventListener('click',e=>{
    e.stopPropagation();positionDrawer();
    drawer.classList.toggle('open',!drawer.classList.contains('open'));
    if(drawer.classList.contains('open'))buildLocGrid();
  });
  document.getElementById('locDrawerClose').addEventListener('click',()=>drawer.classList.remove('open'));
  document.addEventListener('click',e=>{if(!drawer.contains(e.target)&&!btn.contains(e.target))drawer.classList.remove('open');});
  window.addEventListener('resize',()=>{if(drawer.classList.contains('open'))positionDrawer();});
}

/* ════════════════════════════════════
   PLACEMENT + RENDER
════════════════════════════════════ */
function _placeAtCore(cx,cy){
  const p=S.pending,it=p.item,isC=p.type==='cargo';
  /* Use preset canvas px dimensions; fallback to 6×6ft (~1.83×1.83m) square */
  const w=isC?(it.w||m2px_w(1.83)):m2px_w(1.83);
  const h=isC?(it.h||m2px_h(1.83)):m2px_h(1.83);
  /* Store real-world metres for rotation and display; preserve from preset */
  const length_m = isC&&it.length_m ? it.length_m : (w/M);
  const width_m  = isC&&it.width_m  ? it.width_m  : (h/M);
  const c={id:Date.now()+Math.random(),side:'DECK',
    x:Math.max(0,Math.min(cx-w/2,TW-w)),
    y:Math.max(0,Math.min(cy-h/2,CVH-h)),
    w,h,
    length_m, width_m,   /* real-world dims — updated on resize/rotate */
    rot:0,               /* 0=original, 1=90°, 2=180°, 3=270° */
    ccu:'',desc:it.name||it.nm||'',
    wt:isC?it.wt:0,
    platform:S.selLoc||(S.activeLocs[0]||'BLEO'),
    status:S.selStatus,
    dgClass:p.type==='dg'?it.cls:'',
    priority:false,
    trDest:''};
  S.cargo.push(c);renderAll();updateStats();buildActiveLocStrip();
  checkSeg();updateDGSummary();save();
  /* Keep panel in sync */
  if(typeof cpRenderLib==='function' && typeof CP_OPEN!=='undefined' && CP_OPEN) cpRenderLib();
  if(typeof cpHideHint==='function') cpHideHint();
  openModal(c.id);
}

function renderAll(){
  const cv=document.getElementById('cvDECK');
  cv.querySelectorAll('.cb').forEach(b=>b.remove());
  S.cargo.forEach(c=>{if(c.side==='P'||c.side==='S')c.side='DECK';});
  S.cargo.forEach(c=>renderBlock(cv,c));
  /* Re-apply kb-sel ring after DOM rebuild */
  if(typeof KB_SEL!=='undefined' && KB_SEL){
    const el=document.querySelector(`.cb[data-id="${KB_SEL}"]`);
    if(el){ el.classList.add('kb-sel'); }
    else   { if(typeof kbDeselect==='function') kbDeselect(); }
  }
}

function renderBlock(cv,cargo){
  const loc=locById(cargo.platform)||LOC_ALL[0];
  const cols=locColors(getLocBase(loc.id),loc.id);
  const fill=cols[cargo.status]||getLocBase(loc.id);
  const border=darken(fill,.18);
  const textCol=isDark(fill)?'#fff':'#0a0800';
  const minDim=Math.min(cargo.w,cargo.h);
  const maxDim=Math.max(cargo.w,cargo.h);
  /* Font size: scales with the SHORTER dimension so text fits the narrower axis.
     Floor at 8px (unreadable below), cap at 15px (large containers).           */
  const textSz=Math.max(8,Math.min(14,Math.round(minDim*.26)))+'px';
  const badgeSz=Math.max(9,Math.min(14,Math.floor(minDim/6)))+'px';

  /* Make the cargo block itself a flex column so the label is truly centred
     regardless of how many lines it wraps to.                                 */
  const b=document.createElement('div');b.className='cb';b.dataset.id=cargo.id;
  /* Location id for Quick Filter — used by #locFilterStyle CSS rule */
  b.dataset.loc = cargo.platform || '';
  /* Premium tactile finish — subtle inset highlight + ambient shadow */
  const shadowCol = isDark(fill) ? 'rgba(0,0,0,.22)' : 'rgba(49,51,44,.10)';
  const hlCol     = isDark(fill) ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.55)';
  const trBorder = cargo.status==='TR' ? 'rgba(14,116,144,.80)' : border;
  const trExtra  = cargo.status==='TR' ? 'border-style:dashed;' : '';
  b.style.cssText=[
    `left:${cargo.x}px`,`top:${cargo.y}px`,
    `width:${cargo.w}px`,`height:${cargo.h}px`,
    `background:${fill}`,`border-color:${trBorder}`,
    `box-shadow:0 3px 10px ${shadowCol},inset 0 1px 0 ${hlCol}`,
    'display:flex','align-items:center','justify-content:center',
    'flex-direction:column',
    'border-radius:7px',
    trExtra,
  ].filter(Boolean).join(';');

  const dgd=cargo.dgClass?DG_DATA.find(d=>d.cls===cargo.dgClass):null;
  const mkBtn=(cls,txt,fn)=>{const d=document.createElement('div');d.className=cls;d.textContent=txt;d.addEventListener('mousedown',e=>e.stopPropagation());d.addEventListener('click',fn);return d;};

  b.appendChild(mkBtn('cb-del','×',e=>{e.stopPropagation();const _delId=cargo.id;S.cargo=S.cargo.filter(x=>x.id!==_delId);dgEvictDeletedCargo(_delId);renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();}));
  b.appendChild(mkBtn('cb-rot','↻',e=>{
    e.stopPropagation();
    const cx=cargo.x+cargo.w/2,cy=cargo.y+cargo.h/2;
    /* Swap canvas dimensions */
    const nw=cargo.h,nh=cargo.w;
    cargo.w=nw;cargo.h=nh;
    cargo.x=Math.max(0,Math.min(cx-nw/2,TW-nw));
    cargo.y=Math.max(0,Math.min(cy-nh/2,CVH-nh));
    /* Swap real-world metres so they stay consistent with canvas orientation */
    const tmp=cargo.length_m;
    cargo.length_m=cargo.width_m;
    cargo.width_m=tmp;
    cargo.rot=((cargo.rot||0)+1)%4;
    renderAll();save();
  }));
  b.appendChild(mkBtn('cb-copy','+',e=>{e.stopPropagation();S.cargo.push({...cargo,id:Date.now()+Math.random(),x:Math.min(cargo.x+cargo.w+6,TW-cargo.w),y:cargo.y});renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();}));

  const idEl=document.createElement('div');idEl.className='cb-id';
  /* Inline style — font size only; layout handled by CSS + parent flex */
  /* Premium label: slightly bolder, soft text-shadow for depth */
  const labelShadow = isDark(fill) ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.5)';
  idEl.style.cssText=`font-size:${textSz};color:${textCol};font-weight:700;text-shadow:0 1px 2px ${labelShadow};letter-spacing:0px;`;
  idEl.textContent=cargo.ccu||'';
  idEl.addEventListener('dblclick',e=>{e.stopPropagation();startInlineEdit(idEl,cargo,textSz,textCol);});b.appendChild(idEl);

  /* DG badge — position:absolute so it floats above flex flow */
  if(dgd){const badge=document.createElement('div');badge.className='cb-dg-badge';badge.style.cssText=`background:${dgd.bg};color:${dgd.tc};border-color:${dgd.bc};font-size:${badgeSz};font-family:'Inter',system-ui,sans-serif;font-weight:800;letter-spacing:.3px;`;badge.textContent=`${cargo.dgClass}`;b.appendChild(badge);}
  /* Heavy Lift badge — bottom-left, opposite corner from DG */
  if(cargo.heavyLift){const hl=document.createElement('div');hl.className='cb-hl-badge';hl.style.fontSize=badgeSz;hl.textContent='⬆HL';b.appendChild(hl);}
  /* Priority Lift — amber outline + badge */
  if(cargo.priority){
    b.classList.add('cb-priority');
    const pri=document.createElement('div');pri.className='cb-pri-badge';pri.style.fontSize=badgeSz;pri.textContent='⚡';b.appendChild(pri);
  }
  /* Transfer — teal badge showing destination */
  if(cargo.status==='TR'&&cargo.trDest){
    const trd=document.createElement('div');trd.className='cb-tr-badge';
    const destLoc=locById(cargo.trDest);
    trd.style.fontSize=Math.max(7,parseInt(badgeSz)-1)+'px';
    trd.textContent='→'+(destLoc?destLoc.name.slice(0,8):cargo.trDest.slice(0,8));
    b.appendChild(trd);
  }

  ['se','sw','ne','nw'].forEach(dir=>{const rh=document.createElement('div');rh.className=`rh rh-${dir}`;rh.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();startResize(e,cargo,b,dir);});b.appendChild(rh);});

  b.addEventListener('mousedown',e=>{
    if(e.target.classList.contains('cb-del')||e.target.classList.contains('rh')||e.target.classList.contains('cb-id')||e.target.classList.contains('cb-rot'))return;
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();
    if(S.pending){cancelPending();return;}
    const sx=e.clientX,sy=e.clientY,rect=b.getBoundingClientRect();
    const ox=(e.clientX-rect.left)/zoomLevel,oy=(e.clientY-rect.top)/zoomLevel;let moved=false;
    const ghost=document.createElement('div');ghost.className='ghost';
    ghost.style.cssText=`width:${cargo.w*zoomLevel}px;height:${cargo.h*zoomLevel}px;left:${e.clientX-ox*zoomLevel}px;top:${e.clientY-oy*zoomLevel}px;`;
    document.body.appendChild(ghost);
    const onMove=ev=>{
      if(Math.abs(ev.clientX-sx)>4||Math.abs(ev.clientY-sy)>4)moved=true;
      ghost.style.left=(ev.clientX-ox*zoomLevel)+'px';
      ghost.style.top=(ev.clientY-oy*zoomLevel)+'px';
      /* Live DG segregation overlay — only when dragged block has a DG class */
      if(cargo.dgClass)showDragSegOverlay(cargo.dgClass, cargo.id);
    };
    const onUp=ev=>{
      document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);ghost.remove();
      clearDragSegOverlay();
      if(moved){b.style.visibility='hidden';const el=document.elementFromPoint(ev.clientX,ev.clientY);b.style.visibility='';const tc=el&&el.closest('.dcv');if(tc){const cr=tc.getBoundingClientRect();cargo.x=Math.max(0,Math.min((ev.clientX-cr.left)/zoomLevel-ox,TW-cargo.w));cargo.y=Math.max(0,Math.min((ev.clientY-cr.top)/zoomLevel-oy,CVH-cargo.h));}/* Smart Bounce: resolve overlap BEFORE grid snap */
              const bouncePos=smartBounce(cargo);
              if(bouncePos){ cargo.x=bouncePos.x; cargo.y=bouncePos.y; }
              /* Smart Grid Snap: align to neighbour / bay / boundary (after bounce, before render) */
              const snapPos=smartGridSnap(cargo);
              if(snapPos){ cargo.x=snapPos.x; cargo.y=snapPos.y; }
              renderAll();
              if(bouncePos) triggerBounceAnim(cargo.id);
              updateStats();buildActiveLocStrip();
              checkSeg();save();}else{ kbSelect(cargo.id); openModal(cargo.id); }
    };
    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  });
  cv.appendChild(b);
}

function startInlineEdit(el,cargo,sz,col){
  const inp=document.createElement('input');
  inp.type='text';inp.className='id-input';
  inp.value=cargo.ccu||'';inp.placeholder='CCU / ID';
  inp.style.cssText=`font-size:${sz};color:${col};width:90%;text-align:center;`;
  el.replaceWith(inp);inp.focus();inp.select();
  const commit=()=>{cargo.ccu=inp.value.trim();save();renderAll();};
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')commit();if(e.key==='Escape')renderAll();});
  inp.addEventListener('blur',commit);
  inp.addEventListener('mousedown',e=>e.stopPropagation());
}

function startResize(e,cargo,block,dir){
  const sx=e.clientX,sy=e.clientY,ox=cargo.x,oy=cargo.y,ow=cargo.w,oh=cargo.h;
  block.style.opacity='.55';
  const onMove=ev=>{
    const dx=(ev.clientX-sx)/zoomLevel,dy=(ev.clientY-sy)/zoomLevel;
    let nx=ox,ny=oy,nw=ow,nh=oh;
    if(dir.includes('e'))nw=Math.max(24,ow+dx);
    if(dir.includes('s'))nh=Math.max(20,oh+dy);
    if(dir.includes('w')){nw=Math.max(24,ow-dx);nx=ox+ow-nw;}
    if(dir.includes('n')){nh=Math.max(20,oh-dy);ny=oy+oh-nh;}
    cargo.x=nx;cargo.y=ny;cargo.w=nw;cargo.h=nh;
    block.style.cssText+=`left:${nx}px;top:${ny}px;width:${nw}px;height:${nh}px;`;
  };
  const onUp=()=>{
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    block.style.opacity='';
    /* Sync real-world metres from new canvas px dimensions */
    cargo.length_m = parseFloat((cargo.w / M).toFixed(3));
    cargo.width_m  = parseFloat((cargo.h / (CVH/15)).toFixed(3));
    renderAll();save();
  };
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

/* ════════════════════════════════════
   STATS + DG
════════════════════════════════════ */
function updateStats(){let tot=0,wt=0,L=0,BL=0,ROB=0,TR=0;S.cargo.forEach(c=>{tot++;wt+=parseFloat(c.wt)||0;if(c.status==='L')L++;if(c.status==='BL')BL++;if(c.status==='ROB')ROB++;if(c.status==='TR')TR++;});document.getElementById('sLifts').textContent=tot;document.getElementById('sWT').textContent=wt.toFixed(1)+' T';document.getElementById('sL').textContent=L;document.getElementById('sBL').textContent=BL;document.getElementById('sROB').textContent=ROB;const trEl=document.getElementById('sTR');if(trEl)trEl.textContent=TR;const trGst=document.getElementById('gstTR');if(trGst)trGst.style.display=TR>0?'':'none';}
function updateDGSummary(){const counts={};S.cargo.filter(c=>c.dgClass).forEach(c=>{counts[c.dgClass]=(counts[c.dgClass]||0)+1;});const el=document.getElementById('dgSumContent');const entries=Object.entries(counts);if(!entries.length){el.className='dg-empty';el.innerHTML='none';return;}el.className='';el.innerHTML=entries.map(([cls,n])=>{const dg=DG_DATA.find(d=>d.cls===cls);return`<span class="dg-sum-item" style="background:${dg?.bg||'#888'};color:${dg?.tc||'#fff'};border-color:${dg?.bc||'#888'};">◆${cls} ×${n}</span>`;}).join('');}
/* ════════════════════════════════════════════════════════════
   DG AUTO-SEGREGATION CHECK ENGINE  v38.8
   
   Replaces the old inline warning bar with a rich modal panel.
   Runs on every placement, drag-drop, edit, and delete.
   
   Violation levels from IMDG SEG_FULL matrix:
     1 = "Away from"  — amber  — 1 MINI clearance
     2 = "Separated"  — red    — 2 MINI clearance
     3 = "By compartment" — deep red — 3 MINI clearance
   
   Cargo blocks that violate segregation get a pulsing outline.
   Modal shows each pair with description + Locate button.
════════════════════════════════════════════════════════════ */

/* Human-readable descriptions for each DG class pair violation */
const DG_CLASS_NAMES = {
  '1.1':'Explosives (Mass Explosion)',
  '1.2':'Explosives (Projection)',
  '1.3':'Explosives (Fire/Minor Blast)',
  '1.4':'Explosives (Minor Hazard)',
  '1.5':'Explosives (Insensitive)',
  '1.6':'Explosives (Extremely Insensitive)',
  '2.1':'Flammable Gas',
  '2.2':'Non-Flammable Gas',
  '2.3':'Toxic Gas',
  '3':  'Flammable Liquid',
  '4.1':'Flammable Solid',
  '4.2':'Spontaneously Combustible',
  '4.3':'Dangerous When Wet',
  '5.1':'Oxidizer',
  '5.2':'Organic Peroxide',
  '6.1':'Toxic Substance',
  '6.2':'Infectious Substance',
  '7':  'Radioactive',
  '8':  'Corrosive',
  '9':  'Misc. Dangerous Goods',
};

const SEG_LEVEL_LABEL = {
  1: 'Away from',
  2: 'Separated from',
  3: 'Separated by compartment',
};

const SEG_LEVEL_DESC = {
  1: (a,b) => `<b>Class ${a}</b> (${DG_CLASS_NAMES[a]||a}) must be kept <b>away from</b> <b>Class ${b}</b> (${DG_CLASS_NAMES[b]||b}). Minimum edge-to-edge distance: <b>1 MINI (6 ft)</b>.`,
  2: (a,b) => `<b>Class ${a}</b> (${DG_CLASS_NAMES[a]||a}) must be <b>separated from</b> <b>Class ${b}</b> (${DG_CLASS_NAMES[b]||b}). Minimum edge-to-edge distance: <b>2 MINI (12 ft)</b>.`,
  3: (a,b) => `<b>Class ${a}</b> (${DG_CLASS_NAMES[a]||a}) must be <b>separated by an intervening deck or compartment</b> from <b>Class ${b}</b> (${DG_CLASS_NAMES[b]||b}). Minimum: <b>3 MINI (18 ft)</b>.`,
};

/* ════════════════════════════════════════════════════════════
   DG AUTO-SEGREGATION CHECK ENGINE  v38.10
   
   Acknowledged state is stored PER CONFLICT PAIR by cargo ID.
   Key insight: once pair (A.id, B.id) is acknowledged, moving
   either block never re-triggers the warning — because the pair
   key is by stable cargo IDs, not by position or DG class.
   
   A new warning fires ONLY when a pair key appears that has
   never been acknowledged before in this session.
   
   DG_ACK_PAIRS  — Set<string>  keys like "id1::id2" (sorted)
                   Persists for the session. Never cleared unless
                   one of the two containers is deleted.
   
   On delete: remove all pairs that reference the deleted ID,
   so if that slot is later filled by a NEW cargo block with the
   same DG conflict, the warning fires fresh.
════════════════════════════════════════════════════════════ */

let DG_ACK_PAIRS = new Set(); /* Set of "idA::idB" keys — acknowledged conflict pairs */

/* Canonical pair key — always sorted so A::B === B::A */
function dgPairKey(idA, idB){
  return [String(idA), String(idB)].sort().join('::');
}

/* Acknowledge: store ALL currently-shown violation pairs into the ack set,
   clear highlights, close modal, hide legacy bar.                          */
function acknowledgeDGCheck(){
  /* Collect pair keys from modal cards currently shown */
  document.querySelectorAll('.dg-viol-locate').forEach(btn => {
    const idA = btn.dataset.idA;
    const idB = btn.dataset.idB;
    if(idA && idB) DG_ACK_PAIRS.add(dgPairKey(idA, idB));
  });
  const ov = document.getElementById('dgCheckOv');
  if(ov) ov.classList.remove('open');
  clearDGViolationHighlights();
  const wBar = document.getElementById('dgW');
  if(wBar) wBar.classList.remove('on');
}

/* When a cargo block is deleted: evict all pairs that reference its ID
   so future conflicts with a new block in that position fire fresh.     */
function dgEvictDeletedCargo(id){
  const sid = String(id);
  DG_ACK_PAIRS.forEach(key => {
    if(key.split('::').includes(sid)) DG_ACK_PAIRS.delete(key);
  });
}

/* Visual-only close — does NOT acknowledge */
function closeDGCheckModal(){
  const ov = document.getElementById('dgCheckOv');
  if(ov) ov.classList.remove('open');
}

/* Clear pulsing outlines from all cargo blocks */
function clearDGViolationHighlights(){
  document.querySelectorAll('.cb.dg-violation,.cb.dg-violation-warn').forEach(el => {
    el.classList.remove('dg-violation','dg-violation-warn');
  });
}

/* Bind modal controls — called once from init() */
function bindDGAutoCheck(){
  const ov       = document.getElementById('dgCheckOv');
  const closeBtn = document.getElementById('dgCheckClose');
  const dismiss  = document.getElementById('dgCheckDismiss');
  if(closeBtn) closeBtn.addEventListener('click', closeDGCheckModal);
  if(dismiss)  dismiss.addEventListener('click', acknowledgeDGCheck);
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && ov && ov.classList.contains('open')) closeDGCheckModal();
  });
}

function checkSeg(){
  /* ── 1. Collect all DG blocks ── */
  const dgs = S.cargo.filter(c => c.dgClass);

  /* ── 2. Compute ALL violations (geometry check) ── */
  const legacyWarns = [];
  const violations  = [];

  for(let i = 0; i < dgs.length; i++){
    for(let j = i+1; j < dgs.length; j++){
      const a = dgs[i], b = dgs[j];
      const level = getSeg(a.dgClass, b.dgClass);
      if(level < 1) continue;
      const required = segClearancePx(level);
      const gapX = Math.max(0, Math.max(a.x,b.x) - Math.min(a.x+a.w, b.x+b.w));
      const gapY = Math.max(0, Math.max(a.y,b.y) - Math.min(a.y+a.h, b.y+b.h));
      const gap  = Math.min(gapX, gapY);
      if(gap < required){
        legacyWarns.push(`DG${a.dgClass}↔DG${b.dgClass}: ${SEG_LEVEL_LABEL[level]||level+' MINI'}`);
        violations.push({ a, b, level, key: dgPairKey(a.id, b.id) });
      }
    }
  }

  /* ── 3. Split into acknowledged vs new ── */
  const newViolations = violations.filter(v => !DG_ACK_PAIRS.has(v.key));
  const ackViolations = violations.filter(v =>  DG_ACK_PAIRS.has(v.key));

  /* ── 4. Legacy bar — only shows if there are NEW (unacknowledged) violations ── */
  const wTxt = document.getElementById('dgWTxt');
  const wBar = document.getElementById('dgW');
  if(wTxt) wTxt.textContent = legacyWarns.join(' | ');
  if(wBar) wBar.classList.toggle('on', newViolations.length > 0);

  /* ── 5. Feature disabled → clear and exit ── */
  if(!SMART.dgSeg){
    clearDGViolationHighlights();
    return;
  }

  /* ── 6. No violations at all → full clean state ── */
  if(violations.length === 0){
    clearDGViolationHighlights();
    const ov = document.getElementById('dgCheckOv');
    if(ov) ov.classList.remove('open');
    return;
  }

  /* ── 7. No NEW violations → silently clear highlights, keep modal closed ── */
  if(newViolations.length === 0){
    clearDGViolationHighlights();
    const ov = document.getElementById('dgCheckOv');
    if(ov) ov.classList.remove('open');
    return;
  }

  /* ── 8. Apply highlights ONLY to new (unacknowledged) violating blocks ── */
  clearDGViolationHighlights();
  const highlightedIds = new Set();
  newViolations.forEach(v => {
    const cls = v.level >= 2 ? 'dg-violation' : 'dg-violation-warn';
    [v.a.id, v.b.id].forEach(id => {
      if(!highlightedIds.has(id)){
        highlightedIds.add(id);
        const el = document.querySelector(`.cb[data-id="${id}"]`);
        if(el) el.classList.add(cls);
      }
    });
  });

  /* ── 9. Build and show modal for NEW violations only ── */
  const ov   = document.getElementById('dgCheckOv');
  const body = document.getElementById('dgCheckBody');
  const sub  = document.getElementById('dgCheckSub');
  if(!ov || !body) return;

  body.innerHTML = '';

  const totalPairs = newViolations.length;
  const maxLvl     = Math.max(...newViolations.map(v => v.level));
  if(sub) sub.textContent = `${totalPairs} new violation${totalPairs!==1?'s':''} — IMDG Code`;

  /* Summary banner */
  const sevLabel = maxLvl >= 3 ? 'CRITICAL' : maxLvl >= 2 ? 'HIGH' : 'CAUTION';
  const sevIcon  = maxLvl >= 3 ? '🔴' : maxLvl >= 2 ? '🟠' : '🟡';
  const summDiv  = document.createElement('div');
  summDiv.className = 'dg-check-summary';
  summDiv.innerHTML = `
    <div class="dg-check-summary-icon">${sevIcon}</div>
    <div class="dg-check-summary-text">
      <b>${sevLabel}:</b> ${totalPairs} new DG segregation conflict${totalPairs!==1?'s':''}.
      Acknowledge to confirm you have noted this. Acknowledged conflicts won't be repeated.
    </div>`;
  body.appendChild(summDiv);

  /* Violation cards — only new pairs */
  newViolations.forEach(v => {
    const { a, b, level } = v;
    const dgA = DG_DATA.find(d => d.cls === a.dgClass) || { bg:'#888', tc:'#fff', bc:'#888' };
    const dgB = DG_DATA.find(d => d.cls === b.dgClass) || { bg:'#888', tc:'#fff', bc:'#888' };
    const reqLabel = SEG_LEVEL_LABEL[level] || `${level} MINI`;
    const descHtml = (SEG_LEVEL_DESC[level] || (() => ''))(a.dgClass, b.dgClass);

    const card = document.createElement('div');
    card.className = 'dg-viol-card';
    card.innerHTML = `
      <div class="dg-viol-head">
        <span class="dg-viol-sev sev-${level}">${reqLabel.toUpperCase()}</span>
        <div class="dg-viol-pair">
          <span class="dg-viol-badge" style="background:${dgA.bg};color:${dgA.tc};border:1px solid ${dgA.bc};">◆ ${a.dgClass}</span>
          <span class="dg-viol-arrow">⟷</span>
          <span class="dg-viol-badge" style="background:${dgB.bg};color:${dgB.tc};border:1px solid ${dgB.bc};">◆ ${b.dgClass}</span>
        </div>
        <span class="dg-viol-req">${level} MINI req.</span>
      </div>
      <div class="dg-viol-body">
        <div class="dg-viol-desc">${descHtml}</div>
        <button class="dg-viol-locate" data-id-a="${a.id}" data-id-b="${b.id}">Locate ↗</button>
      </div>`;

    /* Locate: acknowledge this specific pair, flash blocks */
    card.querySelector('.dg-viol-locate').addEventListener('click', () => {
      acknowledgeDGCheck();
      [a.id, b.id].forEach((id, idx) => {
        const el = document.querySelector(`.cb[data-id="${id}"]`);
        if(!el) return;
        if(idx === 0) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
        el.classList.add('cp-hl');
        setTimeout(() => el.classList.remove('cp-hl'), 4500);
      });
    });

    body.appendChild(card);
  });

  if(!ov.classList.contains('open')) ov.classList.add('open');
}
function updateDGZones(){
  const ovl=document.getElementById('dgExclOverlay');if(!ovl)return;ovl.innerHTML='';
  const pc=S.pending&&S.pending.type==='dg'?S.pending.item.cls:null;
  if(!pc)return;
  S.cargo.filter(c=>c.dgClass).forEach(cargo=>{
    const rule=getSeg(pc,cargo.dgClass);
    if(rule<1)return;
    const pad=segClearancePx(rule);
    const bg={1:'rgba(251,146,60,.14)',2:'rgba(220,38,38,.18)',3:'rgba(139,0,0,.28)'}[rule]||'rgba(220,38,38,.18)';
    const bc={1:'#f97316',2:'#dc2626',3:'#7f1d1d'}[rule]||'#dc2626';
    const zx=Math.max(0,cargo.x-pad),zy=Math.max(0,cargo.y-pad);
    const zw=Math.min(TW,cargo.x+cargo.w+pad)-zx,zh=Math.min(CVH,cargo.y+cargo.h+pad)-zy;
    const z=document.createElement('div');z.className='dg-excl-zone';
    z.style.cssText=`left:${zx}px;top:${zy}px;width:${zw}px;height:${zh}px;background:${bg};border:1.5px dashed ${bc};`;
    z.innerHTML=`<span class="dg-excl-lbl" style="color:${bc};">${rule} MINI · DG${cargo.dgClass}</span>`;
    ovl.appendChild(z);
  });
}

/* ════════════════════════════════════
   MODAL
════════════════════════════════════ */
let editId=null,modalSt=null;
function openModal(id){editId=id;const c=S.cargo.find(x=>x.id===id);if(!c)return;buildModalDescSelect();document.getElementById('mCCU').value=c.ccu||'';document.getElementById('mDesc').value=c.desc||'';document.getElementById('mWT').value=c.wt||'';document.getElementById('mDG').value=c.dgClass||'';dgPickerSetValue(c.dgClass||'');modalSt=c.status||'L';buildModalLocs(c.platform);document.querySelectorAll('.mdl-st').forEach(b=>b.classList.toggle('sel',b.dataset.s===modalSt));
/* Heavy Lift toggle */
const hlBtn=document.getElementById('mHL');
const hlLbl=document.getElementById('mHLlbl');
hlBtn.classList.toggle('on',!!c.heavyLift);
hlLbl.textContent=c.heavyLift?'Heavy Lift — ON':'Heavy Lift — off';
/* Priority Lift */
const priBtn=document.getElementById('mPriority');
const priLbl=document.getElementById('mPriorityLbl');
if(priBtn){priBtn.classList.toggle('on',!!c.priority);priLbl.textContent=c.priority?'Priority Lift — ON':'Priority Lift — off';}
/* Transfer destination */
const trWrap=document.getElementById('mdlTrWrap');
if(trWrap){
  trWrap.classList.toggle('visible',c.status==='TR');
  buildTrDestSelect(c.trDest||'');
}
document.getElementById('ov').classList.add('open');setTimeout(()=>document.getElementById('mCCU').focus(),50);}
function buildModalLocs(selId){const g=document.getElementById('mLocGrid');g.innerHTML='';const show=S.activeLocs.length?S.activeLocs.map(id=>locById(id)).filter(Boolean):LOC_ALL;show.forEach(loc=>{const el=document.createElement('div');el.className='mdl-loc'+(loc.id===selId?' sel':'');el.style.setProperty('--lc',getLocBase(loc.id));el.dataset.lid=loc.id;el.innerHTML=`<div class="mdl-loc-dot"></div><div class="mdl-loc-name">${loc.name}</div>`;el.onclick=()=>{g.querySelectorAll('.mdl-loc').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');};g.appendChild(el);}); }

/* Populate #mDesc <select> dynamically from CCU_PRESETS, grouped by category.
   Also appends custom library entries under a "Custom" group.
   Called once at init, and again if custom library changes.              */
function buildModalDescSelect(){
  const sel=document.getElementById('mDesc');
  const cur=sel.value; // preserve current selection across rebuilds
  sel.innerHTML='<option value="">— select type —</option>';
  /* Group CCU_PRESETS by cat */
  const cats=['Container','Basket','Tank','Skip','Module'];
  cats.forEach(cat=>{
    const items=CCU_PRESETS.filter(p=>p.cat===cat);
    if(!items.length)return;
    const grp=document.createElement('optgroup');
    grp.label=cat+'s';
    items.forEach(p=>{
      const o=document.createElement('option');
      o.value=p.label;
      const dim=`${p.length_m.toFixed(2)}×${p.width_m.toFixed(2)} m`;
      o.textContent=p.approx ? `${p.label} (${dim}~)` : `${p.label} (${dim})`;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  });
  /* Custom library group */
  if(S.customLib.length){
    const grp=document.createElement('optgroup');
    grp.label='Custom';
    S.customLib.forEach(p=>{
      const o=document.createElement('option');
      o.value=p.name;
      o.textContent=p.name;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  }
  /* Restore selection if still valid */
  if(cur) sel.value=cur;
}
/* ════════════════════════════════════════════════════════════
   CUSTOM DG CLASS PICKER  v38.12
   
   Replaces the native <select id="mDG"> dropdown which cannot
   be reliably styled in dark mode across browsers.
   
   The hidden <select id="mDG"> is kept intact — its .value is
   read by openModal() and the modal save handler unchanged.
   This widget keeps the hidden select in sync.
════════════════════════════════════════════════════════════ */

/* All options: {value, label, bg, tc, bc} — built from DG_DATA + "not DG" entry */
function dgPickerOptions(){
  const opts = [{ value:'', label:'— Not DG —', bg:null, tc:null, bc:null }];
  DG_DATA.forEach(d => {
    opts.push({ value:d.cls, label:`${d.cls} — ${d.nm}`, bg:d.bg, tc:d.tc, bc:d.bc });
  });
  return opts;
}

/* Set the picker display to match a given value (called from openModal) */
function dgPickerSetValue(val){
  const hiddenSel  = document.getElementById('mDG');
  const dot        = document.getElementById('dgPickerDot');
  const label      = document.getElementById('dgPickerLabel');
  if(!dot || !label) return;

  if(!val){
    dot.classList.remove('visible');
    dot.style.background = '';
    label.textContent = '— Not DG —';
    if(hiddenSel) hiddenSel.value = '';
  } else {
    const dg = DG_DATA.find(d => d.cls === val);
    dot.classList.add('visible');
    dot.style.background = dg ? dg.bg : '#888';
    dot.style.boxShadow  = dg ? `0 0 0 1px ${dg.bc}` : '';
    label.textContent    = dg ? `${dg.cls} — ${dg.nm}` : val;
    if(hiddenSel) hiddenSel.value = val;
  }

  /* Sync selected state on option rows */
  document.querySelectorAll('.dg-picker-opt').forEach(el => {
    el.classList.toggle('selected', el.dataset.val === val);
  });
}

function bindDGPicker(){
  const picker     = document.getElementById('dgPicker');
  const btn        = document.getElementById('dgPickerBtn');
  const dropdown   = document.getElementById('dgPickerDropdown');
  const list       = document.getElementById('dgPickerList');
  const search     = document.getElementById('dgPickerSearch');
  if(!picker || !btn || !dropdown || !list) return;

  const allOpts = dgPickerOptions();

  /* Build option rows */
  function buildList(query){
    list.innerHTML = '';
    const q = (query||'').toLowerCase().trim();
    const filtered = q
      ? allOpts.filter(o => o.value && (o.value.includes(q) || o.label.toLowerCase().includes(q)))
      : allOpts;

    filtered.forEach(opt => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'dg-picker-opt' + (opt.value === '' ? ' none-opt' : '');
      row.dataset.val = opt.value;

      if(opt.bg){
        row.innerHTML = `
          <span class="dg-picker-opt-badge" style="background:${opt.bg};color:${opt.tc};border:1px solid ${opt.bc};">◆${opt.value}</span>
          <span class="dg-picker-opt-name">${opt.label.replace(/^[\d.]+ — /,'')}</span>
          <span class="dg-picker-opt-check">✓</span>`;
      } else {
        row.innerHTML = `
          <span class="dg-picker-opt-name" style="padding-left:2px;">${opt.label}</span>
          <span class="dg-picker-opt-check">✓</span>`;
      }

      row.addEventListener('click', () => {
        dgPickerSetValue(opt.value);
        closeDropdown();
      });
      list.appendChild(row);
    });
  }

  function openDropdown(){
    picker.classList.add('open');
    btn.setAttribute('aria-expanded','true');
    buildList('');
    if(search){ search.value=''; search.focus(); }
    /* Scroll selected item into view */
    setTimeout(()=>{
      const sel = list.querySelector('.dg-picker-opt.selected');
      if(sel) sel.scrollIntoView({block:'nearest'});
    }, 60);
  }

  function closeDropdown(){
    picker.classList.remove('open');
    btn.setAttribute('aria-expanded','false');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    picker.classList.contains('open') ? closeDropdown() : openDropdown();
  });

  /* Search filter */
  if(search){
    search.addEventListener('input', () => buildList(search.value));
    search.addEventListener('keydown', e => {
      if(e.key === 'Escape'){ closeDropdown(); e.stopPropagation(); }
      if(e.key === 'Enter'){
        const first = list.querySelector('.dg-picker-opt');
        if(first){ first.click(); }
      }
    });
    search.addEventListener('click', e => e.stopPropagation());
  }

  /* Close on outside click */
  document.addEventListener('click', e => {
    if(!picker.contains(e.target)) closeDropdown();
  });

  /* Close on Escape (bubbled from outside search) */
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && picker.classList.contains('open')) closeDropdown();
  });

  /* Init with empty value */
  dgPickerSetValue('');
}

function closeModal(){document.getElementById('ov').classList.remove('open');editId=null;}
function bindModal(){
  document.getElementById('mCan').onclick=closeModal;
  /* Heavy Lift toggle */
  document.getElementById('mHL').onclick=()=>{
    const btn=document.getElementById('mHL');
    const lbl=document.getElementById('mHLlbl');
    btn.classList.toggle('on');
    lbl.textContent=btn.classList.contains('on')?'Heavy Lift — ON':'Heavy Lift — off';
  };

  /* ── Description change → auto-fill weight from preset ──────────────
     When user selects a different cargo type from the dropdown, immediately
     populate the Weight field with the preset's wt_default value,
     but only if the weight field is empty or still at the old default.
     Never overwrite a weight the user has manually typed.               */
  document.getElementById('mDesc').addEventListener('change', () => {
    const descVal = document.getElementById('mDesc').value;
    if(!descVal) return;
    const preset = CCU_PRESETS.find(p => p.label === descVal);
    if(!preset) return;
    const wtField = document.getElementById('mWT');
    /* Auto-fill only when field is empty or matches a known preset default
       (i.e. user hasn't manually overridden it with a specific value) */
    const currentWt = parseFloat(wtField.value) || 0;
    const isDefaultOrEmpty = !wtField.value ||
      CCU_PRESETS.some(p => Math.abs(p.wt_default - currentWt) < 0.01);
    if(isDefaultOrEmpty){
      wtField.value = preset.wt_default;
      /* Brief visual highlight to signal auto-fill */
      wtField.style.transition = 'background .25s';
      wtField.style.background = 'rgba(72,96,131,.10)';
      setTimeout(() => { wtField.style.background = ''; }, 600);
    }
  });
  document.getElementById('ov').onclick=e=>{if(e.target===document.getElementById('ov'))closeModal();};
  document.querySelectorAll('.mdl-st').forEach(b=>{b.onclick=()=>{modalSt=b.dataset.s;document.querySelectorAll('.mdl-st').forEach(x=>x.classList.toggle('sel',x===b));};});
  document.getElementById('mRm').onclick=()=>{const _rmId=editId;S.cargo=S.cargo.filter(c=>c.id!==_rmId);dgEvictDeletedCargo(_rmId);renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();closeModal();};
  document.getElementById('mSav').onclick=()=>{
    const c=S.cargo.find(x=>x.id===editId);if(!c)return;
    c.ccu=document.getElementById('mCCU').value;
    const newDesc=document.getElementById('mDesc').value;
    /* Auto-resize: if description changed, look up preset dimensions */
    if(newDesc && newDesc!==c.desc){
      /* Try CCU_PRESETS first, then custom library */
      const sz=clibSize(newDesc)||(()=>{const ci=S.customLib.find(i=>i.name===newDesc);return ci?{w:ci.w,h:ci.h}:null;})();
      if(sz){
        const cx=c.x+c.w/2,cy=c.y+c.h/2;
        c.w=sz.w;c.h=sz.h;
        c.x=Math.max(0,Math.min(cx-c.w/2,TW-c.w));
        c.y=Math.max(0,Math.min(cy-c.h/2,CVH-c.h));
        /* Sync real-world metres from new dimensions */
        c.length_m=parseFloat((c.w/M).toFixed(3));
        c.width_m =parseFloat((c.h/(CVH/15)).toFixed(3));
        c.rot=0;
      }
    }
    c.desc=newDesc;
    c.wt=parseFloat(document.getElementById('mWT').value)||0;
    const sl=document.getElementById('mLocGrid').querySelector('.mdl-loc.sel');
    c.platform=sl?sl.dataset.lid:(S.selLoc||S.activeLocs[0]||'BLEO');
    c.status=modalSt||'L';
    c.dgClass=document.getElementById('mDG').value;
    c.heavyLift=document.getElementById('mHL').classList.contains('on');
    c.priority=document.getElementById('mPriority')?.classList.contains('on')||false;
    c.trDest=(c.status==='TR')?(document.getElementById('mdlTrDest')?.value||''):'';
    renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();closeModal();cancelPending();
  };
  document.getElementById('ov').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('mSav').click();});
}

/* ════════════════════════════════════
   LIBRARY
════════════════════════════════════ */
/* ── Build one cargo library card element ────────────────── */
function makeLibCard(item, allItems, list){
  const key   = libKey(item);
  const isFav = LIB_PREFS.favs.has(key);
  const alias = LIB_PREFS.aliases[key] || '';

  const el = document.createElement('div');
  el.className = 'lc';
  el.dataset.key = key;

  const dimStr = item.length_m != null
    ? `${item.length_m.toFixed(2)}×${item.width_m.toFixed(2)} m`
    : '';
  const approx = item.approx ? '<span class="lc-approx">~</span>' : '';

  /* ── Inner HTML ── */
  el.innerHTML = `
    <span class="lc-star${isFav?' active':''}" title="Favourite">★</span>
    <span class="lc-edit" title="Rename">✎</span>
    <div class="lc-cat">${item.cat}</div>
    ${alias
      ? `<div class="lc-alias">${alias}</div><div class="lc-orig">${item.name}</div>`
      : `<div class="lc-nm">${item.name}${approx}</div>`
    }
    <div class="lc-dim">${dimStr}${dimStr&&item.wt?' · ':''}${item.wt?item.wt+'T':''}</div>`;

  /* ── Star: toggle favourite ── */
  el.querySelector('.lc-star').addEventListener('click', e=>{
    e.stopPropagation();
    if(LIB_PREFS.favs.has(key)) LIB_PREFS.favs.delete(key);
    else LIB_PREFS.favs.add(key);
    saveLibPrefs();
    buildCargoList();
  });

  /* ── Edit icon: inline rename ── */
  el.querySelector('.lc-edit').addEventListener('click', e=>{
    e.stopPropagation();
    startLibRename(el, item, key);
  });

  /* ── Drag-to-reorder (mousedown with delay to distinguish from click) ── */
  let dragTimer = null, dragActive = false;

  el.addEventListener('mousedown', e=>{
    if(e.target.classList.contains('lc-star') ||
       e.target.classList.contains('lc-edit')) return;
    if(e.button !== 0) return;

    const startX = e.clientX, startY = e.clientY;

    dragTimer = setTimeout(()=>{
      dragActive = true;
      startLibDrag(el, item, key, allItems, list, e);
    }, 180);

    const cancelDrag = ()=>{ clearTimeout(dragTimer); };
    el.addEventListener('mouseup',   cancelDrag, {once:true});
    el.addEventListener('mouseleave',cancelDrag, {once:true});
  });

  /* ── Click (no drag): select for deck placement ── */
  el.addEventListener('click', e=>{
    if(e.target.classList.contains('lc-star') ||
       e.target.classList.contains('lc-edit') ||
       dragActive) { dragActive=false; return; }
    document.querySelectorAll('.lc,.dgc').forEach(c=>c.classList.remove('sel'));
    el.classList.add('sel');
    S.pending = {type:'cargo', item};
    const dimLabel = item.length_m != null
      ? ` · ${item.length_m.toFixed(2)}×${item.width_m.toFixed(2)} m` : '';
    document.getElementById('hint').innerHTML =
      t('hint_place', alias||item.name, dimLabel);
  });

  return el;
}

/* ── Inline rename inside card ── */
function startLibRename(cardEl, item, key){
  const currentAlias = LIB_PREFS.aliases[key] || '';
  // Temporarily replace nm/alias display with an input
  const existing = cardEl.querySelector('.lc-nm, .lc-alias, .lc-orig');
  if(!existing) return;

  const inp = document.createElement('input');
  inp.className = 'lc-rename-input';
  inp.value = currentAlias;
  inp.placeholder = item.name;
  inp.maxLength = 40;

  cardEl.innerHTML = '';
  cardEl.appendChild(inp);
  inp.focus(); inp.select();

  const commit = ()=>{
    const v = inp.value.trim();
    if(v) LIB_PREFS.aliases[key] = v;
    else  delete LIB_PREFS.aliases[key];
    saveLibPrefs();
    buildCargoList();
  };
  inp.addEventListener('blur',   commit);
  inp.addEventListener('keydown', e=>{
    if(e.key==='Enter')  { e.preventDefault(); inp.blur(); }
    if(e.key==='Escape') { delete LIB_PREFS.aliases[key]; inp.blur(); buildCargoList(); }
    e.stopPropagation();
  });
  inp.addEventListener('mousedown', e=>e.stopPropagation());
  inp.addEventListener('click',     e=>e.stopPropagation());
}

/* ── Drag-to-reorder logic ── */
function startLibDrag(cardEl, item, key, allItems, list, startEvt){
  const rect  = cardEl.getBoundingClientRect();
  const clone = cardEl.cloneNode(true);

  /* Floating clone */
  clone.style.cssText = `
    position:fixed;pointer-events:none;z-index:9998;
    left:${rect.left}px;top:${rect.top}px;
    width:${rect.width}px;height:${rect.height}px;
    transform:scale(1.05) rotate(1.5deg);
    box-shadow:0 10px 32px rgba(0,0,0,.22);
    opacity:.88;transition:none;`;
  document.body.appendChild(clone);

  /* Placeholder in original position */
  cardEl.classList.add('lc-placeholder');

  const cards = [...list.querySelectorAll('.lc:not(.lc-group-lbl)')];
  const offsetX = startEvt.clientX - rect.left;
  const offsetY = startEvt.clientY - rect.top;

  const onMove = e=>{
    clone.style.left = (e.clientX - offsetX) + 'px';
    clone.style.top  = (e.clientY - offsetY) + 'px';

    /* Find insertion point */
    const midX = e.clientX;
    const midY = e.clientY;
    let target = null, before = true;

    for(const c of cards){
      if(c === cardEl) continue;
      if(c.classList.contains('lc-group-lbl')) continue;
      const cr = c.getBoundingClientRect();
      const cMid = cr.left + cr.width / 2;
      const cRow = cr.top + cr.height / 2;
      if(Math.abs(cRow - midY) < cr.height * 1.2){
        if(midX < cMid){ target = c; before = true; break; }
        else            { target = c; before = false; }
      }
    }

    if(target){
      if(before) list.insertBefore(cardEl, target);
      else       target.after(cardEl);
    }
  };

  const onUp = ()=>{
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    clone.remove();
    cardEl.classList.remove('lc-placeholder');

    /* Persist new order */
    const newOrder = [...list.querySelectorAll('.lc[data-key]')]
      .map(c=>c.dataset.key).filter(Boolean);
    LIB_PREFS.order = newOrder;
    saveLibPrefs();
    buildCargoList(); // re-render from authoritative sorted state
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

/* ── Main cargo list builder ── */
function buildCargoList(){
  const list = document.getElementById('clist');
  const q    = document.getElementById('csearch').value.toLowerCase().trim();

  /* Merge standard + custom, apply search */
  const std  = CLIB.map(i=>({...i, _src:'std'}));
  const cust = S.customLib.map(i=>({...i, _src:'cust'}));
  let all = [...std, ...cust];
  if(q) all = all.filter(i=>
    (LIB_PREFS.aliases[libKey(i)]||'').toLowerCase().includes(q) ||
    i.name.toLowerCase().includes(q) ||
    i.cat.toLowerCase().includes(q));

  /* Apply favorites + saved order */
  const sorted = sortedLibItems(all);

  /* Initialise order for any new items not yet in saved order */
  const knownKeys = new Set(LIB_PREFS.order);
  sorted.forEach(i=>{ const k=libKey(i); if(!knownKeys.has(k)) LIB_PREFS.order.push(k); });

  list.innerHTML = '';

  /* Group labels */
  const favItems    = sorted.filter(i=>LIB_PREFS.favs.has(libKey(i)));
  const nonFavItems = sorted.filter(i=>!LIB_PREFS.favs.has(libKey(i)));

  if(favItems.length && nonFavItems.length){
    const fl = document.createElement('div');
    fl.className = 'lc-group-lbl'; fl.textContent = '★ Favourites';
    list.appendChild(fl);
  }
  favItems.forEach(i    => list.appendChild(makeLibCard(i, sorted, list)));

  if(favItems.length && nonFavItems.length){
    const al = document.createElement('div');
    al.className = 'lc-group-lbl'; al.textContent = 'All';
    list.appendChild(al);
  }
  nonFavItems.forEach(i => list.appendChild(makeLibCard(i, sorted, list)));
}
function buildDGList(){const list=document.getElementById('dglist');list.innerHTML=DG_DATA.map(dg=>`<div class="dgc" data-cls="${dg.cls}" style="background:${dg.bg}14;border-color:${dg.bc};"><div class="ddia" style="background:${dgBg(dg)};border-color:${dg.bc};"><span style="color:${dg.tc};">${dg.cls}</span></div><div class="dg-cl" style="color:${dg.bc};">Class ${dg.cls}</div><div class="dg-nm">${dg.nm}</div><div class="dg-sb">${dg.sub}</div></div>`).join('');list.onclick=e=>{const card=e.target.closest('.dgc');if(!card)return;const dg=DG_DATA.find(d=>d.cls===card.dataset.cls);if(!dg)return;document.querySelectorAll('.lc,.dgc').forEach(c=>c.classList.remove('sel'));card.classList.add('sel');S.pending={type:'dg',item:dg};document.getElementById('hint').innerHTML=`<b>◆ DG ${dg.cls} · ${dg.nm}</b> — click deck to place`;updateDGZones();};}
function buildCustList(){
  const list=document.getElementById('custList');list.innerHTML='';
  S.customLib.forEach((item,i)=>{
    const key=libKey(item);
    const alias=LIB_PREFS.aliases[key]||'';
    const dimStr=item.length_m!=null?`${item.length_m.toFixed(2)}×${item.width_m.toFixed(2)} m`:'';
    const el=document.createElement('div');el.className='lc';el.dataset.ci=i;
    el.innerHTML=`<div class="lc-cat">Custom</div>
      ${alias?`<div class="lc-alias">${alias}</div><div class="lc-orig">${item.name}</div>`:`<div class="lc-nm">${item.name}</div>`}
      <div class="lc-dim">${dimStr}${dimStr?' · ':''}${item.wt||0}T</div>`;
    list.appendChild(el);
  });
  list.onclick=e=>{
    const card=e.target.closest('.lc');if(!card)return;
    const item=S.customLib[+card.dataset.ci];if(!item)return;
    document.querySelectorAll('.lc,.dgc').forEach(c=>c.classList.remove('sel'));
    card.classList.add('sel');S.pending={type:'cargo',item};
    document.getElementById('hint').innerHTML=t('hint_place', LIB_PREFS.aliases[libKey(item)]||item.name, '');
  };
}
function cancelPending(){S.pending=null;document.querySelectorAll('.lc,.dgc,.asco-qitem').forEach(c=>c.classList.remove('sel','selected-q'));document.getElementById('hint').innerHTML=t('hint_select');updateDGZones();}
function bindTabs(){document.querySelectorAll('.stab').forEach(t=>{t.onclick=()=>{document.querySelectorAll('.stab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tpane').forEach(x=>x.classList.remove('active'));t.classList.add('active');document.getElementById('tab'+t.dataset.tab.charAt(0).toUpperCase()+t.dataset.tab.slice(1)).classList.add('active');};});}
function bindLibPanel(){
  const panel  = document.getElementById('libPanel');
  const header = document.getElementById('libHeader');
  const handle = document.getElementById('libResizeHandle');
  const arrow  = panel.querySelector('.lib-toggle');

  const LIB_H_MIN = 120;
  const LIB_H_MAX = 600;
  const LIB_H_DEFAULT = 220;
  const LIB_H_EXPANDED = 340;  // height used after import auto-expand
  const SESSION_KEY = 'spicaTide_libH';

  /* Restore session height */
  const savedH = parseInt(sessionStorage.getItem(SESSION_KEY), 10);
  if(savedH && !isNaN(savedH)) panel.style.height = savedH + 'px';

  /* Toggle collapse on header click */
  header.onclick = () => {
    panel.classList.toggle('collapsed');
    arrow.textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
  };

  /* Prevent collapse toggle when clicking hint text */
  document.getElementById('hint').addEventListener('click', e => e.stopPropagation());

  /* ── Resize drag ── */
  let dragStartY = 0;
  let dragStartH = 0;
  let rafId = null;

  const onMouseMove = e => {
    if(rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const delta = dragStartY - e.clientY;   // drag up = larger panel
      const newH = Math.max(LIB_H_MIN, Math.min(LIB_H_MAX, dragStartH + delta));
      panel.style.height = newH + 'px';
      if(panel.classList.contains('collapsed')){
        panel.classList.remove('collapsed');
        arrow.textContent = '▾';
      }
      sessionStorage.setItem(SESSION_KEY, newH);
    });
  };

  const onMouseUp = () => {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if(rafId) cancelAnimationFrame(rafId);
  };

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragStartY = e.clientY;
    dragStartH = panel.offsetHeight;
    handle.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  /* Expose auto-expand for import workflow */
  window._libExpandForImport = () => {
    if(panel.classList.contains('collapsed')){
      panel.classList.remove('collapsed');
      arrow.textContent = '▾';
    }
    const currentH = panel.offsetHeight;
    if(currentH < LIB_H_EXPANDED){
      panel.style.transition = 'height .3s cubic-bezier(.4,0,.2,1)';
      panel.style.height = LIB_H_EXPANDED + 'px';
      sessionStorage.setItem(SESSION_KEY, LIB_H_EXPANDED);
      setTimeout(() => { panel.style.transition = ''; }, 320);
    }
  };
}function bindStatusBtns(){document.querySelectorAll('.sb').forEach(b=>{b.onclick=()=>{S.selStatus=b.dataset.s;document.querySelectorAll('.sb').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');};});}
function bindCustomForm(){
  /* btnAdd now lives in the cp panel as cpBtnAdd */
  const oldAdd = document.getElementById('btnAdd');
  if(oldAdd) oldAdd.onclick=()=>{};  /* neutralised — cpBind handles it */
}

/* ════════════════════════════════════════════════════════════
   PERSISTENCE ABSTRACTION LAYER
   Backend-swappable storage for cargo plans.
   Adapters: LocalStorageAdapter (now), TauriAdapter / RestAdapter (future).
   Public API: savePlan(), loadPlan(), deletePlan(), listPlans()
   Legacy shims: save() and load() delegate here — all 24 call sites unchanged.
════════════════════════════════════════════════════════════ */

const PLAN_SCHEMA_CURRENT = 3;
const PLAN_DEFAULT_KEY = 'current';

/* ── Migration chain ──────────────────────────────────────
   Each function upgrades an envelope from schema N to N+1.
   Index = target version (so index 3 upgrades 2→3).
   Add new migrations at the end when schema changes. */
const PLAN_MIGRATIONS = [
  null, // 0: unused
  null, // 1: unused
  null, // 2: 1→2 handled by importLegacy (scaleVer transition)
  // 3: schema 2→3 — wrap flat format into envelope (handled by importLegacy)
  function migrate_2_to_3(envelope) { return envelope; }
];

function migratePlan(envelope) {
  let current = envelope;
  while (current._schema < PLAN_SCHEMA_CURRENT) {
    const fn = PLAN_MIGRATIONS[current._schema + 1];
    if (!fn) {
      console.warn('[PersistenceLayer] No migration for schema ' + current._schema + ' → ' + (current._schema + 1));
      break;
    }
    current = fn(current);
    current._schema = current._schema + 1;
  }
  return current;
}

/* ── Legacy import ────────────────────────────────────────
   Converts old spicaTide_v13 flat JSON into a schema-3 envelope.
   Called once when new-format key is missing but legacy key exists. */
function importLegacy(raw) {
  const needsScaleWarn = !!(raw.cargo && raw.cargo.length && (raw.scaleVer || 1) < 2);
  return {
    _schema: PLAN_SCHEMA_CURRENT,
    _savedAt: new Date().toISOString(),
    _appVersion: (typeof CURRENT_BUILD !== 'undefined' ? CURRENT_BUILD : 'v38.20'),
    _legacyScaleWarn: needsScaleWarn,
    name: raw.voyage || 'Imported Plan',
    plan: {
      cargo:      raw.cargo      || [],
      customLib:  raw.customLib  || [],
      customLocs: raw.customLocs || [],
      voyage:     raw.voyage     || '',
      activeLocs: raw.activeLocs || ['BLEO','TART'],
      selLoc:     raw.selLoc     || 'BLEO',
      date:       raw.date       || new Date().toISOString(),
      dynColors:  raw.dynColors  || {},
      voyRemarks: raw.voyRemarks || ''
    }
  };
}

/* ── LocalStorage Adapter ─────────────────────────────────
   Adapter interface: { save(key, envelope), load(key), delete(key), list() }
   Future adapters (Tauri FS, REST API) implement the same four methods. */
const LocalStorageAdapter = {
  _prefix: 'spicaTide_plan_',

  save(key, envelope) {
    try {
      localStorage.setItem(this._prefix + key, JSON.stringify(envelope));
    } catch (e) {
      console.warn('[PersistenceLayer] Save failed:', e);
    }
  },

  load(key) {
    try {
      const raw = localStorage.getItem(this._prefix + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[PersistenceLayer] Load failed:', e);
      return null;
    }
  },

  delete(key) {
    try { localStorage.removeItem(this._prefix + key); } catch (e) {}
  },

  list() {
    const plans = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(this._prefix)) {
          try {
            const env = JSON.parse(localStorage.getItem(k));
            plans.push({
              key:     k.slice(this._prefix.length),
              name:    (env && env.name) || '(untitled)',
              savedAt: (env && env._savedAt) || ''
            });
          } catch (e) { /* skip malformed entries */ }
        }
      }
    } catch (e) {}
    return plans;
  }
};

let _planAdapter = LocalStorageAdapter;
let _currentFilePath = null;   /* path of currently open .spica file (Tauri only) */
/* _isTauri is a function, not a const — window.__TAURI__ may not exist
   at module load time in Tauri v2 (injected after ES module executes). */
function _isTauri(){ return typeof window !== 'undefined' && !!window.__TAURI__; }
let _dirty = false;            /* true when unsaved changes exist */
let _autosaveEnabled = true;   /* user-togglable autosave */

/* ── Undo / Redo ─────────────────────────────────────────── */
const UNDO_MAX = 50;
let _undoStack = [];
let _redoStack = [];

function _takeSnapshot(){
  return JSON.stringify({
    cargo: S.cargo, activeLocs: S.activeLocs, selLoc: S.selLoc,
    customLib: S.customLib, customLocs: S.customLocs,
    voyRemarks: S.voyRemarks, dynColors: DYN_COLORS
  });
}

function _pushUndo(){
  _undoStack.push(_takeSnapshot());
  if(_undoStack.length > UNDO_MAX) _undoStack.shift();
  _redoStack = [];
  _updateUndoButtons();
}

function undo(){
  if(!_undoStack.length) return;
  _redoStack.push(_takeSnapshot());
  const snap = JSON.parse(_undoStack.pop());
  _restoreSnapshot(snap);
  _updateUndoButtons();
  showToast('Undo', 'ok');
}

function redo(){
  if(!_redoStack.length) return;
  _undoStack.push(_takeSnapshot());
  const snap = JSON.parse(_redoStack.pop());
  _restoreSnapshot(snap);
  _updateUndoButtons();
  showToast('Redo', 'ok');
}

function _restoreSnapshot(snap){
  S.cargo = snap.cargo;
  S.activeLocs = snap.activeLocs;
  S.selLoc = snap.selLoc;
  S.customLib = snap.customLib;
  S.customLocs = snap.customLocs;
  S.voyRemarks = snap.voyRemarks;
  Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]);
  Object.assign(DYN_COLORS, snap.dynColors);
  renderAll(); updateStats(); updateDGSummary();
  buildActiveLocStrip(); checkSeg();
  savePlan();
  _dirty = true; _updateSaveIndicator();
}

function _updateUndoButtons(){
  const u = document.getElementById('btnUndo');
  const r = document.getElementById('btnRedo');
  if(u) u.disabled = _undoStack.length === 0;
  if(r) r.disabled = _redoStack.length === 0;
}

/* ── Tauri File Adapter ───────────────────────────────────
   Same 4-method interface as LocalStorageAdapter.
   Uses Tauri invoke() commands for disk I/O.
   Active only when running inside Tauri desktop shell. */
const TauriFileAdapter = {

  save(key, envelope) {
    const json = JSON.stringify(envelope, null, 2);
    if (_currentFilePath) {
      window.__TAURI__.core.invoke('write_file', { path: _currentFilePath, contents: json }).catch(e => {
        console.warn('[TauriFileAdapter] Save failed:', e);
      });
    }
    /* Always also save to localStorage as fallback */
    LocalStorageAdapter.save(key, envelope);
  },

  load(key) {
    /* File-based load is handled by openPlanFromFile().
       For auto-load at startup, fall back to localStorage. */
    return LocalStorageAdapter.load(key);
  },

  delete(key) {
    LocalStorageAdapter.delete(key);
  },

  list() {
    return LocalStorageAdapter.list();
  }
};

/* ── Native file dialog functions (Tauri only) ──────────── */

function _buildEnvelope() {
  return {
    _schema:     PLAN_SCHEMA_CURRENT,
    _savedAt:    new Date().toISOString(),
    _appVersion: (typeof CURRENT_BUILD !== 'undefined' ? CURRENT_BUILD : 'v38.20'),
    name:        document.getElementById('voyIn').value || 'Untitled Plan',
    plan: {
      cargo:      S.cargo,
      customLib:  S.customLib,
      customLocs: S.customLocs,
      voyage:     document.getElementById('voyIn').value,
      activeLocs: S.activeLocs,
      selLoc:     S.selLoc,
      date:       selDate.toISOString(),
      dynColors:  DYN_COLORS,
      voyRemarks: S.voyRemarks || '',
      zoomLevel:  zoomLevel
    }
  };
}

/* ── Shared native Save As dialog ───────────────────────────
   Returns the chosen file path, or null if cancelled.
   Works in Tauri desktop mode only. Browser mode returns null. */
async function _nativeSaveDialog(defaultName, filterName, extensions) {
  if (!_isTauri()) {
    console.warn('[SaveDialog] Not in Tauri — falling back to browser');
    return null;
  }
  try {
    const dialogModule = await import('@tauri-apps/plugin-dialog');
    console.log('[SaveDialog] Dialog module loaded, calling save...');
    const path = await dialogModule.save({
      title: 'Save As',
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: extensions }]
    });
    console.log('[SaveDialog] User chose:', path);
    return path || null;
  } catch (e) {
    console.error('[SaveDialog] FAILED:', e);
    showToast('Save dialog error: ' + (e && e.message || e), 'warn');
    return null;
  }
}

/* ── Write bytes or string to a chosen path via Tauri ─── */
async function _tauriWriteBytes(path, uint8arr) {
  await window.__TAURI__.core.invoke('write_file_bytes', { path, bytes: Array.from(uint8arr) });
}

function _updateWindowTitle(filePath) {
  if (filePath) {
    const name = filePath.split(/[/\\]/).pop();
    document.title = 'SPICA TIDE - ' + name;
  } else {
    document.title = 'SPICA TIDE - Deck Cargo Planner';
  }
}

async function _addToRecent(path, name) {
  try {
    await window.__TAURI__.core.invoke('add_recent_file', { path, name: name || 'Untitled' });
  } catch (e) { /* non-critical */ }
}

async function savePlanToFile(path) {
  if (!_isTauri()) return;
  try {
    let targetPath = path;
    if (!targetPath) {
      const dlg = await import('@tauri-apps/plugin-dialog');
      targetPath = await dlg.save({
        title: 'Save Cargo Plan',
        defaultPath: (document.getElementById('voyIn').value || 'cargo-plan').replace(/[^a-zA-Z0-9_\-. ]/g, '_') + '.spica',
        filters: [{ name: 'SPICA Plan', extensions: ['spica'] }]
      });
    }
    if (!targetPath) return; /* user cancelled */

    const envelope = _buildEnvelope();
    const json = JSON.stringify(envelope, null, 2);
    await window.__TAURI__.core.invoke('write_file', { path: targetPath, contents: json });

    _currentFilePath = targetPath;
    _updateWindowTitle(targetPath);
    _addToRecent(targetPath, envelope.name);
    showToast('Plan saved', 'ok');

    /* Also persist to localStorage as backup */
    LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
  } catch (e) {
    console.error('[savePlanToFile]', e);
    showToast('Save failed: ' + e, 'warn');
  }
}

async function openPlanFromFile() {
  if (!_isTauri()) return;
  try {
    const dlg = await import('@tauri-apps/plugin-dialog');
    const selected = await dlg.open({
      title: 'Open Cargo Plan',
      filters: [{ name: 'SPICA Plan', extensions: ['spica'] }],
      multiple: false
    });
    if (!selected) return; /* user cancelled */

    const filePath = typeof selected === 'string' ? selected : selected.path;
    const contents = await window.__TAURI__.core.invoke('read_file', { path: filePath });
    let envelope = JSON.parse(contents);

    /* Run migrations if needed */
    if (envelope._schema < PLAN_SCHEMA_CURRENT) {
      envelope = migratePlan(envelope);
    }

    /* Apply to app state (same logic as loadPlan) */
    const d = envelope.plan;
    if (d.cargo) S.cargo = d.cargo;
    if (d.customLib) { S.customLib = d.customLib; buildCustList(); buildCargoList(); }
    if (d.customLocs && Array.isArray(d.customLocs)) S.customLocs = d.customLocs;
    if (d.voyage) document.getElementById('voyIn').value = d.voyage;
    if (d.activeLocs && d.activeLocs.length) S.activeLocs = d.activeLocs;
    if (d.selLoc) S.selLoc = d.selLoc;
    if (d.date) { selDate = new Date(d.date); if (isNaN(selDate)) selDate = new Date(); }
    if (d.dynColors) { Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]); Object.assign(DYN_COLORS, d.dynColors); }
    if (d.voyRemarks) S.voyRemarks = d.voyRemarks;
    if (d.zoomLevel) applyZoom(d.zoomLevel);

    _currentFilePath = filePath;
    _updateWindowTitle(filePath);
    _addToRecent(filePath, envelope.name);

    /* Re-render everything */
    initDynColors();
    setDateDisplay();
    loadLibPrefs();
    buildActiveLocStrip(); buildLocGrid(); buildCargoList(); buildDGList();
    renderAll(); updateStats(); updateDGSummary();

    /* Also store in localStorage as backup */
    LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);

    showToast('Plan opened', 'ok');
  } catch (e) {
    console.error('[openPlanFromFile]', e);
    showToast('Open failed: ' + e, 'warn');
  }
}

async function openRecentFile(path) {
  if (!_isTauri() || !path) return;
  try {
    const contents = await window.__TAURI__.core.invoke('read_file', { path });
    let envelope = JSON.parse(contents);
    if (envelope._schema < PLAN_SCHEMA_CURRENT) {
      envelope = migratePlan(envelope);
    }
    const d = envelope.plan;
    if (d.cargo) S.cargo = d.cargo;
    if (d.customLib) { S.customLib = d.customLib; buildCustList(); buildCargoList(); }
    if (d.customLocs && Array.isArray(d.customLocs)) S.customLocs = d.customLocs;
    if (d.voyage) document.getElementById('voyIn').value = d.voyage;
    if (d.activeLocs && d.activeLocs.length) S.activeLocs = d.activeLocs;
    if (d.selLoc) S.selLoc = d.selLoc;
    if (d.date) { selDate = new Date(d.date); if (isNaN(selDate)) selDate = new Date(); }
    if (d.dynColors) { Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]); Object.assign(DYN_COLORS, d.dynColors); }
    if (d.voyRemarks) S.voyRemarks = d.voyRemarks;
    if (d.zoomLevel) applyZoom(d.zoomLevel);

    _currentFilePath = path;
    _updateWindowTitle(path);
    _addToRecent(path, envelope.name);
    initDynColors(); setDateDisplay(); loadLibPrefs();
    buildActiveLocStrip(); buildLocGrid(); buildCargoList(); buildDGList();
    renderAll(); updateStats(); updateDGSummary();
    LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
    showToast('Plan opened', 'ok');
  } catch (e) {
    showToast('Could not open file', 'warn');
  }
}

function saveQuick() {
  if (_isTauri() && _currentFilePath) {
    const envelope = _buildEnvelope();
    const json = JSON.stringify(envelope, null, 2);
    window.__TAURI__.core.invoke('write_file', { path: _currentFilePath, contents: json }).catch(() => {});
    LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
  } else {
    savePlan();
  }
}

/* ── Project Save / Load (.json) ────────────────────────── */

async function saveProjectFile() {
  const envelope = _buildEnvelope();
  const json = JSON.stringify(envelope, null, 2);
  const dd = String(selDate.getDate()).padStart(2,'0');
  const mm = String(selDate.getMonth()+1).padStart(2,'0');
  const yyyy = selDate.getFullYear();
  const fileName = 'SPICA TIDE Project - ' + dd + '.' + mm + '.' + yyyy + '.json';

  if (_isTauri()) {
    const targetPath = await _nativeSaveDialog(fileName, 'SPICA Project', ['json']);
    if (!targetPath) return;
    try {
      await window.__TAURI__.core.invoke('write_file', { path: targetPath, contents: json });
      _currentFilePath = targetPath;
      _updateWindowTitle(targetPath);
      _addToRecent(targetPath, envelope.name);
      LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
      _markSaved();
      showToast('Project saved \u2014 ' + targetPath.split(/[/\\]/).pop(), 'ok');
    } catch (e) {
      showToast('Save failed: ' + (e && e.message || e), 'warn');
    }
    return;
  }

  /* Browser: Blob download */
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  _markSaved();
  showToast('Project saved \u2014 ' + fileName, 'ok');
}

function openProjectFile() {
  if (_isTauri()) {
    /* Tauri: native open dialog */
    (async () => {
      try {
        const dlg = await import('@tauri-apps/plugin-dialog');
        const selected = await dlg.open({
          title: 'Open Project',
          filters: [{ name: 'SPICA Project', extensions: ['json','spica'] }],
          multiple: false
        });
        if (!selected) return;
        const filePath = typeof selected === 'string' ? selected : selected.path;
        const contents = await window.__TAURI__.core.invoke('read_file', { path: filePath });
        _applyProjectData(contents, filePath.split(/[/\\]/).pop());
        _currentFilePath = filePath;
        _updateWindowTitle(filePath);
        _addToRecent(filePath, _buildEnvelope().name);
      } catch (e) {
        showToast('Open failed: ' + (e && e.message || e), 'warn');
      }
    })();
    return;
  }

  /* Browser: file input picker */
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.spica';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { _applyProjectData(ev.target.result, file.name); };
    reader.readAsText(file);
  };
  input.click();
}

function _applyProjectData(jsonString, fileName) {
  try {
    let envelope = JSON.parse(jsonString);
    if (envelope._schema < PLAN_SCHEMA_CURRENT) {
      envelope = migratePlan(envelope);
    }
    const d = envelope.plan;
    if (d.cargo) S.cargo = d.cargo;
    if (d.customLib) { S.customLib = d.customLib; buildCustList(); buildCargoList(); }
    if (d.customLocs && Array.isArray(d.customLocs)) S.customLocs = d.customLocs;
    if (d.voyage) document.getElementById('voyIn').value = d.voyage;
    if (d.activeLocs && d.activeLocs.length) S.activeLocs = d.activeLocs;
    if (d.selLoc) S.selLoc = d.selLoc;
    if (d.date) { selDate = new Date(d.date); if (isNaN(selDate)) selDate = new Date(); }
    if (d.dynColors) { Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]); Object.assign(DYN_COLORS, d.dynColors); }
    if (d.voyRemarks) S.voyRemarks = d.voyRemarks;
    if (d.zoomLevel) applyZoom(d.zoomLevel);

    initDynColors(); setDateDisplay(); loadLibPrefs();
    buildActiveLocStrip(); buildLocGrid(); buildCargoList(); buildDGList();
    renderAll(); updateStats(); updateDGSummary();
    LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
    showToast('Project loaded \u2014 ' + fileName, 'ok');
  } catch (err) {
    console.error('[Project] Load error:', err);
    showToast('Invalid project file', 'warn');
  }
}

/* ── Auto-detect Tauri runtime ──────────────────────────── */
if (_isTauri()) {
  _planAdapter = TauriFileAdapter;
}

/* ── Scale warning (extracted from old load()) ──────────── */
function _showScaleWarning() {
  setTimeout(() => {
    const w = document.createElement('div');
    w.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);' +
      'background:rgba(251,209,133,.18);border:1px solid rgba(120,90,26,.35);border-radius:10px;padding:10px 18px;' +
      'font-size:11px;color:#4a3400;z-index:9999;box-shadow:0 6px 24px rgba(49,51,44,.14);max-width:420px;text-align:center;font-family:Inter,system-ui,sans-serif;';
    w.innerHTML = '<b>\u26A0 Scale fix applied (v28)</b> \u2014 cargo blocks saved before this update may be ' +
      'incorrectly sized. <a href="#" style="color:#486083;font-weight:600;" id="clearDeckLink">Clear deck</a> to start fresh.';
    document.body.appendChild(w);
    document.getElementById('clearDeckLink').onclick = e => {
      e.preventDefault();
      S.cargo = []; renderAll(); updateStats(); buildActiveLocStrip(); updateDGSummary(); save(); w.remove();
    };
    setTimeout(() => w.remove(), 18000);
  }, 600);
}

/* ── Public API ────────────────────────────────────────── */

function savePlan(key) {
  key = key || PLAN_DEFAULT_KEY;
  const envelope = {
    _schema:     PLAN_SCHEMA_CURRENT,
    _savedAt:    new Date().toISOString(),
    _appVersion: (typeof CURRENT_BUILD !== 'undefined' ? CURRENT_BUILD : 'v38.20'),
    name:        document.getElementById('voyIn').value || 'Untitled Plan',
    plan: {
      cargo:      S.cargo,
      customLib:  S.customLib,
      customLocs: S.customLocs,
      voyage:     document.getElementById('voyIn').value,
      activeLocs: S.activeLocs,
      selLoc:     S.selLoc,
      date:       selDate.toISOString(),
      dynColors:  DYN_COLORS,
      voyRemarks: S.voyRemarks || ''
    }
  };
  _planAdapter.save(key, envelope);
  /* Dual-write to legacy key for rollback safety — if user reverts to an older
     HTML file, their data is still accessible under the old key. */
  try {
    localStorage.setItem('spicaTide_v13', JSON.stringify({
      cargo: S.cargo, customLib: S.customLib, customLocs: S.customLocs,
      voyage: document.getElementById('voyIn').value,
      activeLocs: S.activeLocs, selLoc: S.selLoc,
      date: selDate.toISOString(), dynColors: DYN_COLORS,
      voyRemarks: S.voyRemarks || '', scaleVer: 2
    }));
  } catch (e) {}
}

function loadPlan(key) {
  key = key || PLAN_DEFAULT_KEY;
  let envelope = _planAdapter.load(key);

  /* Legacy fallback: if no new-format plan exists, import from old key */
  if (!envelope) {
    try {
      const legacy = JSON.parse(localStorage.getItem('spicaTide_v13') || 'null');
      if (legacy && (legacy.cargo || legacy.activeLocs)) {
        envelope = importLegacy(legacy);
        _planAdapter.save(key, envelope);
      }
    } catch (e) {}
  }

  if (!envelope) {
    setDateDisplay();
    loadLibPrefs();
    return false;
  }

  /* Run migrations if data is from an older schema */
  if (envelope._schema < PLAN_SCHEMA_CURRENT) {
    envelope = migratePlan(envelope);
    _planAdapter.save(key, envelope);
  }

  /* Apply plan data to app state */
  const d = envelope.plan;
  if (d.cargo) S.cargo = d.cargo;
  if (d.customLib) { S.customLib = d.customLib; buildCustList(); buildCargoList(); }
  if (d.customLocs && Array.isArray(d.customLocs)) S.customLocs = d.customLocs;
  if (d.voyage) document.getElementById('voyIn').value = d.voyage;
  if (d.activeLocs && d.activeLocs.length) S.activeLocs = d.activeLocs;
  if (d.selLoc) S.selLoc = d.selLoc;
  if (d.date) { selDate = new Date(d.date); if (isNaN(selDate)) selDate = new Date(); }
  if (d.dynColors) Object.assign(DYN_COLORS, d.dynColors);
  if (d.voyRemarks) S.voyRemarks = d.voyRemarks;
  if (d.zoomLevel) applyZoom(d.zoomLevel);

  /* Legacy scale warning for data imported from scaleVer < 2 */
  if (envelope._legacyScaleWarn) _showScaleWarning();

  setDateDisplay();
  loadLibPrefs();
  return true;
}

function deletePlan(key) {
  _planAdapter.delete(key || PLAN_DEFAULT_KEY);
}

function listPlans() {
  return _planAdapter.list();
}

/* ── Legacy shims — all 24 call sites of save() work unchanged ── */
function save() { _pushUndo(); savePlan(); _dirty = true; _updateSaveIndicator(); }
function load() { loadPlan(); }

let zoomLevel=1.0;const ZOOM_STEP=0.1,ZOOM_MIN=0.3,ZOOM_MAX=2.0;
function applyZoom(z){zoomLevel=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,z));const wrap=document.getElementById('deckZoomWrap');wrap.style.transform=`scale(${zoomLevel})`;wrap.style.transformOrigin='top left';const inner=wrap.querySelector('.deck-outer');if(inner){wrap.style.width=(inner.offsetWidth*zoomLevel)+'px';wrap.style.height=(inner.offsetHeight*zoomLevel)+'px';}document.getElementById('zoomLbl').textContent=Math.round(zoomLevel*100)+'%';}
function fitToScreen(){const area=document.getElementById('deckArea'),inner=document.querySelector('.deck-outer');if(!inner)return;applyZoom(Math.min((area.clientWidth-24)/inner.offsetWidth,(area.clientHeight-16)/inner.offsetHeight,1.0));}
function initZoom(){document.getElementById('zoomIn').onclick=()=>applyZoom(zoomLevel+ZOOM_STEP);document.getElementById('zoomOut').onclick=()=>applyZoom(zoomLevel-ZOOM_STEP);document.getElementById('zoomReset').onclick=()=>applyZoom(1.0);document.getElementById('zoomFit').onclick=fitToScreen;document.getElementById('deckArea').addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();applyZoom(zoomLevel+(e.deltaY<0?ZOOM_STEP:-ZOOM_STEP));},{passive:false});setTimeout(()=>{const area=document.getElementById('deckArea'),inner=document.querySelector('.deck-outer');if(inner&&inner.offsetWidth>area.clientWidth-24)fitToScreen();},60);}

/* ── Resolve an ASCO display name to a LOC_ALL location id ──────────────
   Maps strings like "CLAYMORE WOPS", "CLAYMORE CAP", "CLAYMORE CPP",
   "CLAYMORE DRILLING" to their correct LOC_ALL ids.
   Uses a priority keyword table first, then normalised name matching.
   Auto-activates the matched location so cargo can be assigned to it.
   Returns the matched id, or S.selLoc as a last-resort fallback.        */
function resolveImportedLocId(displayName){
  if(!displayName) return S.selLoc || (S.activeLocs[0] || 'BLEO');

  /* Normalise: uppercase, collapse spaces, strip non-alphanumeric except space */
  const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
  const dn = norm(displayName);

  /* ── Priority keyword table ─────────────────────────────────────────────
     Entries are checked in order; first substring match wins.
     More specific entries must come before broader ones.                  */
  const KEYWORD_MAP = [
    /* Claymore sub-locations */
    { keys:['CLAYMORE WOPS','CLAY WOPS'],              id:'CLAY_WOP' },
    { keys:['CLAYMORE CPP','CLAY CPP'],                id:'CLAY_CPP' },
    { keys:['CLAYMORE CAP','CLAY CAP'],                id:'CLAY_CAP' },
    { keys:['CLAYMORE DRILL','CLAY DRILL','CLAYMORE DRILLING'], id:'CLAY_DRL' },
    { keys:['CLAYMORE'],                               id:'CLAY_CAP' }, // generic Claymore → CAP
    /* Piper sub-locations */
    { keys:['PIPER WOPS','PIPER WOP'],                 id:'PIPER_WOP' },
    { keys:['PIPER DRILL','PIPER DR'],                 id:'PIPER_DR'  },
    { keys:['PIPER'],                                  id:'PIPER'     },
    /* Individuals */
    { keys:['SALTIRE','SALT'],                         id:'SALT'  },
    { keys:['TARTAN','TART'],                          id:'TART'  },
    { keys:['BEATRICE','BEAT'],                        id:'BEAT'  },
    { keys:['CLYDE'],                                  id:'CLYDE' },
    { keys:['FULMAR'],                                 id:'FULMAR'},
    { keys:['ARBROATH','ARBR'],                        id:'ARBR'  },
    { keys:['MONTROSE','MONTR'],                       id:'MONTR' },
    { keys:['BLEO'],                                   id:'BLEO'  },
    { keys:['GP3'],                                    id:'GP3'   },
    { keys:['AUK'],                                    id:'AUK'   },
  ];

  let resolvedId = null;

  /* 1. Keyword table — substring check against normalised displayName */
  for(const entry of KEYWORD_MAP){
    if(entry.keys.some(k => dn.includes(norm(k)))){
      resolvedId = entry.id;
      break;
    }
  }

  /* 2. Fallback: direct LOC_ALL or customLocs name match */
  if(!resolvedId){
    const direct = [...LOC_ALL, ...S.customLocs].find(l => norm(l.name) === dn || dn.includes(norm(l.name)));
    if(direct) resolvedId = direct.id;
  }

  /* 3. Unknown location — create it as a custom location rather than
     silently collapsing into an existing one                         */
  if(!resolvedId){
    resolvedId = createCustomLoc(displayName);
    return resolvedId; // createCustomLoc already activates and saves
  }

  /* Auto-activate the location if it isn't already active */
  if(!S.activeLocs.includes(resolvedId)){
    S.activeLocs.push(resolvedId);
    assignLocColor(resolvedId);
    if(!S.selLoc) S.selLoc = resolvedId;
    buildLocGrid();
    buildActiveLocStrip();
    save();
  }

  return resolvedId;
}

/* ════════════════════════════════════
   ASCO CARGO IMPORT SYSTEM
   Parses multi-sheet Excel loadout files
   into a queue; user drags items to deck.
════════════════════════════════════ */

/* Heavy lift threshold (tonnes) */
const HL_THRESHOLD = 10;

/* Queue of imported items (not yet on deck) */
let IMPORT_QUEUE = [];

/* Currently selected items in ASCO modal (during import flow) */
let ascoImportData = [];   // parsed sheets [{sheetName, location, loadlistId, items:[]}]
let ascoSelected = new Set(); // indices of selected items (across all sheets, as "sheetIdx-itemIdx")

/* ── Size detection from description text ────────────────────
   Handles real ASCO formats:
     "10' X 8'", "7'X7'", "20' x 8'", "7 X 7",
     "22FT X 8FT", "10ft basket", "8FT TOTE TANK"
   Returns {length_m, width_m} or null.                        */
function detectSizeFromDesc(desc){
  if(!desc) return null;
  const s = desc.trim();

  /* Unit token: ft, FT, foot, ' — all treated as feet */
  const U = "(?:ft|FT|foot|')";

  /* Pattern 1: N[unit] x M[unit]  — handles "10' X 8'", "22FT X 8FT", "7 X 7" */
  const dimRe = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*${U}?\\s*[xX×]\\s*(\\d+(?:\\.\\d+)?)\\s*${U}?`
  );
  const m = s.match(dimRe);
  if(m){
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    /* Values ≥ 4 assumed feet; < 4 assumed metres */
    const toM = v => v >= 4 ? parseFloat((v * 0.3048).toFixed(3)) : v;
    const L = toM(Math.max(a, b));
    const W = toM(Math.min(a, b));
    /* Sanity: both dims must be > 0 and realistic (< 30m) */
    if(L > 0 && W > 0 && L < 30 && W < 30) return { length_m: L, width_m: W };
  }

  /* Pattern 2: single NNft/NNFT — e.g. "10ft basket", "8FT TOTE TANK" */
  const singleFt = /(\d+(?:\.\d+)?)\s*(?:ft|FT|foot)/;
  const sm = s.match(singleFt);
  if(sm){
    const v = parseFloat((parseFloat(sm[1]) * 0.3048).toFixed(3));
    if(v > 0 && v < 30) return { length_m: v, width_m: v };
  }

  return null;
}

/* ── Map detected size to nearest CCU_PRESET canvas px dims ──
   Finds best-matching preset by minimising area difference.
   If no close match, creates a default square from the metres. */
function sizeToCanvasPx(length_m, width_m){
  if(!length_m || !width_m){
    /* Default: 6ft × 6ft placeholder */
    return { w: m2px_w(1.83), h: m2px_h(1.83), length_m: 1.83, width_m: 1.83, isDefault: true };
  }

  /* Try to find close preset (within 20% area match) */
  const targetArea = length_m * width_m;
  let best = null, bestDiff = Infinity;
  CCU_PRESETS.forEach(p => {
    const area = p.length_m * p.width_m;
    const diff = Math.abs(area - targetArea) / targetArea;
    if(diff < bestDiff){ bestDiff = diff; best = p; }
  });

  if(best && bestDiff < 0.25){
    return {
      w: m2px_w(best.length_m), h: m2px_h(best.width_m),
      length_m: best.length_m, width_m: best.width_m, isDefault: false
    };
  }

  /* Custom size from detected dims */
  return {
    w: m2px_w(length_m), h: m2px_h(width_m),
    length_m, width_m, isDefault: false
  };
}

/* ── DG class extraction ────────────────────────────────────
   Checks Hazard Class column OR description for "HAZ CLASS" keyword */
function extractDGClass(hazardCell, description){
  /* Extract the first valid IMDG class from a string.
     Handles: "3", "2.2", "9, 3", "2.1, 9", "LQ" (non-DG food qualifier). */
  const parseFirst = v => {
    if(!v) return '';
    const s = String(v).trim();
    if(!s || s.toUpperCase() === 'LQ') return '';
    /* Try the whole value first */
    if(/^\d+(\.\d+)?$/.test(s)) return s;
    /* Comma-separated list — e.g. "9, 3" or "2.1, 9" → return first valid class */
    for(const part of s.split(/[,&]/)){
      const p = part.trim();
      if(/^\d+(\.\d+)?$/.test(p)) return p;
    }
    return '';
  };

  const cls = parseFirst(hazardCell);
  if(cls) return cls;

  /* Fallback: scan description text for HAZ CLASS / CLASS patterns
     e.g. "***HAZ CLASS 2.2***", "****HAZ CLASS 8****", "CLASS 9 & 3" */
  if(description){
    const d = String(description);
    const m = d.match(/(?:haz(?:ard)?\s*class|class)\s*(\d+(?:\.\d+)?)/i);
    if(m) return m[1];
    const m2 = d.match(/\*+\s*(?:haz(?:ard)?\s*class|class)\s*(\d+(?:\.\d+)?)\s*\*+/i);
    if(m2) return m2[1];
  }
  return '';
}

/* ════════════════════════════════════
   ASCO EXCEL PARSER — v2
   Built directly from real ASCO iLMS loadout file structure.

   Known fixed layout (confirmed across all sheets):
     Row 6  col0='Location:'   col2=<location name>   col14=<no of lifts>
     Row 7  col0='Loadlist ID:' col2=<loadlist string>
     Col mapping for cargo rows (0-indexed):
       0  = Item number (numeric 1,2,3... or letter A,B,C...)
       1  = Description
       4  = Est WT (T)
       5  = CCU / Lifts
       9  = Hazard Class
       10 = UN number

   Cargo rows begin after row 8 and continue until a STOP marker.
   There are TWO cargo sections per sheet:
     • Priority / urgent / explosive cargo  (item = letter A,B,C...)
     • General cargo                        (item = number 1,2,3...)
   Both sections use the same column layout.
════════════════════════════════════ */

/* Normalise cell to trimmed lowercase string */
function normCell(v){
  if(v == null) return '';
  return String(v).replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
}

/* Row stop markers — stop parsing cargo when we hit these in col0 or col14 */
const ASCO_STOP = new Set([
  'total','standard instructions:','voyage instructions:',
  'loadlist instructions:','boat skip:',
]);

/* Section header markers to skip (not cargo) */
const ASCO_SECTION = new Set([
  'priority lifts / urgent or explosive cargo',
  'general cargo',
]);

/* Check whether a row value is a valid cargo item identifier:
   numeric (1, 2, 3...) or single/double letter (A, B, C..., AA) */
function isItemId(v){
  if(v == null) return false;
  const s = String(v).trim();
  if(!s) return false;
  /* Numeric */
  if(/^\d+(\.\d+)?$/.test(s)) return true;
  /* Letter(s) only — priority section uses A,B,C... */
  if(/^[A-Za-z]{1,2}$/.test(s)) return true;
  return false;
}

/* Parse a single ASCO sheet.  sheetData = array of row-arrays from XLSX.
   Uses the known fixed ASCO column layout directly.                       */
function parseASCOSheet(sheetName, sheetData){
  if(!sheetData || sheetData.length < 9) return null;

  /* ── Step 1: Extract metadata from the known fixed metadata rows ── */
  const r6 = sheetData[6] || [];
  const r7 = sheetData[7] || [];

  /* Location: row 6 col 0 = 'Location:', col 2 = value */
  let sheetLocation = String(r6[2] || '').trim();
  let noLifts       = parseFloat(r6[14]) || 0;

  /* Loadlist ID: row 7 col 0 = 'Loadlist ID:', col 2 = value */
  let loadlistId = String(r7[2] || '').trim();

  /* If the fixed-row lookup failed (different file variant), scan for them */
  if(!sheetLocation || !loadlistId){
    for(let ri = 0; ri < Math.min(sheetData.length, 15); ri++){
      const row = sheetData[ri] || [];
      const c0 = normCell(row[0]);
      if(!sheetLocation && c0.startsWith('location')){
        /* Value is in first non-empty cell after col 0 */
        for(let ci = 1; ci < row.length; ci++){
          const v = String(row[ci] || '').trim();
          if(v && !v.includes('%') && !v.toLowerCase().includes('date')){
            sheetLocation = v; break;
          }
        }
      }
      if(!loadlistId && c0.startsWith('loadlist')){
        for(let ci = 1; ci < row.length; ci++){
          const v = String(row[ci] || '').trim();
          if(v){ loadlistId = v; break; }
        }
      }
    }
  }

  /* ── Step 2: Dynamically locate the column layout ────────────────────
     In the real ASCO file the column positions are always the same, but
     we verify by scanning for a header row containing 'Description' in
     col 1 and 'Est WT' in col 4.  We store all found header row indices
     because there are TWO sections (Priority + General) each with their
     own sub-header.  We start parsing from row 8 and use the KNOWN
     column positions, falling back to dynamic discovery if needed.       */

  /* Known fixed column positions */
  const COL_ITEM   = 0;
  const COL_DESC   = 1;
  const COL_WT     = 4;
  const COL_CCU    = 5;
  const COL_HAZARD = 9;
  const COL_UN     = 10;

  /* Verify at least one header row has 'description' at col 1 */
  let confirmedLayout = false;
  for(let ri = 6; ri < Math.min(sheetData.length, 30); ri++){
    const row = sheetData[ri] || [];
    if(normCell(row[COL_DESC]).includes('description') &&
       normCell(row[COL_WT]).includes('wt')){
      confirmedLayout = true;
      break;
    }
  }

  /* If we can't confirm the fixed layout, fall back to dynamic column search */
  let descCol = COL_DESC, wtCol = COL_WT, ccuCol = COL_CCU, hazCol = COL_HAZARD;
  if(!confirmedLayout){
    for(let ri = 0; ri < Math.min(sheetData.length, 25); ri++){
      const row = sheetData[ri] || [];
      let dFound = false;
      row.forEach((cell, ci) => {
        const cv = normCell(cell);
        if(cv === 'description' || cv === 'item description') { descCol = ci; dFound = true; }
        if(dFound && (cv.includes('est wt') || cv.includes('wt (t)'))) wtCol = ci;
        if(dFound && (cv.includes('ccu') || cv.includes('lifts')))     ccuCol = ci;
        if(dFound && cv.includes('hazard')) hazCol = ci;
      });
      if(dFound) break;
    }
  }

  /* ── Step 3: Parse every cargo row from row 8 onwards ─────────────── */
  const items = [];

  for(let ri = 8; ri < sheetData.length; ri++){
    const row = sheetData[ri];
    if(!row) continue;

    const col0raw = row[COL_ITEM];
    const col0    = String(col0raw ?? '').trim();
    const col0lc  = col0.toLowerCase();

    /* Hard stop — reached footer / instructions block */
    if(ASCO_STOP.has(col0lc)) break;
    /* Soft stop — 'Total' in col 14 */
    if(normCell(row[14]) === 'total') break;

    /* Skip section headings and blank rows */
    if(ASCO_SECTION.has(col0lc)) continue;
    if(col0 === 'Item' || col0lc === 'item') continue; /* repeat header */
    if(!col0 && row.every(c => c == null || String(c).trim() === '')) continue;

    /* A cargo row MUST have a valid item ID in col 0 */
    if(!isItemId(col0raw)) continue;

    /* Description */
    const desc = String(row[descCol] ?? '').trim();
    if(!desc) continue;

    /* Weight */
    const rawWt = row[wtCol];
    let wt = 0;
    if(rawWt != null && rawWt !== ''){
      const parsed = parseFloat(String(rawWt).replace(/[^0-9.]/g, ''));
      if(!isNaN(parsed)) wt = parsed;
    }

    /* CCU */
    const ccu = String(row[ccuCol] ?? '').trim();

    /* Hazard / DG */
    const hazardCell = row[hazCol] ?? null;
    const dgClass    = extractDGClass(hazardCell, desc);
    const heavyLift  = wt >= HL_THRESHOLD;

    /* Size detection from description */
    const detected = detectSizeFromDesc(desc);
    const dims = detected
      ? sizeToCanvasPx(detected.length_m, detected.width_m)
      : sizeToCanvasPx(null, null);

    items.push({
      desc, ccu, wt, dgClass, heavyLift,
      dims,
      platform:   loadlistId || sheetLocation || sheetName,
      loadlistId: loadlistId,
      location:   sheetLocation,
      noLifts,
      sheetName,
      sizeDetected: !!detected,
    });
  }

  if(items.length === 0) return null;

  /* Display name: use Loadlist ID if it contains meaningful location info,
     else fall back to sheet name.  Format: "CLAYMORE CAP" from
     "CLAYMORE CAP - 462 - 100050 - 08.04.26 - SPICA TIDE"            */
  const displayName = loadlistId
    ? loadlistId.split(' - ')[0].trim()
    : (sheetLocation || sheetName);

  return {
    sheetName,
    displayName,
    location:   sheetLocation || sheetName,
    loadlistId,
    noLifts,
    items,
  };
}

/* ── Parse entire workbook — ALL sheets, no early exit ── */
function parseASCOWorkbook(arrayBuffer){
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  const stats = {
    totalSheets: wb.SheetNames.length,
    validSheets: 0,
    totalItems:  0,
    locations:   [],
  };

  const sheets = [];

  /* Iterate ALL sheets — never stop early */
  wb.SheetNames.forEach(name => {
    const ws   = wb.Sheets[name];
    /* raw:true gives us native numbers/strings; we handle formatting ourselves */
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    const parsed = parseASCOSheet(name, data);
    if(parsed && parsed.items.length > 0){
      sheets.push(parsed);
      stats.validSheets++;
      stats.totalItems += parsed.items.length;
      const locLabel = parsed.displayName || parsed.location;
      if(locLabel && !stats.locations.includes(locLabel)){
        stats.locations.push(locLabel);
      }
    }
  });

  return { sheets, stats };
}

/* ── Render ASCO modal content ── */
function renderAscoContent(sheets, stats){
  ascoImportData = sheets;
  ascoSelected.clear();

  const content = document.getElementById('ascoContent');
  content.innerHTML = '';

  /* ── Import summary banner ── */
  const summary = document.createElement('div');
  summary.className = 'asco-summary';
  const locList = stats.locations.length
    ? stats.locations.join(' · ')
    : 'Unknown';
  summary.innerHTML = `
    <div class="asco-sum-grid">
      <div class="asco-sum-cell">
        <div class="asco-sum-val">${stats.totalSheets}</div>
        <div class="asco-sum-lbl">Sheets found</div>
      </div>
      <div class="asco-sum-sep"></div>
      <div class="asco-sum-cell">
        <div class="asco-sum-val asco-sum-ok">${stats.validSheets}</div>
        <div class="asco-sum-lbl">Sheets imported</div>
      </div>
      <div class="asco-sum-sep"></div>
      <div class="asco-sum-cell">
        <div class="asco-sum-val">${stats.totalItems}</div>
        <div class="asco-sum-lbl">Total cargo items</div>
      </div>
      <div class="asco-sum-sep"></div>
      <div class="asco-sum-cell asco-sum-locs">
        <div class="asco-sum-lbl asco-sum-lbl-top">Locations detected</div>
        <div class="asco-sum-loc-list">${escHtml(locList)}</div>
      </div>
    </div>`;
  content.appendChild(summary);

  let globalIdx = 0;

  sheets.forEach((sheet, si) => {
    const section = document.createElement('div');
    section.className = 'asco-sheet';

    /* Sheet header — use displayName (e.g. "CLAYMORE CAP") + sheet tab name */
    const hdr = document.createElement('div');
    hdr.className = 'asco-sheet-hdr';
    const nameLabel  = sheet.displayName || sheet.sheetName;
    const metaLabel  = sheet.sheetName !== nameLabel ? sheet.sheetName : '';
    const llLabel    = sheet.loadlistId && sheet.loadlistId !== nameLabel ? sheet.loadlistId : '';
    hdr.innerHTML = `
      <span class="asco-sheet-icon">📄</span>
      <span class="asco-sheet-name">${escHtml(nameLabel)}</span>
      <span class="asco-sheet-meta">${metaLabel ? escHtml(metaLabel) : ''}${llLabel && metaLabel ? ' · ' : ''}${llLabel ? escHtml(llLabel) : ''}</span>
      <span class="asco-sheet-count">${sheet.items.length} item${sheet.items.length !== 1 ? 's' : ''}</span>
      <span class="asco-sheet-sel-all" data-si="${si}">Select all</span>`;
    section.appendChild(hdr);

    /* Items */
    const itemsDiv = document.createElement('div');
    itemsDiv.className = 'asco-items';

    sheet.items.forEach((item, ii) => {
      const key = `${si}-${ii}`;
      globalIdx++;

      const el = document.createElement('div');
      el.className = 'asco-item';
      el.dataset.key = key;

      /* Badges */
      let badges = '';
      if(item.dgClass)        badges += `<span class="asco-badge dg">◆ DG ${escHtml(item.dgClass)}</span>`;
      if(item.heavyLift)      badges += `<span class="asco-badge hl">⬆ Heavy Lift</span>`;
      if(!item.sizeDetected)  badges += `<span class="asco-badge no-size">⚠ Size not detected</span>`;
      else badges += `<span class="asco-badge size">${item.dims.length_m.toFixed(2)}×${item.dims.width_m.toFixed(2)} m</span>`;
      if(item.wt > 0) badges += `<span class="asco-badge wt">${item.wt.toFixed(1)} T</span>`;

      el.innerHTML = `
        <div class="asco-cb" data-key="${key}"></div>
        <div class="asco-item-main">
          <div class="asco-item-name">${escHtml(item.desc)}</div>
          ${item.ccu ? `<div class="asco-item-id">${escHtml(item.ccu)}</div>` : ''}
          <div class="asco-item-badges">${badges}</div>
        </div>`;

      el.addEventListener('click', () => toggleAscoItem(key));
      itemsDiv.appendChild(el);
    });

    section.appendChild(itemsDiv);
    content.appendChild(section);

    /* Select all handler */
    hdr.querySelector('.asco-sheet-sel-all').addEventListener('click', e => {
      e.stopPropagation();
      const sheetKeys = sheet.items.map((_, ii) => `${si}-${ii}`);
      const allSel = sheetKeys.every(k => ascoSelected.has(k));
      if(allSel) sheetKeys.forEach(k => ascoSelected.delete(k));
      else sheetKeys.forEach(k => ascoSelected.add(k));
      updateAscoSelection();
    });
  });

  /* Show content & footer */
  document.getElementById('ascoDropzone').style.display = 'none';
  content.style.display = 'block';
  document.getElementById('ascoFooter').style.display = 'flex';

  document.getElementById('ascoSubtitle').textContent =
    `${stats.validSheets} of ${stats.totalSheets} sheet${stats.totalSheets!==1?'s':''} · ${stats.totalItems} cargo items`;
  document.getElementById('ascoBadgeCount').style.display = 'block';
  updateAscoSelection();
}

function toggleAscoItem(key){
  if(ascoSelected.has(key)) ascoSelected.delete(key);
  else ascoSelected.add(key);
  updateAscoSelection();
}

function updateAscoSelection(){
  /* Update visual state */
  document.querySelectorAll('.asco-item').forEach(el => {
    const k = el.dataset.key;
    el.classList.toggle('selected', ascoSelected.has(k));
  });

  const n = ascoSelected.size;
  document.getElementById('ascoBadgeCount').textContent = `${n} selected`;
  document.getElementById('ascoImportBtn').disabled = n === 0;
  document.getElementById('ascoFootInfo').innerHTML = n > 0
    ? `<b>${n}</b> item${n!==1?'s':''} selected — will be added to the Imported queue`
    : 'Select items to import into the cargo queue';
}

/* ── Perform import: move selected items to IMPORT_QUEUE ── */
function performAscoImport(){
  const added = [];
  ascoImportData.forEach((sheet, si) => {
    sheet.items.forEach((item, ii) => {
      const key = `${si}-${ii}`;
      if(!ascoSelected.has(key)) return;

      const qItem = {
        id: Date.now() + Math.random(),
        name: item.desc,
        ccu: item.ccu,
        wt: item.wt,
        dgClass: item.dgClass,
        heavyLift: item.heavyLift,
        w: item.dims.w,
        h: item.dims.h,
        length_m: item.dims.length_m,
        width_m: item.dims.width_m,
        isDefaultSize: item.dims.isDefault,
        platform: item.platform,          // raw string e.g. "CLAYMORE WOPS - 797..."
        location: item.location,          // e.g. "CLAYMORE"
        displayName: sheet.displayName || sheet.sheetName,  // e.g. "CLAYMORE WOPS"
        locId: resolveImportedLocId(sheet.displayName || sheet.sheetName), // LOC_ALL id
        sheetName: item.sheetName,
        loadlistId: item.loadlistId,
        sizeDetected: item.sizeDetected,
      };
      IMPORT_QUEUE.push(qItem);
      added.push(qItem);
    });
  });

  closeAscoModal();
  if(window._cpAfterImport) window._cpAfterImport();
  buildQueueList();
  updateQueueBadge();

  /* Auto-open queue tab, auto-expand panel, show toast */
  if(added.length > 0){
    const qTab = document.querySelector('.stab[data-tab="queue"]');
    if(qTab) qTab.click();

    /* Gently expand the library panel so items are visible */
    if(window._libExpandForImport) window._libExpandForImport();

    showToast(t('toast_queue_added', added.length));
  }
}

/* ── Build queue list in library panel ── */
function buildQueueList(){
  const list  = document.getElementById('queueList');
  const count = document.getElementById('queuePaneCount');
  const btnClear = document.getElementById('btnClearQueue');
  if(!list) return;
  list.innerHTML = '';

  const n = IMPORT_QUEUE.length;

  /* Update count pill and clear button */
  if(count){
    count.textContent = n + (n === 1 ? ' item' : ' items');
    count.classList.toggle('visible', n > 0);
  }
  if(btnClear) btnClear.classList.toggle('visible', n > 0);

  if(n === 0){
    list.innerHTML = `
      <div class="asco-queue-empty">
        <div style="font-size:22px;margin-bottom:8px;opacity:.35;">📋</div>
        No imported items yet.<br>
        <span style="color:var(--acc);cursor:pointer;font-weight:600;" id="queueUploadHint">Upload an ASCO file</span> to start.
      </div>`;
    const hint = document.getElementById('queueUploadHint');
    if(hint) hint.onclick = () => document.getElementById('btnAscoUpload').click();
    return;
  }

  IMPORT_QUEUE.forEach((item, qi) => {
    const el = document.createElement('div');
    el.className = 'asco-qitem';

    let badges = '';
    if(item.dgClass)       badges += `<span class="asco-badge dg">◆ DG ${escHtml(item.dgClass)}</span>`;
    if(item.heavyLift)     badges += `<span class="asco-badge hl">⬆ HL</span>`;
    if(item.wt > 0)        badges += `<span class="asco-badge wt">${item.wt.toFixed(1)} T</span>`;
    if(!item.sizeDetected) badges += `<span class="asco-badge no-size">default size</span>`;

    el.innerHTML = `
      <div class="asco-qitem-icon">${item.dgClass ?
        '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d=\"M7 1.5L13 12H1L7 1.5Z\" stroke=\"#785a1a\" stroke-width=\"1.3\" stroke-linejoin=\"round\"/><path d=\"M7 5.5v3M7 10v.5\" stroke=\"#785a1a\" stroke-width=\"1.3\" stroke-linecap=\"round\"/></svg>' :
        '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x=\"1.5\" y=\"4.5\" width=\"11\" height=\"8\" rx=\"1\" stroke=\"currentColor\" stroke-width=\"1.3\"/><path d=\"M1.5 4.5L4 1.5h6l2.5 3\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linejoin=\"round\"/><path d=\"M5 4.5v1.5h4V4.5\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/></svg>'
      }</div>
      <div class="asco-qitem-body">
        <div class="asco-qitem-name">${escHtml(item.name)}</div>
        <div class="asco-qitem-meta">${item.ccu ? escHtml(item.ccu) + ' · ' : ''}${escHtml(item.displayName || item.sheetName)}</div>
        ${badges ? `<div class="asco-qitem-badges">${badges}</div>` : ''}
      </div>
      <button class="asco-qitem-rm" title="Remove from queue">×</button>`;

    el.addEventListener('click', e => {
      if(e.target.classList.contains('asco-qitem-rm')) return;
      selectQueueItem(qi);
    });
    el.querySelector('.asco-qitem-rm').addEventListener('click', e => {
      e.stopPropagation();
      IMPORT_QUEUE.splice(qi, 1);
      buildQueueList();
      updateQueueBadge();
    });

    list.appendChild(el);
  });
}

function selectQueueItem(qi){
  const item = IMPORT_QUEUE[qi];
  if(!item) return;

  /* Deselect all other queue items visually */
  document.querySelectorAll('.asco-qitem').forEach((el, i) => {
    el.classList.toggle('selected-q', i === qi);
  });

  /* Set as pending cargo for deck placement */
  S.pending = {
    type: 'cargo',
    item: {
      name: item.name,
      w: item.w,
      h: item.h,
      length_m: item.length_m,
      width_m: item.width_m,
      wt: item.wt,
      cat: 'Imported',
    },
    fromQueue: true,
    queueIdx: qi,
    queueItem: item,
  };

  document.getElementById('hint').innerHTML =
    `<b>📋 ${escHtml(item.name)}</b> — click deck to place${item.dgClass ? ` · DG ${item.dgClass}` : ''}`;

  /* If DG, show pending exclusion zones */
  if(item.dgClass){
    updateDGZones();
  }
}

function updateQueueBadge(){
  const badge = document.getElementById('queueBadge');
  if(!badge) return;
  badge.style.display = IMPORT_QUEUE.length > 0 ? 'block' : 'none';
  badge.textContent = IMPORT_QUEUE.length;
  if(typeof cpUpdateBadge==='function') cpUpdateBadge();
}

/* ── ASCO Modal control ── */
function openAscoModal(){
  const ov = document.getElementById('ascoOv');
  ov.classList.add('open');
  /* Reset to dropzone state */
  document.getElementById('ascoDropzone').style.display = 'flex';
  document.getElementById('ascoContent').style.display = 'none';
  document.getElementById('ascoFooter').style.display = 'none';
  document.getElementById('ascoSubtitle').textContent = 'Select an ASCO loadout Excel file to import';
  document.getElementById('ascoBadgeCount').style.display = 'none';
  ascoImportData = [];
  ascoSelected.clear();
}

function closeAscoModal(){
  document.getElementById('ascoOv').classList.remove('open');
}

/* ── Bind ASCO UI ── */
function bindAscoUpload(){
  document.getElementById('btnAscoUpload').addEventListener('click', openAscoModal);
  document.getElementById('ascoClose').addEventListener('click', closeAscoModal);
  document.getElementById('ascoCancelBtn').addEventListener('click', closeAscoModal);
  document.getElementById('ascoOv').addEventListener('click', e => {
    if(e.target === document.getElementById('ascoOv')) closeAscoModal();
  });

  /* File chooser button */
  document.getElementById('ascoFilePill').addEventListener('click', () => {
    document.getElementById('ascoFileInput').click();
  });

  document.getElementById('ascoFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if(file) processASCOFile(file);
    e.target.value = '';  // reset so same file can be re-chosen
  });

  /* Drag and drop */
  const dz = document.getElementById('ascoDropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if(file) processASCOFile(file);
  });

  /* Import button */
  document.getElementById('ascoImportBtn').addEventListener('click', performAscoImport);

  /* Clear All imported queue */
  document.getElementById('btnClearQueue').addEventListener('click', () => {
    if(IMPORT_QUEUE.length === 0) return;
    if(!confirm(`Clear all ${IMPORT_QUEUE.length} imported item${IMPORT_QUEUE.length!==1?'s':''}?\n\nThis will not affect any cargo already placed on the deck.`)) return;
    IMPORT_QUEUE.length = 0;
    cancelPending();
    buildQueueList();
    updateQueueBadge();
  });
}

function processASCOFile(file){
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const result = parseASCOWorkbook(e.target.result);
      const { sheets, stats } = result;

      if(!sheets || sheets.length === 0){
        showToast(t('toast_no_cargo'), 'warn');
        return;
      }

      document.getElementById('ascoSubtitle').textContent = `Reading: ${file.name}`;
      renderAscoContent(sheets, stats);
    } catch(err){
      showToast(t('toast_read_err', err.message), 'warn');
      console.error('ASCO parse error:', err);
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ── Unified placeAt: handles queue items AND standard library placement ── */
function placeAt(cx, cy){
  if(!S.pending) return;

  /* ── Queue item path ── */
  if(S.pending.fromQueue){
    const p = S.pending;
    const item = p.queueItem;
    const w = item.w || m2px_w(1.83);
    const h = item.h || m2px_h(1.83);

    /* Resolve the platform id — use stored locId if valid, otherwise
       re-resolve from displayName, fallback to current selLoc.        */
    const platformId = (item.locId && locById(item.locId))
      ? item.locId
      : resolveImportedLocId(item.displayName || item.platform);

    const c = {
      id: Date.now() + Math.random(),
      side: 'DECK',
      x: Math.max(0, Math.min(cx - w/2, TW - w)),
      y: Math.max(0, Math.min(cy - h/2, CVH - h)),
      w, h,
      length_m: item.length_m || 1.83,
      width_m:  item.width_m  || 1.83,
      rot: 0,
      ccu:       item.ccu      || '',
      desc:      item.name     || '',
      wt:        item.wt       || 0,
      platform:  platformId,
      status:    S.selStatus,
      dgClass:   item.dgClass  || '',
      heavyLift: !!item.heavyLift,
      priority: false,
      trDest: '',
    };
    S.cargo.push(c);

    /* Remove from queue after placement */
    IMPORT_QUEUE.splice(p.queueIdx, 1);
    buildQueueList();
    updateQueueBadge();

    S.pending = null;
    document.getElementById('hint').innerHTML = '<b>Select cargo</b> → click deck to place';
    cpHideHint();
    document.querySelectorAll('.lc,.dgc,.asco-qitem,.cp-qi').forEach(el => el.classList.remove('sel','selected-q','cp-qi-sel'));

    renderAll(); updateStats(); buildActiveLocStrip(); checkSeg(); updateDGSummary(); save();

    /* Refresh panel queue list so "On Deck" badge appears immediately */
    if(typeof cpRenderQueue==='function') cpRenderQueue();
    if(typeof cpUpdateBadge==='function') cpUpdateBadge();

    openModal(c.id);
    return;
  }

  /* ── Standard library / DG path ── */
  _placeAtCore(cx, cy);
}

/* ── Utility: simple HTML escape ── */
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ── Toast notification ── */
function showToast(msg, type='ok'){
  const t = document.createElement('div');
  const bg = type==='warn' ? 'rgba(251,209,133,.18)' : 'rgba(58,125,82,.10)';
  const bc = type==='warn' ? 'rgba(120,90,26,.40)' : 'rgba(58,125,82,.45)';
  const tc = type==='warn' ? '#4a3400' : '#1a4a2e';
  t.style.cssText = `position:fixed;bottom:70px;left:50%;transform:translateX(-50%);
    background:${bg};border:1px solid ${bc};border-radius:10px;
    padding:10px 22px;font-size:11px;color:${tc};z-index:9999;
    box-shadow:0 6px 24px rgba(49,51,44,.12);max-width:400px;text-align:center;
    font-family:'Inter',sans-serif;font-weight:600;pointer-events:none;
    animation:toastIn .2s ease;backdrop-filter:blur(8px);`;
  const style = document.createElement('style');
  style.textContent = '@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}';
  document.head.appendChild(style);
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}


/* ═══════════════════════════════════════════════════════════════
   PDF EXPORT v37 — New Design System
   Rebuilt to match current UI: warm ivory palette, Manrope/Inter
   typography, premium navy accent, modern card structure.
═══════════════════════════════════════════════════════════════ */
function exportPDF(){
  /* ══════════════════════════════════════════════════════════
     PDF Export — Restored original mechanism from web version.
     html2canvas captures the live deck as a pixel-perfect image.
     buildPDF() draws the full report with jsPDF + deck image.
     The canvas element is passed directly to doc.addImage()
     (no toDataURL call — avoids Tauri WebView taint error).
     File saved via doc.save() Blob download (same as Excel).
  ══════════════════════════════════════════════════════════ */
  showToast(t('toast_preparing'), 'ok');

  /* ── Gather live data from DOM ── */
  const voyageNum = document.getElementById('voyIn').value.trim() || '\u2014';
  const dateStr   = document.getElementById('dateBtn').textContent.trim() || '\u2014';
  const lifts     = parseInt(document.getElementById('sLifts').textContent) || 0;
  const weightStr = document.getElementById('sWT').textContent.trim();
  const loadCount = parseInt(document.getElementById('sL').textContent) || 0;
  const blCount   = parseInt(document.getElementById('sBL').textContent) || 0;
  const robCount  = parseInt(document.getElementById('sROB').textContent) || 0;

  /* ── Active locations with per-status cargo counts ── */
  const activeLocs = S.activeLocs.map(id => {
    const loc = locById(id);
    if(!loc) return null;
    const base  = getLocBase(id);
    const cols  = locColors(base, id);
    const cargos = S.cargo.filter(c => c.platform === id);
    const L   = cargos.filter(c => c.status === 'L').length;
    const BL  = cargos.filter(c => c.status === 'BL').length;
    const ROB = cargos.filter(c => c.status === 'ROB').length;
    const wt  = cargos.reduce((a,c) => a + (parseFloat(c.wt)||0), 0);
    return { id, name: loc.name, base, cols, L, BL, ROB, wt: wt.toFixed(1) };
  }).filter(Boolean);

  /* ── DG classes actually on deck ── */
  const dgOnDeck = {};
  S.cargo.filter(c => c.dgClass).forEach(c => {
    dgOnDeck[c.dgClass] = (dgOnDeck[c.dgClass]||0) + 1;
  });
  const dgEntries = Object.entries(dgOnDeck).map(([cls, count]) => {
    const dg = DG_DATA.find(d => d.cls === cls);
    return { cls, count, nm: dg ? dg.nm : cls, bg: dg ? dg.bg : '#888', tc: dg ? dg.tc : '#fff', bc: dg ? dg.bc : '#888' };
  });

  /* ══════════════════════════════════════════════════════════
     DECK CAPTURE — Direct live DOM snapshot.
     Captures the actual rendered deck as-is with html2canvas.
     The taint issue is bypassed because buildPDF uses
     canvas.toBlob() → Uint8Array → doc.addImage(bytes),
     which never calls the blocked toDataURL().
     No clone, no style baking — what you see is what you get.
  ══════════════════════════════════════════════════════════ */
  const dcv = document.querySelector('.dcv');
  const deckOuter = document.querySelector('.deck-outer');
  const dzw = document.querySelector('.deck-zoom-wrap');

  /* 1. Reset zoom to 100% for capture */
  const savedTransform = dzw.style.transform;
  dzw.style.transform = 'none';

  /* 2. Unlock overflow so all children are visible */
  const savedDcvOv = dcv.style.overflow;
  const savedOuterOv = deckOuter ? deckOuter.style.overflow : '';
  dcv.style.overflow = 'visible';
  if(deckOuter) deckOuter.style.overflow = 'visible';

  /* 3. Hide editing controls */
  const hiddenEls = document.querySelectorAll('.cb-del,.cb-rot,.cb-copy,.rh,.kb-coord-tip');
  hiddenEls.forEach(el => el.style.visibility = 'hidden');
  const kbEl = document.querySelector('.cb.kb-sel');
  if(kbEl) kbEl.classList.remove('kb-sel');

  /* 4. Hide body::before noise texture (feTurbulence taint source) */
  document.body.classList.add('pdf-capture');

  /* 5. DIAGNOSTIC: Solid color fill test on real zone elements.
        If these appear in PDF → we have the right elements.
        If not → the visible hatching comes from a different layer. */
  const _zoneSaved = [];

  dcv.querySelectorAll('.zone').forEach(el => {
    const cls = el.className;
    const rect = el.getBoundingClientRect();
    _zoneSaved.push({ el, cssText: el.style.cssText });

    if(cls.includes('z-hose')){
      el.style.backgroundColor = 'rgba(200,180,50,0.5)';
      el.style.backgroundImage = 'none';
    } else if(cls.includes('z-tiger')){
      el.style.backgroundColor = 'rgba(160,100,30,0.5)';
      el.style.backgroundImage = 'none';
    } else if(cls.includes('z-store')){
      el.style.backgroundColor = 'rgba(180,140,20,0.6)';
      el.style.backgroundImage = 'none';
    }
    console.log('[PDF] DIAG zone:', cls, 'left:', el.style.left, 'top:', el.style.top, 'w:', el.style.width, 'h:', el.style.height, 'rect:', Math.round(rect.width)+'x'+Math.round(rect.height), 'bgColor:', el.style.backgroundColor);
  });

  /* Also check what the ACTUAL zone count is */
  console.log('[PDF] DIAG .zone count:', dcv.querySelectorAll('.zone').length);
  console.log('[PDF] DIAG .z-hose count:', dcv.querySelectorAll('.z-hose').length);
  console.log('[PDF] DIAG .z-tiger count:', dcv.querySelectorAll('.z-tiger').length);
  console.log('[PDF] DIAG .z-store count:', dcv.querySelectorAll('.z-store').length);

  /* No-DG zone */
  const _nodgEl = dcv.querySelector('[style*="repeating-linear-gradient(45deg,rgba(220,38,38"]');
  let _nodgSavedCss = '';
  if(_nodgEl){
    _nodgSavedCss = _nodgEl.style.cssText;
    _nodgEl.style.backgroundColor = 'rgba(220,50,50,0.15)';
    _nodgEl.style.backgroundImage = 'none';
    console.log('[PDF] DIAG nodg: left:', _nodgEl.style.left, 'w:', _nodgEl.style.width, 'h:', _nodgEl.style.height);
  } else {
    console.log('[PDF] DIAG nodg: NOT FOUND');
  }

  console.log('[PDF] Total zones modified:', _zoneSaved.length, '+ nodg:', _nodgEl ? 1 : 0);

  const restore = () => {
    dzw.style.transform = savedTransform;
    dcv.style.overflow = savedDcvOv;
    if(deckOuter) deckOuter.style.overflow = savedOuterOv;
    hiddenEls.forEach(el => el.style.visibility = '');
    if(kbEl && KB_SEL) kbEl.classList.add('kb-sel');
    document.body.classList.remove('pdf-capture');
    /* Restore original zone styles */
    _zoneSaved.forEach(s => { s.el.style.cssText = s.cssText; });
    if(_nodgEl) _nodgEl.style.cssText = _nodgSavedCss;
  };

  /* 5. Capture live deck with html2canvas.
        allowTaint:true is OK now — we no longer use toDataURL.
        The toBlob path in buildPDF bypasses the taint restriction. */
  setTimeout(() => {
    html2canvas(dcv, {
      scale: 3, useCORS: true, allowTaint: true, backgroundColor: '#fbf9f4',
      logging: false, width: TW, height: CVH,
      windowWidth: TW, windowHeight: CVH,
      x: 0, y: 0, scrollX: 0, scrollY: 0, removeContainer: true,
    }).then(deckCanvas => {
      restore();
      console.log('[PDF] Captured live deck:', deckCanvas.width, 'x', deckCanvas.height);
      buildPDF(deckCanvas, { voyageNum, dateStr, lifts, weightStr, loadCount, blCount, robCount, dgEntries, activeLocs })
        .catch(err => {
          console.error('[PDF] buildPDF error:', err);
          showToast('PDF build error: ' + (err && err.message || err), 'warn');
        });
    }).catch(err => {
      restore();
      console.error('[PDF] html2canvas error:', err);
      showToast('PDF capture failed: ' + (err && err.message || err), 'warn');
    });
  }, 120);
}

async function buildPDF(deckCanvas, data){
  const { voyageNum, dateStr, lifts, weightStr, loadCount, blCount, robCount, dgEntries, activeLocs } = data;
  const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });

  const PW=297, PH=210, ML=10, MR=10, MT=8;
  const CW = PW - ML - MR;

  const C = {
    ink:[49,51,44], ink2:[94,96,88], ink3:[121,124,115], ink4:[177,179,169],
    navy:[72,96,131], navy2:[60,84,119], ivory:[251,249,244], surf2:[245,244,237],
    surf3:[239,238,230], surf4:[232,233,224], green:[58,125,82], amber:[120,90,26],
    brd:[205,205,198], white:[255,255,255],
  };

  const hex2rgb = hex => { const h=(hex||'#999').replace('#',''); return [parseInt(h.slice(0,2),16)||150, parseInt(h.slice(2,4),16)||150, parseInt(h.slice(4,6),16)||150]; };
  const contrastText = rgb => (0.2126*(rgb[0]/255)+0.7152*(rgb[1]/255)+0.0722*(rgb[2]/255)) > 0.45 ? C.ink : C.white;
  const roundRect = (x,y,w,h,r,fill,strokeCol) => {
    if(fill) doc.setFillColor(...fill);
    if(strokeCol){ doc.setDrawColor(...strokeCol); doc.setLineWidth(0.2); }
    doc.roundedRect(x,y,w,h,r,r, fill&&strokeCol?'FD':fill?'F':'D');
  };
  const sepLine = y2 => { doc.setDrawColor(...C.brd); doc.setLineWidth(0.15); doc.line(ML,y2,ML+CW,y2); };

  let y = MT;

  /* 1. HEADER */
  const HDR_H = 22;
  roundRect(ML,y,CW,HDR_H,2,C.ivory,C.brd);
  doc.setFillColor(...C.navy); doc.roundedRect(ML,y,2.5,HDR_H,1,1,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...C.ink);
  doc.text('SPICA TIDE', ML+7, y+9);
  doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(...C.navy);
  doc.text('Deck Cargo Plan', ML+7, y+14);
  doc.setFontSize(5.5); doc.setTextColor(...C.ink3);
  doc.text('PSV \u00B7 North Sea \u00B7 NEO Energy Resources UK', ML+7, y+18.5);
  doc.setDrawColor(...C.brd); doc.setLineWidth(0.2); doc.line(ML+70,y+3,ML+70,y+HDR_H-3);
  const cell = (label,value,cx,colVal) => {
    doc.setFont('helvetica','bold'); doc.setFontSize(5.5); doc.setTextColor(...C.ink3);
    doc.text(label.toUpperCase(),cx,y+8.5);
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...colVal);
    doc.text(value,cx,y+16);
  };
  cell('Voyage',voyageNum,ML+76,C.navy); cell('Date',dateStr,ML+116,C.ink);
  doc.setDrawColor(...C.brd); doc.line(ML+155,y+3,ML+155,y+HDR_H-3);
  [{lbl:'Total Lifts',val:String(lifts),col:C.ink,dx:0},{lbl:'Load',val:String(loadCount),col:C.green,dx:32},
   {lbl:'Backload',val:String(blCount),col:C.navy,dx:58},{lbl:'ROB',val:String(robCount),col:C.amber,dx:82},
   {lbl:'Weight',val:weightStr,col:C.ink2,dx:106}].forEach(s=>cell(s.lbl,s.val,ML+160+s.dx,s.col));
  y += HDR_H+3;

  /* 2. LOCATIONS */
  const filledLocs = activeLocs.filter(loc => loc.L>0 || loc.BL>0 || loc.ROB>0);
  if(filledLocs.length > 0){
    const LOC_H=16, GAP=3;
    const locW = Math.min(Math.floor((CW-(filledLocs.length-1)*GAP)/filledLocs.length), 68);
    filledLocs.forEach((loc,i) => {
      const lx = ML+i*(locW+GAP), rgb = hex2rgb(loc.base);
      roundRect(lx,y,locW,LOC_H,2,C.surf2,C.brd);
      doc.setFillColor(...rgb); doc.roundedRect(lx,y,locW,2.5,1,1,'F');
      doc.setFillColor(...rgb); doc.circle(lx+4,y+7.5,1.5,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(6); doc.setTextColor(...C.ink);
      const maxChars = Math.floor(locW/2.0);
      const nm = loc.name.length>maxChars ? loc.name.slice(0,maxChars-1)+'\u2026' : loc.name;
      doc.text(nm, lx+8, y+8.5);
      doc.setFont('helvetica','normal'); doc.setFontSize(4.5); doc.setTextColor(...C.ink3);
      doc.text(loc.wt+'T', lx+locW-2.5, y+8.5, {align:'right'});
      let px = lx+3; const py = y+11;
      [{lbl:'L',val:loc.L,col:C.green},{lbl:'BL',val:loc.BL,col:C.navy},{lbl:'ROB',val:loc.ROB,col:C.amber}]
        .filter(p=>p.val>0).forEach(p => {
          const pw = p.lbl==='ROB'?13:p.lbl==='BL'?11:9;
          const pillBg = p.col.map(v=>Math.round(v*0.12+242));
          roundRect(px,py-2,pw,5,1.5,pillBg,null);
          doc.setFont('helvetica','bold'); doc.setFontSize(5); doc.setTextColor(...p.col);
          doc.text(`${p.lbl} ${p.val}`, px+pw/2, py+1.5, {align:'center'}); px+=pw+2;
        });
    });
    y += LOC_H+3;
  }

  /* 3. DG ON BOARD */
  if(dgEntries.length > 0){
    const DG_H = 7.5;
    roundRect(ML,y,CW,DG_H,1,[252,244,214],[C.amber[0],C.amber[1],C.amber[2]]);
    doc.setFont('helvetica','bold'); doc.setFontSize(5); doc.setTextColor(...C.amber);
    doc.text('DG ON BOARD', ML+2.5, y+5);
    let bx = ML+26;
    dgEntries.forEach(dg => {
      const bgRgb=hex2rgb(dg.bg), textRgb=contrastText(bgRgb);
      roundRect(bx,y+0.8,14,DG_H-1.6,1.5,bgRgb,bgRgb.map(v=>Math.max(0,v-30)));
      doc.setFont('helvetica','bold'); doc.setFontSize(5.5); doc.setTextColor(...textRgb);
      doc.text(dg.cls, bx+7, y+4.2, {align:'center'});
      doc.setFontSize(4); doc.text('\u00D7'+dg.count, bx+7, y+6.2, {align:'center'}); bx+=16;
    });
    if(bx < ML+CW-20){
      doc.setFont('helvetica','normal'); doc.setFontSize(4.5); doc.setTextColor(...C.ink3);
      doc.text(dgEntries.map(d=>'Cl.'+d.cls+' '+d.nm).join('  \u00B7  ').slice(0,120), bx+2, y+5);
    }
    y += DG_H+2;
  }

  /* 4. DECK PLAN LABEL */
  doc.setFont('helvetica','bold'); doc.setFontSize(5.5); doc.setTextColor(...C.ink3);
  doc.text('DECK CARGO PLAN', ML, y+4.5);
  doc.setFont('helvetica','normal'); doc.setFontSize(4.5); doc.setTextColor(...C.ink4);
  doc.text('\u2190 AFT / BAY 12', ML, y+8);
  doc.text('BAY 1 / BOW \u2192', ML+CW, y+8, {align:'right'});
  y += 10;

  /* 5. DECK IMAGE — the html2canvas capture */
  const FOOTER_H=8, BAY_LBL_H=6;
  const availH = PH-y-FOOTER_H-BAY_LBL_H-2;
  const dw = CW, dh = Math.min(dw*(CVH/TW), availH);
  roundRect(ML-0.4,y-0.4,dw+0.8,dh+0.8,1.5,C.ivory,C.brd);

  /* Convert canvas to PNG bytes via toBlob → ArrayBuffer → Uint8Array.
     This avoids toDataURL() which throws "insecure operation" on
     tainted canvases in Tauri WebView2. toBlob uses a different
     code path that bypasses the taint check in Chromium. */
  console.log('[PDF][8] START toBlob conversion. Canvas:', deckCanvas.width, 'x', deckCanvas.height);
  let pngBytes;
  try {
    const blob = await new Promise((resolve, reject) => {
      deckCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png');
    });
    const arrayBuf = await blob.arrayBuffer();
    pngBytes = new Uint8Array(arrayBuf);
    console.log('[PDF][8] SUCCESS toBlob. PNG size:', pngBytes.length, 'bytes');
  } catch(blobErr) {
    console.error('[PDF][8] FAIL toBlob:', blobErr);
    console.error('[PDF][8] Stack:', blobErr.stack);
    showToast('Canvas export error: ' + (blobErr && blobErr.message || blobErr), 'warn');
    return;
  }
  try {
    doc.addImage(pngBytes, 'PNG', ML, y, dw, dh, '', 'FAST');
    console.log('[PDF][8] SUCCESS doc.addImage with Uint8Array');
  } catch(imgErr) {
    console.error('[PDF][8] FAIL doc.addImage:', imgErr);
    console.error('[PDF][8] Stack:', imgErr.stack);
    showToast('addImage error: ' + (imgErr && imgErr.message || imgErr), 'warn');
    return;
  }

  y += dh+2;

  /* 6. BAY LABELS */
  const bayNms = ['12','11','10','9','8','7','6','5','4','3','2','1'];
  doc.setFont('helvetica','normal'); doc.setFontSize(4.5); doc.setTextColor(...C.ink4);
  BW.forEach((w,i) => { doc.text(bayNms[i], ML+((BL_[i]+w/2)/TW)*dw, y+4, {align:'center'}); });

  /* 7. VOYAGE NOTES */
  const voyRemarks = (typeof S !== 'undefined' && S.voyRemarks) ? S.voyRemarks.trim() : '';
  if(voyRemarks){
    const noteLines = doc.splitTextToSize(voyRemarks, CW-12);
    const NOTE_H = Math.min(24, 6+noteLines.length*4.2);
    if(y+NOTE_H+FOOTER_H < PH-2){
      roundRect(ML,y,CW,NOTE_H,1.5,C.surf2,C.brd);
      doc.setFont('helvetica','bold'); doc.setFontSize(5.5); doc.setTextColor(...C.ink3);
      doc.text('VOYAGE NOTES', ML+3, y+4.5);
      doc.setFont('helvetica','normal'); doc.setFontSize(5.5); doc.setTextColor(...C.ink2);
      doc.text(noteLines, ML+3, y+9); y += NOTE_H+2;
    }
  }

  /* 8. FOOTER */
  const fy = PH-FOOTER_H;
  sepLine(fy-1);
  doc.setFont('helvetica','normal'); doc.setFontSize(5); doc.setTextColor(...C.ink3);
  const now = new Date();
  const ts = now.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  doc.text('Generated '+ts+'  \u00B7  SPICA TIDE  \u00B7  NEO Energy Resources UK', ML, fy+4);
  doc.setTextColor(...C.navy);
  doc.text('Voyage '+voyageNum+'  \u00B7  '+dateStr, ML+CW, fy+4, {align:'right'});

  /* 9. SAVE — use pre-chosen path from menu dialog, or browser fallback */
  const pdfPath = window._pendingPdfPath;
  window._pendingPdfPath = null;

  if(pdfPath){
    /* Path was chosen by user via native Save As dialog in _menuExportPDF */
    try {
      const pdfOutput = doc.output('arraybuffer');
      const bytes = Array.from(new Uint8Array(pdfOutput));
      await window.__TAURI__.core.invoke('write_file_bytes', { path: pdfPath, bytes });
      showToast(t('toast_pdf_ok') + ' \u2014 ' + pdfPath.split(/[/\\]/).pop(), 'ok');
    } catch(e) {
      showToast('PDF save failed: ' + (e && e.message || e), 'warn');
    }
  } else {
    /* Browser fallback — direct download */
    const dd = String(selDate.getDate()).padStart(2,'0');
    const mm = String(selDate.getMonth()+1).padStart(2,'0');
    const yyyy = selDate.getFullYear();
    doc.save('SPICA TIDE Deck Plan - '+dd+'.'+mm+'.'+yyyy+'.pdf');
    showToast(t('toast_pdf_ok'), 'ok');
  }
}


/* ── Save As dropdown wiring ── */
function bindSaveAs(){
  const wrap = document.getElementById('saveAsWrap');
  const btn  = document.getElementById('btnSaveAs');
  const dd   = document.getElementById('saveAsDropdown');
  if(!btn) return;

  btn.addEventListener('click', e=>{
    e.stopPropagation();
    dd.classList.toggle('open');
    /* Populate recent files each time dropdown opens (Tauri only) */
    if(_isTauri() && dd.classList.contains('open')) _populateRecentFiles();
  });
  document.addEventListener('click', e=>{
    if(!wrap.contains(e.target)) dd.classList.remove('open');
  });
  document.getElementById('saveProjectFile').addEventListener('click', ()=>{
    dd.classList.remove('open');
    saveProjectFile();
  });
  document.getElementById('openProjectFile').addEventListener('click', ()=>{
    dd.classList.remove('open');
    openProjectFile();
  });
  document.getElementById('saveAsPDF').addEventListener('click', ()=>{
    dd.classList.remove('open');
    try { exportPDF(); } catch(err) {
      console.error('[PDF] exportPDF threw:', err);
      showToast('PDF error: ' + (err && err.message || err), 'warn');
    }
  });
  const xlsxBtn = document.getElementById('saveAsXLSX');
  if(xlsxBtn){
    xlsxBtn.classList.remove('disabled');
    xlsxBtn.addEventListener('click', ()=>{
      dd.classList.remove('open');
      try {
        console.log('[Excel] Starting export. XLSX available:', typeof XLSX !== 'undefined');
        exportExcel();
      } catch(err) {
        console.error('[Excel] exportExcel threw:', err);
        showToast('Excel error: ' + (err && err.message || err), 'warn');
      }
    });
  }

  /* ── Tauri-only: Save Plan / Open Plan ── */
  if(_isTauri()){
    document.querySelectorAll('.tauri-only').forEach(el => { el.style.display = ''; });

    document.getElementById('saveAsPlanFile').addEventListener('click', ()=>{
      dd.classList.remove('open');
      savePlanToFile(null);
    });
    document.getElementById('openPlanFile').addEventListener('click', ()=>{
      dd.classList.remove('open');
      openPlanFromFile();
    });
  }

  /* ── Ctrl+S / Ctrl+O keyboard shortcuts ── */
  document.addEventListener('keydown', e=>{
    const mod = e.metaKey || e.ctrlKey;
    if(!mod) return;

    if(e.key === 's' && e.shiftKey){
      /* Ctrl+Shift+S → Save As (always dialog) */
      e.preventDefault();
      menuSaveAs();
    } else if(e.key === 's'){
      /* Ctrl+S → Save (overwrite or dialog) */
      e.preventDefault();
      menuSave();
    } else if(e.key === 'o'){
      /* Ctrl+O → Open */
      e.preventDefault();
      menuOpen();
    } else if(e.key === 'z' && !e.shiftKey){
      /* Ctrl+Z → Undo */
      e.preventDefault();
      undo();
    } else if(e.key === 'z' && e.shiftKey){
      /* Ctrl+Shift+Z → Redo */
      e.preventDefault();
      redo();
    } else if(e.key === 'y'){
      /* Ctrl+Y → Redo (Windows convention) */
      e.preventDefault();
      redo();
    }
  });

  /* ── Undo/Redo button clicks ── */
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
}

async function _populateRecentFiles(){
  const listEl = document.getElementById('tauriRecentList');
  const lblEl  = document.getElementById('tauriRecentLbl');
  const divEl  = document.getElementById('tauriRecentDivider');
  if(!listEl) return;

  try {
    const recents = await window.__TAURI__.core.invoke('get_recent_files');
    listEl.innerHTML = '';
    if(!recents || !recents.length){
      if(lblEl) lblEl.style.display = 'none';
      if(divEl) divEl.style.display = 'none';
      return;
    }
    if(lblEl) lblEl.style.display = '';
    if(divEl) divEl.style.display = '';

    recents.slice(0, 5).forEach(r => {
      const item = document.createElement('div');
      item.className = 'saveas-item';
      const fileName = r.path.split(/[/\\]/).pop();
      item.innerHTML =
        '<span class="saveas-item-icon" style="font-size:11px;opacity:.5">\u23F0</span>' +
        '<span class="saveas-item-text">' +
          '<span class="saveas-item-name">' + escHtml(r.name || fileName) + '</span>' +
          '<span class="saveas-item-sub">' + escHtml(fileName) + '</span>' +
        '</span>';
      item.addEventListener('click', () => {
        document.getElementById('saveAsDropdown').classList.remove('open');
        openRecentFile(r.path);
      });
      listEl.appendChild(item);
    });
  } catch(e) { /* non-critical */ }
}

/* PDF export uses pure jsPDF vector drawing + doc.save() Blob download.
   No html2canvas, no canvas capture, no toDataURL, no window.print.
   Same download mechanism as XLSX.writeFile() for Excel export. */


/* ════════════════════════════════════════════════════════════
   CARGO PANEL (CP) — v33 overlay implementation
   Namespace: cp* — no collision with existing v31 logic.
   Main layout completely untouched.
   Panel is position:fixed overlay only.
════════════════════════════════════════════════════════════ */

/* ── State ── */
let CP_OPEN      = false;
let CP_COLLAPSED = false; /* panel open but shrunk to 48px icon strip */
let CP_FILTER = 'all';
let CP_Q      = '';
const CP_SECTIONS = { queue:true, lib:true, dg:true, custom:true };

/* ── Collapse / Expand (panel stays 'open', shrinks to strip) ── */
function cpCollapse(){
  CP_COLLAPSED = true;
  document.getElementById('cpOverlay').classList.add('cp-collapsed');
  document.body.classList.add('cp-panel-collapsed');
  /* Persist */
  try{ localStorage.setItem('spicaTide_cpCollapsed','1'); }catch(e){}
  /* Update strip badge */
  cpUpdateStripBadge();
}
function cpExpand(){
  CP_COLLAPSED = false;
  document.getElementById('cpOverlay').classList.remove('cp-collapsed');
  document.body.classList.remove('cp-panel-collapsed');
  try{ localStorage.setItem('spicaTide_cpCollapsed','0'); }catch(e){}
  cpRender();
  setTimeout(()=>{ const s=document.getElementById('cpSearch'); if(s) s.focus(); }, 120);
}
function cpToggleCollapse(){
  CP_COLLAPSED ? cpExpand() : cpCollapse();
}

/* Strip badge — shows import queue count while collapsed */
function cpUpdateStripBadge(){
  const b = document.getElementById('cpStripBadge');
  if(!b) return;
  const n = (typeof IMPORT_QUEUE !== 'undefined') ? IMPORT_QUEUE.length : 0;
  b.textContent = n > 0 ? (n > 9 ? '9+' : n) : '';
  b.classList.toggle('visible', n > 0);
}

/* ── Open / Close ── */
function cpOpen(){
  CP_OPEN = true;
  document.getElementById('cpOverlay').classList.add('open');
  document.body.classList.add('cp-panel-open');
  const _lo = document.getElementById('btnLibOpen'); if(_lo) _lo.classList.add('panel-active');
  /* Restore collapsed state */
  let wasCollapsed = false;
  try{ wasCollapsed = localStorage.getItem('spicaTide_cpCollapsed') === '1'; }catch(e){}
  if(wasCollapsed) cpCollapse(); else { CP_COLLAPSED=false; cpRender(); }
  if(!CP_COLLAPSED) setTimeout(()=>{ const s=document.getElementById('cpSearch'); if(s) s.focus(); }, 180);
}
function cpClose(){
  CP_OPEN = false;
  CP_COLLAPSED = false;
  document.getElementById('cpOverlay').classList.remove('open','cp-collapsed');
  document.body.classList.remove('cp-panel-open','cp-panel-collapsed');
  const _lo2 = document.getElementById('btnLibOpen'); if(_lo2) _lo2.classList.remove('panel-active');
  cancelPending();
  cpClearHl();
  cpHideHint();
  document.querySelectorAll('.cp-lc,.cp-dg,.cp-qi').forEach(el=>{
    el.classList.remove('cp-lc-sel','cp-dg-sel','cp-qi-sel');
  });
}
function cpToggle(){ CP_OPEN ? cpClose() : cpOpen(); }

/* ── Floating deck hint ── */
function cpShowHint(html){
  const h = document.getElementById('deckFloatHint');
  if(!h) return;
  h.innerHTML = html;
  h.classList.add('show');
}
function cpHideHint(){
  const h = document.getElementById('deckFloatHint');
  if(h) h.classList.remove('show');
}

/* ── Badge on toolbar button ── */
function cpUpdateBadge(){
  const b = document.getElementById('libOpenBadge');
  if(!b) return;
  const n = (typeof IMPORT_QUEUE !== 'undefined') ? IMPORT_QUEUE.length : 0;
  b.textContent = n > 0 ? n : '';
  b.classList.toggle('has-items', n > 0);
  cpUpdateStripBadge();
}

/* ── Section toggle ── */
function cpBindSections(){
  ['Queue','Lib','Dg','Custom'].forEach(sec=>{
    const hdr = document.getElementById('cpSecHdr'+sec);
    const body= document.getElementById('cpSecBody'+sec);
    if(!hdr||!body) return;
    const key = sec.toLowerCase();
    hdr.addEventListener('click', ()=>{
      CP_SECTIONS[key] = !CP_SECTIONS[key];
      body.classList.toggle('hidden', !CP_SECTIONS[key]);
      hdr.classList.toggle('collapsed', !CP_SECTIONS[key]);
    });
  });
}

/* ── Filter pills ── */
function cpBindFilters(){
  document.querySelectorAll('#cpFilters .cp-pill').forEach(pill=>{
    pill.addEventListener('click', ()=>{
      CP_FILTER = pill.dataset.f;
      document.querySelectorAll('#cpFilters .cp-pill').forEach(p=>p.classList.remove('on'));
      pill.classList.add('on');
      cpRender();
    });
  });
}

/* ── Search ── */
function cpBindSearch(){
  const inp = document.getElementById('cpSearch');
  const clr = document.getElementById('cpSearchClear');
  if(!inp) return;
  inp.addEventListener('input', ()=>{
    CP_Q = inp.value.trim().toLowerCase();
    clr.classList.toggle('vis', CP_Q.length > 0);
    cpRender();
    if(CP_Q.length >= 2) cpHighlightDeck(CP_Q);
    else cpClearHl();
  });
  if(clr) clr.addEventListener('click', ()=>{
    inp.value = ''; CP_Q = '';
    clr.classList.remove('vis');
    cpClearHl();
    cpRender();
    inp.focus();
  });
}

/* ── Deck highlight ── */
function cpHighlightDeck(query){
  cpClearHl();
  document.querySelectorAll('.cb').forEach(el=>{
    const id = el.dataset.id;
    const cargo = S.cargo.find(c=>String(c.id)===String(id));
    if(!cargo) return;
    const txt = [cargo.ccu||'', cargo.desc||'', cargo.platform||''].join(' ').toLowerCase();
    if(txt.includes(query)){
      el.classList.add('cp-hl');
      setTimeout(()=>el.classList.remove('cp-hl'), 5500);
    }
  });
}
function cpClearHl(){
  document.querySelectorAll('.cb.cp-hl').forEach(el=>el.classList.remove('cp-hl'));
}

/* ── Text match helper ── */
function cpMatch(item){
  if(!CP_Q) return true;
  /* Build search text from all possible fields across CLIB, queue, and custom items */
  const dim = item.length_m && item.width_m ? item.length_m+'x'+item.width_m : '';
  const t = [
    item.name||'', item.label||'', item.ccu||'', item.desc||'',
    item.sz||'', dim, item.cat||'', item.key||'',
    item.platform||'', item.locId||'',
  ].join(' ').toLowerCase();
  return t.includes(CP_Q);
}

/* ── Filter helper ── */
function cpPassFilter(item, src){
  const f = CP_FILTER;
  if(f==='all')     return true;
  if(f==='dg')      return !!(item.dgClass||item.cls||(src==='dg'));
  if(f==='hl')      return !!(item.heavyLift);
  if(f==='pri')     return !!(item.priority||item.pri);
  if(f==='ondk')    return src==='deck' || (src==='queue' && !!S.cargo.find(c=>c.ccu&&item.ccu&&c.ccu===item.ccu));
  if(f==='unplaced'){
    if(src==='queue') return !S.cargo.find(c=>c.ccu&&c.ccu===item.ccu);
    if(src==='lib'||src==='custom') return true; /* library items are always "unplaced templates" */
    return false;
  }
  if(['L','BL','ROB'].includes(f)) return item.status===f;  /* queue OR deck — both have .status */
  return true;
}

/* ── Master render ── */
function cpRender(){
  cpRenderQueue();
  cpRenderLib();
  cpRenderDg();
  cpRenderCustom();
  cpUpdateBadge();
}

/* ── Render: Imported Queue ── */
function cpRenderQueue(){
  const body   = document.getElementById('cpSecBodyQueue');
  const badge  = document.getElementById('cpQueueBadge');
  const clrBtn = document.getElementById('cpClearQueue');
  const empty  = document.getElementById('cpQueueEmpty');
  if(!body) return;

  const queue = (typeof IMPORT_QUEUE!=='undefined') ? IMPORT_QUEUE : [];
  const items = queue.filter(it=>cpMatch(it) && cpPassFilter(it,'queue'));

  if(badge){ badge.textContent=items.length; badge.style.display=items.length?'':'none'; }
  if(clrBtn) clrBtn.style.display=queue.length?'':'none';

  /* Remove old cards (not the empty msg) */
  Array.from(body.children).forEach(ch=>{ if(ch.id!=='cpQueueEmpty') ch.remove(); });
  if(empty) empty.style.display = items.length===0 ? '' : 'none';

  items.forEach(item=>{
    const realIdx = queue.indexOf(item);
    const isPlaced = !!S.cargo.find(c=>
      (item.ccu && c.ccu && c.ccu===item.ccu) ||
      (item.id && c._queueId===item.id)
    );
    const loc = (typeof locById!=='undefined') ? locById(item.locId) : null;
    const locName = loc ? loc.name : (item.platform||'');

    const card = document.createElement('div');
    card.className = 'cp-qi' + (isPlaced?' cp-qi-placed':'');

    /* icon */
    const dot = document.createElement('div');
    dot.className='cp-qi-dot';
    /* Flat SVG icons instead of emoji */
    if(item.heavyLift){
      dot.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3L4 7M8 3l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      dot.style.color='#785a1a';
    } else if(item.dgClass){
      dot.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 13H1.5L8 2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6v4M8 11.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
      dot.style.color='#785a1a';
    } else {
      dot.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="5" width="13" height="9.5" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 5l2.5-3.5h8L14.5 5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5v2h4V5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    }
    card.appendChild(dot);

    /* body */
    const bd = document.createElement('div'); bd.className='cp-qi-body';
    /* PRIMARY line: actual cargo identity (CCU / ID is most important for crew) */
    const nm = document.createElement('div'); nm.className='cp-qi-name';
    nm.textContent = item.ccu || item.name || '—';
    bd.appendChild(nm);

    /* SECONDARY line: type description */
    const meta = document.createElement('div'); meta.className='cp-qi-meta';
    const wtStr = (item.wt || item.wt_default) ? (item.wt||item.wt_default)+'T' : '';
    meta.textContent = [item.name, wtStr].filter(Boolean).join(' · ');
    bd.appendChild(meta);

    /* TAGS: location, DG, HL, status, placed state */
    const tags = document.createElement('div'); tags.className='cp-qi-tags';
    const mkTag=(cls,txt)=>{ const t=document.createElement('span'); t.className='cp-tag '+cls; t.textContent=txt; tags.appendChild(t); };
    if(locName)         mkTag('cp-tag-loc',            locName);
    if(item.dgClass)    mkTag('cp-tag-dg',             '⬥ DG '+item.dgClass);
    if(item.heavyLift)  mkTag('cp-tag-hl',             '⬆ HL');
    if(item.status)     mkTag('cp-tag-'+item.status,   item.status);
    if(isPlaced)        mkTag('cp-tag-ondk',           '✓ On Deck');
    bd.appendChild(tags);
    card.appendChild(bd);

    /* remove btn */
    const rm = document.createElement('button'); rm.className='cp-qi-rm'; rm.textContent='×';
    rm.addEventListener('mousedown',e=>e.stopPropagation());
    rm.addEventListener('click',e=>{
      e.stopPropagation();
      if(realIdx>=0) IMPORT_QUEUE.splice(realIdx,1);
      updateQueueBadge(); cpRenderQueue();
    });
    card.appendChild(rm);

    /* click action */
    card.addEventListener('click',()=>{
      if(isPlaced){
        const placed = S.cargo.find(c=>c.ccu===item.ccu);
        if(placed){
          const el = document.querySelector(`.cb[data-id="${placed.id}"]`);
          if(el){
            el.scrollIntoView({behavior:'smooth',block:'nearest'});
            el.classList.add('cp-hl');
            setTimeout(()=>el.classList.remove('cp-hl'),4500);
          }
        }
        return;
      }
      document.querySelectorAll('.cp-qi').forEach(x=>x.classList.remove('cp-qi-sel'));
      card.classList.add('cp-qi-sel');
      /* Also sync with the old selectQueueItem path */
      document.querySelectorAll('.asco-qitem').forEach(x=>x.classList.remove('selected-q'));
      if(typeof selectQueueItem==='function' && realIdx>=0) selectQueueItem(realIdx);
      cpShowHint('<b>' + (item.name||item.ccu||'Cargo').replace(/</g,'&lt;') + '</b> → click deck to place');
    });

    body.insertBefore(card, empty);
  });
}

/* ── Render: Standard Library ── */
function cpRenderLib(){
  const body  = document.getElementById('cpSecBodyLib');
  const badge = document.getElementById('cpLibBadge');
  if(!body) return;
  body.innerHTML = '';

  /* On Deck filter: show placed cargo items instead */
  if(CP_FILTER==='ondk'){
    let items = S.cargo;
    if(CP_Q) items = items.filter(c=>[c.ccu||'',c.desc||''].join(' ').toLowerCase().includes(CP_Q));
    if(badge) badge.textContent = items.length;
    if(items.length===0){ body.innerHTML='<div class="cp-empty">No cargo on deck.</div>'; return; }
    items.forEach(cargo=>{
      const loc=(typeof locById!=='undefined')?locById(cargo.platform):null;
      const card=document.createElement('div'); card.className='cp-qi';
      card.innerHTML=`<div class="cp-qi-dot"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="5" width="13" height="9.5" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 5l2.5-3.5h8L14.5 5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5v2h4V5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></div>
        <div class="cp-qi-body">
          <div class="cp-qi-name">${(cargo.ccu||'—').replace(/</g,'&lt;')}</div>
          <div class="cp-qi-meta">${(cargo.desc||'').replace(/</g,'&lt;')} · ${cargo.wt||0}T</div>
          <div class="cp-qi-tags">
            ${loc?`<span class="cp-tag cp-tag-loc">${loc.name.replace(/</g,'&lt;')}</span>`:''}
            <span class="cp-tag cp-tag-${cargo.status}">${cargo.status}</span>
            ${cargo.dgClass?`<span class="cp-tag cp-tag-dg">DG ${cargo.dgClass}</span>`:''}
            ${cargo.heavyLift?'<span class="cp-tag cp-tag-hl">⬆ HL</span>':''}
          </div>
        </div>`;
      card.addEventListener('click',()=>{
        const el=document.querySelector(`.cb[data-id="${cargo.id}"]`);
        if(el){ el.scrollIntoView({behavior:'smooth',block:'nearest'});
          el.classList.add('cp-hl'); setTimeout(()=>el.classList.remove('cp-hl'),4500); }
      });
      body.appendChild(card);
    });
    return;
  }

  /* DG filter — handled by the DG section below */
  if(CP_FILTER==='dg'){
    body.innerHTML='<div class="cp-empty">DG cargo shown in the Dangerous Goods section below.</div>';
    if(badge) badge.textContent='—'; return;
  }

  /* Priority Lift filter */
  if(CP_FILTER==='pri'){
    const items = S.cargo.filter(c => c.priority);
    const filtered = CP_Q ? items.filter(c=>[c.ccu||'',c.desc||''].join(' ').toLowerCase().includes(CP_Q)) : items;
    if(badge) badge.textContent = filtered.length;
    if(filtered.length===0){ body.innerHTML='<div class="cp-empty">No Priority Lift cargo on deck.</div>'; return; }
    filtered.forEach(cargo=>{
      const loc=locById(cargo.platform);
      const card=document.createElement('div'); card.className='cp-qi';
      const dot=document.createElement('div'); dot.className='cp-qi-dot';
      dot.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3L4 7M8 3l4 4" stroke="#d97706" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      card.appendChild(dot);
      const bd=document.createElement('div'); bd.className='cp-qi-body';
      const nm=document.createElement('div'); nm.className='cp-qi-name'; nm.textContent=cargo.ccu||'—'; bd.appendChild(nm);
      const meta=document.createElement('div'); meta.className='cp-qi-meta'; meta.textContent=[cargo.desc,cargo.wt?cargo.wt+'T':''].filter(Boolean).join(' · '); bd.appendChild(meta);
      const tags=document.createElement('div'); tags.className='cp-qi-tags';
      if(loc){const t=document.createElement('span');t.className='cp-tag cp-tag-loc';t.textContent=loc.name;tags.appendChild(t);}
      const pt=document.createElement('span');pt.className='cp-tag';pt.style.cssText='background:rgba(217,119,6,.12);color:rgba(180,90,0,1);border:1px solid rgba(217,119,6,.30);';pt.textContent='⚡ Priority';tags.appendChild(pt);
      bd.appendChild(tags); card.appendChild(bd);
      card.addEventListener('click',()=>{const el=document.querySelector(`.cb[data-id="${cargo.id}"]`);if(el){el.scrollIntoView({behavior:'smooth',block:'nearest'});el.classList.add('cp-hl');setTimeout(()=>el.classList.remove('cp-hl'),4500);if(typeof kbSelect==='function')kbSelect(cargo.id);}});
      body.appendChild(card);
    });
    return;
  }

  /* Heavy Lift filter — show HL cargo from deck AND unplaced queue */
  if(CP_FILTER==='hl'){
    const deckHL = S.cargo.filter(c => c.heavyLift);
    const filtered = CP_Q
      ? deckHL.filter(c => [c.ccu||'',c.desc||''].join(' ').toLowerCase().includes(CP_Q))
      : deckHL;
    if(badge) badge.textContent = filtered.length;
    if(filtered.length === 0){
      body.innerHTML = '<div class="cp-empty">No Heavy Lift cargo on deck.<br>HL items in Import Queue shown above.</div>';
      return;
    }
    filtered.forEach(cargo => {
      const loc = locById(cargo.platform);
      const card = document.createElement('div'); card.className = 'cp-qi';
      const dot = document.createElement('div'); dot.className = 'cp-qi-dot';
      dot.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3L4 7M8 3l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      dot.style.color = '#785a1a';
      card.appendChild(dot);
      const bd = document.createElement('div'); bd.className = 'cp-qi-body';
      const nm = document.createElement('div'); nm.className = 'cp-qi-name';
      nm.textContent = cargo.ccu || '—'; bd.appendChild(nm);
      const meta = document.createElement('div'); meta.className = 'cp-qi-meta';
      meta.textContent = [cargo.desc, cargo.wt ? cargo.wt+'T' : ''].filter(Boolean).join(' · ');
      bd.appendChild(meta);
      const tags = document.createElement('div'); tags.className = 'cp-qi-tags';
      if(loc){ const t=document.createElement('span');t.className='cp-tag cp-tag-loc';t.textContent=loc.name;tags.appendChild(t); }
      const hl=document.createElement('span');hl.className='cp-tag cp-tag-hl';hl.textContent='⬆ HL';tags.appendChild(hl);
      if(cargo.dgClass){ const d=document.createElement('span');d.className='cp-tag cp-tag-dg';d.textContent='⬥ DG '+cargo.dgClass;tags.appendChild(d); }
      bd.appendChild(tags); card.appendChild(bd);
      card.addEventListener('click', () => {
        const el = document.querySelector(`.cb[data-id="${cargo.id}"]`);
        if(el){ el.scrollIntoView({behavior:'smooth',block:'nearest'});
          el.classList.add('cp-hl'); setTimeout(()=>el.classList.remove('cp-hl'),4500);
          if(typeof kbSelect==='function') kbSelect(cargo.id); }
      });
      body.appendChild(card);
    });
    return;
  }

  /* Status filters (L / BL / ROB) — show actual deck cargo with that status */
  if(['L','BL','ROB'].includes(CP_FILTER)){
    const statusLabel = {L:'Load', BL:'Backload', ROB:'ROB'}[CP_FILTER];
    let items = S.cargo.filter(c => c.status === CP_FILTER);
    if(CP_Q) items = items.filter(c =>
      [c.ccu||'', c.desc||'', c.platform||''].join(' ').toLowerCase().includes(CP_Q)
    );
    if(badge) badge.textContent = items.length;
    if(items.length === 0){
      body.innerHTML = `<div class="cp-empty">No ${statusLabel} cargo on deck.</div>`;
      return;
    }
    items.forEach(cargo => {
      const loc = (typeof locById !== 'undefined') ? locById(cargo.platform) : null;
      const locName = loc ? loc.name : (cargo.platform || '');
      const card = document.createElement('div');
      card.className = 'cp-qi';

      /* Icon dot */
      const dot = document.createElement('div'); dot.className = 'cp-qi-dot';
      dot.innerHTML = cargo.dgClass
        ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 5.5v4M8 11v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="5" width="13" height="9.5" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 5l2.5-3.5h8L14.5 5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5v2h4V5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      if(cargo.dgClass) dot.style.color = '#785a1a';
      card.appendChild(dot);

      /* Body */
      const bd = document.createElement('div'); bd.className = 'cp-qi-body';
      /* Primary: CCU/ID in mono */
      const nm = document.createElement('div'); nm.className = 'cp-qi-name';
      nm.textContent = cargo.ccu || '—';
      bd.appendChild(nm);
      /* Secondary: description + weight */
      const meta = document.createElement('div'); meta.className = 'cp-qi-meta';
      meta.textContent = [cargo.desc, cargo.wt ? cargo.wt + 'T' : ''].filter(Boolean).join(' · ');
      bd.appendChild(meta);
      /* Tags: location, status, DG, HL */
      const tags = document.createElement('div'); tags.className = 'cp-qi-tags';
      const mkTag = (cls, txt) => {
        const t = document.createElement('span'); t.className = 'cp-tag ' + cls;
        t.textContent = txt; tags.appendChild(t);
      };
      if(locName)       mkTag('cp-tag-loc',              locName);
      if(cargo.dgClass) mkTag('cp-tag-dg',               '⬥ DG ' + cargo.dgClass);
      if(cargo.heavyLift) mkTag('cp-tag-hl',             '⬆ HL');
      bd.appendChild(tags);
      card.appendChild(bd);

      /* Click: highlight that cargo on deck + keyboard-select it */
      card.addEventListener('click', () => {
        const el = document.querySelector(`.cb[data-id="${cargo.id}"]`);
        if(el){
          el.scrollIntoView({ behavior:'smooth', block:'nearest' });
          el.classList.add('cp-hl');
          setTimeout(() => el.classList.remove('cp-hl'), 4500);
          if(typeof kbSelect === 'function') kbSelect(cargo.id);
        }
      });
      body.appendChild(card);
    });
    return;
  }

  /* Normal library view — use CLIB (the real cargo data) */
  const src = (typeof CLIB !== 'undefined') ? CLIB : [];
  let items = src.filter(item => cpMatch(item));

  /* Unplaced filter — library items are always unplaced (they're templates) */
  /* no additional filter needed for 'unplaced' */

  if(badge) badge.textContent = items.length;
  if(items.length===0){ body.innerHTML='<div class="cp-empty">No cargo matches your search.</div>'; return; }

  /* Add custom library items */
  const customs = (S.customLib||[]).filter(item=>cpMatch(item));

  /* Group standard items by category */
  const groups={};
  items.forEach(it=>{ const c=it.cat||'Other'; (groups[c]=groups[c]||[]).push(it); });

  /* Favourites section first */
  /* Favourites: LIB_PREFS.favs is a Set — use .has() */
  const hasFav = k => (LIB_PREFS.favs instanceof Set) ? LIB_PREFS.favs.has(k) : false;
  const favItems = items.filter(it => hasFav(it.key||it.name));
  if(favItems.length > 0 && !CP_Q){
    const lbl=document.createElement('div'); lbl.className='cp-cat-lbl'; lbl.textContent='★ Favourites';
    body.appendChild(lbl);
    favItems.forEach(item => body.appendChild(cpMakeLibCard(item)));
  }

  /* Standard groups */
  Object.entries(groups).forEach(([cat,grp])=>{
    const lbl=document.createElement('div'); lbl.className='cp-cat-lbl'; lbl.textContent=cat;
    body.appendChild(lbl);
    grp.forEach(item => body.appendChild(cpMakeLibCard(item)));
  });

  /* Custom cargo */
  if(customs.length > 0){
    const lbl=document.createElement('div'); lbl.className='cp-cat-lbl'; lbl.textContent='⚙ Custom';
    body.appendChild(lbl);
    customs.forEach(item => body.appendChild(cpMakeLibCard(item, true)));
  }
}

/* ── Helper: build a library card ── */
function cpMakeLibCard(item, isCustom=false){
  /* ── Key = item.key (CLIB) or item.name (custom) ── */
  const itemKey = item.key || item.name;

  /* ── Favourite state — LIB_PREFS.favs is a Set ── */
  const isFav = (typeof LIB_PREFS!=='undefined' && LIB_PREFS.favs instanceof Set)
    ? LIB_PREFS.favs.has(itemKey) : false;

  /* ── Display name: alias takes priority ── */
  const alias       = (typeof LIB_PREFS!=='undefined' && LIB_PREFS.aliases) ? LIB_PREFS.aliases[itemKey] : null;
  const displayName = alias || item.name;

  /* ── Dimensions ── */
  const dim = (item.length_m && item.width_m)
    ? `${item.length_m}×${item.width_m} m`
    : (item.sz || '');
  const wt  = item.wt || item.wt_default || '?';

  /* ── Canvas pixel dimensions (needed by _placeAtCore) ── */
  const pw = item.w || m2px_w(item.length_m || 3);
  const ph = item.h || m2px_h(item.width_m  || 2.44);

  /* ── Build card ── */
  const card = document.createElement('div');
  card.className = 'cp-lc';

  const icon = document.createElement('div');
  icon.className = 'cp-lc-icon';
  if(isCustom){
    icon.innerHTML='<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8l-1.4 1.4M4.2 9.8l-1.4 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  } else {
    icon.innerHTML='<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="4.5" width="11" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 4.5L4 1.5h6l2.5 3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 4.5v1.5h4V4.5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  }
  card.appendChild(icon);

  const bd = document.createElement('div');
  bd.className = 'cp-lc-body';
  bd.innerHTML = `
    <div class="cp-lc-cat">${(item.cat||'').replace(/</g,'&lt;')}</div>
    <div class="cp-lc-name">${displayName.replace(/</g,'&lt;')}</div>
    <div class="cp-lc-dim">${dim} · ${wt}T</div>`;
  card.appendChild(bd);

  /* ── Star / Favourite toggle ── */
  const star = document.createElement('div');
  star.className = 'cp-lc-star' + (isFav ? ' on' : '');
  star.textContent = '★';
  star.title = isFav ? 'Remove from Favourites' : 'Add to Favourites';

  star.addEventListener('mousedown', e => e.stopPropagation());
  star.addEventListener('click', e => {
    e.stopPropagation();
    /* Ensure LIB_PREFS.favs is always a Set */
    if (!(LIB_PREFS.favs instanceof Set)) {
      LIB_PREFS.favs = new Set(Array.isArray(LIB_PREFS.favs) ? LIB_PREFS.favs : []);
    }
    if (LIB_PREFS.favs.has(itemKey)) {
      LIB_PREFS.favs.delete(itemKey);
      star.classList.remove('on');
      star.title = 'Add to Favourites';
    } else {
      LIB_PREFS.favs.add(itemKey);
      star.classList.add('on');
      star.title = 'Remove from Favourites';
    }
    saveLibPrefs();
    /* Re-render the whole lib section so Favourites group updates immediately */
    cpRenderLib();
  });
  card.appendChild(star);

  /* ── Click = activate for deck placement ── */
  card.addEventListener('click', () => {
    document.querySelectorAll('.cp-lc,.cp-dg').forEach(x => x.classList.remove('cp-lc-sel','cp-dg-sel'));
    card.classList.add('cp-lc-sel');

    /* type:'cargo' is what _placeAtCore checks with isC = p.type==='cargo' */
    S.pending = {
      type: 'cargo',
      item: {
        cat: item.cat,
        name: displayName,
        key:  itemKey,
        w:    pw,
        h:    ph,
        wt:   parseFloat(wt) || 0,
        length_m: item.length_m,
        width_m:  item.width_m,
      }
    };
    document.querySelectorAll('.lc,.dgc,.asco-qitem').forEach(x => x.classList.remove('sel','selected-q'));
    cpShowHint('<b>' + displayName.replace(/</g,'&lt;') + '</b> → click deck to place');
  });

  return card;
}

/* ── Render: DG Section ── */
function cpRenderDg(){
  const body=document.getElementById('cpSecBodyDg'); if(!body) return;
  body.innerHTML='';
  if(!['all','dg'].includes(CP_FILTER)){
    body.innerHTML='<div class="cp-empty">Set filter to "All" or "⬥ DG" to browse DG cargo.</div>'; return;
  }
  const dgData=(typeof DG_DATA!=='undefined')?DG_DATA:[];
  const items=dgData.filter(dg=>{
    if(!CP_Q) return true;
    return ('class '+dg.cls+' '+dg.nm+' '+(dg.sub||'')).toLowerCase().includes(CP_Q);
  });
  if(items.length===0){body.innerHTML='<div class="cp-empty">No DG items match.</div>';return;}
  items.forEach(dg=>{
    const card=document.createElement('div'); card.className='cp-dg';
    const dia=document.createElement('div'); dia.className='cp-dg-dia';
    dia.style.cssText=`background:${dg.bg};border-color:${dg.bc};`;
    const sp=document.createElement('span'); sp.textContent=dg.cls; sp.style.color=dg.tc;
    dia.appendChild(sp); card.appendChild(dia);
    const bd=document.createElement('div'); bd.className='cp-dg-body';
    bd.innerHTML=`<div class="cp-dg-cls" style="color:${dg.bc}">Class ${dg.cls}</div>
                  <div class="cp-dg-nm">${dg.nm.replace(/</g,'&lt;')}</div>`;
    card.appendChild(bd);
    card.addEventListener('click',()=>{
      document.querySelectorAll('.cp-lc,.cp-dg').forEach(x=>x.classList.remove('cp-lc-sel','cp-dg-sel'));
      card.classList.add('cp-dg-sel');
      S.pending={type:'dg',item:dg};
      document.querySelectorAll('.lc,.dgc,.asco-qitem').forEach(x=>x.classList.remove('sel','selected-q'));
      if(typeof updateDGZones==='function') updateDGZones();
      cpShowHint('<b>◆ DG '+dg.cls+' · '+dg.nm.replace(/</g,'&lt;')+'</b> → click deck to place');
    });
    body.appendChild(card);
  });
}

/* ── Render: Custom Section ── */
function cpRenderCustom(){
  const list=document.getElementById('cpCustomList'); if(!list) return;
  list.innerHTML='';
  if(!S.customLib||S.customLib.length===0) return;
  S.customLib.forEach((item,idx)=>{
    if(CP_Q){
      if(![item.name||'',item.sz||''].join(' ').toLowerCase().includes(CP_Q)) return;
    }
    const card=document.createElement('div'); card.className='cp-lc';
    card.innerHTML=`
      <div class="cp-lc-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8l-1.4 1.4M4.2 9.8l-1.4 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></div>
      <div class="cp-lc-body">
        <div class="cp-lc-cat">Custom</div>
        <div class="cp-lc-name">${(item.name||'').replace(/</g,'&lt;')}</div>
        <div class="cp-lc-dim">${(item.sz||'').replace(/</g,'&lt;')} · ${item.wt||'?'}T</div>
      </div>`;
    const rm=document.createElement('span');
    rm.style.cssText='font-size:14px;color:var(--txt4);cursor:pointer;flex-shrink:0;padding:0 2px;';
    rm.textContent='×';
    rm.addEventListener('mousedown',e=>e.stopPropagation());
    rm.addEventListener('click',e=>{
      e.stopPropagation(); S.customLib.splice(idx,1);
      if(typeof save==='function') save();
      cpRenderCustom();
    });
    card.appendChild(rm);
    card.addEventListener('click',()=>{
      document.querySelectorAll('.cp-lc,.cp-dg').forEach(x=>x.classList.remove('cp-lc-sel','cp-dg-sel'));
      card.classList.add('cp-lc-sel');
      /* type:'cargo' so _placeAtCore picks up w/h dimensions correctly */
      S.pending={type:'cargo', item:{
        cat: item.cat, name: item.name,
        w: item.w || m2px_w(item.length_m||3),
        h: item.h || m2px_h(item.width_m||2.44),
        wt: parseFloat(item.wt)||0,
        length_m: item.length_m, width_m: item.width_m,
      }};
      document.querySelectorAll('.lc,.dgc,.asco-qitem').forEach(x=>x.classList.remove('sel','selected-q'));
      cpShowHint('<b>'+(item.name||'').replace(/</g,'&lt;')+'</b> → click deck to place');
    });
    list.appendChild(card);
  });
}

/* ── Custom cargo add from panel form ── */
function cpBindCustomForm(){
  const btn=document.getElementById('cpBtnAdd');
  if(!btn) return;
  btn.addEventListener('click',()=>{
    const desc=document.getElementById('cpDesc').value.trim();
    if(!desc){ alert('Enter description'); return; }
    const sz=document.getElementById('cpSize').value||'3.0x2.44';
    const pp=sz.replace(/[^0-9.x]/gi,'').split('x');
    const lm=parseFloat(pp[0])||3.0, wm=parseFloat(pp[1])||2.44;
    const item={cat:'Custom',name:desc,sz,wt:parseFloat(document.getElementById('cpWT').value)||0,
      length_m:lm,width_m:wm,w:m2px_w(lm),h:m2px_h(wm)};
    S.customLib.push(item);
    if(typeof buildCargoList==='function') buildCargoList();
    if(typeof buildCustList==='function') buildCustList();
    if(typeof buildModalDescSelect==='function') buildModalDescSelect();
    ['cpDesc','cpCCU','cpSize','cpWT'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    if(typeof save==='function') save();
    cpRenderCustom();
  });
  const clrBtn=document.getElementById('cpBtnClrCustom');
  if(clrBtn) clrBtn.addEventListener('click',()=>{
    if(!S.customLib.length) return;
    if(!confirm('Clear all '+S.customLib.length+' custom cargo items?')) return;
    S.customLib=[]; if(typeof save==='function') save();
    if(typeof buildCargoList==='function') buildCargoList();
    cpRenderCustom();
  });
}

/* ── Bind everything ── */
function cpBind(){
  /* Open / close */
  const openBtn = document.getElementById('btnLibOpen');
  if(openBtn) openBtn.addEventListener('click', cpToggle);
  const closeBtn = document.getElementById('cpClose');
  if(closeBtn) closeBtn.addEventListener('click', cpClose);

  /* Collapse / expand strip buttons */
  const collapseBtn = document.getElementById('cpCollapseBtn');
  if(collapseBtn) collapseBtn.addEventListener('click', cpToggleCollapse);
  const expandBtn = document.getElementById('cpExpandBtn');
  if(expandBtn) expandBtn.addEventListener('click', cpExpand);
  /* Backdrop no longer blocks deck — click-outside handled by document listener.
     Panel stays open while placing cargo on deck (pendingClose guard). */
  /* Panel behaves as floating inspector — does NOT auto-close on outside click.
     Close only via: X button | Escape key | toolbar toggle.
     This lets crew select cargo, then freely click on the deck to place it
     without the panel disappearing mid-interaction. */
  /* (No document click-outside listener — intentional floating inspector UX) */

  /* Clear queue */
  const clrQ = document.getElementById('cpClearQueue');
  if(clrQ) clrQ.addEventListener('click',()=>{
    const q=(typeof IMPORT_QUEUE!=='undefined')?IMPORT_QUEUE:[];
    if(!q.length) return;
    if(!confirm('Clear all '+q.length+' imported items? Deck cargo is unaffected.')) return;
    q.length=0; updateQueueBadge(); cpRenderQueue();
  });

  /* Edge handle — click to open when panel is closed */
  const edgeHandle = document.getElementById('cpEdgeHandle');
  if(edgeHandle){
    edgeHandle.addEventListener('click', cpOpen);
    /* Drag-to-open: drag left from right edge */
    let edgeDragX = 0;
    edgeHandle.addEventListener('mousedown', e=>{
      edgeDragX = e.clientX;
      const onMove = ev=>{
        if(edgeDragX - ev.clientX > 40){ document.removeEventListener('mousemove',onMove); cpOpen(); }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', ()=>document.removeEventListener('mousemove',onMove), {once:true});
    });
  }

  cpBindSections();
  cpBindFilters();
  cpBindSearch();
  cpBindCustomForm();

  /* Escape closes panel */
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape' && CP_OPEN) cpClose();
  });

  /* After ASCO import: open panel */
  window._cpAfterImport = ()=>{
    cpUpdateBadge();
    if(!CP_OPEN) cpOpen();
    else cpRenderQueue();
  };

  /* Patch: hide floating hint when pending cancelled */
  const _origCancel = window.cancelPending;
  window.cancelPending = function(){
    _origCancel && _origCancel();
    cpHideHint();
    document.querySelectorAll('.cp-lc,.cp-dg,.cp-qi').forEach(x=>
      x.classList.remove('cp-lc-sel','cp-dg-sel','cp-qi-sel'));
  };
}


/* ════════════════════════════════════════════════════════════
   KEYBOARD CARGO POSITIONING SYSTEM
   Allows fine-tuning of placed cargo with arrow keys.
   - Arrow           = 1px step (ultra-fine)
   - Shift+Arrow     = 1 grid unit = M px = 31px (≈1 metre)
   - Alt/Opt+Arrow   = 5px step (medium fine)
   State: KB_SEL = cargo id of currently keyboard-selected block
════════════════════════════════════════════════════════════ */

let KB_SEL = null;   /* currently keyboard-selected cargo id */

/* ── Pixels per step for each modifier ────────────────────── */
const KB_STEP_FINE   = 1;     /* plain Arrow — 1px ultra-fine */
const KB_STEP_MED    = 5;     /* Alt+Arrow   — 5px medium     */
const KB_STEP_COARSE = M;     /* Shift+Arrow — 31px ≈ 1 metre */

/* ── Select a cargo block for keyboard control ─────────────── */
function kbSelect(id){
  KB_SEL = id;
  /* Visual: add kb-sel class, remove from all others */
  document.querySelectorAll('.cb.kb-sel').forEach(el => el.classList.remove('kb-sel'));
  const el = document.querySelector(`.cb[data-id="${id}"]`);
  if(el) el.classList.add('kb-sel');
  kbShowCoord(id);
}

/* ── Deselect keyboard target ──────────────────────────────── */
function kbDeselect(){
  KB_SEL = null;
  document.querySelectorAll('.cb.kb-sel').forEach(el => el.classList.remove('kb-sel'));
  kbHideCoord();
}

/* ── Show coordinate tip near selected block ───────────────── */
function kbShowCoord(id){
  const cargo = S.cargo.find(c => String(c.id) === String(id));
  const tip   = document.getElementById('kb-coord-tip');
  if(!cargo || !tip) return;

  /* Real-world metres: x from AFT edge, y from PORT edge */
  const xm = (cargo.x / M).toFixed(2);
  const ym = (cargo.y / (CVH/15)).toFixed(2);
  tip.textContent = `x ${xm} m  ·  y ${ym} m`;

  /* Position tip above the block, clamped inside deck area */
  const blockEl = document.querySelector(`.cb[data-id="${id}"]`);
  if(blockEl){
    const bx = cargo.x * zoomLevel;
    const by = cargo.y * zoomLevel;
    const bw = cargo.w * zoomLevel;
    /* sit above block centre, 28px up from top edge */
    tip.style.left = Math.max(4, bx + bw/2) + 'px';
    tip.style.top  = Math.max(4, by - 28) + 'px';
    tip.style.transform = 'translateX(-50%)';
  }
  tip.classList.add('visible');
}

/* ── Hide coordinate tip ────────────────────────────────────── */
function kbHideCoord(){
  const tip = document.getElementById('kb-coord-tip');
  if(tip) tip.classList.remove('visible');
}

/* ── Move the selected block by dx/dy pixels ────────────────── */
function kbMove(dx, dy){
  if(!KB_SEL) return;
  const cargo = S.cargo.find(c => String(c.id) === String(KB_SEL));
  if(!cargo) { kbDeselect(); return; }

  /* Apply delta, clamped to deck boundaries */
  cargo.x = Math.max(0, Math.min(cargo.x + dx, TW  - cargo.w));
  cargo.y = Math.max(0, Math.min(cargo.y + dy, CVH - cargo.h));

  /* Update DOM directly — no full re-render for smooth feel */
  const el = document.querySelector(`.cb[data-id="${KB_SEL}"]`);
  if(el){
    el.style.left = cargo.x + 'px';
    el.style.top  = cargo.y + 'px';
    /* Keep kb-sel class alive after direct DOM update */
    el.classList.add('kb-sel');
  }

  /* Update coord tip live */
  kbShowCoord(KB_SEL);

  /* Debounced save + downstream updates — avoid per-keypress cost */
  kbDebouncedSave();
}

/* ── Debounced save after keyboard movement ────────────────── */
let _kbSaveTimer = null;
function kbDebouncedSave(){
  clearTimeout(_kbSaveTimer);
  _kbSaveTimer = setTimeout(()=>{
    /* Full downstream sync after movement settles */
    updateStats();
    buildActiveLocStrip();
    checkSeg();
    save();
  }, 180);
}

/* ── Zoom flash indicator ──────────────────────────────── */
let _kbZoomFlashTimer = null;
function kbShowZoomFlash(label){
  const el = document.getElementById('kb-zoom-flash');
  if(!el) return;
  el.textContent = label;
  el.classList.add('show');
  clearTimeout(_kbZoomFlashTimer);
  _kbZoomFlashTimer = setTimeout(() => el.classList.remove('show'), 900);
}

/* ── Cheatsheet open / close ────────────────────────────── */
function openKbCheat(){
  const ov = document.getElementById('kbCheatOv');
  if(ov) ov.classList.add('open');
}
function closeKbCheat(){
  const ov = document.getElementById('kbCheatOv');
  if(ov) ov.classList.remove('open');
}

/* ── Main keyboard event handler ───────────────────────────────── */
function kbHandleKey(e){
  /* Always respect ? key for cheatsheet, regardless of shortcuts toggle */
  if(e.key === '?'){
    const ov = document.getElementById('kbCheatOv');
    if(ov){ ov.classList.contains('open') ? closeKbCheat() : openKbCheat(); }
    e.preventDefault();
    return;
  }

  /* Ignore when typing in an input, select, or modal */
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if(['INPUT','SELECT','TEXTAREA'].includes(tag)) return;
  if(document.getElementById('ov').classList.contains('open')) return;
  if(document.getElementById('ascoOv').classList.contains('open')) return;
  if(document.getElementById('kbCheatOv')?.classList.contains('open')) return;

  /* Shortcuts system toggle — arrow keys still work regardless */
  const isArrow = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key);

  /* ── Arrow key movement (always active even if kbShortcuts=false) ── */
  if(isArrow){
    if(!KB_SEL) return;
    e.preventDefault();
    e.stopPropagation();
    let step;
    if(e.shiftKey)    step = KB_STEP_COARSE;
    else if(e.altKey) step = KB_STEP_MED;
    else              step = KB_STEP_FINE;
    let dx = 0, dy = 0;
    if(e.key === 'ArrowLeft')  dx = -step;
    if(e.key === 'ArrowRight') dx = +step;
    if(e.key === 'ArrowUp')    dy = -step;
    if(e.key === 'ArrowDown')  dy = +step;
    kbMove(dx, dy);
    return;
  }

  /* ── Remaining shortcuts — only when kbShortcuts enabled ── */
  if(!SMART.kbShortcuts) return;

  /* ── Zoom level keys 1–5 ── */
  const zoomMap = { '1': 0.5, '2': 0.75, '3': 1.0, '4': 1.25, '5': 1.5 };
  if(zoomMap[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey){
    const z = zoomMap[e.key];
    applyZoom(z);
    kbShowZoomFlash(`${Math.round(z * 100)}%`);
    e.preventDefault();
    return;
  }

  /* ── Block-specific shortcuts (require selection) ── */
  const key = e.key.toLowerCase();

  /* L — toggle library panel collapse */
  if(key === 'l'){
    e.preventDefault();
    if(typeof CP_OPEN !== 'undefined' && CP_OPEN){
      cpToggleCollapse();
    } else {
      if(typeof cpOpen === 'function') cpOpen();
    }
    return;
  }

  /* E — edit */
  if(key === 'e' && KB_SEL){
    e.preventDefault();
    openModal(KB_SEL);
    return;
  }

  /* R — rotate */
  if(key === 'r' && KB_SEL){
    e.preventDefault();
    const cargo = S.cargo.find(c => String(c.id) === String(KB_SEL));
    if(!cargo) return;
    const cx = cargo.x + cargo.w / 2, cy = cargo.y + cargo.h / 2;
    const nw = cargo.h, nh = cargo.w;
    cargo.w = nw; cargo.h = nh;
    cargo.x = Math.max(0, Math.min(cx - nw / 2, TW  - nw));
    cargo.y = Math.max(0, Math.min(cy - nh / 2, CVH - nh));
    const tmp = cargo.length_m;
    cargo.length_m = cargo.width_m;
    cargo.width_m  = tmp;
    cargo.rot = ((cargo.rot || 0) + 1) % 4;
    renderAll();
    kbSelect(KB_SEL);  /* re-apply ring after renderAll */
    checkSeg();
    save();
    return;
  }

  /* D — duplicate */
  if(key === 'd' && KB_SEL){
    e.preventDefault();
    const cargo = S.cargo.find(c => String(c.id) === String(KB_SEL));
    if(!cargo) return;
    const newCargo = {
      ...cargo,
      id: Date.now() + Math.random(),
      x:  Math.min(cargo.x + cargo.w + 6, TW  - cargo.w),
      y:  Math.min(cargo.y + 0,           CVH - cargo.h),
      ccu: cargo.ccu ? cargo.ccu + ' (copy)' : '',
    };
    S.cargo.push(newCargo);
    renderAll();
    kbSelect(newCargo.id);
    updateStats();
    buildActiveLocStrip();
    checkSeg();
    updateDGSummary();
    save();
    return;
  }

  /* Delete / Backspace — delete selected block */
  if((e.key === 'Delete' || e.key === 'Backspace') && KB_SEL){
    e.preventDefault();
    const id = KB_SEL;
    kbDeselect();
    dgEvictDeletedCargo(id);
    S.cargo = S.cargo.filter(c => String(c.id) !== String(id));
    renderAll();
    updateStats();
    buildActiveLocStrip();
    checkSeg();
    updateDGSummary();
    save();
    return;
  }
}

/* ── Bind the keyboard handler ─────────────────────────────── */
function bindKeyboardNav(){
  /* Capture phase so we get priority before browser scroll */
  document.addEventListener('keydown', kbHandleKey, {capture: true});

  /* Clicking the deck background (not a cargo block) clears selection */
  const cv = document.getElementById('cvDECK');
  if(cv){
    cv.addEventListener('click', e=>{
      if(!e.target.closest('.cb')) kbDeselect();
    });
  }

  /* Cheatsheet modal close controls */
  const cheatClose = document.getElementById('kbCheatClose');
  if(cheatClose) cheatClose.addEventListener('click', closeKbCheat);
  const cheatOv = document.getElementById('kbCheatOv');
  if(cheatOv) cheatOv.addEventListener('click', e => {
    if(e.target === cheatOv) closeKbCheat();
  });

  /* Closing the cargo modal re-applies the kb-sel ring visually */
  const origClose = window.closeModal;
  window.closeModal = function(){
    origClose && origClose();
    if(KB_SEL){
      const el = document.querySelector(`.cb[data-id="${KB_SEL}"]`);
      if(el){
        el.classList.add('kb-sel');
        kbShowCoord(KB_SEL);
      } else {
        kbDeselect();
      }
    }
  };
}


/* ═══════════════════════════════════════════════════════════
   THEME SYSTEM — Light / Dark mode
   Applies data-theme="dark" to <html>, persists to localStorage.
   Key: 'spicaTide_theme'  Values: 'light' | 'dark'
═══════════════════════════════════════════════════════════ */

function applyTheme(theme){
  const html = document.documentElement;
  if(theme === 'dark'){
    html.setAttribute('data-theme','dark');
  } else {
    html.removeAttribute('data-theme');
  }
  /* Update toggle button states */
  const lightBtn = document.getElementById('themeLight');
  const darkBtn  = document.getElementById('themeDark');
  if(lightBtn && darkBtn){
    lightBtn.classList.toggle('active', theme === 'light');
    darkBtn.classList.toggle('active',  theme === 'dark');
  }
  /* Persist */
  try{ localStorage.setItem('spicaTide_theme', theme); }catch(e){}
}

function bindThemeToggle(){
  const lightBtn = document.getElementById('themeLight');
  const darkBtn  = document.getElementById('themeDark');
  if(lightBtn) lightBtn.addEventListener('click', () => applyTheme('light'));
  if(darkBtn)  darkBtn.addEventListener('click',  () => applyTheme('dark'));

  /* Restore saved preference */
  let saved = 'light';
  try{ saved = localStorage.getItem('spicaTide_theme') || 'light'; }catch(e){}
  applyTheme(saved);
}


/* ═══════════════════════════════════════════════════════════
   CLEAR DECK SYSTEM
   Shows a premium confirmation modal before removing all cargo.
   Only clears S.cargo — never touches locations, settings,
   imported queue, or any other state.
═══════════════════════════════════════════════════════════ */
function bindClearDeck(){
  const btn     = document.getElementById('btnClrDeck');
  const overlay = document.getElementById('clrDeckOv');
  const cancel  = document.getElementById('clrDeckCancel');
  const confirm = document.getElementById('clrDeckConfirm');
  const countEl = document.getElementById('clrDeckCountNum');

  if(!btn || !overlay) return;

  /* Open modal — update count before showing */
  btn.addEventListener('click', () => {
    if(countEl) countEl.textContent = S.cargo.length;
    overlay.classList.add('open');
    /* Focus cancel by default — safer UX */
    setTimeout(() => cancel && cancel.focus(), 60);
  });

  /* Cancel — close modal, no action */
  const closeModal = () => overlay.classList.remove('open');
  cancel.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if(e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
  });

  /* Confirm — animate out, then clear */
  confirm.addEventListener('click', () => {
    closeModal();
    /* Subtle fade-out of all cargo blocks before removing */
    const blocks = document.querySelectorAll('.cb');
    blocks.forEach(b => {
      b.style.transition = 'opacity .18s ease, transform .18s ease';
      b.style.opacity = '0';
      b.style.transform = 'scale(.94)';
    });
    setTimeout(() => {
      S.cargo = [];
      renderAll();
      updateStats();
      buildActiveLocStrip();
      updateDGSummary();
      checkSeg();
      save();
      /* Deselect keyboard target if any */
      if(typeof kbDeselect === 'function') kbDeselect();
    }, 190);
  });

  /* Also remap the legacy hidden btnClr to the new modal */
  const legacyBtn = document.getElementById('btnClr');
  if(legacyBtn) legacyBtn.onclick = () => btn.click();
}


/* ════════════════════════════════════════════════════════════
   VOYAGE REMARKS SYSTEM
════════════════════════════════════════════════════════════ */
function bindVoyageRemarks(){
  const btn    = document.getElementById('voyRemarksBtn');
  const ov     = document.getElementById('rmkOv');
  const ta     = document.getElementById('rmkText');
  const saveBtn= document.getElementById('rmkSave');
  const canBtn = document.getElementById('rmkCancel');
  const closeX = document.getElementById('rmkClose');
  if(!btn||!ov) return;

  const open = () => {
    ta.value = S.voyRemarks || '';
    ov.classList.add('open');
    setTimeout(()=>ta.focus(),60);
  };
  const close = () => ov.classList.remove('open');
  const saveRmk = () => {
    S.voyRemarks = ta.value.trim();
    save();
    /* Update button visual state */
    btn.classList.toggle('has-notes', !!S.voyRemarks);
    btn.title = S.voyRemarks ? 'Voyage Notes (saved)' : 'Voyage Notes';
    close();
  };

  btn.addEventListener('click', open);
  saveBtn.addEventListener('click', saveRmk);
  canBtn.addEventListener('click', close);
  closeX.addEventListener('click', close);
  ov.addEventListener('click', e => { if(e.target===ov) close(); });
  ta.addEventListener('keydown', e => { if(e.key==='Escape') close(); });

  /* Restore button state on load */
  setTimeout(()=>{ btn.classList.toggle('has-notes', !!S.voyRemarks); }, 200);
}

/* ════════════════════════════════════════════════════════════
   TRANSFER DESTINATION SELECT BUILDER
════════════════════════════════════════════════════════════ */
function buildTrDestSelect(currentVal){
  const sel = document.getElementById('mdlTrDest');
  if(!sel) return;
  sel.innerHTML = '<option value="">— select destination —</option>';
  const locs = [...LOC_ALL, ...S.customLocs];
  locs.forEach(loc=>{
    const opt=document.createElement('option');
    opt.value=loc.id; opt.textContent=loc.name;
    if(loc.id===currentVal) opt.selected=true;
    sel.appendChild(opt);
  });
}

/* ════════════════════════════════════════════════════════════
   MODAL BINDMODAL EXTENSION — Priority toggle + TR visibility
════════════════════════════════════════════════════════════ */
function bindModalExtensions(){
  /* Priority Lift toggle */
  const priBtn = document.getElementById('mPriority');
  const priLbl = document.getElementById('mPriorityLbl');
  if(priBtn){
    priBtn.addEventListener('click', ()=>{
      priBtn.classList.toggle('on');
      priLbl.textContent = priBtn.classList.contains('on') ? 'Priority Lift — ON' : 'Priority Lift — off';
    });
  }
  /* Show/hide Transfer destination when status=TR selected */
  document.querySelectorAll('.mdl-st').forEach(b=>{
    b.addEventListener('click', ()=>{
      const trWrap = document.getElementById('mdlTrWrap');
      if(trWrap) trWrap.classList.toggle('visible', b.dataset.s==='TR');
    });
  });
}

/* ════════════════════════════════════════════════════════════
   EXCEL EXPORT — Full cargo manifest via SheetJS
════════════════════════════════════════════════════════════ */
async function exportExcel(){
  if(typeof XLSX === 'undefined'){ showToast(t('toast_xlsx_loading'),'ok');return; }

  const voyageNum = document.getElementById('voyIn').value.trim()||'—';
  const dateStr   = document.getElementById('dateBtn').textContent.trim()||'—';
  const now       = new Date();
  const ts        = now.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});

  /* ── Worksheet 1: Cargo Manifest ── */
  const rows = [];
  /* Header row */
  rows.push([
    'CCU / ID','Description','Length (m)','Width (m)','Weight (T)',
    'Status','Location','DG Class','Heavy Lift','Priority Lift',
    'Transfer To','Bay (approx)','Remarks'
  ]);
  /* Data rows */
  S.cargo.forEach(c=>{
    const loc = locById(c.platform);
    const trLoc = c.trDest ? locById(c.trDest) : null;
    /* Estimate bay from x position */
    let bayNum = '—';
    let bx=0;
    for(let i=0;i<BW.length;i++){if(c.x>=bx&&c.x<bx+BW[i]){bayNum=String(12-i);break;}bx+=BW[i];}
    rows.push([
      c.ccu||'',
      c.desc||'',
      parseFloat((c.length_m||c.w/M).toFixed(2)),
      parseFloat((c.width_m||c.h/(CVH/15)).toFixed(2)),
      parseFloat(c.wt)||0,
      c.status==='L'?'Load':c.status==='BL'?'Backload':c.status==='ROB'?'ROB':c.status==='TR'?'Transfer':'',
      loc?loc.name:(c.platform||''),
      c.dgClass||'',
      c.heavyLift?'YES':'',
      c.priority?'YES':'',
      trLoc?trLoc.name:(c.trDest||''),
      'Bay '+bayNum,
      '',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  /* Column widths */
  ws['!cols'] = [
    {wch:16},{wch:28},{wch:11},{wch:11},{wch:11},
    {wch:10},{wch:20},{wch:10},{wch:11},{wch:12},
    {wch:20},{wch:10},{wch:25}
  ];

  /* Style header row */
  const range = XLSX.utils.decode_range(ws['!ref']);
  for(let C=range.s.c; C<=range.e.c; C++){
    const addr = XLSX.utils.encode_cell({r:0,c:C});
    if(!ws[addr]) continue;
    ws[addr].s = {
      font:{bold:true,color:{rgb:'FFFFFF'}},
      fill:{fgColor:{rgb:'486083'}},
      alignment:{horizontal:'center'},
    };
  }

  /* ── Worksheet 2: Summary ── */
  const L   = S.cargo.filter(c=>c.status==='L').length;
  const BL  = S.cargo.filter(c=>c.status==='BL').length;
  const ROB = S.cargo.filter(c=>c.status==='ROB').length;
  const TR  = S.cargo.filter(c=>c.status==='TR').length;
  const wt  = S.cargo.reduce((a,c)=>a+(parseFloat(c.wt)||0),0);
  const DGs = [...new Set(S.cargo.filter(c=>c.dgClass).map(c=>c.dgClass))];
  const pris = S.cargo.filter(c=>c.priority).length;

  const sumRows = [
    ['SPICA TIDE — Voyage Summary',''],
    ['Voyage',voyageNum],
    ['Date',dateStr],
    ['Generated',ts],
    ['',''],
    ['Total Lifts',S.cargo.length],
    ['Total Weight (T)',parseFloat(wt.toFixed(1))],
    ['Load',L],
    ['Backload',BL],
    ['ROB',ROB],
    ['Transfer',TR],
    ['DG Classes On Board',DGs.join(', ')||'None'],
    ['Priority Lifts',pris],
    ['',''],
    ['Voyage Notes',S.voyRemarks||'—'],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(sumRows);
  wsSummary['!cols'] = [{wch:22},{wch:40}];

  /* Active Locations breakdown */
  if(S.activeLocs.length>0){
    sumRows.push(['','']);
    sumRows.push(['Location Breakdown','']);
    sumRows.push(['Location','Load','Backload','ROB','Transfer','Total Weight (T)']);
    S.activeLocs.forEach(id=>{
      const loc=locById(id);if(!loc)return;
      const cl=S.cargo.filter(c=>c.platform===id);
      const lL=cl.filter(c=>c.status==='L').length;
      const lBL=cl.filter(c=>c.status==='BL').length;
      const lROB=cl.filter(c=>c.status==='ROB').length;
      const lTR=cl.filter(c=>c.status==='TR').length;
      const lWt=cl.reduce((a,c)=>a+(parseFloat(c.wt)||0),0);
      if(cl.length>0) sumRows.push([loc.name,lL,lBL,lROB,lTR,parseFloat(lWt.toFixed(1))]);
    });
    /* Rebuild wsSummary with location data */
    const wsSummary2 = XLSX.utils.aoa_to_sheet(sumRows);
    wsSummary2['!cols'] = [{wch:22},{wch:10},{wch:10},{wch:10},{wch:10},{wch:14}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cargo Manifest');
    XLSX.utils.book_append_sheet(wb, wsSummary2, 'Summary');
    await _saveWorkbook(wb);
    return;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cargo Manifest');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
  await _saveWorkbook(wb);
}

async function _saveWorkbook(wb){
  const xlsxPath = window._pendingXlsxPath;
  window._pendingXlsxPath = null;

  if(xlsxPath){
    /* Path was chosen by user via native Save As dialog in _menuExportExcel */
    try {
      const xlsxData = XLSX.write(wb, { bookType:'xlsx', type:'array' });
      const bytes = Array.from(new Uint8Array(xlsxData));
      await window.__TAURI__.core.invoke('write_file_bytes', { path: xlsxPath, bytes });
      showToast(t('toast_xlsx_ok') + ' \u2014 ' + xlsxPath.split(/[/\\]/).pop(), 'ok');
    } catch(e){
      showToast('Excel save failed: ' + (e && e.message || e), 'warn');
    }
  } else {
    /* Browser fallback — direct download */
    const dd = String(selDate.getDate()).padStart(2,'0');
    const mm = String(selDate.getMonth()+1).padStart(2,'0');
    const yyyy = selDate.getFullYear();
    XLSX.writeFile(wb, 'SPICA TIDE Manifest - '+dd+'.'+mm+'.'+yyyy+'.xlsx');
    showToast(t('toast_xlsx_ok'),'ok');
  }
}


/* ════════════════════════════════════════════════════════════
   RESPONSIVE HEADER ENGINE — window.innerWidth based.
   
   window.innerWidth is the correct value for CSS breakpoints.
   It already reflects devicePixelRatio correctly — a MacBook
   14" M-series reports 1512 here, not 3024.
   
   Two thresholds applied to <body> classes:
   • body.hdr-compact  when innerWidth < 1600
   • body.hdr-tight    when innerWidth < 1400
   
   Both classes stack: hdr-tight screens also get hdr-compact.
════════════════════════════════════════════════════════════ */
function initResponsiveHeader(){
  const COMPACT_W = 1650;   /* px: tighter padding, hide subtitle */
  const TIGHT_W   = 1480;   /* px: icon-only buttons, hide labels */
  const MINI_W    = 1200;   /* px: hide version badge, lang picker, compress all */

  function applyHdrClass(){
    const w = window.innerWidth;
    document.body.classList.toggle('hdr-compact', w < COMPACT_W);
    document.body.classList.toggle('hdr-tight',   w < TIGHT_W);
    document.body.classList.toggle('hdr-mini',    w < MINI_W);
  }

  applyHdrClass();
  window.addEventListener('resize', applyHdrClass);
}


/* ════════════════════════════════════════════════════════════
   MANIFEST MATCHING — ASCO list vs placed deck cargo.

   Compares IMPORT_QUEUE (imported ASCO items) with S.cargo
   (actually placed items) and shows four categories:
   1. UNPLACED  — in queue but not on deck
   2. MISMATCH  — on deck but weight/location differs from queue
   3. EXTRA     — on deck but not in the ASCO queue at all
   4. OK        — perfect match in queue + deck

   Toggle is in the panel strip. Info modal explains the feature.
   State persisted to sessionStorage only (not across reloads).
════════════════════════════════════════════════════════════ */

let MATCH_ACTIVE = false;

function runManifestMatch(){
  const resultsEl = document.getElementById('cpMatchResults');
  if(!resultsEl) return;

  if(IMPORT_QUEUE.length === 0){
    resultsEl.innerHTML = `<div class="cp-match-empty">${t('match_no_queue')}</div>`;
    return;
  }

  /* ── Build lookup maps ── */
  /* Queue keyed by CCU (normalised) */
  const queueByCcu = new Map();
  IMPORT_QUEUE.forEach(q => {
    const key = (q.ccu || q.name || '').trim().toUpperCase();
    if(key) queueByCcu.set(key, q);
  });

  /* Deck keyed by CCU */
  const deckByCcu = new Map();
  S.cargo.forEach(c => {
    const key = (c.ccu || '').trim().toUpperCase();
    if(key) deckByCcu.set(key, c);
  });

  const unplaced  = [];  /* in queue, not on deck */
  const mismatch  = [];  /* on deck but params differ */
  const ok        = [];  /* perfect match */
  const extra     = [];  /* on deck but not in queue */

  /* Check every queue item */
  queueByCcu.forEach((q, key) => {
    const c = deckByCcu.get(key);
    if(!c){
      unplaced.push({ q });
    } else {
      /* Compare weight (within 0.1T tolerance) and location */
      const wtDiff = Math.abs((parseFloat(c.wt)||0) - (parseFloat(q.wt)||0)) > 0.1;
      const locMatch = !q.locId || c.platform === q.locId;
      if(wtDiff || !locMatch){
        const diffs = [];
        if(wtDiff) diffs.push(`Вес: ASCO ${q.wt||'?'}T → на деке ${c.wt||'?'}T`);
        if(!locMatch){
          const qLoc = locById(q.locId);
          const cLoc = locById(c.platform);
          diffs.push(`Лок: ASCO ${qLoc?qLoc.name:(q.locId||'?')} → на деке ${cLoc?cLoc.name:(c.platform||'?')}`);
        }
        mismatch.push({ q, c, diffs });
      } else {
        ok.push({ q, c });
      }
    }
  });

  /* Check deck items not in queue */
  deckByCcu.forEach((c, key) => {
    if(!queueByCcu.has(key)){
      extra.push({ c });
    }
  });

  /* ── Render results ── */
  resultsEl.innerHTML = '';

  /* Helper to make a group */
  const mkGroup = (dotCls, title, countCls, items, renderFn) => {
    if(items.length === 0) return;
    const g = document.createElement('div');
    g.className = 'cp-match-group';
    g.innerHTML = `<div class="cp-match-group-hdr">
      <div class="cp-match-dot ${dotCls}"></div>
      <div class="cp-match-group-title">${title}</div>
      <div class="cp-match-count ${countCls}">${items.length}</div>
    </div>`;
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cp-match-item';
      renderFn(row, item);
      g.appendChild(row);
    });
    resultsEl.appendChild(g);
  };

  /* 1. Unplaced — in queue but not on deck */
  mkGroup('warn',t('match_unplaced'),'warn', unplaced, (row, {q}) => {
    const locName = q.locId ? (locById(q.locId)||{name:q.locId}).name : (q.displayName||'');
    row.innerHTML = `<div class="cp-match-ccu">${q.ccu||q.name||'—'}</div>
      <div class="cp-match-detail">${q.name||''} · ${q.wt||0}T${locName?' · '+locName:''}</div>`;
  });

  /* 2. Mismatch — on deck with different params */
  mkGroup('err',t('match_mismatch'),'err', mismatch, (row, {q, diffs}) => {
    row.innerHTML = `<div class="cp-match-ccu">${q.ccu||q.name||'—'}</div>
      <div class="cp-match-detail">${q.name||''}
        <div class="cp-match-diff">${diffs.join('<br>')}</div>
      </div>`;
    /* Click to highlight on deck */
    const c = deckByCcu.get((q.ccu||'').toUpperCase());
    if(c) row.addEventListener('click', ()=>{
      const el = document.querySelector(`.cb[data-id="${c.id}"]`);
      if(el){ el.scrollIntoView({behavior:'smooth',block:'nearest'});
        el.classList.add('cp-hl'); setTimeout(()=>el.classList.remove('cp-hl'),4500);
        if(typeof kbSelect==='function') kbSelect(c.id); }
    });
  });

  /* 3. Extra — on deck but not in ASCO */
  mkGroup('extra',t('match_extra'),'extra', extra, (row, {c}) => {
    const loc = locById(c.platform);
    row.innerHTML = `<div class="cp-match-ccu">${c.ccu||'—'}</div>
      <div class="cp-match-detail">${c.desc||''} · ${c.wt||0}T${loc?' · '+loc.name:''}</div>`;
    row.addEventListener('click', ()=>{
      const el = document.querySelector(`.cb[data-id="${c.id}"]`);
      if(el){ el.scrollIntoView({behavior:'smooth',block:'nearest'});
        el.classList.add('cp-hl'); setTimeout(()=>el.classList.remove('cp-hl'),4500);
        if(typeof kbSelect==='function') kbSelect(c.id); }
    });
  });

  /* 4. OK — matched */
  mkGroup('ok',t('match_ok'),'ok', ok, (row, {q}) => {
    row.innerHTML = `<div class="cp-match-ccu">${q.ccu||q.name||'—'}</div>
      <div class="cp-match-detail">${q.name||''} · ${q.wt||0}T</div>`;
  });

  if(unplaced.length === 0 && mismatch.length === 0 && extra.length === 0){
    const perfect = document.createElement('div');
    perfect.className = 'cp-match-empty';
    perfect.innerHTML = t('match_perfect');
    perfect.style.cssText = 'color:var(--s-L);font-style:normal;font-weight:600;';
    resultsEl.appendChild(perfect);
  }
}

function bindManifestMatch(){
  const toggle   = document.getElementById('cpMatchToggle');
  const section  = document.getElementById('cpMatchSection');
  const infoBtn  = document.getElementById('cpMatchInfoBtn');
  const infoOv   = document.getElementById('matchInfoOv');
  const infoClose= document.getElementById('matchInfoClose');
  const infoAct  = document.getElementById('matchInfoAction');
  const refreshBtn = document.getElementById('cpMatchRefresh');
  if(!toggle || !section) return;

  const activate = (showInfo) => {
    MATCH_ACTIVE = true;
    toggle.checked = true;
    section.classList.add('active');
    runManifestMatch();
    if(showInfo){
      /* Open info modal explaining the feature */
      if(infoOv) infoOv.classList.add('open');
    }
  };

  const deactivate = () => {
    MATCH_ACTIVE = false;
    toggle.checked = false;
    section.classList.remove('active');
    /* Show brief info modal explaining what was turned off */
    if(infoOv) infoOv.classList.add('open');
  };

  const closeInfo = () => { if(infoOv) infoOv.classList.remove('open'); };

  toggle.addEventListener('change', () => {
    if(toggle.checked) activate(true);
    else deactivate();
  });

  /* Info button — always open info modal */
  if(infoBtn) infoBtn.addEventListener('click', () => {
    if(infoOv) infoOv.classList.add('open');
  });

  /* Info modal close controls */
  if(infoClose) infoClose.addEventListener('click', closeInfo);
  if(infoAct)   infoAct.addEventListener('click', () => {
    closeInfo();
    /* If not yet active, enable it */
    if(!MATCH_ACTIVE) activate(false);
  });
  if(infoOv) infoOv.addEventListener('click', e => { if(e.target===infoOv) closeInfo(); });
  document.addEventListener('keydown', e => {
    if(e.key==='Escape' && infoOv && infoOv.classList.contains('open')) closeInfo();
  });

  /* Refresh button */
  if(refreshBtn) refreshBtn.addEventListener('click', runManifestMatch);
}


/* ════════════════════════════════════════════════════════════
   SMART TOOLS SYSTEM
   
   Global settings object — all smart features read from here.
   Persisted to localStorage key 'spicaTide_smartTools'.
   
   Each feature is opt-in (default on for Bounce, DG fade;
   manifest matching defaults off since it needs ASCO data).
════════════════════════════════════════════════════════════ */

const SMART_DEFAULTS = {
  bounce:     true,   /* Smart Bounce / Magnetic Snap */
  match:      false,  /* ASCO Manifest Matching */
  dgFade:     true,   /* DG Badge fade on hover */
  dgSeg:      true,   /* DG Auto-Segregation Check — safety critical, default ON */
  hoverMotion:true,   /* Cargo hover lift/scale animation */
  gridSnap:   true,   /* Smart Grid Snap — align on drop to neighbours / bay lines */
  kbShortcuts:true,   /* Keyboard Shortcuts System */
};

let SMART = { ...SMART_DEFAULTS };

function loadSmartSettings(){
  try{
    const raw = localStorage.getItem('spicaTide_smartTools');
    if(raw){ const saved = JSON.parse(raw); Object.assign(SMART, saved); }
  }catch(e){}
}

function saveSmartSettings(){
  try{ localStorage.setItem('spicaTide_smartTools', JSON.stringify(SMART)); }catch(e){}
}

/* Apply DG fade setting: toggle a stylesheet rule via a dedicated <style> tag */
function applyDgFade(){
  let styleEl = document.getElementById('stDgFadeStyle');
  if(!styleEl){
    styleEl = document.createElement('style');
    styleEl.id = 'stDgFadeStyle';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = SMART.dgFade
    ? '.cb:hover .cb-dg-badge,.cb:hover .cb-hl-badge,.cb:hover .cb-pri-badge{opacity:.12;}'
    : '.cb:hover .cb-dg-badge,.cb:hover .cb-hl-badge,.cb:hover .cb-pri-badge{opacity:1;}';
}

function applyHoverMotion(){
  let styleEl = document.getElementById('stHoverMotionStyle');
  if(!styleEl){
    styleEl = document.createElement('style');
    styleEl.id = 'stHoverMotionStyle';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = SMART.hoverMotion
    /* ON — original lift + scale */
    ? '.cb:hover{transform:translateY(-2px) scale(1.01);}'
    /* OFF — no transform, keep only shadow + z-index from base .cb:hover rule */
    : '.cb:hover{transform:none;}';
}

/* Update the gear button dot (shows if any smart feature is active) */
function updateSmartDot(){
  const btn = document.getElementById('btnSmartTools');
  if(!btn) return;
  const anyOn = Object.values(SMART).some(v => v);
  btn.classList.toggle('has-active', anyOn);
}

/* ── Smart Bounce — called after drop to resolve overlaps ──
   Finds the nearest free position adjacent to the dropped cargo,
   preserving the user's intent (same bay area, same y if possible).
   Returns {x, y} of a non-overlapping position. */
function smartBounce(cargo){
  if(!SMART.bounce) return null;

  const others = S.cargo.filter(c => c.id !== cargo.id);

  /* AABB overlap test */
  const overlapsAny = (cx, cy, cw, ch) =>
    others.some(o =>
      cx < o.x + o.w && cx + cw > o.x &&
      cy < o.y + o.h && cy + ch > o.y
    );

  if(!overlapsAny(cargo.x, cargo.y, cargo.w, cargo.h)) return null;

  /* ── Algorithm: directional push from each overlapping neighbour ──
     For each block we overlap, compute the minimum translation vector
     (MTV) to stop overlapping it — the smallest axis push.
     We pick the 4 candidate positions (push right, left, down, up
     from the primary overlapping block) and test each for clearance.
     Return the closest clear candidate to the original drop point. */

  /* Find the block with the largest overlap area (primary collider) */
  let primary = null, maxArea = 0;
  others.forEach(o => {
    const ox = Math.max(0, Math.min(cargo.x + cargo.w, o.x + o.w) - Math.max(cargo.x, o.x));
    const oy = Math.max(0, Math.min(cargo.y + cargo.h, o.y + o.h) - Math.max(cargo.y, o.y));
    const area = ox * oy;
    if(area > maxArea){ maxArea = area; primary = o; }
  });
  if(!primary) return null;

  /* 4 directional push candidates relative to primary */
  const gap = 2; /* 2px breathing room */
  const pushRight = primary.x + primary.w + gap;
  const pushLeft  = primary.x - cargo.w - gap;
  const pushDown  = primary.y + primary.h + gap;
  const pushUp    = primary.y - cargo.h - gap;

  /* Clamp to deck bounds */
  const clampX = x => Math.max(0, Math.min(x, TW - cargo.w));
  const clampY = y => Math.max(0, Math.min(y, CVH - cargo.h));

  /* For each direction, keep y (or x) from drop point to preserve intent */
  const candidates = [
    { x: clampX(pushRight), y: clampY(cargo.y) },  /* push right, keep y */
    { x: clampX(pushLeft),  y: clampY(cargo.y) },  /* push left,  keep y */
    { x: clampX(cargo.x),   y: clampY(pushDown) }, /* push down,  keep x */
    { x: clampX(cargo.x),   y: clampY(pushUp)   }, /* push up,    keep x */
    /* Diagonal fallbacks — push right + down, etc */
    { x: clampX(pushRight), y: clampY(pushDown) },
    { x: clampX(pushLeft),  y: clampY(pushDown) },
    { x: clampX(pushRight), y: clampY(pushUp)   },
    { x: clampX(pushLeft),  y: clampY(pushUp)   },
  ];

  /* Score each candidate: distance from drop point, prefer small moves */
  const scored = candidates
    .map(c => ({
      ...c,
      dist: Math.hypot(c.x - cargo.x, c.y - cargo.y),
      clear: !overlapsAny(c.x, c.y, cargo.w, cargo.h),
    }))
    .filter(c => c.clear)
    .sort((a, b) => a.dist - b.dist);

  if(scored.length > 0) return { x: scored[0].x, y: scored[0].y };

  /* Last resort: brute-force spiral outward in small steps */
  const STEP = 6;
  const MAX_R = Math.max(cargo.w, cargo.h) + 80;
  const spiral = [];
  for(let r = STEP; r <= MAX_R; r += STEP){
    for(let angle = 0; angle < 360; angle += 15){
      const rad = angle * Math.PI / 180;
      spiral.push({
        x: clampX(Math.round(cargo.x + r * Math.cos(rad))),
        y: clampY(Math.round(cargo.y + r * Math.sin(rad))),
        dist: r,
      });
    }
  }
  const free = spiral.find(c => !overlapsAny(c.x, c.y, cargo.w, cargo.h));
  return free ? { x: free.x, y: free.y } : null;
}

/* Trigger the visual bounce animation after renderAll has placed the block */
function triggerBounceAnim(cargoId){
  const el = document.querySelector(`.cb[data-id="${cargoId}"]`);
  if(!el) return;
  el.classList.remove('st-bouncing');
  /* Force reflow so re-adding the class triggers the animation fresh */
  void el.offsetWidth;
  el.classList.add('st-bouncing');
  el.addEventListener('animationend', () => el.classList.remove('st-bouncing'), { once:true });
}

/* ════════════════════════════════════════════════════════════
   SMART GRID SNAP  v38.13
   
   One-time alignment assist on drop. Snaps the cargo block to
   the nearest logical position within SNAP_THRESH px:
   
   Priority order (first match wins, smallest delta applied):
     1. Neighbour edge flush — align this block's edge to a
        neighbour's parallel edge (left→right, top→bottom etc.)
     2. Bay line X — align left edge to a BL_ bay boundary
     3. Deck boundary — align to port (y=0) or starboard (y=CVH)
        edge within threshold
   
   Snap is one-shot: it runs once at mouseup, then the block
   sits at its new position freely. No sticky state is stored.
   Moving the block again resets naturally because the new
   position may or may not be within threshold of anything.
   
   SNAP_THRESH_M = 0.75 m — feels natural, not too grabby.
   Separate X and Y axes — snap each independently.
════════════════════════════════════════════════════════════ */

function smartGridSnap(cargo){
  if(!SMART.gridSnap) return null;

  const SNAP_THRESH_X = Math.round(0.75 * M);          /* ~23 px horizontal */
  const SNAP_THRESH_Y = Math.round(0.75 * (CVH / 15)); /* ~19 px vertical   */
  const HB_H          = Math.round(2.16 * YS);         /* Hose Bay height   */

  const others = S.cargo.filter(c => c.id !== cargo.id);
  const clampX = x => Math.max(0, Math.min(x, TW  - cargo.w));
  const clampY = y => Math.max(0, Math.min(y, CVH - cargo.h));

  /* ── Collect X snap candidates ──
     Bay boundary lines and neighbour left/right edges */
  const xCandidates = []; /* [{snapX, ref}] */

  /* Bay boundary X lines (left edge of cargo to bay boundary) */
  BL_.forEach(bx => {
    /* Snap left edge to bay line */
    if(Math.abs(cargo.x - bx) <= SNAP_THRESH_X)
      xCandidates.push({ snapX: bx, delta: Math.abs(cargo.x - bx), ref: 'bay-left' });
    /* Snap right edge to bay line */
    if(Math.abs((cargo.x + cargo.w) - bx) <= SNAP_THRESH_X)
      xCandidates.push({ snapX: bx - cargo.w, delta: Math.abs((cargo.x + cargo.w) - bx), ref: 'bay-right' });
  });

  /* Deck X boundaries */
  if(cargo.x <= SNAP_THRESH_X)
    xCandidates.push({ snapX: 0, delta: cargo.x, ref: 'deck-left' });
  if((TW - (cargo.x + cargo.w)) <= SNAP_THRESH_X)
    xCandidates.push({ snapX: TW - cargo.w, delta: TW - (cargo.x + cargo.w), ref: 'deck-right' });

  /* Neighbour left/right edges */
  others.forEach(o => {
    /* This block's right edge flush with neighbour's left edge */
    const dRL = Math.abs((cargo.x + cargo.w) - o.x);
    if(dRL <= SNAP_THRESH_X)
      xCandidates.push({ snapX: o.x - cargo.w, delta: dRL, ref: 'nb-rl' });
    /* This block's left edge flush with neighbour's right edge */
    const dLR = Math.abs(cargo.x - (o.x + o.w));
    if(dLR <= SNAP_THRESH_X)
      xCandidates.push({ snapX: o.x + o.w, delta: dLR, ref: 'nb-lr' });
    /* X-alignment: left-to-left */
    const dLL = Math.abs(cargo.x - o.x);
    if(dLL <= SNAP_THRESH_X)
      xCandidates.push({ snapX: o.x, delta: dLL, ref: 'nb-ll' });
    /* X-alignment: right-to-right */
    const dRR = Math.abs((cargo.x + cargo.w) - (o.x + o.w));
    if(dRR <= SNAP_THRESH_X)
      xCandidates.push({ snapX: o.x + o.w - cargo.w, delta: dRR, ref: 'nb-rr' });
  });

  /* ── Collect Y snap candidates ──
     Port/starboard edges, hose bay edges, neighbour top/bottom */
  const yCandidates = [];

  /* Deck Y boundaries (port top, starboard bottom) */
  if(cargo.y <= SNAP_THRESH_Y)
    yCandidates.push({ snapY: 0, delta: cargo.y, ref: 'deck-top' });
  if((CVH - (cargo.y + cargo.h)) <= SNAP_THRESH_Y)
    yCandidates.push({ snapY: CVH - cargo.h, delta: CVH - (cargo.y + cargo.h), ref: 'deck-bottom' });

  /* Hose Bay edges (top bay: 0..HB_H, bottom bay: CVH-HB_H..CVH) */
  /* Bottom edge of block to HB_H (top hose bay lower edge) */
  const dTopHB  = Math.abs((cargo.y + cargo.h) - HB_H);
  if(dTopHB <= SNAP_THRESH_Y)
    yCandidates.push({ snapY: HB_H - cargo.h, delta: dTopHB, ref: 'hosebay-top' });
  /* Top edge of block to CVH-HB_H (bottom hose bay upper edge) */
  const dBotHB  = Math.abs(cargo.y - (CVH - HB_H));
  if(dBotHB <= SNAP_THRESH_Y)
    yCandidates.push({ snapY: CVH - HB_H, delta: dBotHB, ref: 'hosebay-bot' });
  /* Centre line (CVH/2) — top or bottom edge */
  const midY = CVH / 2;
  const dMidT = Math.abs(cargo.y - midY);
  if(dMidT <= SNAP_THRESH_Y)
    yCandidates.push({ snapY: midY, delta: dMidT, ref: 'centre-top' });
  const dMidB = Math.abs((cargo.y + cargo.h) - midY);
  if(dMidB <= SNAP_THRESH_Y)
    yCandidates.push({ snapY: midY - cargo.h, delta: dMidB, ref: 'centre-bottom' });

  /* Neighbour top/bottom edges */
  others.forEach(o => {
    /* This block's bottom flush to neighbour's top */
    const dBT = Math.abs((cargo.y + cargo.h) - o.y);
    if(dBT <= SNAP_THRESH_Y)
      yCandidates.push({ snapY: o.y - cargo.h, delta: dBT, ref: 'nb-bt' });
    /* This block's top flush to neighbour's bottom */
    const dTB = Math.abs(cargo.y - (o.y + o.h));
    if(dTB <= SNAP_THRESH_Y)
      yCandidates.push({ snapY: o.y + o.h, delta: dTB, ref: 'nb-tb' });
    /* Top-to-top alignment */
    const dTT = Math.abs(cargo.y - o.y);
    if(dTT <= SNAP_THRESH_Y)
      yCandidates.push({ snapY: o.y, delta: dTT, ref: 'nb-tt' });
    /* Bottom-to-bottom alignment */
    const dBB = Math.abs((cargo.y + cargo.h) - (o.y + o.h));
    if(dBB <= SNAP_THRESH_Y)
      yCandidates.push({ snapY: o.y + o.h - cargo.h, delta: dBB, ref: 'nb-bb' });
  });

  /* ── Choose best candidate per axis (smallest delta) ── */
  const bestX = xCandidates.sort((a,b) => a.delta - b.delta)[0];
  const bestY = yCandidates.sort((a,b) => a.delta - b.delta)[0];

  const newX = bestX ? clampX(bestX.snapX) : cargo.x;
  const newY = bestY ? clampY(bestY.snapY) : cargo.y;

  /* Only return if at least one axis actually moved */
  if(newX === cargo.x && newY === cargo.y) return null;

  /* Overlap safety check — if snap position overlaps a neighbour, skip it
     (SmartBounce will have already resolved hard overlaps; this is a soft check) */
  const overlaps = others.some(o =>
    newX < o.x + o.w && newX + cargo.w > o.x &&
    newY < o.y + o.h && newY + cargo.h > o.y
  );
  if(overlaps) return null;

  return { x: newX, y: newY };
}

/* ════════════════════════════════════════════════════════════
   AUTO ALIGN DECK  v38.14
   
   One-shot batch alignment tool. Iterates all cargo blocks in
   spatial order (left→right, top→bottom) and applies grid snap
   logic to each, using a slightly wider threshold than the
   per-drop snap (1.0 m vs 0.75 m) since this is an explicit
   cleanup action.
   
   Runs multiple passes until no more blocks move (convergence),
   capped at MAX_PASSES to prevent infinite loops.
   
   Only moves blocks that are within threshold — blocks that are
   already well-spaced are left exactly where they are.
   
   After completion: shows a brief toast and closes the panel.
════════════════════════════════════════════════════════════ */

function autoAlignDeck(){
  if(!S.cargo.length) return;

  const SNAP_THRESH_X  = Math.round(1.0 * M);          /* 1.0 m horizontal */
  const SNAP_THRESH_Y  = Math.round(1.0 * (CVH / 15)); /* 1.0 m vertical   */
  const HB_H           = Math.round(2.16 * YS);
  const MAX_PASSES     = 6;
  const clampX = (x, w)  => Math.max(0, Math.min(x, TW  - w));
  const clampY = (y, h)  => Math.max(0, Math.min(y, CVH - h));

  let totalMoved = 0;

  for(let pass = 0; pass < MAX_PASSES; pass++){
    let movedThisPass = 0;

    /* Sort spatially: left→right primary, top→bottom secondary */
    const sorted = [...S.cargo].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);

    sorted.forEach(cargo => {
      const others = S.cargo.filter(c => c.id !== cargo.id);

      /* ── X axis candidates ── */
      const xC = [];

      BL_.forEach(bx => {
        const dL = Math.abs(cargo.x - bx);
        if(dL <= SNAP_THRESH_X) xC.push({ snapX: bx, delta: dL });
        const dR = Math.abs((cargo.x + cargo.w) - bx);
        if(dR <= SNAP_THRESH_X) xC.push({ snapX: bx - cargo.w, delta: dR });
      });

      if(cargo.x <= SNAP_THRESH_X)
        xC.push({ snapX: 0, delta: cargo.x });
      if((TW - (cargo.x + cargo.w)) <= SNAP_THRESH_X)
        xC.push({ snapX: TW - cargo.w, delta: TW - (cargo.x + cargo.w) });

      others.forEach(o => {
        const pairs = [
          { snapX: o.x - cargo.w,       delta: Math.abs((cargo.x + cargo.w) - o.x) },  /* flush right→left */
          { snapX: o.x + o.w,           delta: Math.abs(cargo.x - (o.x + o.w)) },       /* flush left→right */
          { snapX: o.x,                 delta: Math.abs(cargo.x - o.x) },                /* left align */
          { snapX: o.x + o.w - cargo.w, delta: Math.abs((cargo.x + cargo.w) - (o.x + o.w)) }, /* right align */
        ];
        pairs.forEach(p => { if(p.delta <= SNAP_THRESH_X) xC.push(p); });
      });

      /* ── Y axis candidates ── */
      const yC = [];

      if(cargo.y <= SNAP_THRESH_Y)
        yC.push({ snapY: 0, delta: cargo.y });
      if((CVH - (cargo.y + cargo.h)) <= SNAP_THRESH_Y)
        yC.push({ snapY: CVH - cargo.h, delta: CVH - (cargo.y + cargo.h) });

      const dTopHB = Math.abs((cargo.y + cargo.h) - HB_H);
      if(dTopHB <= SNAP_THRESH_Y) yC.push({ snapY: HB_H - cargo.h, delta: dTopHB });
      const dBotHB = Math.abs(cargo.y - (CVH - HB_H));
      if(dBotHB <= SNAP_THRESH_Y) yC.push({ snapY: CVH - HB_H, delta: dBotHB });

      const midY = CVH / 2;
      yC.push({ snapY: midY,          delta: Math.abs(cargo.y - midY) });
      yC.push({ snapY: midY - cargo.h, delta: Math.abs((cargo.y + cargo.h) - midY) });

      others.forEach(o => {
        const pairs = [
          { snapY: o.y - cargo.h,       delta: Math.abs((cargo.y + cargo.h) - o.y) },
          { snapY: o.y + o.h,           delta: Math.abs(cargo.y - (o.y + o.h)) },
          { snapY: o.y,                 delta: Math.abs(cargo.y - o.y) },
          { snapY: o.y + o.h - cargo.h, delta: Math.abs((cargo.y + cargo.h) - (o.y + o.h)) },
        ];
        pairs.forEach(p => { if(p.delta <= SNAP_THRESH_Y) yC.push(p); });
      });

      /* ── Pick best per axis (smallest delta) ── */
      const bestX = xC.filter(c => c.delta <= SNAP_THRESH_X).sort((a,b) => a.delta - b.delta)[0];
      const bestY = yC.filter(c => c.delta <= SNAP_THRESH_Y).sort((a,b) => a.delta - b.delta)[0];

      const newX = bestX ? clampX(bestX.snapX, cargo.w) : cargo.x;
      const newY = bestY ? clampY(bestY.snapY, cargo.h) : cargo.y;

      if(newX === cargo.x && newY === cargo.y) return;

      /* Safety: skip if new position overlaps another block */
      const overlaps = others.some(o =>
        newX < o.x + o.w && newX + cargo.w > o.x &&
        newY < o.y + o.h && newY + cargo.h > o.y
      );
      if(overlaps) return;

      cargo.x = newX;
      cargo.y = newY;
      movedThisPass++;
      totalMoved++;
    });

    /* Converged — no more moves needed */
    if(movedThisPass === 0) break;
  }

  /* Redraw and persist */
  renderAll();
  updateStats();
  buildActiveLocStrip();
  checkSeg();
  save();

  /* Feedback */
  const uniqueMoved = Math.min(totalMoved, S.cargo.length);
  if(uniqueMoved > 0){
    showToast(`Auto Align: ${uniqueMoved} adjustment${uniqueMoved!==1?'s':''} applied ✓`, 'ok');
  } else {
    showToast('Auto Align: deck is already aligned ✓', 'ok');
  }
}

/* ── Bind Smart Tools panel ── */
function bindSmartTools(){
  loadSmartSettings();
  applyDgFade();
  applyHoverMotion();
  updateSmartDot();

  const btn        = document.getElementById('btnSmartTools');
  const ov         = document.getElementById('stOv');
  const backdrop   = document.getElementById('stBackdrop');
  const closeBtn   = document.getElementById('stClose');
  const bounceChk       = document.getElementById('stBounceToggle');
  const matchChk        = document.getElementById('stMatchToggle');
  const dgFadeChk       = document.getElementById('stDgFadeToggle');
  const dgSegChk        = document.getElementById('stDgSegToggle');
  const hoverMotionChk  = document.getElementById('stHoverMotionToggle');
  const gridSnapChk     = document.getElementById('stGridSnapToggle');
  const kbShortcutsChk  = document.getElementById('stKbShortcutsToggle');

  if(!btn || !ov) return;

  /* Set initial toggle states from loaded settings */
  if(bounceChk)      bounceChk.checked      = SMART.bounce;
  if(matchChk)       matchChk.checked       = SMART.match;
  if(dgFadeChk)      dgFadeChk.checked      = SMART.dgFade;
  if(dgSegChk)       dgSegChk.checked       = SMART.dgSeg;
  if(hoverMotionChk) hoverMotionChk.checked = SMART.hoverMotion;
  if(gridSnapChk)    gridSnapChk.checked    = SMART.gridSnap;
  if(kbShortcutsChk) kbShortcutsChk.checked = SMART.kbShortcuts;

  /* Open / Close */
  const open  = () => ov.classList.add('open');
  const close = () => ov.classList.remove('open');
  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && ov.classList.contains('open')) close();
  });

  /* Toggle handlers — update SMART object, persist, apply side-effects */
  if(bounceChk) bounceChk.addEventListener('change', () => {
    SMART.bounce = bounceChk.checked;
    saveSmartSettings();
    updateSmartDot();
  });

  if(matchChk) matchChk.addEventListener('change', () => {
    SMART.match = matchChk.checked;
    saveSmartSettings();
    updateSmartDot();
    /* Sync with the panel's own manifest toggle */
    const panelToggle = document.getElementById('cpMatchToggle');
    if(panelToggle){
      panelToggle.checked = SMART.match;
      panelToggle.dispatchEvent(new Event('change'));
    }
  });

  if(dgFadeChk) dgFadeChk.addEventListener('change', () => {
    SMART.dgFade = dgFadeChk.checked;
    saveSmartSettings();
    updateSmartDot();
    applyDgFade();
  });

  if(dgSegChk) dgSegChk.addEventListener('change', () => {
    SMART.dgSeg = dgSegChk.checked;
    saveSmartSettings();
    updateSmartDot();
    if(SMART.dgSeg){
      /* Re-enable: clear acknowledged pairs so existing violations show fresh */
      DG_ACK_PAIRS.clear();
      checkSeg();
    } else {
      clearDGViolationHighlights();
      closeDGCheckModal();
    }
  });

  if(hoverMotionChk) hoverMotionChk.addEventListener('change', () => {
    SMART.hoverMotion = hoverMotionChk.checked;
    saveSmartSettings();
    updateSmartDot();
    applyHoverMotion();
  });

  if(gridSnapChk) gridSnapChk.addEventListener('change', () => {
    SMART.gridSnap = gridSnapChk.checked;
    saveSmartSettings();
    updateSmartDot();
  });

  if(kbShortcutsChk) kbShortcutsChk.addEventListener('change', () => {
    SMART.kbShortcuts = kbShortcutsChk.checked;
    saveSmartSettings();
    updateSmartDot();
    /* If disabling, close cheatsheet if open */
    if(!SMART.kbShortcuts) closeKbCheat();
  });

  /* Auto Align Deck — one-shot action button */
  const autoAlignBtn  = document.getElementById('stAutoAlignBtn');
  const autoAlignDesc = document.getElementById('stAutoAlignDesc');
  if(autoAlignBtn){
    autoAlignBtn.addEventListener('click', () => {
      if(!S.cargo.length){
        showToast('No cargo on deck to align.', 'ok');
        return;
      }
      /* Running state */
      autoAlignBtn.classList.add('running');
      if(autoAlignDesc) autoAlignDesc.textContent = 'Выравнивание…';

      /* Run on next frame so the UI updates first */
      requestAnimationFrame(() => {
        autoAlignDeck();
        /* Done state — brief green flash */
        autoAlignBtn.classList.remove('running');
        autoAlignBtn.classList.add('done');
        if(autoAlignDesc) autoAlignDesc.textContent = 'Готово — палуба выровнена';
        setTimeout(() => {
          autoAlignBtn.classList.remove('done');
          if(autoAlignDesc) autoAlignDesc.textContent = 'Выравнивает все контейнеры на палубе — подтягивает близко стоящие к соседям и границам бэёв. Одноразовое действие.';
        }, 2200);
      });
    });
  }

  /* Sync: if cpMatchToggle changes (in the panel), update the Smart Tools checkbox too */
  const cpMatch = document.getElementById('cpMatchToggle');
  if(cpMatch){
    cpMatch.addEventListener('change', () => {
      SMART.match = cpMatch.checked;
      if(matchChk) matchChk.checked = SMART.match;
      saveSmartSettings();
      updateSmartDot();
    });
  }
}


/* ════════════════════════════════════════════════════════════
   i18n — MULTILINGUAL INTERFACE SYSTEM
   
   Architecture:
   • All translations live in the LANG object below.
   • Keys map to data-i18n="key" attributes in the DOM.
   • applyLang(code) swaps all text nodes in one pass.
   • JS runtime strings (toasts, dynamic HTML) use t(key).
   • Core maritime / operational terms (Load, Backload, ROB,
     Transfer, Bay, DG, Library, etc.) are NEVER translated —
     they stay in English across all language modes.
   
   Supported:  en | ru | uk
   Persistent: localStorage 'spicaTide_lang'
   Extensible: add new language by adding a block to LANG.
════════════════════════════════════════════════════════════ */

const LANG = {

  en: {
    /* Clear Deck modal */
    clr_sub:    'This cannot be undone',
    clr_body:   'Are you sure you want to remove all cargo from the deck?',
    clr_items:  'cargo items will be removed',

    /* Buttons */
    btn_cancel: 'Cancel',
    rmk_save:   'Save Notes',

    /* Voyage Remarks */
    rmk_placeholder: 'Enter operational remarks, special instructions, cargo notes, or any voyage-specific information…',
    rmk_hint:   'Notes appear in the PDF export below the deck plan and in the Excel manifest.',

    /* Smart Tools sections */
    st_sec_placement: 'Cargo Placement',
    st_sec_library:   'Cargo Library',
    st_sec_visual:    'Visual',
    st_persist_note:  'Settings are saved automatically and restored on next open.',

    /* Smart Tools descriptions */
    st_bounce_desc: 'When cargo overlaps after drag — the block smoothly bounces to the nearest free position instead of staying in overlap.',
    st_match_desc:  'Shows discrepancies between the imported ASCO list and what is actually placed on deck.',
    st_dgfade_desc: 'On hover over a cargo block — DG and HL badges fade to show the CCU/ID underneath.',
    st_dgseg_desc:  'When a DG item is placed or edited — automatically checks compatibility against the IMDG segregation matrix. Violations are flagged immediately with pair details.',
    st_hovermotion_desc: 'When hovering over a cargo block — it gently lifts and scales up. Disable for a fully static, calm interface.',
    st_gridsnap_desc: 'On drop — gently snaps cargo to the nearest neighbour edge, bay line, or deck boundary within ~0.5 m. One-time assist: no sticky behaviour on subsequent moves.',

    /* Manifest Match info modal */
    mi_sub:           'ASCO list vs deck',
    mi_unplaced_desc: 'Items from the ASCO list not yet placed on deck. Attention required before departure.',
    mi_mismatch_desc: 'Cargo placed but weight or location differs from the imported list. Verify before departure.',
    mi_extra_desc:    'Cargo on deck not found in the ASCO list. Possibly added manually.',
    mi_ok_desc:       'All matched: cargo from the ASCO list is placed correctly.',
    mi_action:        'Got it — enable Manifest Matching',

    /* Manifest Match results (dynamic) */
    match_no_queue:   'No imported ASCO list. Upload a file via Upload Cargo List first.',
    match_unplaced:   'Not placed',
    match_mismatch:   'Parameter mismatch',
    match_extra:      'Extra cargo (not in ASCO)',
    match_ok:         'Matches ASCO',
    match_perfect:    '✓ All matched — deck corresponds to the ASCO list.',
    match_refresh:    'Refresh comparison',

    /* Toast messages */
    toast_queue_added:  (n) => `${n} item${n!==1?'s':''} added to Import Queue`,
    toast_no_cargo:     'No recognisable cargo data found in this file.',
    toast_read_err:     (msg) => 'Could not read Excel file: ' + msg,
    toast_preparing:    'Preparing export…',
    toast_export_fail:  'Export failed — please try again',
    toast_pdf_ok:       'PDF exported \u2713',
    toast_pdf_print_hint: 'Print dialog opened \u2014 choose Save as PDF',
    toast_pdf_err:      'Could not load PDF library — check connection',
    toast_xlsx_loading: 'Loading Excel library…',
    toast_xlsx_ok:      'Excel manifest exported ✓',

    /* Deck hints */
    hint_select:    '<b>Select cargo</b> → click deck to place',
    hint_place:     (name, dim) => `<b>✓ ${name}</b>${dim} — click deck to place`,

    /* Misc */
    mi_unplaced_title:  'Not placed',
    mi_mismatch_title:  'Parameter mismatch',
    mi_extra_title:     'Extra cargo (not in ASCO)',
    mi_ok_title:        'Matches ASCO',
  },

  ru: {
    clr_sub:    'Это действие нельзя отменить',
    clr_body:   'Вы уверены, что хотите убрать весь груз с палубы?',
    clr_items:  'позиций будет удалено',

    btn_cancel: 'Отмена',
    rmk_save:   'Сохранить заметки',

    rmk_placeholder: 'Введите оперативные заметки, инструкции, примечания по грузу или любую информацию по рейсу…',
    rmk_hint:   'Заметки отображаются в PDF-экспорте под планом палубы и в Excel-манифесте.',

    st_sec_placement: 'Размещение груза',
    st_sec_library:   'Cargo Library',
    st_sec_visual:    'Отображение',
    st_persist_note:  'Настройки сохраняются автоматически и восстанавливаются при следующем открытии.',

    st_bounce_desc: 'При перекрытии грузов после drag — контейнер мягко отталкивается в ближайшую свободную позицию рядом, а не остаётся в overlap.',
    st_match_desc:  'Показывает расхождения между импортированным ASCO списком и реальным расположением груза на палубе.',
    st_dgfade_desc: 'При наведении на грузовой блок — DG и HL бейджи становятся полупрозрачными, чтобы был виден CCU/ID.',
    st_dgseg_desc:  'При размещении или редактировании DG груза — автоматическая проверка совместимости по матрице IMDG. Нарушения сегрегации отображаются немедленно.',
    st_hovermotion_desc: 'При наведении на грузовой блок — он плавно приподнимается и немного увеличивается. Выключите для полностью статичного интерфейса.',
    st_gridsnap_desc: 'При сбросе — контейнер аккуратно выравнивается по ближайшему соседу, границе бэя или палубы в радиусе ~0.5 м. Одноразовый assist: при следующем движении прилипания нет.',

    mi_sub:           'ASCO список vs реальная палуба',
    mi_unplaced_desc: 'Грузы из ASCO списка, которые ещё не поставлены на деку. Требуют внимания перед отправкой.',
    mi_mismatch_desc: 'Груз размещён, но вес или локация отличаются от импортированного списка. Стоит проверить.',
    mi_extra_desc:    'Грузы на деке, которых нет в импортированном ASCO списке. Возможно добавлены вручную.',
    mi_ok_desc:       'Всё сходится: груз из ASCO списка найден на деке с правильными параметрами.',
    mi_action:        'Понятно — включить Manifest Matching',

    match_no_queue:   'Нет импортированного ASCO списка. Сначала загрузите файл через Upload Cargo List.',
    match_unplaced:   'Не размещено',
    match_mismatch:   'Расхождение параметров',
    match_extra:      'Extra cargo (не в ASCO)',
    match_ok:         'Совпадает с ASCO',
    match_perfect:    '✓ Всё совпадает — палуба соответствует ASCO списку.',
    match_refresh:    'Обновить сравнение',

    toast_queue_added:  (n) => `${n} позиц${n===1?'ия':n<5?'ии':'ий'} добавлено в Import Queue`,
    toast_no_cargo:     'Данные о грузе в файле не распознаны.',
    toast_read_err:     (msg) => 'Ошибка чтения файла: ' + msg,
    toast_preparing:    'Подготовка экспорта…',
    toast_export_fail:  'Ошибка экспорта — попробуйте ещё раз',
    toast_pdf_ok:       'PDF \u044d\u043a\u0441\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u043d \u2713',
    toast_pdf_print_hint: '\u0414\u0438\u0430\u043b\u043e\u0433 \u043f\u0435\u0447\u0430\u0442\u0438 \u043e\u0442\u043a\u0440\u044b\u0442 \u2014 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u0430\u043a PDF',
    toast_pdf_err:      'Не удалось загрузить библиотеку PDF — проверьте соединение',
    toast_xlsx_loading: 'Загрузка Excel-библиотеки…',
    toast_xlsx_ok:      'Excel-манифест экспортирован ✓',

    hint_select:    '<b>Выберите груз</b> → нажмите на палубу для размещения',
    hint_place:     (name, dim) => `<b>✓ ${name}</b>${dim} — нажмите на палубу для размещения`,

    mi_unplaced_title:  'Не размещено',
    mi_mismatch_title:  'Расхождение параметров',
    mi_extra_title:     'Extra cargo (не в ASCO)',
    mi_ok_title:        'Совпадает с ASCO',
  },

  uk: {
    clr_sub:    'Цю дію не можна скасувати',
    clr_body:   'Ви впевнені, що хочете прибрати весь вантаж з палуби?',
    clr_items:  'позицій буде видалено',

    btn_cancel: 'Скасувати',
    rmk_save:   'Зберегти нотатки',

    rmk_placeholder: 'Введіть оперативні нотатки, інструкції, примітки до вантажу або будь-яку інформацію щодо рейсу…',
    rmk_hint:   'Нотатки відображаються в PDF-експорті під планом палуби та в Excel-маніфесті.',

    st_sec_placement: 'Розміщення вантажу',
    st_sec_library:   'Cargo Library',
    st_sec_visual:    'Відображення',
    st_persist_note:  'Налаштування зберігаються автоматично та відновлюються при наступному відкритті.',

    st_bounce_desc: 'Якщо вантажі перекриваються після drag — контейнер плавно відштовхується до найближчої вільної позиції, а не залишається в overlap.',
    st_match_desc:  'Показує розбіжності між імпортованим ASCO списком та реальним розташуванням вантажу на палубі.',
    st_dgfade_desc: 'При наведенні на вантажний блок — DG та HL бейджі стають напівпрозорими, щоб був видимий CCU/ID.',
    st_dgseg_desc:  'При розміщенні або редагуванні DG вантажу — автоматична перевірка сумісності за матрицею IMDG. Порушення сегрегації відображаються негайно.',
    st_hovermotion_desc: 'При наведенні на вантажний блок — він плавно піднімається та трохи збільшується. Вимкніть для повністю статичного інтерфейсу.',
    st_gridsnap_desc: 'При скиданні — вантаж акуратно вирівнюється по найближчому сусіду, межі бею або палуби в радіусі ~0.5 м. Одноразовий assist: при наступному русі прилипання немає.',

    mi_sub:           'ASCO список vs реальна палуба',
    mi_unplaced_desc: 'Вантажі з ASCO списку, які ще не розміщені на палубі. Потребують уваги перед відправленням.',
    mi_mismatch_desc: 'Вантаж розміщено, але вага або локація відрізняються від імпортованого списку. Варто перевірити.',
    mi_extra_desc:    'Вантажі на палубі, яких немає в імпортованому ASCO списку. Можливо, додані вручну.',
    mi_ok_desc:       'Все збігається: вантаж з ASCO списку знайдено на палубі з правильними параметрами.',
    mi_action:        'Зрозуміло — увімкнути Manifest Matching',

    match_no_queue:   'Немає імпортованого ASCO списку. Спочатку завантажте файл через Upload Cargo List.',
    match_unplaced:   'Не розміщено',
    match_mismatch:   'Розбіжність параметрів',
    match_extra:      'Extra cargo (не в ASCO)',
    match_ok:         'Збігається з ASCO',
    match_perfect:    '✓ Все збігається — палуба відповідає ASCO списку.',
    match_refresh:    'Оновити порівняння',

    toast_queue_added:  (n) => `${n} позиц${n===1?'ію':n<5?'ії':'ій'} додано до Import Queue`,
    toast_no_cargo:     'Дані про вантаж у файлі не розпізнані.',
    toast_read_err:     (msg) => 'Помилка читання файлу: ' + msg,
    toast_preparing:    'Підготовка експорту…',
    toast_export_fail:  'Помилка експорту — спробуйте ще раз',
    toast_pdf_ok:       'PDF \u0435\u043a\u0441\u043f\u043e\u0440\u0442\u043e\u0432\u0430\u043d\u043e \u2713',
    toast_pdf_print_hint: '\u0414\u0456\u0430\u043b\u043e\u0433 \u0434\u0440\u0443\u043a\u0443 \u0432\u0456\u0434\u043a\u0440\u0438\u0442\u043e \u2014 \u043e\u0431\u0435\u0440\u0456\u0442\u044c \u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u044f\u043a PDF',
    toast_pdf_err:      'Не вдалося завантажити бібліотеку PDF — перевірте зʼєднання',
    toast_xlsx_loading: 'Завантаження Excel-бібліотеки…',
    toast_xlsx_ok:      'Excel-маніфест експортовано ✓',

    hint_select:    '<b>Оберіть вантаж</b> → натисніть на палубу для розміщення',
    hint_place:     (name, dim) => `<b>✓ ${name}</b>${dim} — натисніть на палубу для розміщення`,

    mi_unplaced_title:  'Не розміщено',
    mi_mismatch_title:  'Розбіжність параметрів',
    mi_extra_title:     'Extra cargo (не в ASCO)',
    mi_ok_title:        'Збігається з ASCO',
  },
};

/* Current language code */
let _lang = 'en';

/* Translate key → string. Falls back to 'en'. */
function t(key, ...args){
  const d = LANG[_lang] || LANG.en;
  const val = d[key] ?? LANG.en[key];
  if(typeof val === 'function') return val(...args);
  return val ?? key;
}

/* Apply translations to all data-i18n elements + placeholders */
function applyLang(code){
  try{
  if(!LANG[code]) code = 'en';
  _lang = code;

  /* Update all DOM elements with data-i18n.
     Use textContent only — all data-i18n elements are text-only leaves (spans/divs).
     Skip function-valued keys (those are for dynamic t() calls only). */
  document.querySelectorAll('[data-i18n]').forEach(el => {
    try{
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if(typeof val === 'string') el.textContent = val;
    }catch(e){ /* never let i18n break the app */ }
  });

  /* Update placeholders */
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  /* Update dynamic hint if no pending cargo */
  const hintEl = document.getElementById('hint');
  if(hintEl && !S.pending) hintEl.innerHTML = t('hint_select');

  /* Update manifest match refresh button if visible */
  const rfBtn = document.getElementById('cpMatchRefresh');
  if(rfBtn) rfBtn.childNodes[rfBtn.childNodes.length-1].textContent = ' ' + t('match_refresh');

  /* Update lang picker active state */
  const labelMap = { en: 'EN', ru: 'RU', uk: 'UK' };
  const pickerLabel = document.getElementById('langPickerLabel');
  if(pickerLabel) pickerLabel.textContent = labelMap[code] || code.toUpperCase();
  document.querySelectorAll('.lang-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === code);
  });

  /* Persist */
  try{ localStorage.setItem('spicaTide_lang', code); }catch(e){}
  }catch(e){ console.warn('i18n applyLang error:', e); }
}

function bindLangSwitch(){
  /* Restore saved language */
  let saved = 'en';
  try{ saved = localStorage.getItem('spicaTide_lang') || 'en'; }catch(e){}

  /* Dropdown picker logic */
  const pickerBtn  = document.getElementById('langPickerBtn');
  const dropdown   = document.getElementById('langDropdown');

  if(pickerBtn && dropdown){
    pickerBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      dropdown.classList.toggle('open', !isOpen);
      pickerBtn.classList.toggle('open', !isOpen);
    });

    document.addEventListener('click', () => {
      dropdown.classList.remove('open');
      pickerBtn.classList.remove('open');
    });

    dropdown.addEventListener('click', e => e.stopPropagation());
  }

  /* Bind each option */
  document.querySelectorAll('.lang-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      applyLang(btn.dataset.lang);
      if(dropdown) dropdown.classList.remove('open');
      if(pickerBtn) pickerBtn.classList.remove('open');
    });
  });

  /* Apply on load (after DOM is ready) */
  applyLang(saved);
}

/* ════════════════════════════════════════════════════════════
   FEATURE NEW BADGE SYSTEM  v38.15
   
   Version-aware badge visibility.
   
   Rules:
   - CURRENT_VERSION is the build identifier (semver-like)
   - NEW_BADGE_WINDOW = 4 minor versions back from current
   - Each badge carries data-since="vXX.YY"
   - Badges whose since-version is older than the window → hidden
   - SAFETY / ONE-SHOT / other typed badges are NEVER hidden
     (they are not "NEW" indicators, they are category labels)
   - Tooltip text set from data-tooltip attribute
   
   VERSION FORMAT: "v38.15" → major=38, minor=15
   Window: show if minor >= (current_minor - NEW_BADGE_WINDOW)
════════════════════════════════════════════════════════════ */

const CURRENT_BUILD = 'v38.20';
const APP_VERSION   = '1.0.0';
const BUILD_NUMBER  = '38.20';
const RELEASE_CHANNEL = 'Beta';
const NEW_BADGE_WINDOW = 4; /* show NEW for last N minor versions */

function parseBuildVersion(str){
  /* "v38.15" → {major:38, minor:15} */
  const m = (str||'').match(/v(\d+)\.(\d+)/);
  return m ? { major: parseInt(m[1]), minor: parseInt(m[2]) } : null;
}

function applyNewBadges(){
  const current = parseBuildVersion(CURRENT_BUILD);
  if(!current) return;

  document.querySelectorAll('.feat-badge[data-since]').forEach(badge => {
    const since = parseBuildVersion(badge.dataset.since);
    if(!since) return;

    const type = badge.dataset.type || 'new'; /* 'new' | 'safety' | 'action' */

    /* SAFETY and ACTION badges are category labels — always visible, never hidden */
    if(type === 'safety' || type === 'action'){
      badge.classList.remove('hidden');
      return;
    }

    /* NEW badge: visible only within the window */
    const sameMajor = since.major === current.major;
    const inWindow  = sameMajor && (since.minor >= current.minor - NEW_BADGE_WINDOW);
    const future    = since.minor > current.minor; /* defensive: hide if somehow future */

    if(inWindow && !future){
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
}

/* ══════════════════════════════════════════════════════════
   MENU ACTIONS — standalone handlers with direct dialog calls.
   These do NOT depend on _isTauri() or _nativeSaveDialog().
   They import @tauri-apps/plugin-dialog directly at call time.
══════════════════════════════════════════════════════════ */

async function menuSaveAs(){
  try {
    const dlg = await import('@tauri-apps/plugin-dialog');
    const dd=String(selDate.getDate()).padStart(2,'0'), mm=String(selDate.getMonth()+1).padStart(2,'0'), yyyy=selDate.getFullYear();
    const path = await dlg.save({ title:'Save Project As', defaultPath:'SPICA TIDE Project - '+dd+'.'+mm+'.'+yyyy+'.json', filters:[{name:'SPICA Project',extensions:['json']}] });
    if(!path) return;
    const envelope = _buildEnvelope();
    await window.__TAURI__.core.invoke('write_file', { path, contents: JSON.stringify(envelope,null,2) });
    _currentFilePath = path;
    _updateWindowTitle(path);
    LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
    _markSaved();
    showToast('Saved \u2014 ' + path.split(/[/\\]/).pop(), 'ok');
  } catch(e){
    console.error('[SaveAs]', e);
    showToast('Save As failed: '+(e&&e.message||e), 'warn');
  }
}

async function menuSave(){
  if(_currentFilePath){
    try {
      const envelope = _buildEnvelope();
      await window.__TAURI__.core.invoke('write_file', { path: _currentFilePath, contents: JSON.stringify(envelope,null,2) });
      LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
      _markSaved();
      showToast('Saved \u2014 ' + _currentFilePath.split(/[/\\]/).pop(), 'ok');
    } catch(e){ showToast('Save failed: '+(e&&e.message||e),'warn'); }
  } else {
    menuSaveAs();
  }
}

async function menuExportPDF(){
  try {
    const dlg = await import('@tauri-apps/plugin-dialog');
    const dd=String(selDate.getDate()).padStart(2,'0'), mm=String(selDate.getMonth()+1).padStart(2,'0'), yyyy=selDate.getFullYear();
    const path = await dlg.save({ title:'Export PDF', defaultPath:'SPICA TIDE Deck Plan - '+dd+'.'+mm+'.'+yyyy+'.pdf', filters:[{name:'PDF Document',extensions:['pdf']}] });
    if(!path) return;
    window._pendingPdfPath = path;
    exportPDF();
  } catch(e){
    console.error('[ExportPDF]', e);
    showToast('PDF export failed: '+(e&&e.message||e),'warn');
  }
}

async function menuExportExcel(){
  try {
    const dlg = await import('@tauri-apps/plugin-dialog');
    const dd=String(selDate.getDate()).padStart(2,'0'), mm=String(selDate.getMonth()+1).padStart(2,'0'), yyyy=selDate.getFullYear();
    const path = await dlg.save({ title:'Export Excel', defaultPath:'SPICA TIDE Manifest - '+dd+'.'+mm+'.'+yyyy+'.xlsx', filters:[{name:'Excel Spreadsheet',extensions:['xlsx']}] });
    if(!path) return;
    window._pendingXlsxPath = path;
    exportExcel();
  } catch(e){
    console.error('[ExportExcel]', e);
    showToast('Excel export failed: '+(e&&e.message||e),'warn');
  }
}

async function menuOpen(){
  try {
    const dlg = await import('@tauri-apps/plugin-dialog');
    const selected = await dlg.open({ title:'Open Project', filters:[{name:'SPICA Project',extensions:['json','spica']}], multiple:false });
    if(!selected) return;
    const filePath = typeof selected === 'string' ? selected : selected.path;
    const contents = await window.__TAURI__.core.invoke('read_file', { path: filePath });
    _applyProjectData(contents, filePath.split(/[/\\]/).pop());
    _currentFilePath = filePath;
    _updateWindowTitle(filePath);
  } catch(e){
    console.error('[Open]', e);
    showToast('Open failed: '+(e&&e.message||e),'warn');
  }
}

/* ══════════════════════════════════════════════════════════
   MENU BAR — Desktop application menu wiring
══════════════════════════════════════════════════════════ */
function bindMenuBar(){
  const menubar = document.getElementById('menubar');
  if(!menubar) return;

  let openMenu = null;

  function closeAll(){ if(openMenu){ openMenu.classList.remove('open'); openMenu = null; } }

  /* Open/close menu — only when clicking the label, not dropdown children */
  menubar.querySelectorAll('.menu-item').forEach(item => {
    const label = item.querySelector('.menu-label');
    label.addEventListener('click', e => {
      e.stopPropagation();
      if(item === openMenu){ closeAll(); }
      else { closeAll(); item.classList.add('open'); openMenu = item; }
    });
    /* Hover-switch when a menu is already open */
    item.addEventListener('mouseenter', () => {
      if(openMenu && openMenu !== item){
        openMenu.classList.remove('open');
        item.classList.add('open');
        openMenu = item;
      }
    });
  });

  /* Close on outside click */
  document.addEventListener('click', e => {
    if(openMenu && !menubar.contains(e.target)) closeAll();
  });

  /* Action dispatch — uses module-level menu* functions */
  const actions = {
    newDeck:       () => { S.cargo=[]; _currentFilePath=null; _updateWindowTitle(null); renderAll(); updateStats(); buildActiveLocStrip(); updateDGSummary(); save(); showToast('New deck plan','ok'); },
    openProject:   () => menuOpen(),
    saveProject:   () => menuSave(),
    saveProjectAs: () => menuSaveAs(),
    exportPDF:     () => menuExportPDF(),
    exportExcel:   () => menuExportExcel(),
    exportJSON:    () => menuSaveAs(),
    exit:          () => { try{ window.close(); }catch(e){} },
    undo:          () => undo(),
    redo:          () => redo(),
    deleteSelected:() => { if(typeof KB_SEL!=='undefined' && KB_SEL){ const idx=S.cargo.findIndex(c=>c.id===KB_SEL); if(idx>=0){S.cargo.splice(idx,1);renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();} } },
    zoomIn:        () => applyZoom(zoomLevel+0.1),
    zoomOut:       () => applyZoom(zoomLevel-0.1),
    zoomReset:     () => applyZoom(1.0),
    zoomFit:       () => fitToScreen(),
    toggleLibrary: () => cpToggle(),
    about:         () => document.getElementById('aboutOverlay').classList.add('open'),
  };

  /* Wire each menu action — click fires the action and closes the menu */
  menubar.querySelectorAll('.menu-action').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const action = el.dataset.action;
      closeAll();
      if(actions[action]) actions[action]();
    });
  });
}

/* ══════════════════════════════════════════════════════════
   ABOUT MODAL
══════════════════════════════════════════════════════════ */
function bindAboutModal(){
  const ov = document.getElementById('aboutOverlay');
  if(!ov) return;
  document.getElementById('aboutClose').addEventListener('click', () => ov.classList.remove('open'));
  ov.addEventListener('click', e => { if(e.target === ov) ov.classList.remove('open'); });
}

function init(){
  bindMenuBar();
  bindAboutModal();
  bindThemeToggle();   /* apply saved theme immediately, before any render */
  initResponsiveHeader();  /* apply body.hdr-compact / body.hdr-tight */
  bindSmartTools();        /* load and apply smart tool settings */
  bindLangSwitch();        /* restore and apply saved language */
  bindDGAutoCheck();       /* DG Auto-Segregation Check modal controls */
  applyNewBadges();        /* version-aware NEW badge visibility */
  setupCanvas();load();
  /* Initialise dynamic colour assignments for restored active locations */
  initDynColors();
  buildActiveLocStrip();buildLocGrid();buildCargoList();buildDGList();
  bindTabs();bindStatusBtns();bindModal();bindDGPicker();bindCustomForm();bindLibPanel();
  bindLocsPanel();bindLocDrawer();bindLocDeleteDlg();bindDatePicker();
  bindAscoUpload();
  bindSaveAs();
  bindClearDeck();
  bindVoyageRemarks();
  bindModalExtensions();
  bindManifestMatch();
  cpBind();
  bindKeyboardNav();
  bindAdmin();
  buildQueueList();
  cpUpdateBadge();
  /* btnClr is now remapped to the premium Clear Deck modal via bindClearDeck() */
  /* csearch is now a hidden stub — search lives in cp panel */
const _csearchEl = document.getElementById('csearch');
if(_csearchEl) _csearchEl.oninput = ()=>{};
  document.getElementById('voyIn').oninput=save;
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      cancelPending();
      closeAscoModal();
      if(typeof kbDeselect==='function') kbDeselect();
      /* Clear location filter if active */
      if(LOC_FILTER) clearLocFilter();
    }
  });
  renderAll();updateStats();updateDGSummary();initZoom();

  /* ── Session recovery toast ── */
  if(S.cargo.length > 0){
    setTimeout(() => showToast('Previous session restored', 'ok'), 400);
  }

  /* ── Periodic autosave (every 15 seconds, respects toggle) ── */
  setInterval(() => {
    if(!_autosaveEnabled) return;
    save();
    _flashAutosave();
  }, 15000);

  /* ── Autosave toggle + save state indicator ── */
  bindAutosaveToggle();
  _updateSaveIndicator();
}

function _flashAutosave(){
  if(!_autosaveEnabled) return;
  let el = document.getElementById('autosaveIndicator');
  if(!el){
    el = document.createElement('div');
    el.id = 'autosaveIndicator';
    el.className = 'autosave-indicator';
    el.textContent = 'Autosaved \u2713';
    document.body.appendChild(el);
  }
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
  /* Briefly show "Autosaved" in header indicator */
  _showSaveState('autosaved');
  setTimeout(() => _updateSaveIndicator(), 2500);
}

/* ── Save state indicator ──────────────────────────────── */
function _updateSaveIndicator(){
  _showSaveState(_dirty ? 'unsaved' : 'saved');
}

function _showSaveState(state){
  const dot  = document.querySelector('.save-dot');
  const text = document.getElementById('saveStateText');
  if(!dot || !text) return;
  dot.className = 'save-dot ' + state;
  if(state === 'saved')      text.textContent = 'Saved';
  else if(state === 'unsaved')  text.textContent = 'Unsaved';
  else if(state === 'autosaved') text.textContent = 'Autosaved';
}

function _markSaved(){
  _dirty = false;
  _updateSaveIndicator();
}

/* ── Manual Save (Cmd+S) — overwrite or dialog ────────── */
function saveProject(){
  if(_isTauri() && _currentFilePath){
    /* Overwrite current file silently */
    const envelope = _buildEnvelope();
    const json = JSON.stringify(envelope, null, 2);
    window.__TAURI__.core.invoke('write_file', { path: _currentFilePath, contents: json })
      .then(() => {
        LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
        _markSaved();
        showToast('Saved \u2014 ' + _currentFilePath.split(/[/\\]/).pop(), 'ok');
      })
      .catch(() => showToast('Save failed', 'warn'));
  } else {
    /* No file open yet — trigger Save As dialog */
    saveProjectAs();
  }
}

/* ── Save As (Cmd+Shift+S) — always show dialog ────────── */
async function saveProjectAs(){
  const envelope = _buildEnvelope();
  const json = JSON.stringify(envelope, null, 2);
  const dd = String(selDate.getDate()).padStart(2,'0');
  const mm = String(selDate.getMonth()+1).padStart(2,'0');
  const yyyy = selDate.getFullYear();
  const fileName = 'SPICA TIDE Project - ' + dd + '.' + mm + '.' + yyyy + '.json';

  if(_isTauri()){
    const targetPath = await _nativeSaveDialog(fileName, 'SPICA Project', ['json']);
    if(!targetPath) return;
    try {
      await window.__TAURI__.core.invoke('write_file', { path: targetPath, contents: json });
      _currentFilePath = targetPath;
      _updateWindowTitle(targetPath);
      _addToRecent(targetPath, envelope.name);
      LocalStorageAdapter.save(PLAN_DEFAULT_KEY, envelope);
      _markSaved();
      showToast('Saved \u2014 ' + targetPath.split(/[/\\]/).pop(), 'ok');
    } catch(e){
      showToast('Save failed: ' + (e && e.message || e), 'warn');
    }
  } else {
    /* Browser: Blob download */
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
    _markSaved();
    showToast('Saved \u2014 ' + fileName, 'ok');
  }
}

/* ── Autosave toggle ──────────────────────────────────── */
function bindAutosaveToggle(){
  const btn = document.getElementById('autosaveToggle');
  if(!btn) return;
  /* Restore from localStorage */
  const stored = localStorage.getItem('spicaTide_autosave');
  if(stored === 'off'){
    _autosaveEnabled = false;
    btn.classList.remove('on');
    btn.title = 'Autosave Off';
  }
  btn.addEventListener('click', () => {
    _autosaveEnabled = !_autosaveEnabled;
    btn.classList.toggle('on', _autosaveEnabled);
    btn.title = _autosaveEnabled ? 'Autosave On' : 'Autosave Off';
    localStorage.setItem('spicaTide_autosave', _autosaveEnabled ? 'on' : 'off');
    if(_autosaveEnabled) showToast('Autosave enabled', 'ok');
    else showToast('Autosave disabled', 'ok');
  });
}

init();
