/* ════════════════════════════════════════════════════════════
   SPICA TIDE — Deck Cargo Planning Application
   Bundled as ES module for Vite/Tauri.
   Original monolith: source/v1_current/source:v1_current.html
════════════════════════════════════════════════════════════ */

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import * as Sync from './sync.js';
import { invoke } from '@tauri-apps/api/core';
import { FEATURE_BADGE_REGISTRY } from './badgeRegistry.js';
import { RELEASE_NOTES } from './releaseNotes.js';
import { animateModalIn, animateModalOut, bindSwipeDismiss, bindEscapeDismiss, isModalActionable, getModalState } from './animations/modal.js';
import { bindHoldToConfirm } from './animations/holdToConfirm.js';
import { interRegularB64, interBoldB64, manropeExtraBoldB64, jetBrainsMonoRegularB64, jetBrainsMonoMediumB64 } from './inter-fonts.js';
import { flipLayout } from './animations/locations.js';
import { animateLangDropdownIn, animateLangDropdownOut, getLangState } from './animations/langDropdown.js';
import { animateLocPickerIn, animateLocPickerOut, getLocPickerState } from './animations/locPicker.js';
import { animate as motionAnimate } from 'motion';
/* Phase W5/W6 — weather orchestrator + presets. ESM imports are
   hoisted; placed here alongside the other top-level imports for
   convention. Used by the Phase W1 weather block (~line 12462). */
import { wxScene, _FALLBACK_MAP as _WX_FALLBACK_MAP } from './weather/index.js';
import { DEFAULT_CONDITION } from './weather/presets.js';
/* Phase W6 — Open-Meteo data layer (api.js, location.js, autoRefresh.js)
   plus the Meteocons icon URL map. Aliased on import to keep call sites
   readable (e.g. _wxSetLocation rather than `setLocation`, which is too
   generic in app.js scope). */
import { searchCities } from './weather/api.js';
import { iconForCondition } from './weather/iconMap.js';
import {
  setLocation             as _wxSetLocation,
  getLocation             as _wxGetLocation,
  hydrate                 as _wxLocHydrate,
  resolveInitialLocation  as _wxResolveInitialLocation,
  onLocationChange,
} from './weather/location.js';
import {
  start            as _wxAutoStart,
  refreshNow       as _wxRefreshNow,
  getCachedWeather as _wxGetCached,
  onWeatherChange,
} from './weather/autoRefresh.js';

/* ════════════════════════════════════════════════════════════
   OPERATOR / VIEWER MODE
   Two-tier access: Operator (full edit) and Viewer (read-only).
   Persists across restarts via localStorage.
════════════════════════════════════════════════════════════ */
let _currentMode = localStorage.getItem('spicaTideOperatorMode') || 'viewer';
function isOperator(){ return _currentMode === 'operator'; }
function setMode(mode){
  _currentMode = mode;
  localStorage.setItem('spicaTideOperatorMode', mode);
  applyModeUI();
}
/* Expose viewer check for sync.js (ES module — avoids import coupling) */
window.__spicaIsViewer = () => !isOperator();

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
    subtitle: 'PSV · SPICA TIDE · NEO Energy · North Sea',
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

/* ── Apply Operator/Viewer mode to all UI elements ── */
function applyModeUI(){
  const op = isOperator();
  const btn = document.getElementById('modeBtn');
  const labelEl = document.getElementById('modeLbl');
  const banner = document.getElementById('viewerBanner');
  /* Body class drives subtle viewer indicator in the bottom status bar
     (see .bp-viewer-indicator CSS). Replaces the old fixed banner. */
  document.body.classList.toggle('is-viewer', !op);
  if(btn){
    btn.classList.toggle('mode-operator', op);
    btn.classList.toggle('mode-viewer', !op);
    btn.setAttribute('aria-label', op
      ? 'Operator mode active. Click or press Enter to switch to viewer.'
      : 'Viewer mode active. Click or press Enter to switch to operator.');
  }
  /* Role text row in brand block. Accent bar (.brand-accent) carries the
     coloured state cue; this label spells it out. Preserve the trailing
     .brand-role-hint span (hover-only ⇄ glyph) — textContent= would wipe it. */
  if(labelEl){
    const hint = labelEl.querySelector('.brand-role-hint');
    labelEl.textContent = op ? 'OPERATOR MODE' : 'VIEWER MODE';
    if(hint) labelEl.appendChild(hint);
  }
  /* NEW badge on mode button — purely additive, no-op if expired */
  if(btn){
    const oldBadge = btn.querySelector('.feature-badge');
    if(oldBadge) oldBadge.remove();
    if(shouldShowBadge('operatorViewerMode')) btn.appendChild(renderBadge());
  }
  if(banner) banner.style.display = op ? 'none' : '';

  /* Disable / enable destructive mutation controls only.
     Smart Tools is a settings panel (hover motion, grid snap, shortcuts,
     sound, weight gauge etc.) — none of its toggles mutate cargo. It must
     remain accessible in Viewer mode. Only Clear Deck is truly destructive. */
  const mutBtns = ['btnClrDeck'];
  mutBtns.forEach(id => {
    const el = document.getElementById(id);
    if(el){ el.classList.toggle('mode-disabled', !op); el.style.pointerEvents = op ? '' : 'none'; el.style.opacity = op ? '' : '0.4'; }
  });
  /* Defensive: ensure Smart Tools button is always enabled in case a prior
     Viewer session left pointerEvents/opacity set inline. */
  const st = document.getElementById('btnSmartTools');
  if(st){ st.classList.remove('mode-disabled'); st.style.pointerEvents = ''; st.style.opacity = ''; }

  /* Re-render cargo blocks to show/hide handles */
  if(typeof renderAll === 'function') renderAll();
}

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

/* ── Apply brand labels to DOM on load ──
   Brand name rendered as two colored spans (first word + rest). No icon. */
function applyBrandLabels(){
  const el = {
    name: document.getElementById('brandName'),
    dcp:  document.getElementById('brandDcp'),
    sub:  document.getElementById('brandSub'),
  };
  if(el.name){
    const name = (SPICA_CONFIG.BRAND.name || '').trim();
    const parts = name.split(/\s+/);
    el.name.innerHTML = '';
    const first = document.createElement('span');
    first.className = 'brand-spica';
    first.textContent = parts[0] || '';
    el.name.appendChild(first);
    if(parts.length > 1){
      el.name.appendChild(document.createTextNode(' '));
      const rest = document.createElement('span');
      rest.className = 'brand-tide';
      rest.textContent = parts.slice(1).join(' ');
      el.name.appendChild(rest);
    }
  }
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

  /* (syncBrandCol removed — the left-side is now a compact icon + zoom
     control hub; it no longer needs to occupy the brand column width.) */
}

/* ════════════════════════════════════
   CONSTANTS
════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════
   PHYSICAL DECK GEOMETRY — SPICA TIDE · AUTHORITATIVE · LOCKED
   ─────────────────────────────────────────────────────────────────────
   Single source of truth for longitudinal deck coordinates.

   The deck is an alternating sequence of cargo bays and steel deck
   joints. Bays are the planning slots; joints are real 0.15 m wide
   structural plates separating adjacent bays. Previously the joints
   were modelled as zero-width dividers — that introduced cumulative
   measurement error across the full deck length. This is the
   corrected, measured geometry.

   ─────────────────────────────────────────────────────────────────────
   BAY_LENGTHS_M — FINAL MEASURED VALUES, VISUAL RENDER ORDER
   ─────────────────────────────────────────────────────────────────────

   Orientation (do not flip):
     Index 0  = Bay 12  (LEFT  / aft  / stern)
     Index 11 = Bay 1   (RIGHT / bow  / fore)

   Array walks the deck from aft/stern to bow/fore, i.e. left→right
   on screen:

     Bay 12 → Bay 11 → Bay 10 → Bay 9 → Bay 8 → Bay 7 →
     Bay 6  → Bay 5  → Bay 4  → Bay 3 → Bay 2 → Bay 1

   Final measured values (metres):
     Bay 12 = 4.15
     Bay 11 = 4.04
     Bay 10 = 4.75
     Bay 9  = 4.03
     Bay 8  = 4.75
     Bay 7  = 4.76
     Bay 6  = 4.04
     Bay 5  = 4.75
     Bay 4  = 4.02
     Bay 3  = 4.75
     Bay 2  = 4.76
     Bay 1  = 4.47

   Steel joints: 11 joints × 0.15 m each = 1.65 m
   Sum of bays:                            53.27 m
   Total measured deck length:             54.92 m

   ─────────────────────────────────────────────────────────────────────
   ⚠  WARNING — DO NOT REORDER THIS ARRAY NUMERICALLY FROM BAY 1 → 12.
       It is intentionally stored in visual RENDER order from
       Bay 12 (aft, left) to Bay 1 (bow, right). Reordering will break
       the canvas layout, snap logic, bay-number lookup, zones, the
       Methanol curve, the DG limit line, PDF/Excel exports, and every
       cargo position stored in pixels.
   ⚠  DO NOT hardcode the old total deck length (53.7 m) or the old
       canvas width (1651 px) anywhere. Those values predate this
       measured geometry and are archaeologically wrong.
   ─────────────────────────────────────────────────────────────────────
═══════════════════════════════════════════════════════════════════════ */
const M = 31;                                    /* px per metre */
const ft = f => Math.round(f * 0.3048 * M);      /* feet → px helper (legacy) */
const JOINT_WIDTH_M = 0.15;                      /* structural joint between bays */
const BAY_LENGTHS_M = [
  4.15, // [0]  Bay 12  (aft / stern / left)
  4.04, // [1]  Bay 11
  4.75, // [2]  Bay 10
  4.03, // [3]  Bay 9
  4.75, // [4]  Bay 8
  4.76, // [5]  Bay 7
  4.04, // [6]  Bay 6
  4.75, // [7]  Bay 5
  4.02, // [8]  Bay 4
  4.75, // [9]  Bay 3
  4.76, // [10] Bay 2
  4.47, // [11] Bay 1  (bow / fore / right)
];
const BAY_COUNT  = BAY_LENGTHS_M.length;
const JOINT_PX   = Math.round(JOINT_WIDTH_M * M); /* ≈ 5 px at M=31 */

/* Pixel-width array, same indexing as BAY_LENGTHS_M. */
const BW = BAY_LENGTHS_M.map(m => Math.round(m * M));

/* Cumulative bay-left-edge positions in px. Each bay starts after the
   previous bay's pixel width PLUS one joint width. Joint lives in the
   gap between BL_[i]+BW[i] and BL_[i+1]. */
const BL_ = (() => {
  const out = [];
  let x = 0;
  for(let i = 0; i < BAY_COUNT; i++){
    out.push(x);
    x += BW[i];
    if(i < BAY_COUNT - 1) x += JOINT_PX;
  }
  return out;
})();

/* Total deck canvas width in px — includes every bay and every joint. */
const TW = BL_[BAY_COUNT - 1] + BW[BAY_COUNT - 1];

/* Total measured deck length in metres (for readouts / exports). */
const DECK_LENGTH_M = BAY_LENGTHS_M.reduce((a,b) => a + b, 0)
                    + (BAY_COUNT - 1) * JOINT_WIDTH_M;

/* Bay index lookup — returns the index into BW/BL_/BAY_LENGTHS_M for a
   given x coordinate in pixels. Accounts for joint gaps: an x that
   falls inside a joint is reported as the bay to its LEFT (the bay
   whose right edge is the joint's left edge). Returns -1 for x < 0.
   Out-of-range x past the deck is clamped to the last bay. */
function bayIndexFromX(x){
  if(x < 0) return -1;
  for(let i = 0; i < BAY_COUNT; i++){
    const start = BL_[i];
    const end   = start + BW[i];
    if(x < end) return i;
    /* x falls in the joint after this bay — attribute to this bay. */
    const jointEnd = end + (i < BAY_COUNT - 1 ? JOINT_PX : 0);
    if(x < jointEnd) return i;
  }
  return BAY_COUNT - 1;
}

/* ═══════════════════════════════════════════════════════════════════════
   FINAL SCALE MODEL — metres vs pixels
   ─────────────────────────────────────────────────────────────────────
   1) CARGO DIMENSIONS (size)
      Cargo size is stored in metres: cargo.length_m / cargo.width_m.
      Rendered cargo pixel size is derived from those metres:
        cargo.w = m2px_w(length_m) = round(length_m × M)
        cargo.h = m2px_h(width_m)  = round(width_m  × YS)   (YS = CVH/15)
      Metres are the single source of truth for cargo size. The pixel
      cache on cargo.w/cargo.h always falls back to m2px_* if missing.

   2) CARGO / DECK POSITION READOUTS (where something is)
      Physical X position MUST use deckXToMeters(xPx).
      Physical Y position MUST use deckYToMeters(yPx).
      Never use raw `xPx / M` for a full-deck or physical-position
      readout: the deck's longitudinal geometry is an alternating
      sequence of bays and 0.15 m joints whose per-segment pixel widths
      are rounded independently. A naive `xPx / M` across multiple
      segments accumulates rounding drift (~+0.18 m across the full
      deck). `deckXToMeters` walks BAY_LENGTHS_M + JOINT_WIDTH_M and
      interpolates proportionally within the segment the pixel lands
      in, so it reports the true physical model metres.
      (For Y the scale is uniform, so `yPx / YS` is equivalent to
      `deckYToMeters(yPx)`. The helper exists for symmetry and explicit
      naming.)

   3) RULER TOOL
      The ruler MUST use deckXToMeters() and deckYToMeters() so it
      reports the physical vessel model, not accumulated pixel
      rounding. Cross-surface consistency: the status bar, the
      keyboard coord tip, and the ruler all read the same underlying
      model metres and agree at the same pixel.

   4) WHERE `/M` (RAW DIVISION) IS STILL ACCEPTABLE
      Only for LOCAL cargo size rendering — i.e. reading cargo.w back
      to metres inside inspector/export code. Cargo pixel size is
      directly derived from length_m via `round(length_m × M)`, so
      `cargo.w / M ≈ length_m` with at most 1 px rounding inside a
      single cargo block. Do NOT use `/M` for full-deck measurements,
      position readouts, or ruler math — use deckXToMeters().
═══════════════════════════════════════════════════════════════════════ */

/* Pixel-X → physical metres along the deck.
   Walks the real alternating bay/joint segments from the BAY_LENGTHS_M
   + JOINT_WIDTH_M source of truth, interpolating PROPORTIONALLY within
   whichever segment the pixel lands in. This reports the true physical
   metre offset a click represents, without inheriting the pixel-grid
   rounding drift that accumulates when you naively divide `xPx / M`
   across the full deck. Used by the ruler tool so full-deck
   measurements read 54.92 m exact instead of the 55.06 m pixel sum.   */
function deckXToMeters(xPx){
  if(xPx <= 0) return 0;
  if(xPx >= TW) return DECK_LENGTH_M;
  let pxCursor = 0;
  let mCursor  = 0;
  for(let i = 0; i < BAY_COUNT; i++){
    const bayPx = BW[i];
    const bayM  = BAY_LENGTHS_M[i];
    if(xPx <= pxCursor + bayPx){
      const t = bayPx > 0 ? (xPx - pxCursor) / bayPx : 0;
      return mCursor + t * bayM;
    }
    pxCursor += bayPx;
    mCursor  += bayM;
    if(i < BAY_COUNT - 1){
      if(xPx <= pxCursor + JOINT_PX){
        const t = JOINT_PX > 0 ? (xPx - pxCursor) / JOINT_PX : 0;
        return mCursor + t * JOINT_WIDTH_M;
      }
      pxCursor += JOINT_PX;
      mCursor  += JOINT_WIDTH_M;
    }
  }
  return DECK_LENGTH_M;
}

/* Pixel-Y → physical metres across the deck. The vertical scale is a
   single uniform ratio (no segmentation), so this is a plain division.
   Full deck (y = CVH) returns exactly 15.00 m. Exposed as a helper so
   the ruler and any future consumer can use symmetric naming with
   deckXToMeters and never compute coordinates inline. */
function deckYToMeters(yPx){
  return Math.max(0, Math.min(CVH, yPx)) / (CVH / 15);
}

const CVH = 380, YS = CVH / 15;

/* Deck usable area in px² — total canvas minus permanent exclusion zones.
   Zone pixel sizes are from the actual rendered geometry. */
const DECK_USABLE_AREA_PX = TW * CVH
  - (124 * 95)    /* Store PORT bow */
  - (157 * 55)    /* Hose Bay PORT */
  - (258 * 55)    /* Hose Bay STBD */
  - (90 * 60)     /* Ship's Waste Skip */
  - (20 * CVH);   /* Bay 12 stern tiger zone */

/* px² → m² conversion factor: M (px/m along deck) × YS (px/m across deck) */
const PX2_TO_M2 = M * YS;  /* ≈ 785.23 */

/* Deck usage animation state — shared across updateStats calls */
const _du = {
  prevPct: -1,              /* last displayed integer % (for threshold crossing) */
  prevThreshold: '',        /* last threshold class name */
  rafId: 0,                 /* in-flight rAF animation ID */
  displayedPct: 0,          /* current displayed value (float during animation) */
};

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
  {id:'BLEO',      name:'Bleo Holm',      c:'#9aa0a8', fixed:true, type:'fpso'},
  /* Claymore group — violet/purple/indigo family */
  {id:'CLAY_CAP',  name:'Claymore CAP',   c:'#7c3aed', grp:'clay', type:'platform'},
  {id:'CLAY_CPP',  name:'Claymore CPP',   c:'#6326b5', grp:'clay', type:'platform'},
  {id:'CLAY_WOP',  name:'Claymore WOPS',  c:'#9333ea', grp:'clay', type:'platform'},
  {id:'CLAY_DRL',  name:'Claymore Drill', c:'#4338ca', grp:'clay', type:'platform'},
  /* Piper group — amber/brown/orange family (distinguishable trio) */
  {id:'PIPER',     name:'Piper',          c:'#c27b00', grp:'piper', type:'platform'},
  {id:'PIPER_DR',  name:'Piper Drilling', c:'#92400e', grp:'piper', type:'platform'},
  {id:'PIPER_WOP', name:'Piper WOPS',     c:'#d35400', grp:'piper', type:'platform'},
  /* Individuals — each gets a well-separated hue */
  {id:'SALT',      name:'Saltire',        c:'#c0392b', type:'platform'},  // strong red
  {id:'TART',      name:'Tartan',         c:'#1d4ed8', type:'platform'},  // strong blue
  {id:'BEAT',      name:'Beatrice',       c:'#be185d', type:'platform'},  // deep pink
  {id:'CLYDE',     name:'Clyde',          c:'#0e7490', type:'platform'},  // teal
  {id:'FULMAR',    name:'Fulmar',         c:'#1a6db5', type:'platform'},  // ocean blue
  {id:'AUK',       name:'Auk',            c:'#1e8449', type:'platform'},  // forest green
  {id:'MONTR',     name:'Montrose',       c:'#6b7a00', type:'platform'},  // olive
  {id:'ARBR',      name:'Arbroath',       c:'#148f6e', type:'platform'},  // teal-green
  {id:'GP3',       name:'GP3',            c:'#e67e22', type:'fpso'},  // warm orange
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

/* ──────────────────────────────────────────────────────────────
   SINGLE SOURCE OF TRUTH — operation palette.
   The same colour drives pills, deck cargo fill, and any indicator
   showing an operation (L / BL / ROB / TR). Change here → changes
   everywhere. No independent colour generation anywhere else.
   ────────────────────────────────────────────────────────────── */
const OP_HEX = {
  L:   '#7c3aed',   // purple
  BL:  '#eab308',   // yellow / amber
  ROB: '#16a34a',   // green
  TR:  '#3b82f6',   // blue
};

/* ── Per-(location, status) colour cache ─────────────────────────
   Instead of every LOAD being purple / every ROB being green, each
   (location, status) pair receives its own palette entry chosen to
   maximise distance from ALL other active pairs currently on the
   deck. Result: two ROBs from different locations are always
   visibly different.
   BLEO + LOAD is a fixed business override (always grey) and is
   excluded from the cache / palette pool.                         */
const CARGO_COLORS = {};   // key `${locId}|${status}` → { h: hex, palEntry: PALETTE_POOL item }

function _cargoPairsInUse(excludeKey){
  /* Iterate the persistent assignment map (not S.cargo) so a colour
     stays "in use" even after every cargo block for that pair has been
     deleted. Prevents collision when the user deletes a pair and then
     re-adds another with a different (loc,status) — the deleted pair's
     hue is still reserved by CARGO_COLORS, so the new pair is forced
     onto a different palette slot. As a side benefit, once any colour
     has been assigned the scoring loop in _assignCargoColor sees a
     non-empty usedEntries and properly maximises hue distance instead
     of degenerating to PALETTE_POOL[0].
     BLEO|L is excluded because opColor() short-circuits to fixed grey
     before reaching _assignCargoColor, so it never appears here. */
  const used = [];
  for(const k in CARGO_COLORS){
    if(k === excludeKey) continue;
    if(k === 'BLEO|L') continue;
    used.push(CARGO_COLORS[k].palEntry);
  }
  return used;
}

function _assignCargoColor(locId, status){
  const key = `${locId}|${status}`;
  if(CARGO_COLORS[key]) return CARGO_COLORS[key].h;

  const usedEntries = _cargoPairsInUse(key);
  let best = null, bestScore = -1;
  PALETTE_POOL.forEach(entry => {
    /* Skip entries already taken verbatim — forces a different slot
       while we still have unused ones. */
    if(usedEntries.some(u => u === entry)) return;
    const minDist = usedEntries.length
      ? Math.min(...usedEntries.map(u => palDist(entry, u)))
      : 999;
    if(minDist > bestScore){ bestScore = minDist; best = entry; }
  });

  /* Fallback: palette exhausted — reuse the entry with the best
     minimum distance (will still differ as much as possible from
     the closest neighbour on deck). */
  if(!best){
    PALETTE_POOL.forEach(entry => {
      const minDist = usedEntries.length
        ? Math.min(...usedEntries.map(u => palDist(entry, u)))
        : 999;
      if(minDist > bestScore){ bestScore = minDist; best = entry; }
    });
  }
  if(!best) best = PALETTE_POOL[0];
  CARGO_COLORS[key] = { h: best.h, palEntry: best };
  return best.h;
}

/* Business rule: Bleo Holm LOAD is ALWAYS grey. Everything else is
   assigned uniquely per (location, status) from the shared pool. */
function opColor(locId, status){
  if(locId === 'BLEO' && status === 'L') return '#b8bcc2';
  return _assignCargoColor(locId, status);
}

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
  seedDefaultFavs();
}

/* First-run seed for the Frequent section. Pins the five most commonly
   reached-for library items so a brand-new install doesn't show an empty
   Frequent row. Skipped entirely once the user has any saved favourites,
   so it never overwrites real prefs. */
function seedDefaultFavs(){
  if(LIB_PREFS.favs instanceof Set && LIB_PREFS.favs.size > 0) return;
  const defaults = [
    'cont_10x8',     // 10ft × 8ft Container
    'cont_mini_6',   // 6ft Mini Container
    'cont_10x8_ot',  // 10ft Open Top
    'cont_20x8',     // 20ft × 8ft Container
    'cont_10x8_hh',  // 10ft Half Height
  ];
  if(!(LIB_PREFS.favs instanceof Set)){
    LIB_PREFS.favs = new Set(Array.isArray(LIB_PREFS.favs) ? LIB_PREFS.favs : []);
  }
  defaults.forEach(k => LIB_PREFS.favs.add(k));
  saveLibPrefs();
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

const S={activeLocs:['BLEO','TART'],selLoc:'BLEO',pending:null,cargo:[],customLib:[],customLocs:[],voyRemarks:''};

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
/* ── Multi-DG migration helper ─────────────────────────────
   Converts legacy single dgClass to dgClasses array.
   Run on any cargo array after load/import.                  */
function _migrateDgClasses(cargoArr){
  if(!Array.isArray(cargoArr)) return;
  cargoArr.forEach(c => {
    if(!Array.isArray(c.dgClasses)){
      c.dgClasses = (c.dgClass && c.dgClass !== '') ? [c.dgClass] : [];
    }
    delete c.dgClass;
    /* Deduplicate & cap at 3 */
    c.dgClasses = [...new Set(c.dgClasses)].slice(0, 3);
  });
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
  /* Poisons 6.1
     NOTE: 6.1 × 8 is an X cell per UKCS Supplement §2.3 (and IMDG
     segregation table 7.2.4) — no segregation required. Previously
     stored as 1 which incorrectly displayed "1 MINI" to users. */
  '6.1': {
    '6.2':3,
    '7':1,'8':0,'9':0,
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
/* DG segregation preview during drag — refined visual.
   Engine unchanged (getSeg + SEG_FULL + segClearancePx). Only the visual
   presentation changed: class-based styling, muted palette, small corner
   badge, AND a soft halo on each infringed cargo block (via .dg-violation
   on its .cb element). Returns the count of violations so callers can
   react (e.g., visually "safe" when zero). */
function showDragSegOverlay(dragCls, excludeId){
  const ovl = document.getElementById('dgDragOverlay');
  if(!ovl) return 0;
  /* Clear previous zones + violation classes before redrawing */
  ovl.innerHTML = '';
  document.querySelectorAll('.cb.dg-violation').forEach(el => {
    el.classList.remove('dg-violation', 'dg-violation-1', 'dg-violation-2', 'dg-violation-3');
  });

  if(!dragCls) return 0;
  const dragArr = Array.isArray(dragCls) ? dragCls : (dragCls ? [dragCls] : []);
  if(dragArr.length === 0) return 0;

  let violationCount = 0;

  S.cargo.forEach(placed => {
    const placedArr = placed.dgClasses || [];
    if(placed.id === excludeId || placedArr.length === 0) return;

    /* Most restrictive level across all class pairs. */
    let level = 0;
    for(const dc of dragArr){
      for(const pc of placedArr){
        level = Math.max(level, getSeg(dc, pc));
      }
    }
    if(level < 1) return;
    violationCount++;

    /* ── Clearance zone (dotted, muted) ─────────────────────────── */
    const pad = segClearancePx(level);
    const zx  = Math.max(0,   placed.x - pad);
    const zy  = Math.max(0,   placed.y - pad);
    const zx2 = Math.min(TW,  placed.x + placed.w + pad);
    const zy2 = Math.min(CVH, placed.y + placed.h + pad);

    const z = document.createElement('div');
    z.className = 'dg-drag-zone dg-drag-zone-' + level;
    z.style.left   = zx  + 'px';
    z.style.top    = zy  + 'px';
    z.style.width  = (zx2 - zx) + 'px';
    z.style.height = (zy2 - zy) + 'px';

    /* Small corner badge — replaces the old centered pill */
    const lbl = document.createElement('span');
    lbl.className = 'dg-drag-zone-badge';
    lbl.textContent = level + ' MINI · DG ' + placedArr.join(', ');
    z.appendChild(lbl);
    ovl.appendChild(z);

    /* ── Halo on the infringed cargo block itself ──────────────── */
    const cbEl = document.querySelector(`.cb[data-id="${placed.id}"]`);
    if(cbEl){
      cbEl.classList.add('dg-violation', 'dg-violation-' + level);
    }
  });

  return violationCount;
}

function clearDragSegOverlay(){
  const ovl = document.getElementById('dgDragOverlay');
  if(ovl) ovl.innerHTML = '';
  /* Remove halos from any cargo that was marked during the drag. */
  document.querySelectorAll('.cb.dg-violation').forEach(el => {
    el.classList.remove('dg-violation', 'dg-violation-1', 'dg-violation-2', 'dg-violation-3');
  });
}

/* ════════════════════════════════════
   CANVAS
════════════════════════════════════ */
function setupCanvas(){
  const cv=document.getElementById('cvDECK');
  cv.style.width=TW+'px';
  const HB_H=Math.round(2.16*YS);

  /* Bay stripes + ghost bay-number watermarks.
     Positions come from BL_/BW which already account for the 0.15 m
     structural joints between bays, so stripes + numbers sit inside the
     real usable bay segment (not centred on equal columns). */
  BW.forEach((w, i) => {
    const x = BL_[i];
    if(i % 2 === 0){
      const s = document.createElement('div');
      s.className = 'bay-stripe';
      s.style.left  = x + 'px';
      s.style.width = w + 'px';
      cv.appendChild(s);
    }
    const bn = document.createElement('div');
    bn.className = 'bay-num';
    bn.style.cssText = `position:absolute;left:${x}px;width:${w}px;top:50%;transform:translateY(-50%);
      text-align:center;font-family:'Manrope',sans-serif;font-size:40px;font-weight:900;
      color:rgba(49,51,44,.14);pointer-events:none;z-index:1;user-select:none;line-height:1;`;
    bn.textContent = 12 - i;
    cv.appendChild(bn);
  });

  /* Bay joints — physical 0.15 m steel plates between adjacent bays.
     Rendered as real-width vertical bands (JOINT_PX wide), not hairline
     borders. There are 11 joints between 12 bays. */
  for(let i = 0; i < BAY_COUNT - 1; i++){
    const jx = BL_[i] + BW[i];  /* right edge of bay i = joint left edge */
    const jo = document.createElement('div');
    jo.className = 'bay-joint';
    jo.style.left  = jx + 'px';
    jo.style.width = JOINT_PX + 'px';
    cv.appendChild(jo);
  }

  /* Centre line + PORT/STBD */
  const cl=document.createElement('div');cl.className='center-line';cl.style.top=(CVH/2)+'px';cv.appendChild(cl);
  [{txt:'PORT ▶',top:'8px'},{txt:'STBD ▶',bottom:'8px'}].forEach(o=>{
    const el=document.createElement('div');el.className='side-lbl';
    Object.assign(el.style,o.top?{top:o.top}:{bottom:o.bottom});el.textContent=o.txt;cv.appendChild(el);
  });

  /* Zones */
  /* Aft tiger-striped reference strip. 1.00 m longitudinal length,
     positioned INSIDE Bay 12 at its aft (stern) edge. Does NOT add to
     total deck length — Bay 12 still spans 4.15 m in total. Scaled via
     m2px_w so it uses the same metre→pixel system as cargo and bays. */
  addZone(cv, 0, 0, m2px_w(1.0), CVH, 'tiger', '');
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
  dgd.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:21;';
  cv.appendChild(dgd);

  cv.addEventListener('mousedown',e=>{
    /* Never interfere with clicks on existing cargo — those have their own handlers */
    if(e.target.closest('.cb')) return;
    /* Pending placement wins over marquee — if a library card is pending,
       a click on the deck is a deliberate place-at action. */
    if(S.pending){
      e.preventDefault();
      const r=cv.getBoundingClientRect();
      placeAt((e.clientX-r.left)/zoomLevel,(e.clientY-r.top)/zoomLevel);
      return;
    }
    /* Phase 4 — empty-deck mousedown starts a potential marquee. Below a
       4px movement threshold the gesture collapses to the original
       "click empty space = deselect" behaviour. */
    _marqueeStart(e, cv);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 4 — MARQUEE SELECTION on the deck canvas.
   Click-drag on empty deck → rectangle → any cargo intersecting it on
   release joins the selection set. Shift: additive. No shift: replaces.
   Below 4px of movement, falls through to kbDeselect() so the existing
   empty-deck-click = deselect gesture is preserved pixel-for-pixel.
══════════════════════════════════════════════════════════════════════ */
function _marqueeStart(startEv, cv){
  if(!cv) return;
  const cr = cv.getBoundingClientRect();
  const sx = (startEv.clientX - cr.left) / zoomLevel;
  const sy = (startEv.clientY - cr.top)  / zoomLevel;
  const shiftHeld = startEv.shiftKey === true;

  let rectEl = null;
  let moved  = false;

  const updateRect = (cx, cy) => {
    const x0 = Math.min(sx, cx), x1 = Math.max(sx, cx);
    const y0 = Math.min(sy, cy), y1 = Math.max(sy, cy);
    rectEl.style.left   = x0 + 'px';
    rectEl.style.top    = y0 + 'px';
    rectEl.style.width  = (x1 - x0) + 'px';
    rectEl.style.height = (y1 - y0) + 'px';
  };

  const onMove = ev => {
    if(!moved){
      if(Math.abs(ev.clientX - startEv.clientX) < 4
      && Math.abs(ev.clientY - startEv.clientY) < 4) return;
      moved = true;
      rectEl = document.createElement('div');
      rectEl.className = 'marquee-rect';
      cv.appendChild(rectEl);
      document.body.classList.add('marquee-active');
    }
    const cx = (ev.clientX - cr.left) / zoomLevel;
    const cy = (ev.clientY - cr.top)  / zoomLevel;
    updateRect(cx, cy);
  };

  const onUp = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.body.classList.remove('marquee-active');

    if(!moved){
      /* Click-only: preserve original empty-deck-click = deselect behaviour. */
      if(typeof kbDeselect === 'function') kbDeselect();
      return;
    }

    /* Final rectangle, normalised */
    const cx = (ev.clientX - cr.left) / zoomLevel;
    const cy = (ev.clientY - cr.top)  / zoomLevel;
    const x0 = Math.min(sx, cx), x1 = Math.max(sx, cx);
    const y0 = Math.min(sy, cy), y1 = Math.max(sy, cy);

    /* Intersect hit-test — any pixel overlap counts. */
    const hits = S.cargo.filter(c =>
      !(c.x + c.w < x0 || c.x > x1 || c.y + c.h < y0 || c.y > y1)
    );

    if(rectEl){ rectEl.remove(); rectEl = null; }

    /* Apply selection. Shift = additive; otherwise replace. */
    if(!shiftHeld){
      KB_SEL_SET.clear();
      document.querySelectorAll('.cb.kb-sel').forEach(el => el.classList.remove('kb-sel'));
    }
    hits.forEach(c => {
      KB_SEL_SET.add(c.id);
      const el = document.querySelector(`.cb[data-id="${c.id}"]`);
      if(el) el.classList.add('kb-sel');
    });

    /* Resolve the outcome: update primary + inspector. */
    if(KB_SEL_SET.size === 0){
      KB_SEL = null;
      if(typeof kbHideCoord === 'function') kbHideCoord();
      if(typeof inspClose === 'function') inspClose();
    } else {
      KB_SEL = Array.from(KB_SEL_SET).pop();
      if(typeof kbShowCoord === 'function') kbShowCoord(KB_SEL);
      if(typeof inspOpen === 'function') inspOpen(KB_SEL);
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
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

/* Voyage date is rolling today — re-anchor selDate to today's local calendar
   date if the day boundary has passed since last check. 5-min granularity
   is intentional: laptop sleep/wake cycles on a vessel make a one-shot
   setTimeout-to-midnight unreliable (timer fires lost on sleep). setInterval
   keeps ticking on resume, so the user sees the date roll within 5 min of
   midnight regardless of sleep state. Suppressed while the date picker is
   open so we don't override a user mid-edit. No save() — auto-rollover is
   implicit, not a user action; it shouldn't dirty autosave or create an
   undo step. Started once during init() at the bindDatePicker() call site;
   interval lifetime = page lifetime (Tauri reload destroys JS context). */
function _rollDateToTodayIfNeeded(){
  const calPopup = document.getElementById('calPopup');
  if(calPopup && calPopup.classList.contains('open')) return;
  const now = new Date();
  if(selDate.getFullYear() === now.getFullYear() &&
     selDate.getMonth()    === now.getMonth() &&
     selDate.getDate()     === now.getDate()) return;
  selDate = now;
  setDateDisplay();
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
    const el=document.createElement('div');
    el.className='loc-opt'+(inUse?' in-use':'');

    const locType=(loc.type||'platform');
    const iconSvg=locType==='fpso'
      ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 10 L2.5 12.5 L13.5 12.5 L14.5 10 Z"/><rect x="5" y="7" width="2" height="3"/><rect x="8" y="6" width="2" height="4"/><line x1="11" y1="10" x2="11" y2="7"/><line x1="10.5" y1="7.5" x2="11.5" y2="7.5"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="11" height="2.5"/><line x1="4" y1="8.5" x2="4" y2="14"/><line x1="12" y1="8.5" x2="12" y2="14"/><line x1="8" y1="8.5" x2="8" y2="14"/><polyline points="6,6 6,3 10,3 10,6"/><line x1="8" y1="3" x2="8" y2="1.5"/></svg>';

    const customTag=isCustom?`<div class="loc-opt-custom-tag">custom</div>`:'';
    const chk=`<div class="loc-opt-chk">✓</div>`;
    el.innerHTML=`
      <div class="loc-opt-icon">${iconSvg}</div>
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
  if(!isOperator()) return;            /* Viewer: block location changes */
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
  /* Only apply visual dimming if Highlight by Platform is enabled in Smart Tools */
  if(!SMART.locHighlight){
    /* Still track selection for cargo placement, but don't dim */
    LOC_FILTER = null;
    return;
  }

  LOC_FILTER = id;

  /* Inject CSS that dims all .cb not matching the filter */
  let styleEl = document.getElementById('locFilterStyle');
  if(!styleEl){
    styleEl = document.createElement('style');
    styleEl.id = 'locFilterStyle';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent =
    `.cb:not([data-loc="${id}"]){opacity:.25;filter:saturate(0);pointer-events:none;transition:opacity .3s,filter .3s;}` +
    `.cb[data-loc="${id}"]{z-index:20;transition:opacity .3s,filter .3s;}`;

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
  const strip=document.getElementById('activeLocStrip');
  const cnt=document.getElementById('locsCount');
  cnt.textContent=S.activeLocs.length;
  if(!S.activeLocs.length){
    strip.innerHTML='<div style="display:flex;align-items:center;padding:0 20px;font-size:11px;color:var(--txt3);">No locations — click ⊕ to add</div>';
    return;
  }
  flipLayout(strip, () => {
    strip.innerHTML='';
    S.activeLocs.forEach(id=>{
      const loc=locById(id);if(!loc)return;

      /* Only deck cargo counts — not queue, not library */
      const mine=S.cargo.filter(c=>c.platform===id);

      /* Render ONLY the pills for operations that actually exist on this
         location (count > 0). No placeholder / zero pills. Card width
         follows content. Fixed operation colors (L/BL/ROB/TR) per design. */
      const statuses=[
        {key:'L',   label:'L'},
        {key:'BL',  label:'BL'},
        {key:'ROB', label:'ROB'},
        {key:'TR',  label:'TR'},
      ].map(s => ({...s, count: mine.filter(c=>c.status===s.key).length}))
       .filter(s => s.count > 0);

      const effectiveBase=getLocBase(id);
      const cols=locColors(effectiveBase,id);

      /* Card element — always rendered */
      const el=document.createElement('div');
      el.className='loc-card'+(S.selLoc===id?' sel':'');
      el.style.setProperty('--lc',effectiveBase);
      /* data-loc-id for FLIP identity + filter targeting */
      el.dataset.locId = id;

      /* Name row — dot is a color picker trigger */
      const head=document.createElement('div');
      head.className='loc-card-head';

      const icon = document.createElement('div');
      icon.className = 'loc-card-icon';
      const locType = (loc.type || 'platform');
      if (locType === 'fpso') {
        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 10 L2.5 12.5 L13.5 12.5 L14.5 10 Z"/><rect x="5" y="7" width="2" height="3"/><rect x="8" y="6" width="2" height="4"/><line x1="11" y1="10" x2="11" y2="7"/><line x1="10.5" y1="7.5" x2="11.5" y2="7.5"/></svg>';
      } else {
        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="11" height="2.5"/><line x1="4" y1="8.5" x2="4" y2="14"/><line x1="12" y1="8.5" x2="12" y2="14"/><line x1="8" y1="8.5" x2="8" y2="14"/><polyline points="6,6 6,3 10,3 10,6"/><line x1="8" y1="3" x2="8" y2="1.5"/></svg>';
      }

      const nameLbl=document.createElement('div');
      nameLbl.className='loc-card-name';
      nameLbl.textContent=loc.name;

      head.appendChild(icon);
      head.appendChild(nameLbl);

      /* Status pill strip — only present statuses */
      const pillStrip=document.createElement('div');
      pillStrip.className='loc-card-pills';

      if(statuses.length === 0){
        /* Graceful empty state — no cargo yet for this location */
        const empty = document.createElement('div');
        empty.className = 'loc-card-empty';
        empty.textContent = 'no cargo on deck';
        pillStrip.appendChild(empty);
      } else {
        statuses.forEach(s=>{
          const pill=document.createElement('div');
          pill.className='loc-pill';
          pill.dataset.status = s.key;
          const hex = opColor(id, s.key);
          try{
            const [r,g,b] = h2r(hex);
            pill.style.setProperty('--op-color', `${r},${g},${b}`);
          }catch(e){}
          pill.innerHTML=
            `<span class="loc-pill-lbl">${s.label}</span>`+
            `<span class="loc-pill-val">${s.count}</span>`;
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
    const st=getLocPickerState(drawer);
    if(st==='closed'||st==='closing'){
      buildLocGrid();
      drawer.classList.add('open');
      btn.classList.add('is-open');
      animateLocPickerIn(drawer);
    }else{
      btn.classList.remove('is-open');
      animateLocPickerOut(drawer);
    }
  });
  document.getElementById('locDrawerClose').addEventListener('click',()=>{btn.classList.remove('is-open');animateLocPickerOut(drawer);});
  document.addEventListener('click',e=>{if(!drawer.contains(e.target)&&!btn.contains(e.target)){btn.classList.remove('is-open');animateLocPickerOut(drawer);}});
  window.addEventListener('resize',()=>{if(drawer.classList.contains('open'))positionDrawer();});
}

/* ════════════════════════════════════
   PLACEMENT + RENDER
════════════════════════════════════ */
/* Idempotently activate a location id so a freshly placed cargo's platform
   always appears in the location strip and the Edit modal. Mirrors the ⊕
   picker's seeding (dedupe + colour assign + selLoc default + grid refresh);
   both placement call sites re-render the strip and persist afterwards. */
function ensureLocActive(id){
  if(!id || S.activeLocs.includes(id)) return;
  S.activeLocs.push(id);
  assignLocColor(id);
  if(!S.selLoc) S.selLoc = id;
  buildLocGrid();
}
let _stampPlacement = false;   /* set per placement: true = click-to-place cargo stamp (stays armed) */
function _placeAtCore(cx,cy){
  const p=S.pending,it=p.item,isC=p.type==='cargo';
  /* Use preset canvas px dimensions; fallback to 6×6ft (~1.83×1.83m) square */
  const w=isC?(it.w||m2px_w(1.83)):m2px_w(1.83);
  const h=isC?(it.h||m2px_h(1.83)):m2px_h(1.83);
  /* Store real-world metres for rotation and display; preserve from preset */
  const length_m = isC&&it.length_m ? it.length_m : (w/M);
  const width_m  = isC&&it.width_m  ? it.width_m  : (h/YS);
  const c={id:Date.now()+Math.random(),side:'DECK',
    x:Math.max(0,Math.min(cx-w/2,TW-w)),
    y:Math.max(0,Math.min(cy-h/2,CVH-h)),
    w,h,
    length_m, width_m,   /* real-world dims — updated on resize/rotate */
    rot:0,               /* 0=original, 1=90°, 2=180°, 3=270° */
    ccu:'',desc:it.name||it.nm||'',
    wt:isC?it.wt:0,
    platform:S.selLoc||(S.activeLocs[0]||'BLEO'),
    status:'L',
    dgClasses:p.type==='dg'?[it.cls]:[],
    priority:false,
    trDest:''};
  S.cargo.push(c);ensureLocActive(c.platform);renderAll();updateStats();buildActiveLocStrip();
  checkSeg();updateDGSummary();save();
  /* Hybrid stamp: the editor opens on every placement so the copy can be
     named/configured. For a click-to-place stamp (_stampPlacement) we skip the
     library-panel refresh, because cpRenderLib() rebuilds the cards without
     their selected highlight — skipping it keeps the armed card highlighted and
     its toggle-off disarm intact, so the template stays armed for the next
     placement. Saving/cancelling the editor no longer disarms a stamp (see the
     mSav handler). DG and drag-drop refresh the panel as before. */
  if(!_stampPlacement){
    if(typeof cpRenderLib==='function' && typeof CP_OPEN!=='undefined' && CP_OPEN) cpRenderLib();
    if(typeof cpHideHint==='function') cpHideHint();
  }
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

/* Edge-aware side for the selection action buttons (×/↻/+). They live in a
   vertical stack just outside the block's right side; flip LEFT when the
   block sits near the deck's right edge, where a right-side stack would
   overflow the deck area. 34 px = 8 gap + 22 btn + 4 cushion. Shared by
   renderBlock and kbMove so nudging stays consistent with full renders. */
function cbControlsFlipLeft(cargo){ return cargo.x + cargo.w > TW - 34; }

function renderBlock(cv,cargo){
  const loc=locById(cargo.platform)||LOC_ALL[0];
  /* Cargo fill uses the SAME central operation palette as pills — one
     source of truth, so L is purple / BL yellow / ROB green / TR blue
     everywhere. Location-specific override (e.g. Bleo Holm LOAD = grey)
     is handled inside opColor(). */
  const fill=opColor(cargo.platform, cargo.status) || getLocBase(loc.id);
  const border=darken(fill,.18);
  const textCol=isDark(fill)?'#fff':'#0a0800';
  const minDim=Math.min(cargo.w,cargo.h);
  const maxDim=Math.max(cargo.w,cargo.h);
  /* Font size: combines two constraints and picks the stricter:
       (a) block-based — scales with the SHORTER dimension so text fits
           the narrower axis (the original heuristic).
       (b) name-based — width of the label box divided by the average
           glyph width (Inter 800 ≈ 0.6em), so longer names auto-shrink
           to fit on one line instead of wrapping into the corner DG
           badges. The label uses full block width (no 60% clamp now
           that the badge strip is corner-positioned, not edge-strip).
     Floor 7 px stays legible on retina. */
  const labelText = String(cargo.ccu || '');
  const nameLen   = Math.max(1, labelText.length);
  const labelWidth = cargo.w - 10;                                    /* ~5 px padding each side */
  const fontByName = Math.floor(labelWidth / (nameLen * 0.54));
  const blockBased = Math.round(minDim * 0.30);
  const textSz = Math.max(12, Math.min(18, blockBased, fontByName)) + 'px';
  const badgeSz=Math.max(9,Math.min(14,Math.floor(minDim/6)))+'px';

  /* Make the cargo block itself a flex column so the label is truly centred
     regardless of how many lines it wraps to.                                 */
  const b=document.createElement('div');b.className='cb' + (isOperator() ? '' : ' cb-viewer');b.dataset.id=cargo.id;
  /* Location id for Quick Filter — used by #locFilterStyle CSS rule */
  b.dataset.loc = cargo.platform || '';
  const _dgList = cargo.dgClasses || [];
  if(_dgList.length > 0) b.dataset.dg = _dgList[0];
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

  /* Action-button stack sits outside the block's side; flip left near the
     deck's right edge (see cbControlsFlipLeft). Anchoring-only — the CSS
     reuses the same vertical-offset transforms for both sides. */
  if(cbControlsFlipLeft(cargo)) b.classList.add('cb-ctrl-left');

  /* Right-click context menu (Operator only — Viewer can still see block but not act) */
  b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if(!isOperator()) return; showCtxMenu(cargo.id, e.clientX, e.clientY); });

  const dgd=_dgList.length>0?DG_DATA.find(d=>d.cls===_dgList[0]):null;
  const mkBtn=(cls,txt,fn)=>{const d=document.createElement('div');d.className=cls;d.textContent=txt;d.addEventListener('mousedown',e=>e.stopPropagation());d.addEventListener('click',fn);return d;};

  b.appendChild(mkBtn('cb-del','×',e=>{e.stopPropagation();const _delId=cargo.id;animateCargoExit(_delId);S.cargo=S.cargo.filter(x=>x.id!==_delId);dgEvictDeletedCargo(_delId);renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();playSound('remove');}));
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
    const _rotId=cargo.id;
    renderAll();updateStats();buildActiveLocStrip();checkSeg();save();
    playSound('rotate');
    _pulseCargo(_rotId, 'cb-rotate-pulse');
  }));
  b.appendChild(mkBtn('cb-copy','+',e=>{e.stopPropagation();const _newId=Date.now()+Math.random();const _srcX=cargo.x,_srcY=cargo.y,_srcW=cargo.w,_srcH=cargo.h;const _spot=findFreeSpot(cargo.x+cargo.w+6,cargo.y,cargo.w,cargo.h);S.cargo.push({...cargo,id:_newId,x:_spot.x,y:_spot.y});renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();playSound('duplicate');_emitDuplicateTrail(_srcX,_srcY,_srcW,_srcH,_newId);}));

  const idEl=document.createElement('div');idEl.className='cb-id';
  /* Inline style — font size only; layout handled by CSS + parent flex */
  /* Premium label: slightly bolder, soft text-shadow for depth */
  const labelShadow = isDark(fill) ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.5)';
  idEl.style.cssText=`font-size:${textSz};color:${textCol};font-weight:700;text-shadow:0 1px 2px ${labelShadow};letter-spacing:0px;`;
  /* Phase 26 — Tiny-cargo label fallback. Below ~0.9 m on shortest side
     the text font clips to 8 px and becomes unreadable anyway. Suppress
     the text entirely: block stays selectable, hover card and inspector
     still show full info, but the deck stays clean instead of noisy. */
  const _tinyCargo = minDim < 28;
  idEl.textContent = _tinyCargo ? '' : (cargo.ccu||'');
  b.appendChild(idEl);

  /* DG badges — wrapped in a safe-area strip that owns layout.
     The strip is pinned to the top with left:3px and right:3px so
     its flex flow can never overflow the cargo card, even on tiny
     containers. Badges justify to the right and wrap to additional
     rows when the cargo is narrow, so 3 badges on a small card stack
     into 2 rows instead of overflowing horizontally. Size modifiers
     tighten font/padding for small and extra-small cargo widths. */
  /* Hybrid layout (Phase 27): name reserves the MIDDLE 60% of the block
     (centred, with symmetric 20% gutters on each side); DG badge sits in
     the RIGHT 20% gutter. Gate at cargo.w >= 36 px (~1.16 m) so the
     existing -xs tier becomes reachable for 6 ft Mini Container (57 px)
     and 4 ft Basket (47 px) — without this, the gate at 60 px orphaned
     the xs tier wired below. Below 36 px the badge is hidden on canvas —
     DG data still surfaces in the edit modal, hover tooltip, DG ON BOARD
     summary line, and PDF/Excel exports. The CSS rule `.cb.cb-has-dg
     .cb-id` (in app.css near ~line 5117) constrains the name to a
     symmetric 60%-wide centred box so the badge and name never overlap
     and the visual reads balanced. Threshold uses logical (zoom-
     independent) cargo.w, so behaviour is consistent across zoom levels. */
  const _dgFits = cargo.w >= 36;
  if(_dgList.length > 0 && _dgFits){
    b.classList.add('cb-has-dg');
    const strip = document.createElement('div');
    strip.className = 'cb-dg-strip';
    /* Scale down badge metrics on small cargo so multi-class fits.
       Thresholds picked against the deck's m2px scale (M=31px/m):
       ≈ 2.6 m width triggers small, ≈ 1.5 m width triggers xs.     */
    if(cargo.w < 82) strip.classList.add('cb-dg-strip-small');
    if(cargo.w < 48) strip.classList.add('cb-dg-strip-xs');
    _dgList.forEach(cls => {
      const dd = DG_DATA.find(d => d.cls === cls);
      if(!dd) return;
      const badge = document.createElement('div');
      badge.className = 'cb-dg-badge';
      badge.style.cssText = `background:${dd.bg};color:${dd.tc};border-color:${dd.bc};font-family:'Inter',system-ui,sans-serif;font-weight:800;letter-spacing:.2px;`;
      badge.textContent = cls;
      strip.appendChild(badge);
    });
    b.appendChild(strip);
  }
  /* Heavy Lift badge — bottom-left, opposite corner from DG.
     Phase 26 — matches DG strip tier classes at 82px/48px for unified
     badge coherence. */
  if(cargo.heavyLift){
    const hl=document.createElement('div');hl.className='cb-hl-badge';
    if(cargo.w < 82) hl.classList.add('cb-hl-badge-small');
    if(cargo.w < 48) hl.classList.add('cb-hl-badge-xs');
    hl.style.fontSize=badgeSz;hl.textContent='⬆HL';b.appendChild(hl);
  }
  /* Priority Lift — amber outline + badge. Phase 26 tier adaptation. */
  if(cargo.priority){
    b.classList.add('cb-priority');
    const pri=document.createElement('div');pri.className='cb-pri-badge';
    if(cargo.w < 82) pri.classList.add('cb-pri-badge-small');
    if(cargo.w < 48) pri.classList.add('cb-pri-badge-xs');
    pri.style.fontSize=badgeSz;pri.textContent='⚡';b.appendChild(pri);
  }
  /* Transfer — destination badge. Inherits cb-id's bg-adaptive textCol
     so it stays readable on every dynamic fill (olive, brown, pastel,
     saturated). Lower opacity + lighter weight + smaller size + corner
     position keep it visually secondary to the cargo name. */
  if(cargo.status==='TR'&&cargo.trDest){
    const trd=document.createElement('div');trd.className='cb-tr-badge';
    const destLoc=locById(cargo.trDest);
    const trdBg = isDark(fill) ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
    const trdBd = isDark(fill) ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.22)';
    trd.style.cssText = `font-size:${Math.max(7,parseInt(badgeSz)-1)}px;color:${textCol};opacity:.78;font-weight:500;background:${trdBg};border-color:${trdBd};`;
    trd.textContent='→'+(destLoc?destLoc.name.slice(0,8):cargo.trDest.slice(0,8));
    b.appendChild(trd);
  }

  ['se','sw','ne','nw'].forEach(dir=>{const rh=document.createElement('div');rh.className=`rh rh-${dir}`;rh.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();startResize(e,cargo,b,dir);});b.appendChild(rh);});

  b.addEventListener('mousedown',e=>{
    if(e.target.classList.contains('cb-del')||e.target.classList.contains('rh')||e.target.classList.contains('cb-id')||e.target.classList.contains('cb-rot'))return;
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();
    /* Viewer: allow selection (opens read-only inspector) but never drag */
    if(!isOperator()){ kbSelect(cargo.id); if(typeof inspOpen==='function') inspOpen(cargo.id); return; }
    if(S.pending){cancelPending();return;}
    const sx=e.clientX,sy=e.clientY,rect=b.getBoundingClientRect();
    const ox=(e.clientX-rect.left)/zoomLevel,oy=(e.clientY-rect.top)/zoomLevel;let moved=false;
    const ghost=document.createElement('div');ghost.className='ghost';
    ghost.style.cssText=`width:${cargo.w*zoomLevel}px;height:${cargo.h*zoomLevel}px;left:${e.clientX-ox*zoomLevel}px;top:${e.clientY-oy*zoomLevel}px;`;
    document.body.appendChild(ghost);
    /* Drag ghost trail (#7) — shadow at original position */
    let _ghostTrail=null;
    if(SMART.dragGhost){
      _ghostTrail=document.createElement('div');
      _ghostTrail.className='drag-ghost-trail';
      _ghostTrail.style.cssText=`left:${cargo.x}px;top:${cargo.y}px;width:${cargo.w}px;height:${cargo.h}px;`;
      const cv=document.getElementById('cvDECK');if(cv)cv.appendChild(_ghostTrail);
    }
    let _dragSegTimer=0;
    const onMove=ev=>{
      if(Math.abs(ev.clientX-sx)>4||Math.abs(ev.clientY-sy)>4)moved=true;
      ghost.style.left=(ev.clientX-ox*zoomLevel)+'px';
      ghost.style.top=(ev.clientY-oy*zoomLevel)+'px';
      /* Throttled DG segregation overlay — prevents fullscreen flicker */
      if(cargo.dgClasses&&cargo.dgClasses.length>0&&!_dragSegTimer){_dragSegTimer=1;requestAnimationFrame(()=>{showDragSegOverlay(cargo.dgClasses,cargo.id);_dragSegTimer=0;});}
    };
    const onUp=ev=>{
      document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
      /* Phase 27 — ghost landing dissolve. Instead of pop-off, the ghost
         fades + micro-scales for 120ms so the drag's phantom "arrives"
         before disappearing. Purely cosmetic; state flow is unchanged.
         Only applied when the drag actually moved; zero-move clicks still
         get instant cleanup to preserve selection semantics. */
      if(moved){
        ghost.classList.add('is-dissolving');
        ghost.addEventListener('transitionend',
          () => ghost.remove(),
          { once: true });
        /* Safety net in case transitionend is skipped (tab blur etc.) */
        setTimeout(() => { if(ghost.parentNode) ghost.remove(); }, 240);
      } else {
        ghost.remove();
      }
      if(_ghostTrail) _ghostTrail.remove();
      clearDragSegOverlay();
      if(moved){
        /* Phase 4 — Group drag detection. If the cargo being dragged is
           part of an active multi-selection, every other selected cargo
           moves with it by the same delta. Relative positions preserved
           exactly; Bounce / Grid-Snap suppressed in group mode (rigid move). */
        const isGroupDrag = (typeof KB_SEL_SET !== 'undefined'
                          && KB_SEL_SET.size > 1
                          && KB_SEL_SET.has(cargo.id));
        const groupOthers = isGroupDrag
          ? Array.from(KB_SEL_SET)
              .filter(id => id !== cargo.id)
              .map(id => S.cargo.find(c => c.id === id))
              .filter(Boolean)
          : [];

        b.style.visibility='hidden';
        const el=document.elementFromPoint(ev.clientX,ev.clientY);
        b.style.visibility='';
        const tc=el&&el.closest('.dcv');

        if(tc){
          const cr=tc.getBoundingClientRect();
          const attemptedX = Math.max(0, Math.min((ev.clientX-cr.left)/zoomLevel - ox, TW  - cargo.w));
          const attemptedY = Math.max(0, Math.min((ev.clientY-cr.top) /zoomLevel - oy, CVH - cargo.h));

          if(isGroupDrag){
            /* Clamp the delta so no OTHER selected cargo slides off the deck.
               The primary already sits within bounds thanks to the Max/Min
               above; we only need to further constrain per-other. */
            let dx = attemptedX - cargo.x;
            let dy = attemptedY - cargo.y;
            groupOthers.forEach(o => {
              if(dx > 0) dx = Math.min(dx, TW  - o.w - o.x);
              else       dx = Math.max(dx, -o.x);
              if(dy > 0) dy = Math.min(dy, CVH - o.h - o.y);
              else       dy = Math.max(dy, -o.y);
            });
            cargo.x += dx;
            cargo.y += dy;
            groupOthers.forEach(o => { o.x += dx; o.y += dy; });
          } else {
            cargo.x = attemptedX;
            cargo.y = attemptedY;
          }
        }

        /* Smart Bounce + Grid Snap — single-cargo only. In group drag we
           preserve the operator's chosen formation; auto-adjusting would
           break the intent. */
        let bouncePos = null, snapPos = null;
        if(!isGroupDrag){
          bouncePos=smartBounce(cargo);
          if(bouncePos){ cargo.x=bouncePos.x; cargo.y=bouncePos.y; }
          snapPos=smartGridSnap(cargo);
          if(snapPos){ cargo.x=snapPos.x; cargo.y=snapPos.y; }
        }

        renderAll();

        if(isGroupDrag){
          /* Re-apply multi-select ring to every set member (renderAll wipes it),
             and fire the same placement-confirmation scale-in on each moved
             block so the group visually lands as one. */
          const movedIds = [cargo.id, ...groupOthers.map(o => o.id)];
          movedIds.forEach(id => {
            const domEl = document.querySelector(`.cb[data-id="${id}"]`);
            if(!domEl) return;
            domEl.classList.add('kb-sel');
            domEl.classList.add('just-placed');
            domEl.addEventListener('animationend', () => domEl.classList.remove('just-placed'), { once:true });
          });
        } else if(bouncePos){
          triggerBounceAnim(cargo.id);
        }

        updateStats();buildActiveLocStrip();
        checkSeg();save();playSound('drop');
        /* Phase 25 — snap lock-in confirmation. When Smart Grid Snap
           committed a snap target on this drop, fire a tiny pulse +
           tick on the cargo so the operator sees "yes it locked on".
           (Bounce already has its own bounce animation via
           triggerBounceAnim; snap gets its own distinct cue.) */
        if(snapPos && !isGroupDrag){
          const snapEl = document.querySelector(`.cb[data-id="${cargo.id}"]`);
          if(snapEl){
            snapEl.classList.remove('cb-snap-pulse');
            void snapEl.offsetWidth; /* force reflow so re-add restarts anim */
            snapEl.classList.add('cb-snap-pulse');
            snapEl.addEventListener('animationend',
              () => snapEl.classList.remove('cb-snap-pulse'),
              { once:true });
          }
          playSound('snap');
        }
      }else{
                /* Click without drag → Phase 2: select + open inspector.
                   Phase 4: shift-click toggles the cargo in the selection set
                   without dismissing the current multi-selection.            */
                const _shift = ev.shiftKey === true;
                kbSelect(cargo.id, { shift: _shift });
                if(typeof inspOpen==='function'){
                  if(KB_SEL_SET.size === 0){
                    /* All deselected (shift-click removed the last one) */
                    if(typeof inspClose === 'function') inspClose();
                  } else {
                    inspOpen(cargo.id);
                  }
                } else {
                  openModal(cargo.id);
                }
              }
    };
    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  });

  /* ── Touch support — mirrors mouse drag for tablets ── */
  b.addEventListener('touchstart', e => {
    if(e.target.classList.contains('cb-del')||e.target.classList.contains('rh')||e.target.classList.contains('cb-rot')) return;
    /* Viewer: tap to open read-only inspector, never drag */
    if(!isOperator()){ kbSelect(cargo.id); if(typeof inspOpen==='function') inspOpen(cargo.id); return; }
    if(S.pending){cancelPending();return;}
    const touch = e.touches[0];
    const sx=touch.clientX, sy=touch.clientY, rect=b.getBoundingClientRect();
    const ox=(touch.clientX-rect.left)/zoomLevel, oy=(touch.clientY-rect.top)/zoomLevel;
    let moved=false;
    const ghost=document.createElement('div');ghost.className='ghost';
    ghost.style.cssText=`width:${cargo.w*zoomLevel}px;height:${cargo.h*zoomLevel}px;left:${touch.clientX-ox*zoomLevel}px;top:${touch.clientY-oy*zoomLevel}px;`;
    document.body.appendChild(ghost);
    const onTouchMove = ev => {
      ev.preventDefault();
      const t = ev.touches[0];
      if(Math.abs(t.clientX-sx)>4||Math.abs(t.clientY-sy)>4) moved=true;
      ghost.style.left=(t.clientX-ox*zoomLevel)+'px'; ghost.style.top=(t.clientY-oy*zoomLevel)+'px';
      if(cargo.dgClasses&&cargo.dgClasses.length>0) showDragSegOverlay(cargo.dgClasses, cargo.id);
    };
    const onTouchEnd = ev => {
      document.removeEventListener('touchmove',onTouchMove); document.removeEventListener('touchend',onTouchEnd);
      ghost.remove(); clearDragSegOverlay();
      const t = ev.changedTouches[0];
      if(moved){
        b.style.visibility='hidden';const el=document.elementFromPoint(t.clientX,t.clientY);b.style.visibility='';
        const tc=el&&el.closest('.dcv');
        if(tc){const cr=tc.getBoundingClientRect();cargo.x=Math.max(0,Math.min((t.clientX-cr.left)/zoomLevel-ox,TW-cargo.w));cargo.y=Math.max(0,Math.min((t.clientY-cr.top)/zoomLevel-oy,CVH-cargo.h));}
        const bouncePos=smartBounce(cargo);if(bouncePos){cargo.x=bouncePos.x;cargo.y=bouncePos.y;}
        const snapPos=smartGridSnap(cargo);if(snapPos){cargo.x=snapPos.x;cargo.y=snapPos.y;}
        renderAll();if(bouncePos)triggerBounceAnim(cargo.id);
        updateStats();buildActiveLocStrip();checkSeg();save();
      } else { /* Tap without drag → select + inspector (modal is fallback) */ kbSelect(cargo.id); if(typeof inspOpen==='function'){ inspOpen(cargo.id); } else { openModal(cargo.id); } }
    };
    document.addEventListener('touchmove',onTouchMove,{passive:false}); document.addEventListener('touchend',onTouchEnd);
  }, {passive:false});

  cv.appendChild(b);
}

/* ════════════════════════════════════════════════════════════
   PHASE 12 — CARGO EXIT ANIMATION
   Clones the cargo's .cb DOM at its current screen position, pins
   it to <body> with position:fixed, then fades + scales out.
   renderAll() wipes the original underneath; the clone lives on
   body so it survives the rebuild. Purely visual — underlying
   state mutation flow unchanged.
════════════════════════════════════════════════════════════ */
function animateCargoExit(ids){
  if(!ids) return;
  const list = Array.isArray(ids) ? ids : [ids];
  list.forEach(id => {
    const el = document.querySelector(`.cb[data-id="${id}"]`);
    if(!el) return;
    const rect = el.getBoundingClientRect();
    if(rect.width === 0 || rect.height === 0) return;
    const clone = el.cloneNode(true);
    /* Drop interaction + semantic classes so the clone is purely visual. */
    clone.classList.remove('kb-sel', 'dg-violation', 'dg-violation-warn',
                           'dg-violation-1', 'dg-violation-2', 'dg-violation-3',
                           'just-placed', 'st-bouncing');
    clone.classList.add('cb-leaving');
    clone.removeAttribute('data-id'); /* avoid duplicate data-id in DOM */
    clone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;`
                        + `width:${rect.width}px;height:${rect.height}px;`
                        + `margin:0;z-index:9998;pointer-events:none;`;
    document.body.appendChild(clone);
    /* Force layout commit so the transition kicks in on class add. */
    void clone.offsetWidth;
    clone.classList.add('is-leaving');
    const cleanup = () => { if(clone.parentNode) clone.parentNode.removeChild(clone); };
    clone.addEventListener('transitionend', cleanup, { once:true });
    /* Safety net — guarantee removal even if transitionend misses. */
    setTimeout(cleanup, 500);
  });
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
    renderAll();updateStats();buildActiveLocStrip();checkSeg();save();
  };
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

/* ════════════════════════════════════
   STATS + DG
════════════════════════════════════ */
function updateStats(){
  let tot=0,wt=0,L=0,BL=0,ROB=0,TR=0;
  S.cargo.forEach(c=>{
    tot++;
    wt+=parseFloat(c.wt)||0;
    if(c.status==='L')L++;
    if(c.status==='BL')BL++;
    if(c.status==='ROB')ROB++;
    if(c.status==='TR')TR++;
  });

  document.getElementById('sLifts').textContent=tot;
  document.getElementById('sWT').textContent=wt.toFixed(1)+' T';
  document.getElementById('sL').textContent=L;
  document.getElementById('sBL').textContent=BL;
  document.getElementById('sROB').textContent=ROB;
  const trEl=document.getElementById('sTR');if(trEl)trEl.textContent=TR;
  const trGst=document.getElementById('gstTR');if(trGst)trGst.style.display=TR>0?'':'none';

  /* Phase 3A — weight-as-hero capacity bar. Always visible in the ribbon;
     threshold class shifts color calmly at 70 % (warn) and 90 % (crit). */
  const MAX_WT = 2500;
  const pct = Math.min(100, wt / MAX_WT * 100);
  const bar = document.getElementById('sWTbar');
  if(bar){
    bar.style.width = pct.toFixed(1) + '%';
    bar.classList.toggle('warn', pct > 70 && pct <= 90);
    bar.classList.toggle('crit', pct > 90);
  }

  /* V12: Empty deck hint */
  const hintEl=document.getElementById('emptyDeckHint');
  if(hintEl){hintEl.classList.toggle('hidden',tot>0||!SMART.emptyHint);}

  /* ── Deck Usage indicator (equal-mode full-circle gauge + Motion One) ── */
  const duCard = document.getElementById('gstDeckUsage');
  if(duCard){
    let occupiedPx = 0;
    S.cargo.forEach(c => { occupiedPx += (c.w || 0) * (c.h || 0); });
    const usedPct = Math.min(100, Math.round((occupiedPx / DECK_USABLE_AREA_PX) * 100));

    /* Threshold class — same scale as legacy bar (do not redefine) */
    const cls = usedPct >= 95 ? 'deck-usage--critical'
              : usedPct >= 85 ? 'deck-usage--alert'
              : usedPct >= 70 ? 'deck-usage--warn'
              :                 'deck-usage--calm';
    duCard.className = 'gst gst-deck-usage ' + cls;

    /* Look up gauge nodes AFTER the class change so threshold colors are
       in effect the moment Motion One paints the first frame. */
    const numEl   = document.getElementById('sDeckPct');
    const freeEl  = document.getElementById('sDeckFree');
    const arcEl   = document.getElementById('sDeckArc');
    const trackEl = document.getElementById('sDeckTrack');

    /* Equal-mode geometry (ported from 21st.dev gauge-1, offsetFactor=0.5).
       Track + value share a circle of circumference C, separated by two
       symmetric gaps totaling GAP%. At 0% used, track fills the ring; at
       100%, value fills it. For 0 < p < 100 there are gaps at 12 and 6. */
    const C            = 282.74;  /* 2π·r for r=45 */
    const PX_PER_PCT   = C / 100;
    const GAP          = 5;
    const F            = 0.5;     /* offsetFactor for equal mode */
    const DEG_PER_PCT  = 3.6;

    const primaryDash = (p) => {
      const sub = p > 100 - GAP * 2 * F ? (-p + 100) : (GAP * 2 * F);
      return Math.max(p * PX_PER_PCT - sub * PX_PER_PCT, 0).toFixed(2) + ' ' + C.toFixed(2);
    };
    const secondaryDash = (p) => {
      const sub = p < GAP * 2 * F ? p : (GAP * 2 * F);
      return Math.max((100 - p) * PX_PER_PCT - sub * PX_PER_PCT, 0).toFixed(2) + ' ' + C.toFixed(2);
    };
    const primaryRotate = (p) => {
      const add = p > 100 - GAP * 2 * F ? (0.5 * (-p + 100)) : (GAP * F);
      return 'rotate(' + (-90 + add * DEG_PER_PCT) + 'deg)';
    };
    const secondaryRotate = (p) => {
      const sub = p < GAP * 2 * F ? (0.5 * p) : (GAP * F);
      return 'rotate(' + (360 - 90 - sub * DEG_PER_PCT) + 'deg) scaleY(-1)';
    };

    if(numEl && freeEl && arcEl && trackEl){
      const fromVal = _du.prevPct < 0 ? 0 : _du.displayedPct;
      const toVal   = usedPct;

      /* Cancel any in-flight animation so a fast cargo edit doesn't
         leave two animations racing on the same nodes. */
      if(_du.anim && typeof _du.anim.stop === 'function') _du.anim.stop();

      const paint = (v) => {
        arcEl.setAttribute('stroke-dasharray', primaryDash(v));
        arcEl.style.transform = primaryRotate(v);
        trackEl.setAttribute('stroke-dasharray', secondaryDash(v));
        trackEl.style.transform = secondaryRotate(v);
        const intV = Math.round(v);
        numEl.textContent  = intV + '%';
        freeEl.textContent = (100 - intV) + '% free';
        _du.displayedPct   = v;
      };

      if(Math.abs(toVal - fromVal) < 0.5){
        /* No meaningful delta — snap, skip animation */
        paint(toVal);
        _du.anim = null;
      } else {
        _du.anim = motionAnimate(fromVal, toVal, {
          duration: 1.2,
          ease: 'easeOut',
          onUpdate: paint,
          onComplete: () => { paint(toVal); _du.anim = null; },
        });
      }
    }

    _du.prevPct       = usedPct;
    _du.prevThreshold = cls;

    /* Tooltip m² breakdown */
    const usableM2  = Math.round(DECK_USABLE_AREA_PX / PX2_TO_M2);
    const occupiedM2 = Math.round(occupiedPx / PX2_TO_M2);
    const freeM2    = usableM2 - occupiedM2;
    const ttUsable   = document.getElementById('sDeckTTUsable');
    const ttOccupied = document.getElementById('sDeckTTOccupied');
    const ttFree     = document.getElementById('sDeckTTFree');
    if(ttUsable)   ttUsable.textContent   = usableM2 + ' m²';
    if(ttOccupied) ttOccupied.textContent = occupiedM2 + ' m²';
    if(ttFree)     ttFree.textContent     = freeM2 + ' m²';
  }

  /* V9: Status bar update */
  if(typeof updateStatusBar==='function') updateStatusBar();
}
function updateDGSummary(){
  const el = document.getElementById('dgOnBoardText');
  if(!el) return;
  const counts = {};
  S.cargo.forEach(c => {
    (c.dgClasses||[]).forEach(cls => { counts[cls] = (counts[cls]||0) + 1; });
  });
  const entries = Object.keys(counts).sort((a,b) => parseFloat(a)-parseFloat(b));
  if(entries.length === 0){
    el.textContent = 'none';
  } else {
    el.textContent = entries.map(cls => 'Class ' + cls + ' (' + counts[cls] + ')').join(', ');
  }
}
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

/* Phase 27 — previous-violation snapshot for resolved detection.
   Tracks which cargo ids were participating in a violation on the last
   check. When the current check finds any of them NOT in any violation
   anymore, they get the "resolved" pulse + sound fires once. */
let _phase27PrevViolationIds = new Set();

function checkSeg(){
  /* ── 1. Collect all DG blocks ── */
  const dgs = S.cargo.filter(c => c.dgClasses && c.dgClasses.length > 0);

  /* ── 2. Compute ALL violations (geometry check) ── */
  const legacyWarns = [];
  const violations  = [];

  for(let i = 0; i < dgs.length; i++){
    for(let j = i+1; j < dgs.length; j++){
      const a = dgs[i], b = dgs[j];
      /* Check ALL class combinations — most restrictive wins */
      let level = 0;
      let worstA = '', worstB = '';
      for(const clsA of a.dgClasses){
        for(const clsB of b.dgClasses){
          const l = getSeg(clsA, clsB);
          if(l > level){ level = l; worstA = clsA; worstB = clsB; }
        }
      }
      if(level < 1) continue;
      const required = segClearancePx(level);
      const gapX = Math.max(0, Math.max(a.x,b.x) - Math.min(a.x+a.w, b.x+b.w));
      const gapY = Math.max(0, Math.max(a.y,b.y) - Math.min(a.y+a.h, b.y+b.h));
      const gap  = Math.min(gapX, gapY);
      if(gap < required){
        legacyWarns.push(`DG${worstA}↔DG${worstB}: ${SEG_LEVEL_LABEL[level]||level+' MINI'}`);
        violations.push({ a, b, level, worstA, worstB, key: dgPairKey(a.id, b.id) });
      }
    }
  }

  /* ── 3. Split into acknowledged vs new ── */
  const newViolations = violations.filter(v => !DG_ACK_PAIRS.has(v.key));
  const ackViolations = violations.filter(v =>  DG_ACK_PAIRS.has(v.key));

  /* Phase 27 — detect resolved violations. Anything in the previous set
     that no longer appears in the current violation set is "cleared".
     Fire the resolved feedback once per check, then rotate the snapshot. */
  const currentViolationIds = new Set();
  violations.forEach(v => { currentViolationIds.add(String(v.a.id)); currentViolationIds.add(String(v.b.id)); });
  const resolvedIds = [];
  _phase27PrevViolationIds.forEach(id => { if(!currentViolationIds.has(id)) resolvedIds.push(id); });
  if(resolvedIds.length > 0 && _phase27PrevViolationIds.size > 0){
    playSound('resolved');
    const cap = Math.min(resolvedIds.length, 6);
    for(let i = 0; i < cap; i++) _pulseCargo(resolvedIds[i], 'cb-dg-resolved');
  }
  _phase27PrevViolationIds = currentViolationIds;

  /* Legacy DG warning bar removed */

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

  /* Play DG warning sound if new violations found */
  if(newViolations.length > 0) playSound('warning');

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
    const { a, b, level, worstA, worstB } = v;
    const dgA = DG_DATA.find(d => d.cls === (worstA||a.dgClasses[0])) || { bg:'#888', tc:'#fff', bc:'#888' };
    const dgB = DG_DATA.find(d => d.cls === (worstB||b.dgClasses[0])) || { bg:'#888', tc:'#fff', bc:'#888' };
    const clsLblA = worstA || a.dgClasses[0] || '?';
    const clsLblB = worstB || b.dgClasses[0] || '?';
    const reqLabel = SEG_LEVEL_LABEL[level] || `${level} MINI`;
    const descHtml = (SEG_LEVEL_DESC[level] || (() => ''))(clsLblA, clsLblB);

    const card = document.createElement('div');
    card.className = 'dg-viol-card';
    card.innerHTML = `
      <div class="dg-viol-head">
        <span class="dg-viol-sev sev-${level}">${reqLabel.toUpperCase()}</span>
        <div class="dg-viol-pair">
          <span class="dg-viol-badge" style="background:${dgA.bg};color:${dgA.tc};border:1px solid ${dgA.bc};">◆ ${clsLblA}</span>
          <span class="dg-viol-arrow">⟷</span>
          <span class="dg-viol-badge" style="background:${dgB.bg};color:${dgB.tc};border:1px solid ${dgB.bc};">◆ ${clsLblB}</span>
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
  S.cargo.filter(c=>c.dgClasses&&c.dgClasses.length>0).forEach(cargo=>{
    /* Check pending DG class against ALL classes of placed cargo — most restrictive wins */
    let rule=0;
    cargo.dgClasses.forEach(cls=>{ rule=Math.max(rule,getSeg(pc,cls)); });
    if(rule<1)return;
    const pad=segClearancePx(rule);
    const bg={1:'rgba(251,146,60,.14)',2:'rgba(220,38,38,.18)',3:'rgba(139,0,0,.28)'}[rule]||'rgba(220,38,38,.18)';
    const bc={1:'#f97316',2:'#dc2626',3:'#7f1d1d'}[rule]||'#dc2626';
    const zx=Math.max(0,cargo.x-pad),zy=Math.max(0,cargo.y-pad);
    const zw=Math.min(TW,cargo.x+cargo.w+pad)-zx,zh=Math.min(CVH,cargo.y+cargo.h+pad)-zy;
    const z=document.createElement('div');z.className='dg-excl-zone';
    z.style.cssText=`left:${zx}px;top:${zy}px;width:${zw}px;height:${zh}px;background:${bg};border:1.5px dashed ${bc};`;
    z.innerHTML=`<span class="dg-excl-lbl" style="color:${bc};">${rule} MINI · DG${cargo.dgClasses.join(',')}</span>`;
    ovl.appendChild(z);
  });
}

/* ════════════════════════════════════
   MODAL
════════════════════════════════════ */
let editId=null,modalSt=null;
function openModal(id){editId=id;const c=S.cargo.find(x=>x.id===id);if(!c)return;buildModalDescSelect();document.getElementById('mCCU').value=c.ccu||'';document.getElementById('mDesc').value=c.desc||'';document.getElementById('mWT').value=c.wt||'';_dgMultiSelected=Array.isArray(c.dgClasses)?[...c.dgClasses]:[];_dgMultiRenderTags();modalSt=c.status||'L';buildModalLocs(c.platform);document.querySelectorAll('.mdl-st').forEach(b=>b.classList.toggle('sel',b.dataset.s===modalSt));
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
const _ovEl=document.getElementById('ov');const _mdlEl=_ovEl.querySelector('.mdl');_ovEl.classList.add('open');animateModalIn(_ovEl,_mdlEl);setTimeout(()=>document.getElementById('mCCU').focus(),50);
}
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

/* ══════════════════════════════════════════════════════════
   MULTI-DG PICKER — tag-based multi-select (up to 3 classes)
══════════════════════════════════════════════════════════ */
let _dgMultiSelected = [];   /* ordered array of selected DG class strings */

function _dgMultiRenderTags(){
  const container = document.getElementById('dgMultiTags');
  const msgEl     = document.getElementById('dgMultiMsg');
  if(!container) return;
  container.innerHTML = '';

  if(_dgMultiSelected.length === 0){
    container.innerHTML = '<span class="dg-multi-empty">— Not DG —</span>';
  }

  _dgMultiSelected.forEach(cls => {
    const dg = DG_DATA.find(d => d.cls === cls);
    const tag = document.createElement('span');
    tag.className = 'dg-multi-tag';
    tag.style.cssText = dg ? `background:${dg.bg};color:${dg.tc};border:1px solid ${dg.bc};` : '';
    tag.innerHTML = `<span class="dg-multi-tag-label">${cls}</span><span class="dg-multi-tag-rm">&times;</span>`;
    tag.querySelector('.dg-multi-tag-rm').addEventListener('click', e => {
      e.stopPropagation();
      _dgMultiSelected = _dgMultiSelected.filter(c => c !== cls);
      _dgMultiRenderTags();
    });
    container.appendChild(tag);
  });

  if(msgEl) msgEl.textContent = '';
}

function _dgMultiOpenDropdown(){
  const dropdown = document.getElementById('dgMultiDropdown');
  const addBtn   = document.getElementById('dgMultiAdd');
  const list     = document.getElementById('dgMultiList');
  const search   = document.getElementById('dgMultiSearch');
  if(!dropdown || !list) return;

  /* PORTAL — escape the modal's backdrop-filter containing block.
     `.mdl` uses backdrop-filter, which makes it the containing block for
     every position:fixed descendant. That breaks viewport-relative
     positioning and causes the dropdown to inflate the modal body. Move
     the dropdown to <body> so position:fixed resolves against the
     viewport. One-way move — the dropdown lives in <body> from now on. */
  if(dropdown.parentElement !== document.body){
    document.body.appendChild(dropdown);
  }

  function build(query){
    list.innerHTML = '';
    const q = (query||'').toLowerCase().trim();
    DG_DATA.forEach(d => {
      if(_dgMultiSelected.includes(d.cls)) return;  /* already selected */
      const label = `${d.cls} — ${d.nm}`;
      if(q && !d.cls.includes(q) && !label.toLowerCase().includes(q)) return;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'dg-picker-opt';
      row.innerHTML = `
        <span class="dg-picker-opt-badge" style="background:${d.bg};color:${d.tc};border:1px solid ${d.bc};">◆${d.cls}</span>
        <span class="dg-picker-opt-name">${d.nm}</span>`;
      row.addEventListener('click', () => {
        _dgMultiSelectClass(d.cls);
        dropdown.classList.remove('open');
      });
      list.appendChild(row);
    });
  }

  build('');
  dropdown.classList.add('open');

  /* Anchor as a floating popover so the dropdown escapes the modal's
     scroll container and footer. position:fixed + viewport-relative
     coords computed from the add-button rect. Auto-flips upward when
     there's not enough room below. */
  if(addBtn){
    const r = addBtn.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const maxH = 280;
    const popW = Math.max(260, Math.round(r.width));
    dropdown.style.position = 'fixed';
    dropdown.style.left = Math.round(r.left) + 'px';
    dropdown.style.width = popW + 'px';
    dropdown.style.maxHeight = maxH + 'px';
    dropdown.style.zIndex = '700';
    if (vh - r.bottom < maxH + 16) {
      /* Not enough room below — flip upward. Set top:auto explicitly
         (not empty) so the legacy CSS base rule's `top:100%` cannot
         re-assert and collapse the element between top+bottom. */
      dropdown.style.top = 'auto';
      dropdown.style.bottom = (vh - r.top + 6) + 'px';
    } else {
      dropdown.style.bottom = 'auto';
      dropdown.style.top = (r.bottom + 6) + 'px';
    }
  }

  if(search){ search.value = ''; search.focus(); }
}

function _dgMultiSelectClass(cls){
  const msgEl = document.getElementById('dgMultiMsg');
  if(_dgMultiSelected.includes(cls)) return;  /* duplicate guard */
  if(_dgMultiSelected.length >= 3){
    if(msgEl) msgEl.textContent = 'Maximum 3 DG classes per item';
    setTimeout(() => { if(msgEl) msgEl.textContent = ''; }, 3000);
    return;
  }
  _dgMultiSelected.push(cls);
  _dgMultiRenderTags();
}

function bindDGMultiPicker(){
  const addBtn   = document.getElementById('dgMultiAdd');
  const dropdown = document.getElementById('dgMultiDropdown');
  const search   = document.getElementById('dgMultiSearch');
  if(!addBtn) return;

  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    if(dropdown && dropdown.classList.contains('open')){
      dropdown.classList.remove('open');
    } else {
      _dgMultiOpenDropdown();
    }
  });

  if(search){
    search.addEventListener('input', () => {
      const list = document.getElementById('dgMultiList');
      if(!list) return;
      list.innerHTML = '';
      const q = search.value.toLowerCase().trim();
      DG_DATA.forEach(d => {
        if(_dgMultiSelected.includes(d.cls)) return;
        const label = `${d.cls} — ${d.nm}`;
        if(q && !d.cls.includes(q) && !label.toLowerCase().includes(q)) return;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dg-picker-opt';
        row.innerHTML = `
          <span class="dg-picker-opt-badge" style="background:${d.bg};color:${d.tc};border:1px solid ${d.bc};">◆${d.cls}</span>
          <span class="dg-picker-opt-name">${d.nm}</span>`;
        row.addEventListener('click', () => {
          _dgMultiSelectClass(d.cls);
          dropdown.classList.remove('open');
        });
        list.appendChild(row);
      });
    });
    search.addEventListener('keydown', e => {
      if(e.key === 'Escape'){ dropdown.classList.remove('open'); e.stopPropagation(); }
    });
    search.addEventListener('click', e => e.stopPropagation());
  }

  /* Close dropdown on outside click */
  document.addEventListener('click', e => {
    if(dropdown && !dropdown.contains(e.target) && e.target !== addBtn) dropdown.classList.remove('open');
  });

  /* Close dropdown when the modal body scrolls — the popover is
     position:fixed and anchored to the button's on-screen rect, so
     scrolling would drift the anchor away from the button. */
  const _mdlBody = document.querySelector('#ov .mdl-body');
  if(_mdlBody){
    _mdlBody.addEventListener('scroll', () => {
      if(dropdown && dropdown.classList.contains('open')) dropdown.classList.remove('open');
    });
  }
  /* Also close on window resize for the same reason */
  window.addEventListener('resize', () => {
    if(dropdown && dropdown.classList.contains('open')) dropdown.classList.remove('open');
  });

  _dgMultiRenderTags();
}

let _modalClosing = false;

/* Force-close modal (used after Save/Remove/Cancel) */
async function _forceCloseModal(){
  const ov = document.getElementById('ov');
  if(!ov.classList.contains('open') || _modalClosing) return;
  _modalClosing = true;
  const mdl = ov.querySelector('.mdl');
  editId=null;
  /* Ensure the portaled DG picker dropdown doesn't outlive the modal. */
  const _dgDd = document.getElementById('dgMultiDropdown');
  if(_dgDd) _dgDd.classList.remove('open');
  /* Animated exit — spring out + backdrop fade */
  await animateModalOut(ov, mdl);
  ov.classList.remove('open');
  _modalClosing = false;
  if(document.body.classList.contains('mdl-over-insp')){
    document.body.classList.remove('mdl-over-insp');
  }
  if(typeof inspRefreshIfOpen === 'function') inspRefreshIfOpen();
}

/* Close modal (dismiss paths: Escape, backdrop, swipe, Cancel) */
async function closeModal(){
  const ov = document.getElementById('ov');
  if(!ov || !ov.classList.contains('open') || _modalClosing) return;
  const mState = getModalState(ov);
  if(mState === 'closing' || mState === 'closed') return;
  await _forceCloseModal();
}

/* ════════════════════════════════════════════════════════════
   INSPECTOR RAIL — Phase 2 keystone
   Selection-first editing surface that replaces modal-first cargo
   editing as the primary flow. The legacy #ov modal remains as a
   fallback path for complex fields (DG / HL / Priority / TR dest)
   via the "Edit details…" button and keyboard `E`.

   State model:
     inspSelId   — currently inspected cargo id (null when closed)
     inspOpen()  — slides the rail in, populates fields, closes Library
     inspClose() — slides out, clears selId, calls kbDeselect()
     inspPopulate(cargo) — writes fields from S.cargo
     inspField handlers — live-edit: mutate S.cargo + renderAll + save
════════════════════════════════════════════════════════════ */
let inspSelId = null;

/* Inspector-gutter reveal state. When the rail opens, `body.insp-open` adds
   a 340px right gutter to .deck-area, shrinking the overflow:auto deck
   viewport so bow (Bay 1–2 / fore) blocks can scroll past the fore edge —
   putting their on-deck resize handles (.rh) out of reach. We scroll a
   clipped block back into view on open and restore the prior scroll on close. */
let _inspPrevScrollLeft = null;
let _inspScrollAnim = null;

/* Smoothly animate .deck-area horizontal scroll via the shared Motion One
   import. Clamps the target to the scrollable range and cancels any in-flight
   tween so open/close don't fight. */
function _inspAnimateScrollLeft(area, to){
  const from   = area.scrollLeft;
  const target = Math.max(0, Math.min(to, area.scrollWidth - area.clientWidth));
  if(_inspScrollAnim && typeof _inspScrollAnim.stop === 'function') _inspScrollAnim.stop();
  if(Math.abs(target - from) < 1){ area.scrollLeft = target; _inspScrollAnim = null; return; }
  _inspScrollAnim = motionAnimate(from, target, {
    duration: 0.32,
    ease: [0.22, 1, 0.36, 1],   /* iOS-style ease-out */
    onUpdate: v => { area.scrollLeft = v; },
    onComplete: () => { area.scrollLeft = target; _inspScrollAnim = null; },
  });
}

/* If the selected block is clipped by the gutter-shrunken deck viewport,
   scroll it (with its resize handles) fully into view. Fully-visible blocks
   (Bay 3–12 etc.) are left untouched so non-bow cargo never jumps.
   Zoom-robust: works off getBoundingClientRect, which is already
   post-transform. */
function revealSelectedFromGutter(cargoId){
  const area  = document.getElementById('deckArea');
  const block = document.querySelector(`.cb[data-id="${cargoId}"]`);
  if(!area || !block) return;
  const areaRect  = area.getBoundingClientRect();
  const z = (typeof zoomLevel === 'number') ? zoomLevel : 1;
  /* A selected block also shows an on-block action cluster (× / ↻ / +) that
     sits ~30px beyond one side (left:100% + margin + 22px width, see
     .cb-del/.cb-rot/.cb-copy in app.css; flips left via .cb-ctrl-left). Union
     the block with those buttons so the reveal clears the FULL selected
     footprint — not just the block + a resize handle, which left the bow
     cluster clipped by the gutter. getBoundingClientRect keeps it zoom-correct. */
  const blockRect = block.getBoundingClientRect();
  let footLeft = blockRect.left, footRight = blockRect.right;
  block.querySelectorAll('.cb-del,.cb-rot,.cb-copy').forEach(el => {
    const r = el.getBoundingClientRect();
    if(r.width || r.height){ footLeft = Math.min(footLeft, r.left); footRight = Math.max(footRight, r.right); }
  });
  /* breathing room so the .rh resize handle on the side WITHOUT the cluster
     (handle ~11px, app.css) also clears the gutter edge. */
  const pad = 11 * z + 12;
  let target = null;
  if(footRight + pad > areaRect.right){
    /* clipped on the fore (right) edge — the typical bow case */
    target = area.scrollLeft + (footRight + pad - areaRect.right);
  } else if(footLeft - pad < areaRect.left){
    /* clipped on the aft (left) edge — symmetric robustness */
    target = area.scrollLeft + (footLeft - pad - areaRect.left);
  }
  if(target == null) return;   /* already fully visible → no movement */
  /* NOTE: at zoom>1 a block wider than the viewport can't be fully revealed;
     the clamp in _inspAnimateScrollLeft scrolls as far as allowed. Possible
     follow-up: compose a translateX in the zoom transform. */
  _inspAnimateScrollLeft(area, target);
}

/* The gutter (margin-right:340px) animates over --dur-medium, so one rAF
   would read a mid-transition viewport and under-detect clipping. On a
   closed→open transition, wait for the gutter to settle before measuring;
   when the rail is already open (e.g. switching selection / panel Duplicate),
   the gutter is in place so a single rAF suffices. */
function _inspRevealWhenSettled(id, alreadyOpen){
  if(alreadyOpen){
    requestAnimationFrame(() => revealSelectedFromGutter(id));
    return;
  }
  const area = document.getElementById('deckArea');
  if(!area){ requestAnimationFrame(() => revealSelectedFromGutter(id)); return; }
  let done = false;
  const finish = () => {
    if(done) return; done = true;
    area.removeEventListener('transitionend', onEnd);
    requestAnimationFrame(() => revealSelectedFromGutter(id));
  };
  const onEnd = e => {
    if(e.target === area && (e.propertyName === 'margin-right' || e.propertyName === 'margin')) finish();
  };
  area.addEventListener('transitionend', onEnd);
  setTimeout(finish, 340);   /* fallback > --dur-medium (260ms) if no transitionend fires */
}

/* Single restore chokepoint. Animates the deck back to the home scroll
   captured at session start, then ends the session (clears home) so the next
   reveal recaptures. Idempotent — a no-op once home is cleared, so it can be
   called from every dismissal path without double-firing. Wired into
   kbDeselect(), which every inspector-dismissal / selection-clear path funnels
   through (inspClose() ends by calling it; the deck-background click, drag
   fall-through, command palette, etc. call it directly). */
function restoreDeckHome(){
  if(_inspPrevScrollLeft == null) return;
  const home = _inspPrevScrollLeft;
  _inspPrevScrollLeft = null;   /* end session before animating so a new reveal mid-restore recaptures */
  const area = document.getElementById('deckArea');
  if(area) _inspAnimateScrollLeft(area, home);
}

function inspBuildDescSelect(){
  /* Mirrors buildModalDescSelect but targets #inspDesc. Uses the same
     CCU_PRESETS + custom library so description choices stay consistent. */
  const sel = document.getElementById('inspDesc');
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— select type —</option>';
  const cats = ['Container','Basket','Tank','Skip','Module'];
  cats.forEach(cat => {
    const items = CCU_PRESETS.filter(p => p.cat === cat);
    if(!items.length) return;
    const grp = document.createElement('optgroup');
    grp.label = cat + 's';
    items.forEach(p => {
      const o = document.createElement('option');
      o.value = p.label;
      const dim = `${p.length_m.toFixed(2)}×${p.width_m.toFixed(2)} m`;
      o.textContent = p.approx ? `${p.label} (${dim}~)` : `${p.label} (${dim})`;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  });
  if(S.customLib.length){
    const grp = document.createElement('optgroup');
    grp.label = 'Custom';
    S.customLib.forEach(p => {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  }
  if(cur) sel.value = cur;
}

function inspBuildLocs(selId){
  const g = document.getElementById('inspLocs');
  if(!g) return;
  g.innerHTML = '';
  const show = S.activeLocs.length
    ? S.activeLocs.map(id => locById(id)).filter(Boolean)
    : LOC_ALL;
  show.forEach(loc => {
    const el = document.createElement('div');
    el.className = 'insp-loc' + (loc.id === selId ? ' sel' : '');
    el.style.setProperty('--lc', getLocBase(loc.id));
    el.dataset.lid = loc.id;
    el.innerHTML = `<span class="insp-loc-dot"></span><span class="insp-loc-name">${loc.name}</span>`;
    el.onclick = () => {
      if(!isOperator()) return;
      const c = S.cargo.find(x => x.id === inspSelId);
      if(!c) return;
      c.platform = loc.id;
      g.querySelectorAll('.insp-loc').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
      renderAll();
      kbSelect(inspSelId);
      updateStats(); buildActiveLocStrip(); updateDGSummary();
      save();
    };
    g.appendChild(el);
  });
}

function inspSetStatusSeg(status){
  const seg = document.getElementById('inspStatusSeg');
  if(!seg) return;
  seg.querySelectorAll('button').forEach(b => {
    b.classList.toggle('sel', b.dataset.s === status);
  });
  const rail = document.getElementById('inspRail');
  if(rail) rail.dataset.status = status || '';
}

function inspPopulate(cargo){
  if(!cargo) return;
  const rail = document.getElementById('inspRail');
  const kicker = document.getElementById('inspKicker');
  const title  = document.getElementById('inspTitle');
  const ccu    = document.getElementById('inspCCU');
  const desc   = document.getElementById('inspDesc');
  const wt     = document.getElementById('inspWT');
  if(!rail) return;

  kicker.textContent = cargo.status === 'L'   ? 'Load'
                   : cargo.status === 'BL'  ? 'Backload'
                   : cargo.status === 'ROB' ? 'ROB'
                   : cargo.status === 'TR'  ? 'Transfer'
                   : 'Cargo';
  title.textContent  = (cargo.ccu || cargo.desc || '—');

  inspBuildDescSelect();
  if(ccu)  ccu.value  = cargo.ccu || '';
  if(desc) desc.value = cargo.desc || '';
  if(wt)   wt.value   = (cargo.wt != null ? cargo.wt : '');

  inspBuildLocs(cargo.platform);
  inspSetStatusSeg(cargo.status || 'L');

  /* Summary rows for fields that still live in the legacy modal */
  const dg  = document.getElementById('inspDgDetail');
  const hl  = document.getElementById('inspHlDetail');
  const pri = document.getElementById('inspPriDetail');
  if(dg)  dg.textContent  = (cargo.dgClasses && cargo.dgClasses.length) ? cargo.dgClasses.join(', ') : '—';
  if(hl)  hl.textContent  = cargo.heavyLift ? 'on' : 'off';
  if(pri) pri.textContent = cargo.priority  ? 'on' : 'off';
}

function inspOpen(id){
  if(!isOperator()) return;
  const cargo = S.cargo.find(c => c.id === id);
  if(!cargo) return;
  const prevId = inspSelId;
  inspSelId = id;
  /* Library ↔ Inspector mutual exclusion — inspector wins when cargo is picked */
  if(typeof CP_OPEN !== 'undefined' && CP_OPEN && typeof cpClose === 'function') cpClose();
  const rail = document.getElementById('inspRail');
  if(!rail) return;

  /* Phase 4 — single vs aggregate view. When 2+ cargo are in the selection
     set, render aggregate; otherwise render the usual single-cargo inspector. */
  const isMulti = (typeof KB_SEL_SET !== 'undefined' && KB_SEL_SET.size > 1);
  document.body.classList.toggle('insp-multi', isMulti);

  /* Subtle selection-switch crossfade — when the rail is already open
     for a different cargo, we dip the head text for ~120ms before
     rewriting it. Feels "alive" without being a distraction. */
  const headText = rail.querySelector('.insp-head-text');
  const alreadyOpen = rail.classList.contains('open');
  if(alreadyOpen && prevId != null && prevId !== id && headText){
    headText.classList.add('swap');
    setTimeout(() => {
      if(isMulti) inspPopulateMulti(); else inspPopulate(cargo);
      headText.classList.remove('swap');
      /* After populate rewrites ccu.value, ensure cursor is at end */
      if(!isMulti){
        const ccuEl = document.getElementById('inspCCU');
        if(ccuEl){ const len = ccuEl.value.length; ccuEl.setSelectionRange(len, len); }
      }
    }, 120);
  } else {
    if(isMulti) inspPopulateMulti(); else inspPopulate(cargo);
  }

  /* Capture the pre-open deck scroll once (closed→open) so inspClose can
     restore it. Don't overwrite it when merely switching selection while the
     rail is already open. Captured before the gutter applies, so it reflects
     the true pre-gutter scroll position. */
  if(!alreadyOpen){
    const _area = document.getElementById('deckArea');
    _inspPrevScrollLeft = _area ? _area.scrollLeft : null;
  }

  rail.classList.add('open');
  rail.setAttribute('aria-hidden', 'false');
  document.body.classList.add('insp-open');

  /* Once the gutter has applied and layout settles, scroll a clipped (bow)
     block back into view so its resize handles clear the gutter edge. */
  _inspRevealWhenSettled(id, alreadyOpen);

  /* Deliberately do NOT auto-focus the CCU/ID field on open. A plain block
     selection opens this rail, and stealing focus into the text input would
     route arrow keys to the caret instead of nudging the selected block.
     Keyboard focus stays on the deck; renaming is an explicit click into the
     field. Explicit edit/create flows (E key, "Edit details…") use openModal,
     which focuses its own input separately. */
}

/* Phase 4 — aggregate rendering when KB_SEL_SET.size > 1.
   Summarises: count, total weight, distinct locations, status breakdown. */
function inspPopulateMulti(){
  const ids = Array.from(KB_SEL_SET);
  const cargos = ids
    .map(id => S.cargo.find(c => c.id === id))
    .filter(Boolean);
  if(cargos.length === 0) return;

  const kicker = document.getElementById('inspKicker');
  const title  = document.getElementById('inspTitle');
  const rail   = document.getElementById('inspRail');

  kicker.textContent = 'Multi-select';
  title.textContent  = cargos.length + ' cargo selected';
  if(rail) rail.dataset.status = '';       /* neutral rim in multi mode */

  /* Aggregate stats */
  const totalWt = cargos.reduce((a,c) => a + (parseFloat(c.wt) || 0), 0);
  const countEl = document.getElementById('inspMultiCount');
  const wtEl    = document.getElementById('inspMultiWt');
  const locsEl  = document.getElementById('inspMultiLocs');
  const bdEl    = document.getElementById('inspMultiBreakdown');
  if(countEl) countEl.textContent = cargos.length;
  if(wtEl)    wtEl.textContent    = totalWt.toFixed(1) + ' t';

  /* Distinct locations */
  const locIds = new Set(cargos.map(c => c.platform).filter(Boolean));
  let locsText = '—';
  if(locIds.size === 1){
    const loc = locById(Array.from(locIds)[0]);
    locsText = loc ? loc.name : '—';
  } else if(locIds.size > 1){
    locsText = locIds.size + ' platforms';
  }
  if(locsEl) locsEl.textContent = locsText;

  /* Status breakdown → status-colored chips */
  if(bdEl){
    const counts = { L:0, BL:0, ROB:0, TR:0 };
    cargos.forEach(c => { if(counts[c.status] !== undefined) counts[c.status]++; });
    const labels = { L:'Load', BL:'Backload', ROB:'ROB', TR:'Transfer' };
    bdEl.innerHTML = '';
    Object.keys(counts).forEach(k => {
      if(counts[k] > 0){
        const chip = document.createElement('span');
        chip.className = 'insp-multi-chip s-' + k;
        chip.innerHTML = `<span>${labels[k]}</span><span>${counts[k]}</span>`;
        bdEl.appendChild(chip);
      }
    });
  }
}

function inspClose(){
  inspSelId = null;
  const rail = document.getElementById('inspRail');
  if(rail){
    rail.classList.remove('open');
    rail.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('insp-open');
  document.body.classList.remove('insp-multi');
  /* Deck-home restore is funnelled through kbDeselect() → restoreDeckHome(),
     called below, so every dismissal path (not just this one) restores. */
  if(typeof kbDeselect === 'function') kbDeselect();
}

/* External hook: called by other code when cargo data changes so the
   inspector re-reads the current cargo if it's the selected one. */
function inspRefreshIfOpen(){
  if(inspSelId == null) return;
  const c = S.cargo.find(x => x.id === inspSelId);
  if(!c){ inspClose(); return; }
  inspPopulate(c);
}

/* Tiny debounce helper for text inputs inside the inspector.
   Calls `flush` via blur/Enter so the last edit always persists even if
   the user closes the app mid-typing. */
function _inspDebounce(fn, ms){
  let t;
  const run = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = 0; fn(...args); }, ms);
  };
  run.flush = () => { if(t){ clearTimeout(t); t = 0; fn(); } };
  return run;
}

function bindInspector(){
  const rail = document.getElementById('inspRail');
  if(!rail) return;

  /* Close button */
  const closeBtn = document.getElementById('inspClose');
  if(closeBtn) closeBtn.addEventListener('click', () => inspClose());

  /* Esc while inspector is open */
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && inspSelId != null){
      /* Don't swallow Escape if any modal is open — modals own that key */
      const ovOpen  = document.getElementById('ov')?.classList.contains('open');
      const stOpen  = document.getElementById('stOv')?.classList.contains('open');
      const ascOpen = document.getElementById('ascoOv')?.classList.contains('open');
      if(ovOpen || stOpen || ascOpen) return;
      /* Don't hijack when typing in an input */
      const t = e.target;
      if(t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      inspClose();
    }
  });

  /* ── Live field edits — debounced text inputs, immediate UI echo.
     Pattern: every keystroke updates only the on-deck label (cheap),
     a 250ms debounce commits the model mutation + save. Blur/Enter flush.
     Status / Location / Actions stay immediate (discrete click events). */
  const ccu = document.getElementById('inspCCU');
  if(ccu){
    const commitCcu = () => {
      if(!isOperator() || inspSelId == null) return;
      const c = S.cargo.find(x => x.id === inspSelId);
      if(!c) return;
      c.ccu = ccu.value;
      /* Update on-deck label + stats WITHOUT full renderAll() — keeps typing smooth */
      const cbEl = document.querySelector(`.cb[data-id="${c.id}"] .cb-id`);
      if(cbEl && !cbEl.matches(':focus-within')) cbEl.textContent = c.ccu || '';
      save();
    };
    const commitCcuDebounced = _inspDebounce(commitCcu, 250);
    ccu.addEventListener('input', () => {
      if(!isOperator() || inspSelId == null) return;
      /* Title preview is instant so the rail reflects typing in real time */
      document.getElementById('inspTitle').textContent = ccu.value || '—';
      commitCcuDebounced();
    });
    ccu.addEventListener('blur',  () => commitCcuDebounced.flush());
    ccu.addEventListener('keydown', e => { if(e.key === 'Enter') commitCcuDebounced.flush(); });
  }

  const desc = document.getElementById('inspDesc');
  if(desc) desc.addEventListener('change', () => {
    if(!isOperator() || inspSelId == null) return;
    const c = S.cargo.find(x => x.id === inspSelId);
    if(!c) return;
    c.desc = desc.value;
    /* If a preset matches, adopt its dimensions */
    const preset = CCU_PRESETS.find(p => p.label === desc.value)
              || S.customLib.find(p => p.name === desc.value);
    if(preset){
      if(preset.length_m){ c.length_m = preset.length_m; c.w = m2px_w(preset.length_m); }
      if(preset.width_m) { c.width_m  = preset.width_m;  c.h = m2px_h(preset.width_m); }
    }
    /* Description may change dimensions — a full renderAll is necessary here */
    renderAll(); kbSelect(inspSelId);
    updateStats(); buildActiveLocStrip(); save();
  });

  const wt = document.getElementById('inspWT');
  if(wt){
    const commitWT = () => {
      if(!isOperator() || inspSelId == null) return;
      const c = S.cargo.find(x => x.id === inspSelId);
      if(!c) return;
      const v = parseFloat(wt.value);
      c.wt = isNaN(v) ? 0 : v;
      /* Weight change only affects stats — no need to re-render cargo blocks */
      if(typeof updateStats === 'function') updateStats();
      if(typeof buildActiveLocStrip === 'function') buildActiveLocStrip();
      save();
    };
    const commitWTDebounced = _inspDebounce(commitWT, 250);
    wt.addEventListener('input', commitWTDebounced);
    wt.addEventListener('blur',  () => commitWTDebounced.flush());
    wt.addEventListener('keydown', e => { if(e.key === 'Enter') commitWTDebounced.flush(); });
  }

  /* Status segmented control */
  const seg = document.getElementById('inspStatusSeg');
  if(seg){
    seg.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        if(!isOperator() || inspSelId == null) return;
        const c = S.cargo.find(x => x.id === inspSelId);
        if(!c) return;
        c.status = b.dataset.s;
        inspSetStatusSeg(c.status);
        const kicker = document.getElementById('inspKicker');
        if(kicker) kicker.textContent = c.status === 'L'   ? 'Load'
                                     : c.status === 'BL'  ? 'Backload'
                                     : c.status === 'ROB' ? 'ROB'
                                     : c.status === 'TR'  ? 'Transfer'
                                     : 'Cargo';
        renderAll(); kbSelect(inspSelId);
        updateStats(); buildActiveLocStrip(); checkSeg(); updateDGSummary(); save();
      });
    });
  }

  /* Actions */
  const rotBtn = document.getElementById('inspRot');
  if(rotBtn) rotBtn.addEventListener('click', () => {
    if(!isOperator() || inspSelId == null) return;
    const c = S.cargo.find(x => x.id === inspSelId);
    if(!c) return;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const nw = c.h, nh = c.w;
    c.w = nw; c.h = nh;
    c.x = Math.max(0, Math.min(cx - nw / 2, TW  - nw));
    c.y = Math.max(0, Math.min(cy - nh / 2, CVH - nh));
    const tmp = c.length_m; c.length_m = c.width_m; c.width_m = tmp;
    c.rot = ((c.rot || 0) + 1) % 4;
    renderAll(); kbSelect(inspSelId); checkSeg(); save();
  });

  const dupBtn = document.getElementById('inspDup');
  if(dupBtn) dupBtn.addEventListener('click', () => {
    if(!isOperator() || inspSelId == null) return;
    const c = S.cargo.find(x => x.id === inspSelId);
    if(!c) return;
    const newC = {
      ...c,
      id: Date.now() + Math.random(),
      x: Math.min(c.x + c.w + 6, TW  - c.w),
      y: Math.min(c.y + 0,       CVH - c.h),
      ccu: c.ccu ? c.ccu + ' (copy)' : '',
    };
    S.cargo.push(newC);
    renderAll();
    kbSelect(newC.id);
    inspOpen(newC.id);
    updateStats(); buildActiveLocStrip(); save();
  });

  const delBtn = document.getElementById('inspDel');
  if(delBtn) delBtn.addEventListener('click', () => {
    if(!isOperator() || inspSelId == null) return;
    /* Phase 4 — bulk remove when a multi-selection is active.
       Single selection still removes just the one. */
    const isMulti = (typeof KB_SEL_SET !== 'undefined' && KB_SEL_SET.size > 1);
    if(isMulti){
      const ids = Array.from(KB_SEL_SET);
      animateCargoExit(ids);
      S.cargo = S.cargo.filter(c => !KB_SEL_SET.has(c.id));
      ids.forEach(id => { if(typeof dgEvictDeletedCargo === 'function') dgEvictDeletedCargo(id); });
    } else {
      const id = inspSelId;
      animateCargoExit(id);
      S.cargo = S.cargo.filter(c => c.id !== id);
      if(typeof dgEvictDeletedCargo === 'function') dgEvictDeletedCargo(id);
    }
    inspClose();
    renderAll(); updateStats(); buildActiveLocStrip(); checkSeg(); updateDGSummary(); save();
  });

  const editDetailsBtn = document.getElementById('inspEditDetails');
  if(editDetailsBtn) editDetailsBtn.addEventListener('click', () => {
    if(inspSelId == null) return;
    /* Open legacy modal for DG / HL / Priority / Transfer destination.
       While the modal is over the inspector, body gets `mdl-over-insp`
       so the inspector body fades slightly — communicates "modal has
       focus, rail is still tracking the same cargo". Modal save mutates
       S.cargo; we refresh the inspector when the modal closes. */
    document.body.classList.add('mdl-over-insp');
    openModal(inspSelId);
    const ov = document.getElementById('ov');
    if(!ov) return;
    const obs = new MutationObserver(() => {
      if(!ov.classList.contains('open')){
        obs.disconnect();
        document.body.classList.remove('mdl-over-insp');
        inspRefreshIfOpen();
      }
    });
    obs.observe(ov, { attributes:true, attributeFilter:['class'] });
  });
}
function bindModal(){
  document.getElementById('mCan').onclick=()=>{_cpExitPlacing();closeModal();};   /* HOOK 5 — return library on cancel */
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
  document.getElementById('ov').onclick=e=>{if(e.target===document.getElementById('ov')){_cpExitPlacing();closeModal();}};
  document.querySelectorAll('.mdl-st').forEach(b=>{b.onclick=()=>{modalSt=b.dataset.s;document.querySelectorAll('.mdl-st').forEach(x=>x.classList.toggle('sel',x===b));};});
  document.getElementById('mRm').onclick=()=>{if(!isModalActionable(document.getElementById('ov')))return;if(!isOperator())return;const _rmId=editId;animateCargoExit(_rmId);S.cargo=S.cargo.filter(c=>c.id!==_rmId);dgEvictDeletedCargo(_rmId);renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();_forceCloseModal();};
  document.getElementById('mSav').onclick=()=>{
    _cpExitPlacing();   /* HOOK 5 — return library on save, incl. stamp mode which skips cancelPending below */
    if(!isModalActionable(document.getElementById('ov'))) return;
    if(!isOperator()) return;          /* Viewer: block save */
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
    ensureLocActive(c.platform);   /* keep a location chosen in the editor in the active strip */
    c.status=modalSt||'L';
    c.dgClasses=[..._dgMultiSelected];
    c.heavyLift=document.getElementById('mHL').classList.contains('on');
    c.priority=document.getElementById('mPriority')?.classList.contains('on')||false;
    c.trDest=(c.status==='TR')?(document.getElementById('mdlTrDest')?.value||''):'';
    renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();_forceCloseModal();
    /* Hybrid stamp: a click-to-place stamp stays armed across save so the next
       click drops another copy; only non-stamp placements (DG, drag-drop) and
       existing-block edits disarm here. The four explicit paths still disarm. */
    if(!_stampPlacement) cancelPending();
  };
  document.getElementById('ov').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('mSav').click();});
  /* Family-style dismiss: Escape key + swipe-down gesture */
  const _ovRef = document.getElementById('ov');
  const _mdlRef = _ovRef.querySelector('.mdl');
  bindEscapeDismiss(_ovRef, ()=>{_cpExitPlacing();closeModal();});
  bindSwipeDismiss(_mdlRef, ()=>{_cpExitPlacing();closeModal();});
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
function cancelPending(){_cpExitPlacing();S.pending=null;document.querySelectorAll('.lc,.dgc,.asco-qitem').forEach(c=>c.classList.remove('sel','selected-q'));document.getElementById('hint').innerHTML=t('hint_select');updateDGZones();}
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
}
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
    _appVersion: (typeof CURRENT_BUILD !== 'undefined' ? CURRENT_BUILD : 'v3.0.0'),
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
function _isTauri(){ return typeof window !== 'undefined' && !!(window.__TAURI_INTERNALS__ || window.__TAURI__); }
let _dirty = false;            /* true when unsaved changes exist */
let _autosaveEnabled = true;   /* user-togglable autosave */

/* ── Undo / Redo ─────────────────────────────────────────── */
const UNDO_MAX = 50;
let _undoStack = [];
let _redoStack = [];
/* Baseline snapshot of the LAST COMMITTED state. Initialised at bootstrap
   via seedHistoryBaseline() after the first render. On every _pushUndo():
     1. The baseline (pre-mutation state) is pushed onto the undo stack
     2. The baseline is updated to the current (post-mutation) state
   This flips every existing save() site from "push post-state" to "push
   pre-state" semantics with zero call-site edits, so a single Ctrl+Z
   reliably pops the one pre-mutation snapshot the user expects. */
let _lastCommitted = null;

function _takeSnapshot(){
  return JSON.stringify({
    cargo: S.cargo, activeLocs: S.activeLocs, selLoc: S.selLoc,
    customLib: S.customLib, customLocs: S.customLocs,
    voyRemarks: S.voyRemarks, dynColors: DYN_COLORS
  });
}

/* Must be called exactly once after the initial load finishes so the
   first user action has a pre-state to push onto the undo stack. */
function seedHistoryBaseline(){
  _lastCommitted = _takeSnapshot();
  _undoStack = [];
  _redoStack = [];
  _updateUndoButtons();
}

function _pushUndo(){
  const current = _takeSnapshot();
  /* No-op dedupe: autosave and idempotent re-saves fire save() repeatedly
     without any state change. Skip the push so the stack holds only real
     history steps. Also protects against late-bootstrap calls when the
     baseline hasn't been seeded yet. */
  if(_lastCommitted === null){ _lastCommitted = current; return; }
  if(current === _lastCommitted) return;
  _undoStack.push(_lastCommitted);
  if(_undoStack.length > UNDO_MAX) _undoStack.shift();
  _lastCommitted = current;
  _redoStack = [];
  _updateUndoButtons();
}

/* Phase 13 — describe what happened between two cargo id sets so the
   undo/redo toast carries context. Minimal semantic diff: restored count
   = ids that appeared, removed count = ids that disappeared. Position /
   status / rotation changes surface as an unchanged-set fallback. */
function _diffCargoIds(beforeIds, afterIds){
  const before = new Set(beforeIds.map(String));
  const after  = new Set(afterIds.map(String));
  const appeared   = [...after].filter(id => !before.has(id));
  const disappeared= [...before].filter(id => !after.has(id));
  const survived   = [...after].filter(id =>  before.has(id));
  return { appeared, disappeared, survived };
}

function undo(){
  if(!_undoStack.length) return;
  /* Current (post-action) state becomes the redo target. */
  _redoStack.push(_takeSnapshot());
  /* Pop the pre-mutation state and restore it. */
  const snapStr = _undoStack.pop();
  const snap    = JSON.parse(snapStr);
  const beforeIds = S.cargo.map(c => c.id);
  _restoreSnapshot(snap);
  /* Rebase the baseline to the just-restored state so the next mutation
     pushes the correct pre-state onto the stack. */
  _lastCommitted = snapStr;
  const diff = _diffCargoIds(beforeIds, S.cargo.map(c => c.id));
  _animateRestoredCargo(diff.appeared);
  _updateUndoButtons();
  showToast(_formatUndoMessage('Undo', diff), 'ok');
  /* Phase 27 — restorative feedback. Sound fires always; pulse decorates
     existing cargo (not pre-delete, not just-appeared) so the operator
     sees which piece reverted without spamming every block. */
  playSound('undo');
  _pulseRestoredCargo(diff.survived);
}

function redo(){
  if(!_redoStack.length) return;
  /* Current state goes back to undo as a restore point. */
  _undoStack.push(_takeSnapshot());
  if(_undoStack.length > UNDO_MAX) _undoStack.shift();
  const snapStr = _redoStack.pop();
  const snap    = JSON.parse(snapStr);
  const beforeIds = S.cargo.map(c => c.id);
  _restoreSnapshot(snap);
  _lastCommitted = snapStr;
  const diff = _diffCargoIds(beforeIds, S.cargo.map(c => c.id));
  _animateRestoredCargo(diff.appeared);
  _updateUndoButtons();
  showToast(_formatUndoMessage('Redo', diff), 'ok');
  playSound('redo');
  _pulseRestoredCargo(diff.survived);
}

/* Phase 27 — quick cool-tone pulse on cargo that survived across an
   undo/redo restore. Restrained: 260ms, no scale, no saturation bump,
   just a soft inset ring that confirms "this piece changed state".
   Max 8 blocks pulsed so dense plans don't get a wall of feedback. */
function _pulseRestoredCargo(ids){
  if(!ids || ids.length === 0) return;
  const cap = Math.min(ids.length, 8);
  for(let i = 0; i < cap; i++){
    const el = document.querySelector(`.cb[data-id="${ids[i]}"]`);
    if(!el) continue;
    el.classList.remove('cb-undo-pulse');
    void el.offsetWidth;
    el.classList.add('cb-undo-pulse');
    el.addEventListener('animationend',
      () => el.classList.remove('cb-undo-pulse'),
      { once: true });
  }
}

/* Phase 27 — single-cargo pulse helper. Used by rotate, duplicate-trail,
   dg-resolved. Reflow dance ensures the class re-applies even when the
   pulse fires back-to-back on the same element. */
function _pulseCargo(id, cls){
  const el = document.querySelector(`.cb[data-id="${id}"]`);
  if(!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend',
    () => el.classList.remove(cls),
    { once: true });
}

/* Phase 27 — duplicate trail. A pale ghost at the source position fades
   and shrinks while the new cargo gets a gentle spawn pulse. The trail
   is absolutely positioned inside the deck canvas so it tracks zoom. */
function _emitDuplicateTrail(x, y, w, h, newId){
  const cv = document.getElementById('cvDECK');
  if(!cv) return;
  const trail = document.createElement('div');
  trail.className = 'cb-duplicate-trail';
  trail.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  cv.appendChild(trail);
  trail.addEventListener('animationend',
    () => trail.remove(),
    { once: true });
  /* Pair with a gentle spawn pulse on the new cargo itself. */
  _pulseCargo(newId, 'cb-duplicate-pulse');
}

/* Phase 13 — apply the shared .just-placed entrance animation to cargo
   that newly appeared after a snapshot restore. Reuses the exact motion
   already used by library/group-drop so the visual language stays
   consistent across add paths. */
function _animateRestoredCargo(ids){
  if(!ids || ids.length === 0) return;
  ids.forEach(id => {
    const el = document.querySelector(`.cb[data-id="${id}"]`);
    if(!el) return;
    /* Avoid double-adding if the element already has the class from
       another recent placement animation. */
    if(el.classList.contains('just-placed')) return;
    el.classList.add('just-placed');
    el.addEventListener('animationend',
      () => el.classList.remove('just-placed'),
      { once:true });
  });
}

function _formatUndoMessage(label, diff){
  const { appeared, disappeared } = diff;
  if(appeared.length > 0 && disappeared.length === 0){
    return `${label} · ${appeared.length} restored`;
  }
  if(disappeared.length > 0 && appeared.length === 0){
    return `${label} · ${disappeared.length} removed`;
  }
  if(appeared.length === 0 && disappeared.length === 0){
    return `${label} · changes reverted`;
  }
  /* Mixed case — rare but possible (e.g. undoing a complex bulk op). */
  return `${label} · ${appeared.length} restored · ${disappeared.length} removed`;
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
      invoke('write_file', { path: _currentFilePath, contents: json }).catch(e => {
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
    _appVersion: (typeof CURRENT_BUILD !== 'undefined' ? CURRENT_BUILD : 'v3.0.0'),
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
      cargoColors: CARGO_COLORS,
      voyRemarks: S.voyRemarks || '',
      zoomLevel:  zoomLevel
    }
  };
}

/* ── Shared native Save As dialog ───────────────────────────
   Returns the chosen file path, or null if cancelled.
   Works in Tauri desktop mode only. Browser mode returns null. */
async function _nativeSaveDialog(defaultName, filterName, extensions) {
  if (!_isTauri()) return null;
  try {
    const dialogModule = await import('@tauri-apps/plugin-dialog');
    const path = await dialogModule.save({
      title: 'Save As',
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: extensions }]
    });
    return path || null;
  } catch (e) {
    showToast('Save dialog error: ' + (e && e.message || e), 'warn');
    return null;
  }
}

/* ── Write bytes or string to a chosen path via Tauri ─── */
async function _tauriWriteBytes(path, uint8arr) {
  await invoke('write_file_bytes', { path, bytes: Array.from(uint8arr) });
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
    await invoke('add_recent_file', { path, name: name || 'Untitled' });
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
    await invoke('write_file', { path: targetPath, contents: json });

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
    const contents = await invoke('read_file', { path: filePath });
    let envelope = JSON.parse(contents);

    /* Run migrations if needed */
    if (envelope._schema < PLAN_SCHEMA_CURRENT) {
      envelope = migratePlan(envelope);
    }

    /* Apply to app state (same logic as loadPlan) */
    const d = envelope.plan;
    if (d.cargo) { S.cargo = d.cargo; _migrateDgClasses(S.cargo); }
    if (d.customLib) { S.customLib = d.customLib; buildCustList(); buildCargoList(); }
    if (d.customLocs && Array.isArray(d.customLocs)) S.customLocs = d.customLocs;
    if (d.voyage) document.getElementById('voyIn').value = d.voyage;
    if (d.activeLocs && d.activeLocs.length) S.activeLocs = d.activeLocs;
    if (d.selLoc) S.selLoc = d.selLoc;
    if (d.date) { selDate = new Date(d.date); if (isNaN(selDate)) selDate = new Date(); }
    if (d.dynColors) { Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]); Object.assign(DYN_COLORS, d.dynColors); }
    if (d.cargoColors) { Object.keys(CARGO_COLORS).forEach(k => delete CARGO_COLORS[k]); Object.assign(CARGO_COLORS, d.cargoColors); }
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
    const contents = await invoke('read_file', { path });
    let envelope = JSON.parse(contents);
    if (envelope._schema < PLAN_SCHEMA_CURRENT) {
      envelope = migratePlan(envelope);
    }
    const d = envelope.plan;
    if (d.cargo) { S.cargo = d.cargo; _migrateDgClasses(S.cargo); }
    if (d.customLib) { S.customLib = d.customLib; buildCustList(); buildCargoList(); }
    if (d.customLocs && Array.isArray(d.customLocs)) S.customLocs = d.customLocs;
    if (d.voyage) document.getElementById('voyIn').value = d.voyage;
    if (d.activeLocs && d.activeLocs.length) S.activeLocs = d.activeLocs;
    if (d.selLoc) S.selLoc = d.selLoc;
    if (d.date) { selDate = new Date(d.date); if (isNaN(selDate)) selDate = new Date(); }
    if (d.dynColors) { Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]); Object.assign(DYN_COLORS, d.dynColors); }
    if (d.cargoColors) { Object.keys(CARGO_COLORS).forEach(k => delete CARGO_COLORS[k]); Object.assign(CARGO_COLORS, d.cargoColors); }
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
    invoke('write_file', { path: _currentFilePath, contents: json }).catch(() => {});
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
      await invoke('write_file', { path: targetPath, contents: json });
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
        const contents = await invoke('read_file', { path: filePath });
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
    if (d.cargo) { S.cargo = d.cargo; _migrateDgClasses(S.cargo); }
    if (d.customLib) { S.customLib = d.customLib; buildCustList(); buildCargoList(); }
    if (d.customLocs && Array.isArray(d.customLocs)) S.customLocs = d.customLocs;
    if (d.voyage) document.getElementById('voyIn').value = d.voyage;
    if (d.activeLocs && d.activeLocs.length) S.activeLocs = d.activeLocs;
    if (d.selLoc) S.selLoc = d.selLoc;
    if (d.date) { selDate = new Date(d.date); if (isNaN(selDate)) selDate = new Date(); }
    if (d.dynColors) { Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]); Object.assign(DYN_COLORS, d.dynColors); }
    if (d.cargoColors) { Object.keys(CARGO_COLORS).forEach(k => delete CARGO_COLORS[k]); Object.assign(CARGO_COLORS, d.cargoColors); }
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
    _appVersion: (typeof CURRENT_BUILD !== 'undefined' ? CURRENT_BUILD : 'v3.0.0'),
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
      cargoColors: CARGO_COLORS,
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
  if (d.cargo) { S.cargo = d.cargo; _migrateDgClasses(S.cargo); }
  if (d.customLib) { S.customLib = d.customLib; buildCustList(); buildCargoList(); }
  if (d.customLocs && Array.isArray(d.customLocs)) S.customLocs = d.customLocs;
  if (d.voyage) document.getElementById('voyIn').value = d.voyage;
  if (d.activeLocs && d.activeLocs.length) S.activeLocs = d.activeLocs;
  if (d.selLoc) S.selLoc = d.selLoc;
  if (d.date) { selDate = new Date(d.date); if (isNaN(selDate)) selDate = new Date(); }
  if (d.dynColors) Object.assign(DYN_COLORS, d.dynColors);
  if (d.cargoColors) { Object.keys(CARGO_COLORS).forEach(k => delete CARGO_COLORS[k]); Object.assign(CARGO_COLORS, d.cargoColors); }
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
function save() {
  _pushUndo();
  savePlan();
  _dirty = true;
  _updateSaveIndicator();
  _syncPushDebounced();
  /* Phase 3A — quiet heartbeat on the bottom rail's save dot.
     One-shot 520ms ring pulse; no loop, no decoration. */
  const dots = document.querySelectorAll('.save-dot');
  dots.forEach(dot => {
    dot.classList.remove('pulse');
    /* Force reflow so re-adding .pulse restarts the animation */
    void dot.offsetWidth;
    dot.classList.add('pulse');
    setTimeout(() => dot.classList.remove('pulse'), 560);
  });
}
function load() { loadPlan(); }

let zoomLevel=1.0;const ZOOM_STEP=0.1,ZOOM_MIN=0.3,ZOOM_MAX=2.0;
function applyZoom(z){
  zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  const wrap = document.getElementById('deckZoomWrap');
  const inner = wrap.querySelector('.deck-outer');
  /* Center-origin scaling so the deck grows/shrinks symmetrically —
     aft and fore move equally instead of the stern appearing anchored.
     The wrap's LAYOUT size is set to natural * zoom so the flex parent
     centers the visually-scaled content correctly and scrolls when the
     content overflows on zoom-in. */
  wrap.style.transform = `scale(${zoomLevel})`;
  wrap.style.transformOrigin = '50% 50%';
  if(inner){
    const naturalW = inner.offsetWidth;
    const naturalH = inner.offsetHeight;
    wrap.style.width  = (naturalW * zoomLevel) + 'px';
    wrap.style.height = (naturalH * zoomLevel) + 'px';
    /* Compensate for the center-origin pivot:
         when wrap layout = N*S and origin = N*S/2, the scaled content
         naturally spans origin*(1-S) to origin+N*(1-S/2)S, which drifts
         off-box. Pre-translate by -N*(1-S)/2 to re-seat the top-left
         at (0,0) so the content fills the layout rect exactly.        */
    const tx = -naturalW * (1 - zoomLevel) / 2;
    const ty = -naturalH * (1 - zoomLevel) / 2;
    wrap.style.transform = `translate(${tx}px, ${ty}px) scale(${zoomLevel})`;
  }
  document.getElementById('zoomLbl').textContent = Math.round(zoomLevel * 100) + '%';
  /* Ship silhouette visibility tiers — CSS reads body.zoom-* classes
     (kept for any other consumers, but .vessel-bg opacity now ignores
     them in favour of a smooth zoom-vs-FIT ramp — see below).        */
  const pct = zoomLevel * 100;
  const tier = pct >= 90 ? 'high' : pct >= 70 ? 'mid' : pct >= 40 ? 'low' : 'minimum';
  document.body.classList.remove('zoom-high','zoom-mid','zoom-low','zoom-minimum');
  document.body.classList.add('zoom-' + tier);
  /* Vessel silhouette fade — at/above FIT the deck is the primary
     working surface so the decorative ship drawing hides completely.
     Below FIT it fades in progressively, reaching peak opacity at
     ZOOM_MIN. Easing is quadratic ease-in on the normalized distance
     below FIT so the reveal starts gently, then strengthens. */
  updateVesselBgOpacity();
  /* Phase 23 — keep the measurement label pinned to the line midpoint
     when the deck zooms. The label is position:fixed in <body>, so its
     client coordinates must be recomputed from the new cvRect. */
  if(typeof _rulerRender === 'function') _rulerRender();
}

function computeFitScale(){
  const area  = document.getElementById('deckArea');
  const inner = document.querySelector('.deck-outer');
  if(!area || !inner) return 1;
  const padX = 16, padY = 8;
  const sx = (area.clientWidth  - padX) / inner.offsetWidth;
  const sy = (area.clientHeight - padY) / inner.offsetHeight;
  return Math.min(sx, sy);
}

function updateVesselBgOpacity(){
  const fit = computeFitScale();
  const VESSEL_BG_MAX = 0.85;
  let op;
  if(zoomLevel >= fit - 0.002){
    op = 0;                                             /* at or above FIT */
  } else {
    const span = Math.max(0.01, fit - ZOOM_MIN);
    const t = Math.min(1, Math.max(0, (fit - zoomLevel) / span));
    const eased = t * t;                                /* ease-in quad */
    op = eased * VESSEL_BG_MAX;
  }
  document.documentElement.style.setProperty('--vessel-bg-opacity', op.toFixed(3));
}
function fitToScreen(){
  const area  = document.getElementById('deckArea');
  const inner = document.querySelector('.deck-outer');
  if(!inner || !area) return;
  /* CONTAIN — show the entire deck, Bay 12 aft to Bay 1 forward. Always
     computed from the deck's natural dimensions (offsetWidth/Height are
     the untransformed layout size) and the untransformed area size
     (clientWidth/Height), so FIT is stateless — it doesn't depend on
     the current zoom or pan. Reset scroll so the deck centers cleanly. */
  area.scrollLeft = 0;
  area.scrollTop  = 0;
  const padX = 16, padY = 8;
  const sx = (area.clientWidth  - padX) / inner.offsetWidth;
  const sy = (area.clientHeight - padY) / inner.offsetHeight;
  applyZoom(Math.min(sx, sy));
}
function initZoom(){document.getElementById('zoomIn').onclick=()=>applyZoom(zoomLevel+ZOOM_STEP);document.getElementById('zoomOut').onclick=()=>applyZoom(zoomLevel-ZOOM_STEP);document.getElementById('zoomReset').onclick=()=>applyZoom(1.0);document.getElementById('zoomFit').onclick=fitToScreen;document.getElementById('deckArea').addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();applyZoom(zoomLevel+(e.deltaY<0?ZOOM_STEP:-ZOOM_STEP));},{passive:false});setTimeout(()=>{const area=document.getElementById('deckArea'),inner=document.querySelector('.deck-outer');if(inner&&inner.offsetWidth>area.clientWidth-24)fitToScreen();},60);
/* Pinch-to-zoom on touch devices */
let _pinchStartDist=0, _pinchStartZoom=1;
document.getElementById('deckArea').addEventListener('touchstart',e=>{if(e.touches.length===2){e.preventDefault();const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;_pinchStartDist=Math.sqrt(dx*dx+dy*dy);_pinchStartZoom=zoomLevel;}},{passive:false});
document.getElementById('deckArea').addEventListener('touchmove',e=>{if(e.touches.length===2&&_pinchStartDist>0){e.preventDefault();const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;const dist=Math.sqrt(dx*dx+dy*dy);applyZoom(_pinchStartZoom*(dist/_pinchStartDist));}},{passive:false});
document.getElementById('deckArea').addEventListener('touchend',()=>{_pinchStartDist=0;});

/* ── DG pill positioning ─────────────────────────────────────
   Keeps `--dg-top` in sync with the actual top of .deck-area so the
   fixed-position pill always floats at the very top of the deck
   viewport, independent of viewport size changes. The pill never
   moves with pan/zoom because it lives outside the transform layer. */
(function syncDgPillTop(){
  const area = document.getElementById('deckArea');
  if(!area) return;
  function sync(){
    const topPx = Math.round(area.getBoundingClientRect().top + 6); /* 6 px float above deck edge */
    document.documentElement.style.setProperty('--dg-top', topPx + 'px');
    /* FIT scale depends on viewport size; keep the silhouette fade in
       lockstep with any resize by recomputing whenever the deck-area
       box changes. */
    if(typeof updateVesselBgOpacity === 'function') updateVesselBgOpacity();
  }
  sync();
  window.addEventListener('resize', sync);
  if(typeof ResizeObserver !== 'undefined'){
    new ResizeObserver(sync).observe(area);
  }
})();

/* ── Drag-to-pan ─────────────────────────────────────────────
   Activates with middle-mouse-button OR Alt+left-mouse-button.
   Cargo blocks (.cb) keep their own left-drag behaviour: we early-out
   when the mousedown originates inside a cargo block. The pan updates
   .deck-area.scrollLeft / scrollTop so it works in both axes
   regardless of the current zoom level (the wrap is sized to natural*zoom
   so overflow is real and scrollable). */
(function initDeckPan(){
  const area = document.getElementById('deckArea');
  if(!area) return;
  let panning = false, startX = 0, startY = 0, baseLeft = 0, baseTop = 0;

  area.addEventListener('mousedown', (e) => {
    /* Allow normal left-click on cargo, controls, and inside .dcv. */
    const isMiddle = e.button === 1;
    const isAltLeft = e.button === 0 && e.altKey;
    if(!isMiddle && !isAltLeft) return;
    /* Don't hijack drag-start on actual cargo blocks (left-click only). */
    if(isAltLeft && e.target.closest('.cb, .rh, .cb-del, .cb-rot, .cb-copy')) return;
    panning = true;
    startX = e.clientX; startY = e.clientY;
    baseLeft = area.scrollLeft; baseTop = area.scrollTop;
    area.classList.add('deck-panning');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if(!panning) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    /* Drag right → reveal content on the right → scroll right.
       Inverted from naive (we move the camera, not the content). */
    area.scrollLeft = baseLeft - dx;
    area.scrollTop  = baseTop  - dy;
    e.preventDefault();
  });
  function stopPan(){
    if(!panning) return;
    panning = false;
    area.classList.remove('deck-panning');
  }
  window.addEventListener('mouseup',    stopPan);
  window.addEventListener('mouseleave', stopPan);
  /* Disable native browser middle-click autoscroll which would compete. */
  area.addEventListener('auxclick', (e) => { if(e.button === 1) e.preventDefault(); });
})();
}

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
   Checks Hazard Class column OR description for "HAZ CLASS" keyword.
   Returns ARRAY of unique IMDG classes (max 3).                    */
function extractDGClasses(hazardCell, description){
  const results = [];
  const addCls = v => { const s = String(v).trim(); if(s && /^\d+(\.\d+)?$/.test(s) && !results.includes(s)) results.push(s); };

  /* Parse hazard cell — may contain comma/ampersand-separated list */
  if(hazardCell){
    const s = String(hazardCell).trim();
    if(s && s.toUpperCase() !== 'LQ'){
      for(const part of s.split(/[,&]/)){
        addCls(part);
      }
    }
  }

  /* Fallback: scan description text for HAZ CLASS / CLASS patterns */
  if(description){
    const d = String(description);
    const re = /(?:haz(?:ard)?\s*class|class)\s*(\d+(?:\.\d+)?)/gi;
    let m;
    while((m = re.exec(d)) !== null) addCls(m[1]);
  }

  return results.slice(0, 3);
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
    const dgClasses  = extractDGClasses(hazardCell, desc);
    const heavyLift  = wt >= HL_THRESHOLD;

    /* Size detection from description */
    const detected = detectSizeFromDesc(desc);
    let dims = detected
      ? sizeToCanvasPx(detected.length_m, detected.width_m)
      : sizeToCanvasPx(null, null);
    let sizeDetected = !!detected;
    let autoAssigned = '';

    /* Auto-assign rule: "food" in description → Mini Container (DNV) */
    if(/food/i.test(desc.trim())){
      const foodPreset = CCU_PRESETS.find(p => p.key === 'cont_mini_std');
      if(foodPreset){
        dims = sizeToCanvasPx(foodPreset.length_m, foodPreset.width_m);
        sizeDetected = true;
        autoAssigned = foodPreset.label;
      }
    }

    items.push({
      desc, ccu, wt, dgClasses, heavyLift,
      dims, autoAssigned,
      platform:   loadlistId || sheetLocation || sheetName,
      loadlistId: loadlistId,
      location:   sheetLocation,
      noLifts,
      sheetName,
      sizeDetected,
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
      if(item.dgClasses&&item.dgClasses.length>0) badges += `<span class="asco-badge dg">◆ DG ${escHtml(item.dgClasses.join(', '))}</span>`;
      if(item.heavyLift)      badges += `<span class="asco-badge hl">⬆ Heavy Lift</span>`;
      if(!item.sizeDetected)  badges += `<span class="asco-badge no-size">⚠ Size not detected</span>`;
      else badges += `<span class="asco-badge size">${item.dims.length_m.toFixed(2)}×${item.dims.width_m.toFixed(2)} m</span>`;
      if(item.wt > 0) badges += `<span class="asco-badge wt">${item.wt.toFixed(1)} T</span>`;
      if(item.autoAssigned) badges += `<span class="asco-badge auto-assign">Auto: ${escHtml(item.autoAssigned)}</span>`;

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
  /* Dedup by CCU against existing queue entries and cargo already placed
     on deck. Same normalisation as runManifestMatch (trim + uppercase).
     Rows without a CCU are never dedup-matched — always imported. */
  const normCcu = v => (v || '').trim().toUpperCase();
  const queueKeys = new Set(IMPORT_QUEUE.map(q => normCcu(q.ccu)).filter(Boolean));
  const deckKeys  = new Set(S.cargo.map(c => normCcu(c.ccu)).filter(Boolean));
  let skippedInQueue = 0, skippedOnDeck = 0, noCcuCount = 0;
  ascoImportData.forEach((sheet, si) => {
    sheet.items.forEach((item, ii) => {
      const key = `${si}-${ii}`;
      if(!ascoSelected.has(key)) return;

      const ccuKey = normCcu(item.ccu);
      if(ccuKey && deckKeys.has(ccuKey)){ skippedOnDeck++; return; }
      if(ccuKey && queueKeys.has(ccuKey)){ skippedInQueue++; return; }
      if(ccuKey) queueKeys.add(ccuKey); else noCcuCount++;

      const qItem = {
        id: Date.now() + Math.random(),
        name: item.desc,
        ccu: item.ccu,
        wt: item.wt,
        dgClasses: item.dgClasses || [],
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
        autoAssigned: item.autoAssigned || '',
      };
      IMPORT_QUEUE.push(qItem);
      added.push(qItem);
    });
  });

  closeAscoModal();
  if(window._cpAfterImport) window._cpAfterImport();
  buildQueueList();
  updateQueueBadge();

  /* Manifest-comparison readout retired from the drawer (dormant in place). */

  /* Auto-open queue tab, auto-expand panel */
  if(added.length > 0){
    const qTab = document.querySelector('.stab[data-tab="queue"]');
    if(qTab) qTab.click();

    /* Gently expand the library panel so items are visible */
    if(window._libExpandForImport) window._libExpandForImport();
  }

  /* Import summary: plain "N added" when nothing was skipped, otherwise
     full added / already-imported / already-on-deck / no-CCU breakdown. */
  if(skippedInQueue + skippedOnDeck > 0){
    showToast(
      t('toast_import_summary', added.length, skippedInQueue, skippedOnDeck, noCcuCount),
      added.length > 0 ? 'info' : 'warn'
    );
  } else if(added.length > 0){
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
    const _qdg = item.dgClasses||[];
    if(_qdg.length>0)      badges += `<span class="asco-badge dg">◆ DG ${escHtml(_qdg.join(', '))}</span>`;
    if(item.heavyLift)     badges += `<span class="asco-badge hl">⬆ HL</span>`;
    if(item.wt > 0)        badges += `<span class="asco-badge wt">${item.wt.toFixed(1)} T</span>`;
    if(!item.sizeDetected) badges += `<span class="asco-badge no-size">default size</span>`;
    if(item.autoAssigned)  badges += `<span class="asco-badge auto-assign">Auto: ${escHtml(item.autoAssigned)}</span>`;

    el.innerHTML = `
      <div class="asco-qitem-icon">${_qdg.length>0 ?
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
      const removed = IMPORT_QUEUE.splice(qi, 1)[0];
      buildQueueList();
      updateQueueBadge();
      showUndoToast(
        t('removed_prefix') + (removed.displayName || removed.name || 'item'),
        t('undo'),
        () => { IMPORT_QUEUE.splice(qi, 0, removed); buildQueueList(); updateQueueBadge(); }
      );
    });

    list.appendChild(el);
  });
}

function selectQueueItem(qi){
  if(!isOperator()){ showToast('Switch to Operator mode to place cargo'); return; }
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
    `<b>📋 ${escHtml(item.name)}</b> — click deck to place${item.dgClasses&&item.dgClasses.length>0 ? ` · DG ${item.dgClasses.join(', ')}` : ''}`;

  /* If DG, show pending exclusion zones */
  if(item.dgClasses&&item.dgClasses.length>0){
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
  /* V11: Show skeleton shimmer while parsing */
  const ascoBody = document.querySelector('.asco-body') || document.getElementById('ascoContent');
  if(ascoBody){
    ascoBody.innerHTML = '';
    for(let i=0;i<6;i++){ const sk=document.createElement('div'); sk.className='skel-card'; ascoBody.appendChild(sk); }
  }

  const reader = new FileReader();
  reader.onload = e => {
    try{
      const result = parseASCOWorkbook(e.target.result);
      const { sheets, stats } = result;

      if(!sheets || sheets.length === 0){
        if(ascoBody) ascoBody.innerHTML = '';
        showToast(t('toast_no_cargo'), 'warn');
        return;
      }

      document.getElementById('ascoSubtitle').textContent = `Reading: ${file.name}`;
      renderAscoContent(sheets, stats);
    } catch(err){
      if(ascoBody) ascoBody.innerHTML = '';
      showToast(t('toast_read_err', err.message), 'warn');
      console.error('ASCO parse error:', err);
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ── Unified placeAt: handles queue items AND standard library placement ── */
function placeAt(cx, cy){
  if(!isOperator()) return;            /* Viewer: block placement */
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
      status:    'L',
      dgClasses: item.dgClasses || [],
      heavyLift: !!item.heavyLift,
      priority: false,
      trDest: '',
    };
    S.cargo.push(c);
    ensureLocActive(c.platform);

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
  /* Click-to-place cargo is a stamp: it stays armed across the editor's
     save/cancel so the next empty-deck click drops another copy. DG disarms
     on save as before. */
  _stampPlacement = (S.pending.type === 'cargo');
  _placeAtCore(cx, cy);
}

/* ── Utility: simple HTML escape ── */
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ════════════════════════════════════════════════════════════
   PHASE 14 — PREMIUM TOAST SYSTEM
   Container-based stack reusing the existing .toast-msg glass
   styling. Wires the orphaned .toast-msg CSS to showToast() so
   every one of the 77 call sites gains premium polish without
   touching callers. Keeps the (msg, type) API identical.
   Dismisses oldest when stack exceeds the visible cap.
════════════════════════════════════════════════════════════ */
const _TOAST_CAP      = 4;
const _TOAST_TIMEOUT  = 3200;
const _TOAST_EXIT_MS  = 240;

function _ensureToastStack(){
  let stack = document.getElementById('toastStack');
  if(!stack){
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    stack.setAttribute('aria-atomic', 'false');
    document.body.appendChild(stack);
  }
  return stack;
}

/* Icon glyphs per tone. Inline SVG so weight/color inherit via CSS
   currentColor — keeps the stack visually coherent with the tone pill. */
function _toastIcon(type){
  if(type === 'warn'){
    return `<svg class="toast-msg-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.6L14 13H2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M8 7v3M8 11.4v.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  }
  if(type === 'info'){
    return `<svg class="toast-msg-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/>
      <path d="M8 7v4M8 5v.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  }
  /* default = ok */
  return `<svg class="toast-msg-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/>
    <path d="M5.4 8.2l1.8 1.8L10.8 6.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function showToast(msg, type = 'ok'){
  const stack = _ensureToastStack();

  /* Enforce stack cap by dismissing the oldest until appending a new
     toast will leave us at exactly _TOAST_CAP visible entries. Loop
     (not a single check) so the cap is robust even when the stack was
     somehow pre-populated past the limit. */
  let active = stack.querySelectorAll('.toast-msg:not(.is-leaving)');
  while(active.length >= _TOAST_CAP){
    _dismissToast(active[0]);
    active = stack.querySelectorAll('.toast-msg:not(.is-leaving)');
  }

  const t = document.createElement('div');
  t.className = 'toast-msg is-' + (type === 'warn' ? 'warn' : type === 'info' ? 'info' : 'ok');
  t.setAttribute('role', type === 'warn' ? 'alert' : 'status');
  t.innerHTML = _toastIcon(type) +
    `<span class="toast-msg-text"></span>`;
  /* Text via textContent to avoid HTML injection from callers. */
  t.querySelector('.toast-msg-text').textContent = msg;

  stack.appendChild(t);
  /* Force reflow so the .is-visible transition fires on class add. */
  void t.offsetWidth;
  t.classList.add('is-visible');

  const auto = setTimeout(() => _dismissToast(t), _TOAST_TIMEOUT);
  t.dataset.toastTimer = String(auto);
}

function _dismissToast(el){
  if(!el || !el.parentNode) return;
  if(el.dataset.toastTimer){
    clearTimeout(Number(el.dataset.toastTimer));
    delete el.dataset.toastTimer;
  }
  if(el.classList.contains('is-leaving')) return;
  el.classList.add('is-leaving');
  el.classList.remove('is-visible');
  setTimeout(() => { if(el.parentNode) el.parentNode.removeChild(el); }, _TOAST_EXIT_MS + 40);
}


/* ═══════════════════════════════════════════════════════════════
   PDF EXPORT v37 — New Design System
   Rebuilt to match current UI: warm ivory palette, Manrope/Inter
   typography, premium navy accent, modern card structure.
═══════════════════════════════════════════════════════════════ */
let _isReportRendering = false;

/* ── DOM pollutant removal for html2canvas ─────────────────────────────
   WKWebView (Tauri on macOS) taints a canvas at the document level when
   ANY element in the document contains: external images, <canvas>, or
   SVG filters — even if those elements are display:none or outside the
   capture target. The only reliable fix is to physically detach them
   from the DOM before html2canvas runs and restore them after.
   
   Stash format: [{el, parent, next}] for ordered re-insertion. */
function _stripExportPollutants(){
  const stash = [];
  /* External/local images outside the deck canvas (e.g. vessel-bg map) */
  document.querySelectorAll('img').forEach(el => {
    if(!el.closest('#cvDECK')){
      stash.push({el, parent: el.parentNode, next: el.nextSibling});
      el.remove();
    }
  });
  /* Weather precipitation canvas elements */
  document.querySelectorAll('.wx-scene canvas, canvas.wx-scene').forEach(el => {
    stash.push({el, parent: el.parentNode, next: el.nextSibling});
    el.remove();
  });
  /* SVG elements containing filters (feTurbulence etc.) outside deck canvas.
     NOTE: only SVGs that have a <filter> child — preserves header icon SVGs. */
  document.querySelectorAll('svg').forEach(svg => {
    if(svg.querySelector('filter') && !svg.closest('#cvDECK')){
      stash.push({el: svg, parent: svg.parentNode, next: svg.nextSibling});
      svg.remove();
    }
  });
  /* CSS injection — neutralize body::before/::after pseudo-elements (feTurbulence
     noise texture, weather gradient wash) and backdrop-filter/filter outside #cvDECK.
     These are the primary WKWebView taint triggers and cannot be removed via DOM. */
  const exportStyle = document.createElement('style');
  exportStyle.id = '__export-css-strip';
  exportStyle.textContent = `
    body, html {
      background: none !important;
      backdrop-filter: none !important;
    }
    *::before, *::after {
      background-image: none !important;
      content: none !important;
    }
    *:not(#cvDECK):not(#cvDECK *) {
      backdrop-filter: none !important;
      filter: none !important;
    }
  `;
  document.head.appendChild(exportStyle);
  stash.push({type: 'style', el: exportStyle});
  return stash;
}

function _restoreExportPollutants(stash){
  stash.forEach(({type, el, parent, next}) => {
    if(type === 'style'){
      el.remove();
    } else {
      if(next && next.parentNode === parent) parent.insertBefore(el, next);
      else parent.appendChild(el);
    }
  });
}

function exportPDF(){ return _renderReport('save'); }
async function printDeckPlan(){
  /* WKWebView print() is silently broken — save to OS temp dir silently,
     then shell.open() so user gets a native print dialog in system viewer.
     No Save As dialog — that's for Export PDF flow only. */
  if(_isTauri()){
    try {
      const { tempDir } = await import('@tauri-apps/api/path');
      const tmp = await tempDir();
      const sep = tmp.endsWith('\\') || tmp.endsWith('/') ? '' : '/';
      window._pendingPdfPath = tmp + sep + 'spica-tide-print-' + Date.now() + '.pdf';
      _renderReport('save');
    } catch(e){
      console.error('[print] temp path error:', e);
      /* Fallback: show Save As dialog via menuExportPDF */
      menuExportPDF();
    }
  } else {
    _renderReport('print');
  }
}

async function _renderReport(mode){
  if(_isReportRendering){ return; }
  _isReportRendering = true;

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
    /* Per-(loc,status) opColor() so PDF pills match the deck blocks (DESIGN_RULES §1, §3, §8). */
    const pillColors = {};
    if(L   > 0) pillColors.L   = opColor(id, 'L');
    if(BL  > 0) pillColors.BL  = opColor(id, 'BL');
    if(ROB > 0) pillColors.ROB = opColor(id, 'ROB');
    return { id, name: loc.name, base, cols, L, BL, ROB, wt: wt.toFixed(1), pillColors };
  }).filter(Boolean);

  /* ── DG classes actually on deck ── */
  const dgOnDeck = {};
  S.cargo.forEach(c => {
    (c.dgClasses||[]).forEach(cls => { dgOnDeck[cls] = (dgOnDeck[cls]||0) + 1; });
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

  /* 3. Hide editing controls + remove cargo shadows for clean print */
  const hiddenEls = document.querySelectorAll('.cb-del,.cb-rot,.cb-copy,.rh,.kb-coord-tip');
  hiddenEls.forEach(el => el.style.visibility = 'hidden');
  const kbEl = document.querySelector('.cb.kb-sel');
  if(kbEl) kbEl.classList.remove('kb-sel');
  /* Remove box-shadow from all cargo blocks for crisp print */
  const allCb = dcv.querySelectorAll('.cb');
  const _savedShadows = [];
  allCb.forEach(cb => {
    _savedShadows.push(cb.style.boxShadow);
    cb.style.boxShadow = 'none';
  });

  /* 4. Hide body::before noise texture (feTurbulence taint source) */
  document.body.classList.add('pdf-capture');

  /* 5. Option A — flat premium zone fills for the snapshot. Live zones use
        !important hatch backgrounds, so overrides MUST use setProperty(...,
        'important') (plain assignment is a no-op). No data-URI (taints WKWebView). */
  const _zoneSaved = [];

  dcv.querySelectorAll('.zone').forEach(el => {
    const cls = el.className;
    const lbl = el.querySelector('.z-lbl');
    _zoneSaved.push({ el, cssText: el.style.cssText, lbl, lblCss: lbl ? lbl.style.cssText : null });

    const store = cls.includes('z-store');
    el.style.setProperty('background', store ? 'rgba(85,78,58,0.18)' : 'rgba(90,82,62,0.15)', 'important');
    el.style.setProperty('border', store ? '1px solid rgba(85,78,58,0.34)' : '1px solid rgba(90,82,62,0.32)', 'important');
    if(lbl){
      lbl.style.setProperty('color', store ? '#3d2200' : '#3d280a', 'important');
      lbl.style.setProperty('font-weight', '700', 'important');
    }
  });

  /* No-DG zone */
  const _nodgEl = dcv.querySelector('[style*="repeating-linear-gradient(45deg,rgba(220,38,38"]');
  let _nodgSavedCss = '';
  if(_nodgEl){
    _nodgSavedCss = _nodgEl.style.cssText;
    _nodgEl.style.setProperty('background', 'rgba(220,38,38,0.07)', 'important');
    _nodgEl.style.setProperty('border', 'none', 'important');
    _nodgEl.style.setProperty('border-left', '1.5px dashed rgba(220,38,38,0.45)', 'important');
  }

  /* No-DG rotated label + DG limit line → flat brick-red */
  const _nodgLbl = [...dcv.querySelectorAll('span')].find(s => /no dg cargo/i.test(s.textContent));
  let _nodgLblCss = '';
  if(_nodgLbl){ _nodgLblCss = _nodgLbl.style.cssText; _nodgLbl.style.setProperty('color', 'rgba(180,30,30,0.55)', 'important'); }
  const _dgLine = dcv.querySelector('.dg-limit-line');
  let _dgLineCss = '';
  if(_dgLine){ _dgLineCss = _dgLine.style.cssText; _dgLine.style.setProperty('background', 'rgba(159,64,61,0.55)', 'important'); _dgLine.style.setProperty('opacity', '1', 'important'); }

  /* Ship's Waste Skip — one-off .ships-skip fixture (not a .zone; its label
        is inline text on the element, so color is set on el, not a child). */
  const _skipEl = dcv.querySelector('.ships-skip');
  let _skipCss = '';
  if(_skipEl){
    _skipCss = _skipEl.style.cssText;
    _skipEl.style.setProperty('background', 'rgba(90,82,62,0.15)', 'important');
    _skipEl.style.setProperty('border', '1px solid rgba(90,82,62,0.32)', 'important');
    _skipEl.style.setProperty('color', '#3d280a', 'important');
    _skipEl.style.setProperty('font-weight', '700', 'important');
  }

  const restore = () => {
    dzw.style.transform = savedTransform;
    dcv.style.overflow = savedDcvOv;
    if(deckOuter) deckOuter.style.overflow = savedOuterOv;
    hiddenEls.forEach(el => el.style.visibility = '');
    if(kbEl && KB_SEL) kbEl.classList.add('kb-sel');
    /* Restore cargo shadows */
    allCb.forEach((cb,i) => { cb.style.boxShadow = _savedShadows[i] || ''; });
    document.body.classList.remove('pdf-capture');
    /* Restore original zone + label styles */
    _zoneSaved.forEach(s => { s.el.style.cssText = s.cssText; if(s.lbl) s.lbl.style.cssText = s.lblCss || ''; });
    if(_nodgEl) _nodgEl.style.cssText = _nodgSavedCss;
    if(_nodgLbl) _nodgLbl.style.cssText = _nodgLblCss || '';
    if(_dgLine) _dgLine.style.cssText = _dgLineCss || '';
    if(_skipEl) _skipEl.style.cssText = _skipCss || '';
  };

  /* 5. Capture live deck with html2canvas.
        DOM pollutants (img, wx canvas, svg filters) are physically detached
        before capture — display:none is insufficient in WKWebView, taint check
        operates at document level regardless of visibility.
        Double rAF ensures CSS repaint is committed before capture. */
  const _exportStash = _stripExportPollutants();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const deckCanvas = await html2canvas(dcv, {
      scale: 3, useCORS: true, backgroundColor: '#fbf9f4',
      logging: false, width: TW, height: CVH,
      windowWidth: TW, windowHeight: CVH,
      x: 0, y: 0, scrollX: 0, scrollY: 0, removeContainer: true,
    });
    restore();
    buildPDF(deckCanvas, { voyageNum, dateStr, lifts, weightStr, loadCount, blCount, robCount, dgEntries, activeLocs }, { mode })
      .catch(err => {
        console.error('[PDF] buildPDF error:', err);
        showToast('PDF build error: ' + (err && err.message || err), 'warn');
      })
      .finally(() => { _isReportRendering = false; });
  } catch(err) {
    restore();
    _isReportRendering = false;
    console.error('[PDF] html2canvas error:', err);
    showToast('PDF capture failed: ' + (err && err.message || err), 'warn');
  } finally {
    _restoreExportPollutants(_exportStash);
  }
}

async function buildPDF(deckCanvas, data, opts){
  const _mode = (opts && opts.mode) || 'save';
  const { voyageNum, dateStr, lifts, weightStr, loadCount, blCount, robCount, dgEntries, activeLocs } = data;
  const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });

  /* Register Inter TTF — embedded at build time via inter-fonts.js.
     addFileToVFS + addFont is the standard jsPDF custom-font pattern. */
  doc.addFileToVFS('Inter-Regular.ttf', interRegularB64);
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', interBoldB64);
  doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
  doc.addFileToVFS('Manrope-ExtraBold.ttf', manropeExtraBoldB64);
  doc.addFont('Manrope-ExtraBold.ttf', 'Manrope', 'bold');
  doc.addFileToVFS('JetBrainsMono-Regular.ttf', jetBrainsMonoRegularB64);
  doc.addFont('JetBrainsMono-Regular.ttf', 'JetBrainsMono', 'normal');
  doc.addFileToVFS('JetBrainsMono-Medium.ttf', jetBrainsMonoMediumB64);
  doc.addFont('JetBrainsMono-Medium.ttf', 'JetBrainsMono', 'bold');

  const PW=297, PH=210, ML=10, MR=10, MT=8;
  const CW = PW - ML - MR;

  /* Palette — Stage 1 normalization.
     Old keys (ink/ink2/ink3/ink4/navy/navy2/ivory/surf2/surf3/surf4/green/amber/brd)
     retain their pre-Stage-1 RGBs so KPI counters, location cards, DG band,
     voyage notes, deck label, bay labels render bit-identical until Stage 2.
     New keys are header-band + footer-only and add no visual change elsewhere. */
  const C = {
    /* Brand (new in Stage 1 — header band) */
    navyDark:        [10, 22, 40],
    brandAmber:      [245, 158, 11],
    /* Ink on dark navy (new) */
    inkOnNavy:       [255, 255, 255],
    inkOnNavyMute:   [180, 195, 215],
    inkOnNavyFaint:  [140, 155, 180],
    inkOnNavyHair:   [80, 90, 110],
    /* Footer (new) */
    brdSoft:         [180, 190, 200],
    footerInk:       [120, 130, 145],
    /* Legacy — kept at original RGBs for backward compatibility with
       sections that Stage 1 does not modify. Stage 2 will rationalise. */
    ink:    [49, 51, 44],
    ink2:   [94, 96, 88],
    ink3:   [121, 124, 115],
    ink4:   [177, 179, 169],
    navy:   [59, 110, 181],
    navy2:  [47, 90, 161],
    ivory:  [251, 249, 244],
    surf2:  [245, 244, 237],
    surf3:  [239, 238, 230],
    surf4:  [232, 233, 224],
    green:  [30, 143, 74],
    amber:  [160, 125, 46],
    brd:    [205, 205, 198],
    white:  [255, 255, 255],
  };

  /* Stage-2 "Variant A" soft palette — tinted fills + neutral card borders.
     Values are the Pavel-approved reference triples; used by the KPI pills,
     destination cards, deck label and DG card. */
  const ink         = [10, 22, 40];
  const inkMute     = [90, 100, 120];
  const green       = [74, 124, 89];
  const amberStatus = [217, 119, 6];
  const tintGreen   = [233, 240, 235];
  const tintAmber   = [250, 242, 230];
  const tintNavy    = [238, 240, 243];
  const cardBorder  = [225, 228, 235];

  const hex2rgb = hex => h2r(hex || '#999999'); // delegate to live h2r — preserves 0 channels (never ||fallback, which corrupts a 00 byte e.g. #6b7a00)
  const contrastText = rgb => (0.2126*(rgb[0]/255)+0.7152*(rgb[1]/255)+0.0722*(rgb[2]/255)) > 0.45 ? C.ink : C.white;
  const roundRect = (x,y,w,h,r,fill,strokeCol) => {
    if(fill) doc.setFillColor(...fill);
    if(strokeCol){ doc.setDrawColor(...strokeCol); doc.setLineWidth(0.2); }
    doc.roundedRect(x,y,w,h,r,r, fill&&strokeCol?'FD':fill?'F':'D');
  };
  const sepLine = y2 => { doc.setDrawColor(...C.brd); doc.setLineWidth(0.15); doc.line(ML,y2,ML+CW,y2); };

  let y = MT;

  /* 1. HEADER — 14mm navy band + 1mm amber strip (Stage 1 redesign).
        Brand mark + voyage metadata moved into the band; KPI counter strip
        is preserved below as its own block. */
  const HB_H = 14, HB_PAD = 6, HB_AMBER_H = 1.5;

  /* Navy band \u2014 rounded inset masthead (radius 2.5mm), full content width. */
  doc.setFillColor(...C.navyDark);
  doc.roundedRect(ML, y, CW, HB_H, 2.5, 2.5, 'F');
  /* Amber accent \u2014 thin rounded bar (1.5mm, fully-pilled ends) sitting
     directly BENEATH the navy band, not inside it. */
  doc.setFillColor(...C.brandAmber);
  doc.roundedRect(ML, y + HB_H + 0.8, CW, HB_AMBER_H, 0.75, 0.75, 'F');

  /* Shared text baseline through the vertical centre of the navy band.
     Cap-height correction for ~11pt display glyph pushes the baseline
     ~1.4mm below centre. */
  const hbMidY = y + HB_H / 2;
  const hbBL   = hbMidY + 1.4;
  const hairH  = 5;
  const drawHair = (xp) => {
    doc.setDrawColor(...C.inkOnNavyHair);
    doc.setLineWidth(0.3);
    doc.line(xp, hbMidY - hairH/2, xp, hbMidY + hairH/2);
  };

  /* \u2500\u2500 Left cluster: SPICA TIDE | hair | DECK CARGO PLAN \u2500\u2500 */
  let lx = ML + HB_PAD;
  doc.setFont('Manrope','bold'); doc.setFontSize(11); doc.setTextColor(...C.inkOnNavy);
  doc.setCharSpace(0.4);
  doc.text('SPICA TIDE', lx, hbBL);
  lx += doc.getTextWidth('SPICA TIDE');
  doc.setCharSpace(0);
  lx += 4; drawHair(lx); lx += 4;
  doc.setFont('Inter','normal'); doc.setFontSize(7); doc.setTextColor(...C.inkOnNavyMute);
  doc.setCharSpace(0.5);
  doc.text('DECK CARGO PLAN', lx, hbBL);
  doc.setCharSpace(0);

  /* \u2500\u2500 Right cluster: build right-to-left from PW-MR-HB_PAD \u2500\u2500
        Order ending at right edge: NeoNext | hair | DATE pair | hair | VOYAGE pair | hair | PSV pair */
  let rx = ML + CW - HB_PAD;

  /* Render a "LABEL  VALUE" pair with rightmost edge at rx; returns pair width. */
  const renderHbPair = (label, value, valueFont, valueStyle) => {
    doc.setFont(valueFont, valueStyle); doc.setFontSize(8); doc.setCharSpace(0);
    const valW = doc.getTextWidth(value);
    doc.setFont('Inter','normal'); doc.setFontSize(5.5); doc.setCharSpace(0.6);
    const labW = doc.getTextWidth(label);
    const pairW = labW + 3 + valW;
    const labX  = rx - pairW;
    doc.setFont('Inter','normal'); doc.setFontSize(5.5); doc.setTextColor(...C.inkOnNavyFaint); doc.setCharSpace(0.6);
    doc.text(label, labX, hbBL);
    doc.setFont(valueFont, valueStyle); doc.setFontSize(8); doc.setTextColor(...C.inkOnNavy); doc.setCharSpace(0);
    doc.text(value, labX + labW + 3, hbBL);
    return pairW;
  };

  /* Item 1: NeoNext brand mark */
  doc.setFont('Manrope','bold'); doc.setFontSize(9); doc.setTextColor(...C.inkOnNavy); doc.setCharSpace(0.2);
  const neoW = doc.getTextWidth('NeoNext');
  doc.text('NeoNext', rx - neoW, hbBL);
  doc.setCharSpace(0);
  rx -= neoW + 5; drawHair(rx); rx -= 5;

  /* Item 5: DATE pair */
  rx -= renderHbPair('DATE', dateStr, 'Inter', 'bold');
  rx -= 5; drawHair(rx); rx -= 5;

  /* Item 9: VOYAGE pair (value in Inter Bold).
        Empty / em-dash fallback rendered as hyphen-minus so the glyph is
        guaranteed in Manrope's latin subset and so impeccable's no-em-dash
        guidance is honoured. */
  const voyVal = (voyageNum && voyageNum.trim() && voyageNum.trim() !== '\u2014')
                 ? voyageNum
                 : '-';
  rx -= renderHbPair('VOYAGE', voyVal, 'Inter', 'bold');

  /* 1. KPI STRIP — 4 soft pills (Total Lifts 1.5× width), Variant A.
        Tinted fills, no borders, Manrope numerics right-aligned. */
  const kpiY  = y + HB_H + 4.5;           /* clears the amber bar (ends at +2.3) */
  const KPI_H = 17, KPI_GAP = 2;
  const kUnit = (CW - 3*KPI_GAP) / 4.5;   /* base pill; Total Lifts is 1.5× */
  const kBL   = kpiY + 11.5;              /* baseline centring the 26pt value */
  let kx = ML;
  [
    { w:kUnit*1.5, fill:C.navyDark, lbl:'TOTAL LIFTS', lblCol:[150,160,180], val:String(lifts),     valCol:C.white,         valSize:26 },
    { w:kUnit,     fill:tintGreen,  lbl:'LOAD',        lblCol:green,         val:String(loadCount), valCol:green,           valSize:20 },
    { w:kUnit,     fill:tintAmber,  lbl:'BACKLOAD',    lblCol:amberStatus,   val:String(blCount),   valCol:amberStatus,     valSize:20 },
    { w:kUnit,     fill:tintNavy,   lbl:'ROB',         lblCol:inkMute,       val:String(robCount),  valCol:[70,80,100],     valSize:20 },
  ].forEach(p => {
    roundRect(kx, kpiY, p.w, KPI_H, 2.5, p.fill, null);
    doc.setFont('Inter','normal'); doc.setFontSize(9); doc.setTextColor(...p.lblCol); doc.setCharSpace(0.3);
    doc.text(p.lbl, kx+5, kBL);
    doc.setCharSpace(0);
    /* Total Lifts is the dominant numeric (26pt) — supporting counts at 20pt
       hold a ≥1.25 ratio per typeset hierarchy guidance. */
    doc.setFont('Manrope','bold'); doc.setFontSize(p.valSize); doc.setTextColor(...p.valCol);
    const vW = doc.getTextWidth(p.val);
    doc.text(p.val, kx+p.w-5-vW, kBL);
    kx += p.w + KPI_GAP;
  });

  y = kpiY + KPI_H + 2;

  /* 2. DESTINATIONS — soft cards with dot indicators (Variant A).
        Active locations only; equal-width row; no tonnage. */
  const filledLocs = activeLocs.filter(loc => loc.L>0 || loc.BL>0 || loc.ROB>0);
  if(filledLocs.length > 0){
    const DEST_H = 16, DGAP = 2, DPAD = 4, dotR = 1.4;
    const cardW = (CW - (filledLocs.length-1)*DGAP) / filledLocs.length;
    /* FIX D — one uniform pill width = widest "LBL N" across ALL destination
       cards, computed once so every capsule is identical in size. */
    doc.setFont('Inter','bold'); doc.setFontSize(7.5);
    let uniPillW = 12;
    filledLocs.forEach(loc => {
      [['L',loc.L],['BL',loc.BL],['ROB',loc.ROB]].forEach(([lbl,val]) => {
        if(val>0) uniPillW = Math.max(uniPillW, doc.getTextWidth(`${lbl} ${val}`) + 6);
      });
    });
    filledLocs.forEach((loc,i) => {
      const cx = ML + i*(cardW+DGAP), rgb = hex2rgb(loc.base);
      roundRect(cx, y, cardW, DEST_H, 2.5, C.white, cardBorder);
      /* Row 1 — colour dot + location name */
      doc.setFillColor(...rgb); doc.circle(cx+DPAD+dotR, y+5, dotR, 'F');
      const nameX = cx+DPAD+2*dotR+2.5;
      doc.setFont('Manrope','bold'); doc.setFontSize(10.5); doc.setTextColor(...ink);
      const maxChars = Math.max(4, Math.floor((cardW-(nameX-cx)-DPAD)/2.0));
      const nm = loc.name.length>maxChars ? loc.name.slice(0,maxChars-1)+'…' : loc.name;
      doc.text(nm, nameX, y+6.3);
      /* Row 2 — filled capsule pills in the SOLID per-(loc,status) opColor()
         (DESIGN_RULES §1, §3, §8): identical to the deck cargo block fill, never an
         ivory wash, so muted hues (Claymore CPP olive, slate) read true instead of
         greying. On a genuine miss fall back to loc.base (getLocBase) — never slate. */
      let px = cx+DPAD; const pillY = y+9, pillH = 5.5, pillR = pillH/2;
      [{lbl:'L',  val:loc.L,   hex: (loc.pillColors && loc.pillColors.L)   || loc.base},
       {lbl:'BL', val:loc.BL,  hex: (loc.pillColors && loc.pillColors.BL)  || loc.base},
       {lbl:'ROB',val:loc.ROB, hex: (loc.pillColors && loc.pillColors.ROB) || loc.base}]
        .filter(p=>p.val>0).forEach(p => {
          const txt = `${p.lbl} ${p.val}`;
          const rgbFill = hex2rgb(p.hex);
          roundRect(px, pillY, uniPillW, pillH, pillR, rgbFill, null);
          /* Capsule colour IS the status indicator (§3); text picks max contrast
             against the solid fill exactly as the deck block does. */
          doc.setFont('Inter','bold'); doc.setFontSize(7.5); doc.setTextColor(...contrastText(rgbFill));
          doc.text(txt, px+uniPillW/2, pillY+3.7, {align:'center'});
          px += uniPillW + 1.5;
        });
    });
    y += DEST_H + 2;
  }

  /* 3. DECK LABEL — mirrors the live `.deck-compass` strip (DESIGN_RULES §7).
        3-part space-between row: aft marker (left), vessel facts (centred), bow marker (right).
        Text is verbatim from §7 — em dashes are Pavel's authoritative spec, overriding the
        impeccable no-em-dash guideline for this specific deck wayfinding band. */
  const lblBL = y + 4;
  doc.setFont('Inter','normal'); doc.setFontSize(5.5); doc.setTextColor(...inkMute); doc.setCharSpace(0.4);
  doc.text('◄ AFT / STERN — BAY 12', ML, lblBL);
  doc.text('BAY 1 — BOW / FORE ►', ML+CW, lblBL, {align:'right'});
  doc.setFont('Inter','bold'); doc.setFontSize(6); doc.setTextColor(...ink); doc.setCharSpace(0.3);
  doc.text('SPICA TIDE · 54.92 m × 15 m · 752 m²',
           ML+CW/2, lblBL, {align:'center'});
  doc.setCharSpace(0);
  y += 5;
  doc.setDrawColor(...cardBorder); doc.setLineWidth(0.15);
  doc.line(ML, y, ML+CW, y);
  y += 1.5;

  /* 5. DECK IMAGE — the html2canvas capture */
  const FOOTER_H=8, BAY_LBL_H=7;
  const availH = PH-y-FOOTER_H-BAY_LBL_H-2;
  const dw = CW, dh = Math.min(dw*(CVH/TW), availH);
  roundRect(ML-0.4,y-0.4,dw+0.8,dh+0.8,1.5,C.ivory,C.brd);

  /* Convert canvas to PNG bytes via toBlob → ArrayBuffer → Uint8Array.
     This avoids toDataURL() which throws "insecure operation" on
     tainted canvases in Tauri WebView2. toBlob uses a different
     code path that bypasses the taint check in Chromium. */
  let pngBytes;
  try {
    const blob = await new Promise((resolve, reject) => {
      deckCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png');
    });
    const arrayBuf = await blob.arrayBuffer();
    pngBytes = new Uint8Array(arrayBuf);
  } catch(blobErr) {
    showToast('Canvas export error: ' + (blobErr && blobErr.message || blobErr), 'warn');
    return;
  }
  try {
    doc.addImage(pngBytes, 'PNG', ML, y, dw, dh, '', 'FAST');
  } catch(imgErr) {
    showToast('Image error: ' + (imgErr && imgErr.message || imgErr), 'warn');
    return;
  }

  y += dh+2;

  /* 6. BAY LABELS — Inter bold 11pt inkMute, centred under each real bay segment
        (DESIGN_RULES §6). The bottom row stays even though the snapshot already
        carries the ghost-watermark Manrope 900 numbers — cargo can cover those,
        so the explicit row gives a guaranteed readable reference. */
  const bayNms = ['12','11','10','9','8','7','6','5','4','3','2','1'];
  doc.setFont('Inter','bold'); doc.setFontSize(11); doc.setTextColor(...inkMute);
  BW.forEach((w,i) => { doc.text(bayNms[i], ML+((BL_[i]+w/2)/TW)*dw, y+5, {align:'center'}); });

  /* clear the bay-number row before the DG card */
  y += BAY_LBL_H;

  /* DG ON BOARD — soft tinted card, premium like the load/backload pills
        (DESIGN_RULES §4). No standalone total count. Uniform chip dimensions;
        class glyph rendered in DG_DATA.tc so light backgrounds (2.3/6.x/8/9)
        keep their dark text and red backgrounds (2.1/3) stay white-on-red. */
  y += 3;
  const dgRed = [185, 28, 28], dgBorder = [220, 180, 180], dgTint = [250, 238, 238];
  const DG_H = 14, dgPad = 4;
  roundRect(ML, y, CW, DG_H, 2.5, dgTint, dgBorder);
  /* Row 1 — eyebrow label only (no standalone total) */
  const dgR1 = y + dgPad + 1.5;
  doc.setFont('Inter','normal'); doc.setFontSize(6.5); doc.setTextColor(...dgRed); doc.setCharSpace(0.4);
  doc.text(dgEntries.length ? 'DG ON BOARD' : 'DG ON BOARD · None', ML+dgPad, dgR1);
  doc.setCharSpace(0);
  /* Row 2 — uniform IMDG class chips: width = max class-text width + 4mm,
        height 5.5mm, radius 1.5mm. Fill from DG_DATA.bg, glyph in DG_DATA.tc. */
  if(dgEntries.length){
    const chipY = y + dgPad + 3.5, chipH = 5.5;
    doc.setFont('Inter','bold'); doc.setFontSize(8);
    const maxClsW = dgEntries.reduce((mx, e) => Math.max(mx, doc.getTextWidth(e.cls)), 0);
    const chipW = maxClsW + 4;
    let dgx = ML + dgPad;
    dgEntries.forEach(e => {
      const chipBg = hex2rgb(e.bg);
      roundRect(dgx, chipY, chipW, chipH, 1.5, chipBg, null);
      /* PDF override (DESIGN_RULES §8): class glyph is always near-black
         [17,17,17] regardless of chip bg — print legibility on this report
         trumps the live DG_DATA.tc white-on-red. */
      doc.setFont('Inter','bold'); doc.setFontSize(8); doc.setTextColor(17, 17, 17);
      doc.text(e.cls, dgx+chipW/2, chipY+3.7, {align:'center'});
      const cnt = '×' + e.count;
      const cntX = dgx + chipW + 1.5;
      doc.setFont('JetBrainsMono','bold'); doc.setFontSize(9); doc.setTextColor(20, 24, 30);
      doc.text(cnt, cntX, chipY+3.7);
      dgx = cntX + doc.getTextWidth(cnt) + 3;
    });
  }
  y += DG_H + 2;


  /* 7. VOYAGE NOTES */
  const voyRemarks = (typeof S !== 'undefined' && S.voyRemarks) ? S.voyRemarks.trim() : '';
  if(voyRemarks){
    const noteLines = doc.splitTextToSize(voyRemarks, CW-12);
    const NOTE_H = Math.min(24, 6+noteLines.length*4.2);
    if(y+NOTE_H+FOOTER_H < PH-2){
      roundRect(ML,y,CW,NOTE_H,1.5,C.surf2,C.brd);
      doc.setFont('Inter','bold'); doc.setFontSize(5.5); doc.setTextColor(...C.ink3);
      doc.text('VOYAGE NOTES', ML+3, y+4.5);
      doc.setFont('Inter','normal'); doc.setFontSize(5.5); doc.setTextColor(...C.ink2);
      doc.text(noteLines, ML+3, y+9); y += NOTE_H+2;
    }
  }

  /* 8. FOOTER \u2014 hairline divider, generated timestamp left, page + brand right.
        Rebrand: "NEO Energy Resources UK" \u2192 "NeoNext" throughout. */
  const fy = PH - FOOTER_H;
  /* Soft hairline divider \u2014 0.2mm stroke, brand-tinted neutral. */
  doc.setDrawColor(...C.brdSoft);
  doc.setLineWidth(0.2);
  doc.line(ML, fy - 1, ML + CW, fy - 1);
  /* Timestamp formatted as "DD MMM YYYY \u00B7 HH:mm" (Inter-friendly glyphs only). */
  const now = new Date();
  const dd  = String(now.getDate()).padStart(2,'0');
  const mon = now.toLocaleString('en-GB',{month:'short'});
  const yyyy = now.getFullYear();
  const hh  = String(now.getHours()).padStart(2,'0');
  const mi  = String(now.getMinutes()).padStart(2,'0');
  const ts  = `${dd} ${mon} ${yyyy} \u00B7 ${hh}:${mi}`;
  /* Left: Generated ts + brand wordmark + version. */
  doc.setFont('Inter','normal'); doc.setFontSize(6.5); doc.setTextColor(...C.footerInk); doc.setCharSpace(0.2);
  doc.text('Generated ' + ts + '  \u00B7  SPICA TIDE v' + APP_VERSION, ML, fy + 4);
  /* Right: page indicator + brand. Single-page output for now (multi-page work is post-Stage-2). */
  doc.text('Page 1 / 1  \u00B7  NeoNext', ML + CW, fy + 4, {align:'right'});
  doc.setCharSpace(0);

  /* 9. OUTPUT — print or save depending on mode */
  if(_mode === 'print'){
    const blobUrl = doc.output('bloburl');
    showToast(t('toast_print_ok'), 'ok');
    _printPdfViaIframe(blobUrl);
    return;
  }

  /* Save mode — use pre-chosen path from menu dialog, or browser fallback */
  const pdfPath = window._pendingPdfPath;
  window._pendingPdfPath = null;

  if(pdfPath){
    /* Path was chosen by user via native Save As dialog in _menuExportPDF */
    try {
      const pdfOutput = doc.output('arraybuffer');
      const bytes = Array.from(new Uint8Array(pdfOutput));
      await invoke('write_file_bytes', { path: pdfPath, bytes });
      showToast(t('toast_pdf_ok') + ' \u2014 ' + pdfPath.split(/[/\\]/).pop(), 'ok');
      _phase27ExportComplete();
      /* Auto-open in system viewer so user can print via native dialog */
      try {
        const { openPath } = await import('@tauri-apps/plugin-opener');
        await openPath(pdfPath);
      } catch(openErr){
        console.error('[print] openPath failed:', openErr);
        showToast('PDF saved \u2014 open manually to print', 'info');
      }
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
    _phase27ExportComplete();
  }
}

/* ── Print PDF via hidden iframe ── */
function _printPdfViaIframe(blobUrl){
  const existing = document.getElementById('_printIframe');
  if(existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = '_printIframe';
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.src = blobUrl;

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch(err){
        console.error('[print] iframe.print failed:', err);
        window.open(blobUrl, '_blank');
      }
    }, 100);
  };

  document.body.appendChild(iframe);

  /* Cleanup after 60s — enough time for user to interact with print dialog */
  setTimeout(() => {
    if(iframe.parentNode) iframe.remove();
    try { URL.revokeObjectURL(blobUrl); } catch(e){}
  }, 60000);
}

/* Phase 27 — export terminus feedback. Sound + toast success decoration.
   Lives on every export completion path (PDF Tauri, PDF browser, Excel
   Tauri, Excel browser). Timed to follow showToast so the toast is in
   the DOM when we upgrade its class. */
function _phase27ExportComplete(){
  playSound('export');
  /* Upgrade the most recent toast to the success variant. Pull it from
     #toastHost so we don't hit a stale element. */
  const host = document.getElementById('toastHost') || document.body;
  const toasts = host.querySelectorAll('.toast');
  const last = toasts[toasts.length - 1];
  if(last) last.classList.add('is-export-success');
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
    } else if(e.key === 'p' && !e.shiftKey){
      /* Ctrl+P → Print deck plan report */
      e.preventDefault();
      printDeckPlan();
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
    const recents = await invoke('get_recent_files');
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
let CP_OPEN  = false;
let CP_FILTER = 'all';
let CP_Q      = '';
/* A.4a.3 — `lib` starts false so Other Cargo is collapsed on initial
   page load. cpRenderLib syncs DOM to this on first render; user clicks
   on the header flip the value via cpBindSections, so toggle works
   normally thereafter. Not persisted — module-scope const resets on
   every page load. */
const CP_SECTIONS = { queue:true, freq:true, lib:false, custom:true };

/* ── Placing state — slide library clear of deck during placement ── */
let _cpPlacingActive = false;
function _cpEnterPlacing(){
  if(_cpPlacingActive) return;
  _cpPlacingActive = true;
  document.getElementById('cpOverlay')?.classList.add('placing');
}
function _cpExitPlacing(){
  if(!_cpPlacingActive) return;
  _cpPlacingActive = false;
  document.getElementById('cpOverlay')?.classList.remove('placing');
}

/* ── Open / Close ── */
function cpOpen(){
  CP_OPEN = true;
  /* Mutual exclusion with Inspector — only one right rail at a time. */
  if(typeof inspSelId !== 'undefined' && inspSelId != null && typeof inspClose === 'function') inspClose();
  document.getElementById('cpOverlay').classList.add('open');
  document.body.classList.add('cp-panel-open');
  const _lo = document.getElementById('btnLibOpen'); if(_lo) _lo.classList.add('panel-active');
  cpRender();
  setTimeout(()=>{ const s=document.getElementById('cpSearch'); if(s) s.focus(); }, 180);
  /* Manifest-comparison readout retired from the drawer — the Imported Cargo
     (.cp-qi) cards are the placement surface now. runManifestMatch() and the
     .cp-match-section markup stay dormant in place (re-enable by restoring the
     activation here and in performAscoImport). */
}
function cpClose(){
  CP_OPEN = false;
  document.getElementById('cpOverlay').classList.remove('open');
  document.body.classList.remove('cp-panel-open');
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
}

/* ── Section toggle ── */
function cpBindSections(){
  ['Queue','Freq','Lib','Custom'].forEach(sec=>{
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
  if(f==='ondk')    return src==='deck' || (src==='queue' && !!S.cargo.find(c=>c.ccu&&item.ccu&&c.ccu===item.ccu));
  if(f==='unplaced'){
    if(src==='queue') return !S.cargo.find(c=>c.ccu&&c.ccu===item.ccu);
    if(src==='lib'||src==='custom') return true; /* library items are always "unplaced templates" */
    return false;
  }
  return true;
}

/* ── Master render ── */
function cpRender(){
  cpRenderQueue();
  cpRenderFreq();
  cpRenderLib();
  cpRenderCustom();
  cpUpdateBadge();
}

/* ── Render: Imported Queue ── */
function cpRenderQueue(){
  const body   = document.getElementById('cpSecBodyQueue');
  const hdr    = document.getElementById('cpSecHdrQueue');
  const badge  = document.getElementById('cpQueueBadge');
  const clrBtn = document.getElementById('cpClearQueue');
  const empty  = document.getElementById('cpQueueEmpty');
  if(!body) return;

  const queue = (typeof IMPORT_QUEUE!=='undefined') ? IMPORT_QUEUE : [];
  const items = queue.filter(it=>cpMatch(it) && cpPassFilter(it,'queue'));

  /* A.4a — badge always visible (mockup shows "0" when empty). */
  if(badge){ badge.textContent=items.length; badge.style.display=''; }
  if(clrBtn) clrBtn.style.display=queue.length?'':'none';

  /* Remove old cards (not the empty msg) */
  Array.from(body.children).forEach(ch=>{ if(ch.id!=='cpQueueEmpty') ch.remove(); });
  if(empty) empty.style.display = items.length===0 ? '' : 'none';

  /* A.4a — default-collapsed visual when queue is empty: header chevron
     rotates to point right, but body stays VISIBLE so the italic empty
     message reads as the section's resting content. When the queue has
     items, honour the user-toggled CP_SECTIONS.queue state. */
  if(hdr){
    if(items.length === 0){
      hdr.classList.add('collapsed');
      body.classList.remove('hidden');
    } else {
      const open = CP_SECTIONS.queue !== false;
      hdr.classList.toggle('collapsed', !open);
      body.classList.toggle('hidden', !open);
    }
  }

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
    /* Operation-colour accent: status (L/BL/ROB/TR) wins, else DG or HL */
    if(item.status)                             card.dataset.status = item.status;
    else if(item.dgClasses && item.dgClasses.length) card.dataset.status = 'DG';
    else if(item.heavyLift)                     card.dataset.status = 'HL';

    /* icon */
    const dot = document.createElement('div');
    dot.className='cp-qi-dot';
    /* Flat SVG icons instead of emoji */
    if(item.heavyLift){
      dot.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3L4 7M8 3l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      dot.style.color='#785a1a';
    } else if(item.dgClasses&&item.dgClasses.length>0){
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
    if(item.dgClasses&&item.dgClasses.length>0) mkTag('cp-tag-dg', '⬥ DG '+item.dgClasses.join(', '));
    if(item.heavyLift)  mkTag('cp-tag-hl',             '⬆ HL');
    if(item.status)     mkTag('cp-tag-'+item.status,   item.status);
    if(item.autoAssigned) mkTag('cp-tag-auto',           'Auto: '+item.autoAssigned);
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

    /* Drag-to-place — same gesture as library cards. Carries the fromQueue
       pending object (identical to selectQueueItem) so a drop keeps the
       manifest CCU / DG / heavy-lift / platform and splices from IMPORT_QUEUE.
       A plain click (no 5px drag) is a no-op here and falls through to the
       click handler below, preserving click-to-place. */
    card.addEventListener('mousedown', e => {
      if(isPlaced) return;                       /* placed cards aren't re-placeable */
      if(e.target.closest('.cp-qi-rm')) return;  /* don't drag from the × button */
      if(realIdx < 0) return;
      const qItem = queue[realIdx];
      const pending = {
        type:'cargo',
        item:{ name:qItem.name, w:qItem.w, h:qItem.h, length_m:qItem.length_m, width_m:qItem.width_m, wt:qItem.wt, cat:'Imported' },
        fromQueue:true, queueIdx:realIdx, queueItem:qItem,
      };
      _libDragFromCard(e, pending, qItem.ccu||qItem.name||'Cargo', qItem.w, qItem.h);
    });

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
      /* Toggle: click-again on the already-selected card deselects it
         and returns the card to its default blue idle state. */
      const wasSelected = card.classList.contains('cp-qi-sel');
      document.querySelectorAll('.cp-qi,.cp-lc,.cp-dg').forEach(x=>x.classList.remove('cp-qi-sel','cp-lc-sel','cp-dg-sel'));
      document.querySelectorAll('.asco-qitem').forEach(x=>x.classList.remove('selected-q'));
      if(wasSelected){
        /* Deselected — cancel pending placement */
        if(typeof cancelPending==='function') cancelPending();
        cpShowHint('');
      } else {
        card.classList.add('cp-qi-sel');
        if(typeof selectQueueItem==='function' && realIdx>=0) selectQueueItem(realIdx);
        cpShowHint('<b>' + (item.name||item.ccu||'Cargo').replace(/</g,'&lt;') + '</b> → click deck to place');
      }
    });

    body.insertBefore(card, empty);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 4 — DRAG FROM CARGO LIBRARY (shared helper).
   Attached to every library card (main · DG · custom) via mousedown.
   Threshold: 5px of cursor movement promotes click → drag.  Ghost follows
   the cursor; over the deck canvas it gets a "drop-ok" accent; anywhere
   else it stays in a neutral, slightly dimmed state.  On release:
     - over deck  → _placeAtCore(dropX, dropY) using the provided pending.
     - elsewhere  → graceful cancel (ghost removed, no state change).
   Viewer mode: early-return; click-to-place path handles the read-only
   permission check downstream via placeAt().                              */
function _libDragFromCard(e, pendingItem, displayName, pw, ph){
  if(!isOperator()) return;
  if(e.button !== 0) return;
  /* Stop the browser's native text-selection grab on the card; the click event
     still fires, so click-to-place is unaffected. The page-wide suppression
     (body.dragging-cargo) is added once a real drag begins, below. */
  e.preventDefault();

  const sx = e.clientX, sy = e.clientY;
  let dragging = false;
  let ghost = null;
  let overDeck = false;

  /* Default ghost dimensions when no physical size is known (DG markers,
     custom entries missing length/width). Small, premium, non-distracting. */
  const GW = pw ? Math.max(60, pw * zoomLevel) : 112;
  const GH = ph ? Math.max(28, ph * zoomLevel) : 38;

  const onMove = ev => {
    if(!dragging){
      const dx = Math.abs(ev.clientX - sx);
      const dy = Math.abs(ev.clientY - sy);
      if(dx > 5 || dy > 5){
        dragging = true;
        _cpEnterPlacing();                                /* real drag confirmed — slide library clear (idempotent) */
        document.body.classList.add('dragging-cargo');   /* suppress page-wide text selection for this drag only */
        ghost = document.createElement('div');
        ghost.className = 'ghost ghost-lib';
        ghost.style.width  = GW + 'px';
        ghost.style.height = GH + 'px';
        const lbl = document.createElement('div');
        lbl.className = 'ghost-lib-label';
        lbl.textContent = displayName;
        ghost.appendChild(lbl);
        document.body.appendChild(ghost);

        /* Install Escape cancellation only now that a real drag exists. */
        document.addEventListener('keydown', onKey);
      }
    }
    if(ghost){
      ghost.style.left = (ev.clientX - GW / 2) + 'px';
      ghost.style.top  = (ev.clientY - GH / 2) + 'px';

      /* Over-deck detection — a subtle accent cue so the operator knows
         the drop will land. No colour explosion, no bounce. */
      const dcv = document.querySelector('.dcv');
      if(dcv){
        const cr = dcv.getBoundingClientRect();
        const nowOver = (ev.clientX >= cr.left && ev.clientX <= cr.right
                      && ev.clientY >= cr.top  && ev.clientY <= cr.bottom);
        if(nowOver !== overDeck){
          overDeck = nowOver;
          ghost.classList.toggle('ghost-drop-ok', overDeck);
        }
      }
    }
  };

  /* Escape cancels an in-progress drag: removes ghost, clears any pending
     selection. Listener is only attached after the 5px threshold so
     click-only flows don't see it. */
  const onKey = ev => {
    if(ev.key !== 'Escape') return;
    ev.preventDefault();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('dragging-cargo');
    if(ghost){ ghost.remove(); ghost = null; }
    S.pending = null;
    if(typeof cancelPending === 'function') cancelPending();
  };

  const onUp = ev => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('dragging-cargo');
    if(ghost) ghost.remove();
    if(!dragging) return;         /* click-only: let the card's click handler run */
    _cpExitPlacing();             /* drag completed (any landing) — one-shot return */

    const dcv = document.querySelector('.dcv');
    if(!dcv) return;              /* defensive: deck element missing */
    const cr = dcv.getBoundingClientRect();
    if(ev.clientX < cr.left || ev.clientX > cr.right
    || ev.clientY < cr.top  || ev.clientY > cr.bottom){
      return;                     /* off-deck release — graceful cancel */
    }

    S.pending = pendingItem;
    _stampPlacement = false;   /* drag-drop is one-shot — disarm on editor save */
    if(pendingItem.fromQueue){
      /* Imported-queue card: route through placeAt's fromQueue branch so the
         manifest item keeps its CCU / DG / heavy-lift / platform and is spliced
         out of IMPORT_QUEUE. That branch centres on the cursor deck coord (it
         subtracts w/2), so pass the cursor-centre, not the top-left. */
      placeAt((ev.clientX - cr.left) / zoomLevel, (ev.clientY - cr.top) / zoomLevel);
    } else {
      const dropX = (ev.clientX - cr.left) / zoomLevel - (pw || 1) / 2;
      const dropY = (ev.clientY - cr.top)  / zoomLevel - (ph || 1) / 2;
      _placeAtCore(
        Math.max(0, Math.min(dropX, TW  - (pw || 1))),
        Math.max(0, Math.min(dropY, CVH - (ph || 1)))
      );
    }

    /* Placement confirmation — tag the new cargo block for a 180ms
       scale-in. CSS handles the rest; class self-removes via animationend. */
    const placed = S.cargo[S.cargo.length - 1];
    if(placed){
      const el = document.querySelector(`.cb[data-id="${placed.id}"]`);
      if(el){
        el.classList.add('just-placed');
        el.addEventListener('animationend', () => el.classList.remove('just-placed'), { once:true });
      }
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ── Render: Standard Library ── */
/* ── Render: Frequent (favourited library items) ──
   Surfaces LIB_PREFS.favs as its own section above the main Library.
   Cards are built via cpMakeLibCard() — identical visuals, drag, click,
   and star toggle to the Library section. An item that is starred shows
   up here AND in its normal category group in cpRenderLib(). */
function cpRenderFreq(){
  const body  = document.getElementById('cpSecBodyFreq');
  const badge = document.getElementById('cpFreqBadge');
  if(!body) return;

  const favSet = (LIB_PREFS.favs instanceof Set)
    ? LIB_PREFS.favs
    : new Set(Array.isArray(LIB_PREFS.favs) ? LIB_PREFS.favs : []);

  const stdItems = (typeof CLIB !== 'undefined') ? CLIB : [];
  const allItems = [
    ...stdItems,
    ...((S.customLib || []).map(c => ({ ...c, isCustom:true }))),
  ];

  const favItems = allItems
    .filter(it => favSet.has(it.key || it.name))
    .filter(it => cpMatch(it) && cpPassFilter(it, 'lib'));

  if(badge) badge.textContent = favItems.length;
  body.innerHTML = '';

  if(favItems.length === 0){
    body.innerHTML = '<div class="cp-empty">No frequent cargo yet. Star items to pin them here.</div>';
    return;
  }

  favItems.forEach(it => body.appendChild(cpMakeLibCard(it, !!it.isCustom)));
}

function cpRenderLib(){
  const body  = document.getElementById('cpSecBodyLib');
  const badge = document.getElementById('cpLibBadge');
  if(!body) return;

  /* A.4a.3 — sync DOM collapse state from CP_SECTIONS.lib on every
     render. Lib defaults to false (collapsed on initial load); user
     toggle in cpBindSections flips CP_SECTIONS.lib and the DOM in
     lockstep, so subsequent renders preserve user state. Placed
     before the ondk early-return so the sync runs in all branches. */
  const hdr = document.getElementById('cpSecHdrLib');
  if(hdr){
    const open = CP_SECTIONS.lib !== false;
    hdr.classList.toggle('collapsed', !open);
    body.classList.toggle('hidden', !open);
  }

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
            ${cargo.dgClasses&&cargo.dgClasses.length>0?`<span class="cp-tag cp-tag-dg">DG ${cargo.dgClasses.join(', ')}</span>`:''}
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

  /* Normal library view — CLIB presets only. Custom cargo is rendered
     exclusively by cpRenderCustom() into #cpCustomList, and favourited
     items (including favourited customs) are surfaced by cpRenderFreq().
     This section is the single source of truth for the standard preset
     catalogue.

     A.4a — flat list, no category group dividers (.cp-cat-lbl).
     Mockup shows "Other Cargo" as a single flat zebra-row list; the
     per-item .cp-lc-cat is also hidden via CSS, so categorisation
     hierarchy is suppressed everywhere on the row level. */
  const src = (typeof CLIB !== 'undefined') ? CLIB : [];
  const items = src.filter(item => cpMatch(item));

  if(badge) badge.textContent = items.length;
  if(items.length===0){
    body.innerHTML='<div class="cp-empty">No cargo matches your search.</div>';
    return;
  }

  items.forEach(item => body.appendChild(cpMakeLibCard(item)));
}

/* ── Helper: build a library card ──
   options:
     removable  — when true, render a × button that removes the item
                  from S.customLib (used by the Custom Cargo section).
     onRemove   — optional override for the × handler. Receives
                  (item, cardElement). If omitted, the default removal
                  splices S.customLib, saves, re-renders, and fires an
                  undo toast. */
function cpMakeLibCard(item, isCustom=false, options={}){
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
    /* Re-render both Frequent and Library so the star toggle updates
       the Frequent section membership immediately as well as the star
       state in any other card showing the same key. */
    cpRenderFreq();
    cpRenderLib();
  });
  card.appendChild(star);

  /* ── Optional × Remove button — Custom Cargo section only ── */
  let rmBtn = null;
  if(options.removable === true){
    rmBtn = document.createElement('span');
    rmBtn.style.cssText = 'font-size:14px;color:var(--txt4);cursor:pointer;flex-shrink:0;padding:0 2px;';
    rmBtn.textContent = '×';
    rmBtn.addEventListener('mousedown', e => e.stopPropagation());
    rmBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(typeof options.onRemove === 'function'){
        options.onRemove(item, card);
        return;
      }
      /* Default removal: splice S.customLib by reference (the visible
         index may not match the array index when filters are active),
         persist, re-render every section, and offer an undo toast that
         restores the item at the original position. */
      const idx = S.customLib.indexOf(item);
      if(idx < 0) return;
      const removed = S.customLib.splice(idx, 1)[0];
      if(typeof save === 'function') save();
      cpRender();
      if(typeof showUndoToast === 'function'){
        showUndoToast(
          (typeof t === 'function' ? t('removed_prefix') : 'Removed ') + (removed.name || 'custom cargo'),
          (typeof t === 'function' ? t('undo') : 'Undo'),
          () => {
            S.customLib.splice(idx, 0, removed);
            if(typeof save === 'function') save();
            cpRender();
          }
        );
      }
    });
    card.appendChild(rmBtn);
  }

  /* ── F1: Drag from library card onto deck canvas ── */
  const pendingItem = {
    type: 'cargo',
    item: { cat:item.cat, name:displayName, key:itemKey, w:pw, h:ph, wt:parseFloat(wt)||0, length_m:item.length_m, width_m:item.width_m }
  };

  card.addEventListener('mousedown', e => {
    if(e.target.closest('.cp-lc-star')) return;   /* don't intercept star click */
    if(rmBtn && e.target === rmBtn) return;       /* don't drag when starting on × */
    _libDragFromCard(e, pendingItem, displayName, pw, ph);
  });

  /* ── Click = toggle select. Second click on the same card deselects
     and returns it to the default blue idle state. ── */
  card.addEventListener('click', () => {
    const wasSelected = card.classList.contains('cp-lc-sel');
    document.querySelectorAll('.cp-qi,.cp-lc,.cp-dg').forEach(x => x.classList.remove('cp-qi-sel','cp-lc-sel','cp-dg-sel'));
    document.querySelectorAll('.lc,.dgc,.asco-qitem').forEach(x => x.classList.remove('sel','selected-q'));
    if(wasSelected){
      S.pending = null;
      if(typeof cancelPending==='function') cancelPending();
      cpShowHint('');
    } else {
      card.classList.add('cp-lc-sel');
      S.pending = pendingItem;
      _cpEnterPlacing();
      cpShowHint('<b>' + displayName.replace(/</g,'&lt;') + '</b> → click deck to place');
    }
  });

  return card;
}

/* ── Render: Custom Section ──
   Uses the unified cpMakeLibCard builder so drag, click, glow, star,
   alias, and the new toggle-deselect behave identically to Library and
   Frequent cards. The `removable:true` option turns on the × button. */
function cpRenderCustom(){
  const list = document.getElementById('cpCustomList'); if(!list) return;
  list.innerHTML = '';
  if(!S.customLib || S.customLib.length === 0) return;

  const items = S.customLib.filter(it => cpMatch(it) && cpPassFilter(it, 'custom'));
  if(items.length === 0){
    list.innerHTML = '<div class="cp-empty">No custom cargo matches your search.</div>';
    return;
  }
  items.forEach(item => list.appendChild(cpMakeLibCard(item, true, { removable:true })));
}

/* ── Custom cargo add from panel form ── */
function cpBindCustomForm(){
  const btn=document.getElementById('cpBtnAdd');
  if(!btn) return;
  btn.addEventListener('click',()=>{
    if(!isOperator()){ showToast('Switch to Operator mode'); return; }
    const desc=document.getElementById('cpDesc').value.trim();
    if(!desc){ alert('Enter description'); return; }
    /* Footprint-only template: length × width. Weight is 0 by default
       and set per-placed-instance via the cargo edit modal (it varies
       by loading state). CCU / ID isn't part of a manual template. */
    const lm=parseFloat(document.getElementById('cpLen').value)||3.0;
    const wm=parseFloat(document.getElementById('cpWid').value)||2.44;
    const sz=lm.toFixed(2)+'x'+wm.toFixed(2);
    const item={cat:'Custom',name:desc,sz,wt:0,
      length_m:lm,width_m:wm,w:m2px_w(lm),h:m2px_h(wm)};
    S.customLib.push(item);
    if(typeof buildCargoList==='function') buildCargoList();
    if(typeof buildCustList==='function') buildCustList();
    if(typeof buildModalDescSelect==='function') buildModalDescSelect();
    ['cpDesc','cpLen','cpWid'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
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

let KB_SEL = null;   /* currently keyboard-selected cargo id ("primary") */
/* Phase 4 foundation — full multi-selection set.
   KB_SEL remains the "primary" id (last-selected) for single-cargo paths
   (keyboard nudge, rotate/duplicate, single edit). KB_SEL_SET mirrors the
   visual `.cb.kb-sel` state for multi-select operations (bulk remove,
   aggregate inspector). On single-select, set contains just KB_SEL. */
let KB_SEL_SET = new Set();

/* ── Pixels per step for each modifier ────────────────────── */
const KB_STEP_FINE   = 1;     /* plain Arrow — 1px ultra-fine */
const KB_STEP_MED    = 5;     /* Alt+Arrow   — 5px medium     */
const KB_STEP_COARSE = M;     /* Shift+Arrow — 31px ≈ 1 metre */

/* ── Select a cargo block — now supports shift to build a set ─────────── */
/*  kbSelect(id)           → primary single-select (clear others, set primary)
 *  kbSelect(id, {shift})  → toggle id in the set without clearing others.
 *                           Primary becomes id (if added) or the last remaining
 *                           id in the set (if id was removed from the set).    */
/* Phase 25 — debounce window for the `select` confirmation tick. Rapid
   Tab-through or marquee updates would otherwise fire a tick per
   transition, which becomes chatty. A 180 ms minimum interval keeps the
   sound tactile without being buzzy. */
let _lastSelectTickAt = 0;
function _playSelectTick(id){
  if(!id) return;
  const now = performance.now();
  if(now - _lastSelectTickAt < 180) return;
  _lastSelectTickAt = now;
  if(typeof playSound === 'function') playSound('select');
}

function kbSelect(id, opts){
  opts = opts || {};
  const prevPrimary = KB_SEL;
  if(opts.shift){
    if(KB_SEL_SET.has(id)){
      /* Remove from selection */
      KB_SEL_SET.delete(id);
      const el = document.querySelector(`.cb[data-id="${id}"]`);
      if(el) el.classList.remove('kb-sel');
      /* Promote another set member to primary, or clear */
      if(KB_SEL_SET.size === 0){
        KB_SEL = null;
        kbHideCoord();
      } else {
        KB_SEL = Array.from(KB_SEL_SET).pop();
        kbShowCoord(KB_SEL);
      }
    } else {
      /* Add to selection */
      KB_SEL_SET.add(id);
      KB_SEL = id;
      const el = document.querySelector(`.cb[data-id="${id}"]`);
      if(el) el.classList.add('kb-sel');
      kbShowCoord(id);
    }
    /* Shift extensions don't play the tick — would be chatty during
       multi-select building. Only the primary transitions tick. */
    return;
  }
  /* Default — single-select: clear, then add the one */
  KB_SEL = id;
  KB_SEL_SET.clear();
  KB_SEL_SET.add(id);
  document.querySelectorAll('.cb.kb-sel').forEach(el => el.classList.remove('kb-sel'));
  const el = document.querySelector(`.cb[data-id="${id}"]`);
  if(el) el.classList.add('kb-sel');
  kbShowCoord(id);
  /* Phase 25 — soft confirmation tick when the primary actually changes.
     Re-selecting the same cargo doesn't tick (avoids double-fire on
     click-then-open-rail paths). */
  if(id !== prevPrimary) _playSelectTick(id);
}

/* ── Deselect keyboard target — clears full Phase 4 set ──────────────── */
function kbDeselect(){
  KB_SEL = null;
  KB_SEL_SET.clear();
  document.querySelectorAll('.cb.kb-sel').forEach(el => el.classList.remove('kb-sel'));
  kbHideCoord();
  /* Phase 2: deselection also closes the inspector rail.
     Guard against reentrancy — inspClose() calls kbDeselect(), so we
     only forward here if the rail is currently open with a selection. */
  if(typeof inspSelId !== 'undefined' && inspSelId != null){
    inspSelId = null;
    const rail = document.getElementById('inspRail');
    if(rail){
      rail.classList.remove('open');
      rail.setAttribute('aria-hidden','true');
    }
    document.body.classList.remove('insp-open');
    document.body.classList.remove('insp-multi');
  }
  /* Universal deck-home restore. Outside the guard above because inspClose()
     nulls inspSelId before calling us — every dismissal/deselect path funnels
     through here, so this is the single chokepoint that returns the deck to
     its pre-reveal position. No-op when no session is active. */
  restoreDeckHome();
}

/* ── Show coordinate tip near selected block ───────────────── */
function kbShowCoord(id){
  const cargo = S.cargo.find(c => String(c.id) === String(id));
  const tip   = document.getElementById('kb-coord-tip');
  if(!cargo || !tip) return;

  /* Real-world metres: x from AFT edge, y from PORT edge.
     Uses the physical-model helpers so the coord tip agrees with the
     ruler and the status-bar readout at the same pixel position. */
  const xm = deckXToMeters(cargo.x).toFixed(2);
  const ym = deckYToMeters(cargo.y).toFixed(2);
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
    /* Keep the action-button side consistent as the block nudges across
       the right edge (kbMove skips the full re-render that renderBlock uses). */
    el.classList.toggle('cb-ctrl-left', cbControlsFlipLeft(cargo));
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
    if(!isOperator()) return;          /* Viewer: block keyboard move */
    e.preventDefault();
    e.stopPropagation();
    /* Fine/medium nudges are zoom-compensated so the on-screen move equals
       the intended pixel amount at any zoom — the deck renders inside a
       scale(zoomLevel) wrapper, so model delta must be divided by zoomLevel.
       The coarse step is a real 1-metre deck distance and must stay a fixed
       model delta regardless of zoom, so it is NOT compensated. */
    let step;
    if(e.shiftKey)    step = KB_STEP_COARSE;
    else if(e.altKey) step = KB_STEP_MED  / zoomLevel;
    else              step = KB_STEP_FINE / zoomLevel;
    let dx = 0, dy = 0;
    if(e.key === 'ArrowLeft')  dx = -step;
    if(e.key === 'ArrowRight') dx = +step;
    if(e.key === 'ArrowUp')    dy = -step;
    if(e.key === 'ArrowDown')  dy = +step;
    kbMove(dx, dy);
    return;
  }

  /* ── Phase 6 — Tab / Shift+Tab cycles selection through cargo on the
     deck in reading order (bay order: left→right, top→bottom tiebreak).
     Always active (even for viewers) since it is a pure selection move,
     not a mutation. Wraps at ends. Opens inspector for the new selection
     when one is already open (Phase 2 behaviour: panel follows selection). */
  if(e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey){
    if(S.cargo.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const ordered = S.cargo.slice().sort((a,b) =>
      (a.x - b.x) || (a.y - b.y) || String(a.id).localeCompare(String(b.id))
    );
    const curIdx = KB_SEL ? ordered.findIndex(c => String(c.id) === String(KB_SEL)) : -1;
    const dir = e.shiftKey ? -1 : +1;
    const nextIdx = curIdx < 0
      ? (dir > 0 ? 0 : ordered.length - 1)
      : (curIdx + dir + ordered.length) % ordered.length;
    const next = ordered[nextIdx];
    if(!next) return;
    kbSelect(next.id);
    /* Only refresh the inspector if it was already open — never auto-open
       the rail from Tab alone. Deck-first: scanning stays on the deck. */
    if(document.body.classList.contains('insp-open') && typeof inspOpen === 'function'){
      inspOpen(next.id);
    }
    /* Nudge the new cargo into view on zoomed-out scrollers. */
    const el = document.querySelector(`.cb[data-id="${next.id}"]`);
    if(el && typeof el.scrollIntoView === 'function'){
      el.scrollIntoView({behavior:'smooth', block:'nearest', inline:'nearest'});
    }
    return;
  }

  /* ── Phase 8 — Content-adaptive viewport keys.
     F  : fit the selected cargo into the viewport (zoom-to-selection).
     0  : fit the entire deck into the viewport (same as fitToScreen).
     Both are pure viewport ops — no state mutation — so they run before
     the kbShortcuts gate and work for operators and viewers alike. */
  if(e.key === '0' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey){
    e.preventDefault();
    if(typeof fitToScreen === 'function') fitToScreen();
    return;
  }
  if((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey){
    e.preventDefault();
    if(!KB_SEL){
      if(typeof showToast === 'function') showToast('Select a cargo first','info');
      return;
    }
    const cargo = S.cargo.find(c => String(c.id) === String(KB_SEL));
    if(!cargo) return;
    const area  = document.getElementById('deckArea');
    const inner = document.querySelector('.deck-outer');
    if(!area || !inner) return;
    /* Target: cargo fills ~45% of the viewport's smaller axis, clamped to
       the global zoom bounds (applyZoom clamps internally too). */
    const targetFrac = 0.45;
    const naturalW = inner.offsetWidth  || TW;
    const naturalH = inner.offsetHeight || CVH;
    const zX = (area.clientWidth  * targetFrac) / cargo.w;
    const zY = (area.clientHeight * targetFrac) / cargo.h;
    const z  = Math.min(zX, zY);
    applyZoom(z);
    /* After zoom, the wrap resizes. Wait one frame for layout to commit
       before scrolling the cargo into the viewport center. */
    requestAnimationFrame(() => {
      const el = document.querySelector(`.cb[data-id="${cargo.id}"]`);
      if(el && typeof el.scrollIntoView === 'function'){
        el.scrollIntoView({behavior:'smooth', block:'center', inline:'center'});
      }
    });
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

  /* L — toggle the library panel (open ↔ close) */
  if(key === 'l'){
    e.preventDefault();
    if(typeof cpToggle === 'function') cpToggle();
    return;
  }

  /* Viewer mode: block all mutation shortcuts below this point */
  if(!isOperator()) return;

  /* Phase 7 — P toggles priority on the selected cargo (or uniform-mirror
     across a multi-selection). Finishes the Phase 6 "tag on the deck"
     pattern so priority, like status, never requires the inspector rail.
     Uniform-mirror rule: if any target is off → set all ON; if all on →
     set all OFF. Priority is non-spatial, so no segregation re-check. */
  if(key === 'p' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && KB_SEL){
    e.preventDefault();
    const targetIds = KB_SEL_SET.size > 0
      ? Array.from(KB_SEL_SET)
      : [KB_SEL];
    const targets = targetIds
      .map(id => S.cargo.find(c => String(c.id) === String(id)))
      .filter(Boolean);
    if(targets.length === 0) return;
    const allOn = targets.every(c => !!c.priority);
    const nextVal = !allOn;   /* any off → all ON; all on → all OFF */
    targets.forEach(c => { c.priority = nextVal; });
    renderAll();
    /* Restore ring (renderAll wipes DOM classes) — use whole set so multi
       selections stay visually active. */
    if(KB_SEL_SET.size > 0){
      KB_SEL_SET.forEach(id => {
        const el = document.querySelector(`.cb[data-id="${id}"]`);
        if(el) el.classList.add('kb-sel');
      });
    } else {
      kbSelect(KB_SEL);
    }
    updateStats();
    save();
    /* Phase 25 — priority toggle pulse on every affected cargo. Adds a
       brief glow so the change is visibly registered, especially when
       the priority badge itself is small. */
    targetIds.forEach(id => {
      const el = document.querySelector(`.cb[data-id="${id}"]`);
      if(!el) return;
      el.classList.remove('cb-priority-pulse');
      void el.offsetWidth;
      el.classList.add('cb-priority-pulse');
      el.addEventListener('animationend',
        () => el.classList.remove('cb-priority-pulse'),
        { once:true });
    });
    const n = targets.length;
    const label = nextVal ? 'Priority ON' : 'Priority off';
    if(typeof showToast === 'function'){
      showToast(n > 1 ? `${label} — ${n} cargo` : label, 'ok');
    }
    return;
  }

  /* Phase 6 — S cycles status (L → BL → ROB → TR → L) for the selected
     cargo, directly on the deck. The most common operator edit no longer
     requires the inspector rail. Goes through the same save / renderAll /
     updateStats / checkSeg chain as the inspector control so segregation
     checks and DG summaries stay correct. */
  if(key === 's' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && KB_SEL){
    const cargo = S.cargo.find(c => String(c.id) === String(KB_SEL));
    if(!cargo) return;
    e.preventDefault();
    const cycle = ['L','BL','ROB','TR'];
    const idx = cycle.indexOf(cargo.status);
    cargo.status = cycle[(idx + 1 + cycle.length) % cycle.length];
    renderAll();
    kbSelect(KB_SEL);   /* re-apply ring after renderAll() wipes DOM */
    updateStats();
    buildActiveLocStrip();
    if(typeof checkSeg === 'function') checkSeg();
    if(typeof updateDGSummary === 'function') updateDGSummary();
    save();
    /* Phase 25 — status cycle pulse on the affected cargo. renderAll()
       wiped + rebuilt the DOM above, so re-query after the rebuild and
       add the pulse class to the fresh element. */
    const statusEl = document.querySelector(`.cb[data-id="${KB_SEL}"]`);
    if(statusEl){
      statusEl.classList.remove('cb-status-pulse');
      void statusEl.offsetWidth;
      statusEl.classList.add('cb-status-pulse');
      statusEl.addEventListener('animationend',
        () => statusEl.classList.remove('cb-status-pulse'),
        { once:true });
    }
    const label = cargo.status === 'L'   ? 'Load'
                : cargo.status === 'BL'  ? 'Backload'
                : cargo.status === 'ROB' ? 'ROB'
                :                          'Transfer';
    if(typeof showToast === 'function') showToast('Status → ' + label, 'ok');
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
    const _rotId = KB_SEL;
    renderAll();
    kbSelect(KB_SEL);  /* re-apply ring after renderAll */
    updateStats();
    buildActiveLocStrip();
    checkSeg();
    save();
    playSound('rotate');
    _pulseCargo(_rotId, 'cb-rotate-pulse');
    return;
  }

  /* D — duplicate */
  if(key === 'd' && KB_SEL){
    e.preventDefault();
    const cargo = S.cargo.find(c => String(c.id) === String(KB_SEL));
    if(!cargo) return;
    const _srcX = cargo.x, _srcY = cargo.y, _srcW = cargo.w, _srcH = cargo.h;
    const _spot = findFreeSpot(cargo.x + cargo.w + 6, cargo.y, cargo.w, cargo.h);
    const newCargo = {
      ...cargo,
      id: Date.now() + Math.random(),
      x: _spot.x,
      y: _spot.y,
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
    playSound('duplicate');
    _emitDuplicateTrail(_srcX, _srcY, _srcW, _srcH, newCargo.id);
    return;
  }

  /* Delete / Backspace — delete selected block(s). Phase 9: after removal,
     advance selection to the next cargo in reading order (same ordering
     Tab uses in Phase 6) so scan-and-prune loops don't require the
     operator to re-select between each delete. */
  if((e.key === 'Delete' || e.key === 'Backspace') && KB_SEL){
    e.preventDefault();
    /* Decide which ids are being removed (honor Phase 4 multi-selection). */
    const removeIds = KB_SEL_SET.size > 0
      ? new Set(Array.from(KB_SEL_SET).map(String))
      : new Set([String(KB_SEL)]);

    /* Compute the successor BEFORE mutating S.cargo. Reading order matches
       Phase 6 Tab: x primary, y tiebreak, stable on id. Successor is the
       first cargo in that order NOT being removed, scanning from the
       position just after the last-removed item, wrapping to the head. */
    const ordered = S.cargo.slice().sort((a,b) =>
      (a.x - b.x) || (a.y - b.y) || String(a.id).localeCompare(String(b.id))
    );
    const removedIndices = ordered
      .map((c,i) => removeIds.has(String(c.id)) ? i : -1)
      .filter(i => i >= 0);
    const lastRemovedIdx = removedIndices.length
      ? removedIndices[removedIndices.length - 1]
      : -1;
    let succId = null;
    if(ordered.length > removeIds.size && lastRemovedIdx >= 0){
      const n = ordered.length;
      for(let step = 1; step <= n; step++){
        const probe = ordered[(lastRemovedIdx + step) % n];
        if(probe && !removeIds.has(String(probe.id))){ succId = probe.id; break; }
      }
    }

    /* Capture whether the rail was open — determines whether it follows. */
    const railWasOpen = document.body.classList.contains('insp-open');

    /* Phase 12 — spawn exit animations BEFORE the DOM is wiped. */
    animateCargoExit([...removeIds]);

    /* Now mutate. */
    kbDeselect();
    removeIds.forEach(id => dgEvictDeletedCargo(id));
    S.cargo = S.cargo.filter(c => !removeIds.has(String(c.id)));
    renderAll();
    updateStats();
    buildActiveLocStrip();
    checkSeg();
    updateDGSummary();
    save();

    /* Phase 9 — restore selection on the successor. Rail follows ONLY if
       it was already open (deck-first: never auto-open from a delete). */
    if(succId != null){
      kbSelect(succId);
      if(railWasOpen && typeof inspOpen === 'function') inspOpen(succId);
    }
    return;
  }
}

/* ════════════════════════════════════════════════════════════════════
   PHASE 4 — COMMAND PALETTE (Cmd/Ctrl+K).
   Grouped searchable command list. Every action dispatches to existing
   product functionality; no new domain logic. Dynamic cargo search when
   the query is non-empty. Guards hide actions inappropriate for the
   current mode (e.g. destructive actions in Viewer).
═══════════════════════════════════════════════════════════════════════ */
let _cmdpActive = 0;

function _cmdpActions(){
  /* Static action registry. Rebuilt per render so guards evaluate live. */
  const opFn = () => isOperator();
  const list = [
    /* Mode */
    { group:'Mode',      label:'Switch mode',
      run: () => { document.getElementById('modeBtn')?.click(); } },

    /* View */
    { group:'View',      label:'Open Library',           shortcut:'L',
      run: () => { if(typeof cpOpen === 'function') cpOpen(); else document.getElementById('btnLibOpen')?.click(); } },
    { group:'View',      label:'Open Smart Tools',
      run: () => { document.getElementById('btnSmartTools')?.click(); } },
    { group:'View',      label:'Reset zoom',             shortcut:'3',
      run: () => { if(typeof applyZoom === 'function') applyZoom(1.0); } },
    { group:'View',      label:'Fit to screen',
      run: () => { if(typeof fitToScreen === 'function') fitToScreen(); } },
    /* Phase 29 — Focus Deck mode. Dims the surrounding chrome so the
       deck alone is legible for final review. Never a permanent button:
       only reachable here or by re-running the action. Esc exits. */
    { group:'View',      label:'Enter Focus Deck',
      guard: () => !_focusDeckActive,
      run: () => { _focusDeckEnter(); } },
    { group:'View',      label:'Exit Focus Deck',
      guard: () => _focusDeckActive,
      run: () => { _focusDeckExit(); } },

    /* File */
    { group:'File',      label:'New deck plan',
      guard: opFn,
      run: () => {
        S.cargo = []; _currentFilePath = null;
        if(typeof _updateWindowTitle === 'function') _updateWindowTitle(null);
        renderAll(); updateStats(); buildActiveLocStrip(); updateDGSummary(); save();
        if(typeof showToast === 'function') showToast('New deck plan','ok');
      } },
    { group:'File',      label:'Save',                    shortcut:'Ctrl+S',
      run: () => { if(typeof menuSave === 'function') menuSave(); } },
    { group:'File',      label:'Save As…',                shortcut:'Ctrl+Shift+S',
      run: () => { if(typeof menuSaveAs === 'function') menuSaveAs(); } },
    { group:'File',      label:'Open project…',           shortcut:'Ctrl+O',
      run: () => { if(typeof menuOpen === 'function') menuOpen(); } },
    { group:'File',      label:'Clear deck plan…',
      guard: opFn,
      run: () => { document.getElementById('btnClrDeck')?.click(); } },

    /* Export */
    { group:'Export',    label:'Export PDF',
      run: () => { if(typeof menuExportPDF === 'function') menuExportPDF(); } },
    { group:'Export',    label:'Export Excel',
      run: () => { if(typeof menuExportExcel === 'function') menuExportExcel(); } },

    /* Selection */
    { group:'Selection', label:'Select all cargo',
      guard: () => S.cargo.length > 0,
      run: () => {
        KB_SEL_SET.clear();
        document.querySelectorAll('.cb.kb-sel').forEach(el => el.classList.remove('kb-sel'));
        S.cargo.forEach(c => {
          KB_SEL_SET.add(c.id);
          const el = document.querySelector(`.cb[data-id="${c.id}"]`);
          if(el) el.classList.add('kb-sel');
        });
        if(KB_SEL_SET.size > 0){
          KB_SEL = Array.from(KB_SEL_SET).pop();
          if(typeof kbShowCoord === 'function') kbShowCoord(KB_SEL);
          if(typeof inspOpen === 'function') inspOpen(KB_SEL);
        }
      } },
    { group:'Selection', label:'Clear selection',         shortcut:'Esc',
      guard: () => KB_SEL_SET.size > 0,
      run: () => { kbDeselect(); } },
    { group:'Selection', label:'Remove selected cargo',
      guard: () => isOperator() && KB_SEL_SET.size > 0,
      run: () => {
        /* Phase 9 — compute successor in Tab reading order BEFORE mutation
           so scan-and-prune loops stay fluid whether the delete came from
           the keyboard (Del) or this palette action. Rail stays closed
           unless it was already open (deck-first). */
        const removeIds = new Set(Array.from(KB_SEL_SET).map(String));
        const ordered = S.cargo.slice().sort((a,b) =>
          (a.x - b.x) || (a.y - b.y) || String(a.id).localeCompare(String(b.id))
        );
        const removedIndices = ordered
          .map((c,i) => removeIds.has(String(c.id)) ? i : -1)
          .filter(i => i >= 0);
        const lastRemovedIdx = removedIndices.length
          ? removedIndices[removedIndices.length - 1]
          : -1;
        let succId = null;
        if(ordered.length > removeIds.size && lastRemovedIdx >= 0){
          const n = ordered.length;
          for(let step = 1; step <= n; step++){
            const probe = ordered[(lastRemovedIdx + step) % n];
            if(probe && !removeIds.has(String(probe.id))){ succId = probe.id; break; }
          }
        }
        const railWasOpen = document.body.classList.contains('insp-open');

        const ids = Array.from(KB_SEL_SET);
        /* Phase 12 — exit animation before DOM wipe. */
        animateCargoExit(ids);
        S.cargo = S.cargo.filter(c => !KB_SEL_SET.has(c.id));
        ids.forEach(id => { if(typeof dgEvictDeletedCargo === 'function') dgEvictDeletedCargo(id); });
        /* Close the rail first (which also kbDeselects); we'll restore the
           next selection and rail follow-state explicitly below. */
        if(typeof inspClose === 'function') inspClose();
        renderAll(); updateStats(); buildActiveLocStrip();
        if(typeof checkSeg === 'function') checkSeg();
        if(typeof updateDGSummary === 'function') updateDGSummary();
        save();

        if(succId != null){
          kbSelect(succId);
          if(railWasOpen && typeof inspOpen === 'function') inspOpen(succId);
        }
      } },
  ];
  return list.filter(a => !a.guard || a.guard());
}

function _cmdpCargoResults(query){
  if(!query) return [];
  const q = query.toLowerCase();
  return S.cargo
    .filter(c =>
      (c.ccu || '').toLowerCase().includes(q)
      || (c.desc || '').toLowerCase().includes(q)
    )
    .slice(0, 5)
    .map(c => {
      const loc = (typeof locById === 'function' && c.platform) ? locById(c.platform) : null;
      const wt  = (parseFloat(c.wt) || 0).toFixed(1) + ' t';
      const bits = [c.status, loc && loc.name, wt].filter(Boolean);
      return {
        group:'Cargo',
        label: c.ccu || c.desc || 'Unnamed',
        sub:   bits.join(' · '),
        run: () => {
          if(typeof kbSelect === 'function') kbSelect(c.id);
          if(typeof inspOpen  === 'function') inspOpen(c.id);
        },
      };
    });
}

function renderCmdPalette(){
  const input = document.getElementById('cmdpInput');
  const list  = document.getElementById('cmdpList');
  if(!input || !list) return;

  const q = (input.value || '').trim();
  const qLower = q.toLowerCase();

  /* Filter static actions by query (label or group text match) */
  const staticActions = _cmdpActions().filter(a => {
    if(!qLower) return true;
    return a.label.toLowerCase().includes(qLower)
        || a.group.toLowerCase().includes(qLower);
  });
  const cargoResults = _cmdpCargoResults(q);

  const all = [...staticActions, ...cargoResults];

  list.innerHTML = '';
  if(all.length === 0){
    list.innerHTML = '<div class="cmdp-empty">No matches</div>';
    _cmdpActive = 0;
    return;
  }

  /* Group while preserving order */
  const groups = [];
  const groupMap = {};
  all.forEach(a => {
    if(!groupMap[a.group]){
      groupMap[a.group] = { name: a.group, items: [] };
      groups.push(groupMap[a.group]);
    }
    groupMap[a.group].items.push(a);
  });

  /* Flat row index for keyboard nav */
  let rowIdx = 0;
  groups.forEach(g => {
    const hdr = document.createElement('div');
    hdr.className = 'cmdp-group-header';
    hdr.textContent = g.name;
    list.appendChild(hdr);
    g.items.forEach(a => {
      const row = document.createElement('div');
      row.className = 'cmdp-row';
      row.setAttribute('role', 'option');
      row.dataset.idx = rowIdx;
      const lbl = document.createElement('span');
      lbl.className = 'cmdp-row-label';
      lbl.textContent = a.label;
      row.appendChild(lbl);
      if(a.sub){
        const sub = document.createElement('span');
        sub.className = 'cmdp-row-sub';
        sub.textContent = a.sub;
        row.appendChild(sub);
      }
      if(a.shortcut){
        const sc = document.createElement('span');
        sc.className = 'cmdp-row-shortcut';
        sc.textContent = a.shortcut;
        row.appendChild(sc);
      }
      row.addEventListener('click', () => {
        closeCmdPalette();
        try { a.run(); } catch(err){ console.error('Command failed:', err); }
      });
      row.addEventListener('mousemove', () => {
        _cmdpSetActive(parseInt(row.dataset.idx, 10));
      });
      list.appendChild(row);
      rowIdx++;
    });
  });

  _cmdpActive = Math.min(_cmdpActive, rowIdx - 1);
  if(_cmdpActive < 0) _cmdpActive = 0;
  _cmdpSetActive(_cmdpActive);
}

function _cmdpSetActive(idx){
  const rows = document.querySelectorAll('.cmdp-row');
  if(rows.length === 0) return;
  _cmdpActive = Math.max(0, Math.min(rows.length - 1, idx));
  rows.forEach((r, i) => r.classList.toggle('active', i === _cmdpActive));
  rows[_cmdpActive]?.scrollIntoView({ block: 'nearest' });
}

function _cmdpNav(dir){
  const rows = document.querySelectorAll('.cmdp-row');
  if(rows.length === 0) return;
  _cmdpSetActive(_cmdpActive + dir);
}

function _cmdpExecute(){
  const rows = document.querySelectorAll('.cmdp-row');
  const row = rows[_cmdpActive];
  if(row) row.click();
}

function openCmdPalette(){
  const ov = document.getElementById('cmdpOv');
  if(!ov) return;
  _cmdpActive = 0;
  const input = document.getElementById('cmdpInput');
  if(input){ input.value = ''; }
  ov.classList.add('open');
  ov.setAttribute('aria-hidden', 'false');
  renderCmdPalette();
  setTimeout(() => { input?.focus(); }, 40);
}

function closeCmdPalette(){
  const ov = document.getElementById('cmdpOv');
  if(!ov) return;
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
}

function bindCmdPalette(){
  const ov       = document.getElementById('cmdpOv');
  const backdrop = document.getElementById('cmdpBackdrop');
  const input    = document.getElementById('cmdpInput');
  if(!ov || !input) return;

  input.addEventListener('input', () => {
    _cmdpActive = 0;
    renderCmdPalette();
  });

  input.addEventListener('keydown', e => {
    if(e.key === 'ArrowDown'){ e.preventDefault(); _cmdpNav(1); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); _cmdpNav(-1); }
    else if(e.key === 'Enter'){ e.preventDefault(); _cmdpExecute(); }
    else if(e.key === 'Escape'){ e.preventDefault(); closeCmdPalette(); }
  });

  if(backdrop) backdrop.addEventListener('click', () => closeCmdPalette());

  /* Global opener — capture phase so it still reaches us even when an
     input is focused. Toggle behaviour: second Cmd/Ctrl+K closes. */
  document.addEventListener('keydown', e => {
    if((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')){
      e.preventDefault();
      if(ov.classList.contains('open')) closeCmdPalette();
      else openCmdPalette();
    }
  }, { capture: true });
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

const THEME_SVG_SUN  = '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.5 2.5l.7.7M8.8 8.8l.7.7M9.5 2.5l-.7.7M3.2 8.8l-.7.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const THEME_SVG_MOON = '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 7.5A4.5 4.5 0 0 1 4.5 2c0-.3.02-.6.07-.9A4.5 4.5 0 1 0 10.9 7.43 4.6 4.6 0 0 1 10 7.5Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function applyTheme(theme){
  const html = document.documentElement;
  if(theme === 'dark'){
    html.setAttribute('data-theme','dark');
  } else {
    html.removeAttribute('data-theme');
  }
  /* Update gradient-pill icon + label */
  const ico = document.getElementById('themeIco');
  const lbl = document.getElementById('themeLbl');
  if(ico) ico.innerHTML = theme === 'dark' ? THEME_SVG_MOON : THEME_SVG_SUN;
  if(lbl) lbl.textContent = theme === 'dark' ? 'Dark' : 'Light';
  /* Persist */
  try{ localStorage.setItem('spicaTide_theme', theme); }catch(e){}
}

function bindThemeToggle(){
  /* Single gradient-pill toggle in the header cluster */
  const btn = document.getElementById('themeToggle');
  if(btn) btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'light' ? 'dark' : 'light');
  });

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

  if(!btn || !overlay) return;

  /* Open modal */
  btn.addEventListener('click', () => {
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
    /* Subtle fade-out of all cargo blocks AND location cards before removing.
       Both fade in parallel over the same 180ms window so the destructive
       setTimeout (190ms) clears them simultaneously and the user perceives
       a single coherent "everything dissolves" gesture rather than two
       separate disappearances. */
    const blocks = document.querySelectorAll('.cb');
    blocks.forEach(b => {
      b.style.transition = 'opacity .18s ease, transform .18s ease';
      b.style.opacity = '0';
      b.style.transform = 'scale(.94)';
    });
    const locCards = document.querySelectorAll('.loc-card');
    locCards.forEach(c => {
      c.style.transition = 'opacity .18s ease, transform .18s ease';
      c.style.opacity = '0';
      c.style.transform = 'scale(.94)';
    });
    setTimeout(() => {
      S.cargo = [];
      /* Clear voyage locations along with cargo. Per Pavel: Clear Deck is
         a "rework cargo plan" reset — cargo + locations + selection state
         go, but voyage metadata (voyage no, date, remarks) and user-owned
         libraries (S.customLocs, S.customLib) stay. */
      S.activeLocs = [];
      S.selLoc = null;
      LOC_FILTER = null;
      Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]);
      if(S.pending) S.pending = null;       /* cancel any mid-placement cargo */
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
   NEW DECK PLAN — Hold-to-confirm modal
   Replaces the instant actions.newDeck with a confirmation gate.
   Uses Family-style modal animations + holdToConfirm module.
═══════════════════════════════════════════════════════════ */
let _newDeckHtcCleanup = null;

function _execNewDeck(){
  /* ── Block 1: snapshot current state before clearing ── */
  const snap = {
    cargo: JSON.parse(JSON.stringify(S.cargo)),
    activeLocs: [...S.activeLocs],
    selLoc: S.selLoc,
    customLib: JSON.parse(JSON.stringify(S.customLib)),
    customLocs: JSON.parse(JSON.stringify(S.customLocs)),
    voyRemarks: S.voyRemarks,
    dynColors: JSON.parse(JSON.stringify(DYN_COLORS)),
    timestamp: Date.now()
  };
  try { localStorage.setItem('spicaTide_lastSnapshot_v1', JSON.stringify(snap)); } catch(e){}

  S.cargo=[];
  _currentFilePath=null;
  _updateWindowTitle(null);
  renderAll();
  updateStats();
  buildActiveLocStrip();
  updateDGSummary();
  save();
  _showUndoToast();
}

/* ── Restore deck from snapshot ── */
function _restoreFromSnapshot(){
  let raw;
  try { raw = localStorage.getItem('spicaTide_lastSnapshot_v1'); } catch(e){}
  if(!raw) return false;
  const snap = JSON.parse(raw);
  S.cargo = snap.cargo || [];
  S.activeLocs = snap.activeLocs || ['BLEO','TART'];
  S.selLoc = snap.selLoc || S.activeLocs[0];
  S.customLib = snap.customLib || [];
  S.customLocs = snap.customLocs || [];
  S.voyRemarks = snap.voyRemarks || '';
  if(snap.dynColors){ Object.keys(DYN_COLORS).forEach(k => delete DYN_COLORS[k]); Object.assign(DYN_COLORS, snap.dynColors); }
  renderAll(); updateStats(); buildActiveLocStrip(); updateDGSummary(); save();
  return true;
}

/* ── Generic undo toast (Apple-style snackbar with action button) ── */
function showUndoToast(msg, actionLabel, onUndo, duration = 6000){
  const stack = _ensureToastStack();
  let active = stack.querySelectorAll('.toast-msg:not(.is-leaving)');
  while(active.length >= _TOAST_CAP){ _dismissToast(active[0]); active = stack.querySelectorAll('.toast-msg:not(.is-leaving)'); }

  const el = document.createElement('div');
  el.className = 'toast-msg is-info toast-undo';
  el.setAttribute('role', 'status');
  el.innerHTML = _toastIcon('info') +
    `<span class="toast-msg-text">${_escHtml(msg)}</span>` +
    `<button class="toast-undo-btn">${_escHtml(actionLabel)}</button>`;

  el.querySelector('.toast-undo-btn').addEventListener('click', () => {
    clearTimeout(Number(el.dataset.toastTimer));
    onUndo();
    _dismissToast(el);
  });

  stack.appendChild(el);
  void el.offsetWidth;
  el.classList.add('is-visible');
  const auto = setTimeout(() => _dismissToast(el), duration);
  el.dataset.toastTimer = String(auto);
}

/* ── Undo toast for New Deck Plan (wrapper) ── */
function _showUndoToast(){
  showUndoToast(t('restore_toast'), t('restore_undo'), () => _restoreFromSnapshot(), 8000);
}

function _escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _updateRestoreMenuItem(){
  const el = document.getElementById('menuRestoreDeck');
  if(!el) return;
  let hasSnap = false;
  try { hasSnap = !!localStorage.getItem('spicaTide_lastSnapshot_v1'); } catch(e){}
  el.style.display = hasSnap ? '' : 'none';
}

function bindNewDeckModal(){
  const overlay = document.getElementById('newDeckOv');
  const modal   = document.getElementById('newDeckModal');
  const cancel  = document.getElementById('newDeckCancel');
  const holdBtn = document.getElementById('newDeckHoldBtn');
  if(!overlay || !modal || !holdBtn) return;

  const closeModal = async () => {
    await animateModalOut(overlay, modal);
    overlay.classList.remove('open');
    if(_newDeckHtcCleanup){ _newDeckHtcCleanup(); _newDeckHtcCleanup = null; }
  };

  /* Cancel */
  if(cancel) cancel.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if(e.target === overlay) closeModal(); });
  bindEscapeDismiss(overlay, closeModal);
  bindSwipeDismiss(modal, closeModal);
}

function openNewDeckModal(){
  const overlay = document.getElementById('newDeckOv');
  const modal   = document.getElementById('newDeckModal');
  const holdBtn = document.getElementById('newDeckHoldBtn');
  if(!overlay || !modal || !holdBtn) return;

  /* Clean up any previous hold binding */
  if(_newDeckHtcCleanup){ _newDeckHtcCleanup(); _newDeckHtcCleanup = null; }

  /* Update labels from current language */
  holdBtn.textContent = t('htc_new_deck_label');

  overlay.classList.add('open');
  animateModalIn(overlay, modal);

  /* Bind hold-to-confirm */
  _newDeckHtcCleanup = bindHoldToConfirm(holdBtn, () => {
    /* 100% hold completed → execute + close */
    const ov = document.getElementById('newDeckOv');
    const md = document.getElementById('newDeckModal');
    animateModalOut(ov, md).then(() => {
      ov.classList.remove('open');
    });
    _execNewDeck();
    if(_newDeckHtcCleanup){ _newDeckHtcCleanup(); _newDeckHtcCleanup = null; }
  }, {
    variant: 'linear',
    duration: 800,
    holdLabel: t('htc_hold_to', t('htc_new_deck_label').toLowerCase()),
    completedLabel: t('htc_completed'),
    fallbackLabel: t('htc_fallback_confirm'),
    hintText: t('htc_hint'),
    tooltipText: t('htc_tooltip_hold'),
  });

  /* Focus cancel — safer UX */
  const cancel = document.getElementById('newDeckCancel');
  if(cancel) setTimeout(() => cancel.focus(), 60);
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
    /* Estimate bay from x position — uses the central bayIndexFromX()
       helper so joint gaps are attributed to the bay on their left. */
    const _bi = bayIndexFromX(c.x);
    const bayNum = (_bi >= 0 && _bi < BAY_COUNT) ? String(12 - _bi) : '—';
    rows.push([
      c.ccu||'',
      c.desc||'',
      parseFloat((c.length_m||c.w/M).toFixed(2)),
      parseFloat((c.width_m||c.h/(CVH/15)).toFixed(2)),
      parseFloat(c.wt)||0,
      c.status==='L'?'Load':c.status==='BL'?'Backload':c.status==='ROB'?'ROB':c.status==='TR'?'Transfer':'',
      loc?loc.name:(c.platform||''),
      (c.dgClasses||[]).join(', ')||'',
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
  const DGs = [...new Set(S.cargo.flatMap(c=>c.dgClasses||[]))];
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
      await invoke('write_file_bytes', { path: xlsxPath, bytes });
      showToast(t('toast_xlsx_ok') + ' \u2014 ' + xlsxPath.split(/[/\\]/).pop(), 'ok');
      if(typeof _phase27ExportComplete === 'function') _phase27ExportComplete();
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
    if(typeof _phase27ExportComplete === 'function') _phase27ExportComplete();
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
  /* Toggle strip removed — matching is now automatic.
     Only the refresh button needs wiring. */
  const refreshBtn = document.getElementById('cpMatchRefresh');
  if(refreshBtn) refreshBtn.addEventListener('click', runManifestMatch);
}


/* ════════════════════════════════════════════════════════════
   SMART TOOLS SYSTEM
   
   Global settings object — all smart features read from here.
   Persisted to localStorage key 'spicaTide_smartTools'.

   Each feature is opt-in (default on for Bounce, DG fade).
════════════════════════════════════════════════════════════ */

const SMART_DEFAULTS = {
  bounce:      true,   /* Smart Bounce / Magnetic Snap */
  dgFade:      false,  /* DG Badge fade on hover */
  dgSeg:       true,   /* DG Auto-Segregation Check — safety critical, default ON */
  gridSnap:    true,   /* Smart Grid Snap — align on drop to neighbours / bay lines */
  kbShortcuts: true,   /* Keyboard Shortcuts System */
  locHighlight:false,  /* Highlight by Platform — dim non-selected platform cargo */
  emptyHint:   true,   /* V12: Show hint when deck is empty */
  dgOnly:      false,  /* S3: Show DG cargo only */
  /* Visual Smart Tools */
  portStbd:      true,  /* STBD/PORT labels on deck */
  secWatermark:  true,  /* Section number watermarks */
  dragGhost:     false, /* Ghost trail during drag */
  nameShimmer:   false, /* Vessel name shimmer */
  soundEnabled:  true,  /* Sound effects on/off */
  soundVolume:   70,    /* Master volume 0-100 */
  /* Performance Mode — reduces blur + decorative looping animations for
     weak integrated GPUs (Intel HD 630 class). Default ON for the fleet;
     full glass + motion return when toggled OFF. Implemented via
     html[data-perf="reduced"] (see app.css block at end of file). */
  perfMode:      true,
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

/* Apply Performance Mode: set/remove html[data-perf="reduced"]. The CSS
   block at the end of app.css scopes its overrides under that attribute. */
function applyPerfMode(){
  if(SMART.perfMode) document.documentElement.setAttribute('data-perf', 'reduced');
  else               document.documentElement.removeAttribute('data-perf');
}

/* Update the gear button dot (shows if any smart feature is active) */
function updateSmartDot(){
  const btn = document.getElementById('btnSmartTools');
  if(!btn) return;
  const anyOn = Object.values(SMART).some(v => v);
  btn.classList.toggle('has-active', anyOn);
}

/* findFreeSpot — nearest free, non-overlapping position for a NEW/duplicated block,
   starting at (seedX,seedY) near the original and spiralling outward. Tests against
   existing S.cargo only (same scope as smartBounce; fixed zones are NOT considered).
   Runs unconditionally — independent of the Smart Bounce toggle. */
function findFreeSpot(seedX, seedY, w, h){
  const others = S.cargo;
  const clampX = x => Math.max(0, Math.min(x, TW - w));
  const clampY = y => Math.max(0, Math.min(y, CVH - h));
  const overlaps = (x, y) => others.some(o =>
    x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y);
  const sx = clampX(seedX), sy = clampY(seedY);
  if(!overlaps(sx, sy)) return { x: sx, y: sy };
  const STEP = 8;
  const maxR = Math.max(TW, CVH);
  for(let r = STEP; r <= maxR; r += STEP){
    for(let a = 0; a < 360; a += 12){
      const rad = a * Math.PI / 180;
      const x = clampX(sx + r * Math.cos(rad));
      const y = clampY(sy + r * Math.sin(rad));
      if(!overlaps(x, y)) return { x, y };
    }
  }
  return { x: sx, y: sy };   /* deck packed: best-effort, keep seed */
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



/* ── Bind Smart Tools panel ── */
function bindSmartTools(){
  loadSmartSettings();
  applyDgFade();
  applyPerfMode();
  /* S3: Apply DG-only mode from persisted settings */
  const _dcvInit = document.getElementById('cvDECK');
  if(_dcvInit && SMART.dgOnly) _dcvInit.classList.add('deck-dg-only');
  updateSmartDot();

  const btn        = document.getElementById('btnSmartTools');
  const ov         = document.getElementById('stOv');
  const backdrop   = document.getElementById('stBackdrop');
  const closeBtn   = document.getElementById('stClose');
  const bounceChk       = document.getElementById('stBounceToggle');
  const dgFadeChk       = document.getElementById('stDgFadeToggle');
  const dgSegChk        = document.getElementById('stDgSegToggle');
  const gridSnapChk     = document.getElementById('stGridSnapToggle');
  const kbShortcutsChk  = document.getElementById('stKbShortcutsToggle');
  const locHighlightChk = document.getElementById('stLocHighlightToggle');
  const soundChk        = document.getElementById('stSoundToggle');
  const soundVolSlider  = document.getElementById('stSoundVolume');
  const soundVolLabel   = document.getElementById('stSoundVolLabel');
  const emptyHintChk    = document.getElementById('stEmptyHintToggle');
  const dgOnlyChk       = document.getElementById('stDgOnlyToggle');
  const perfModeChk     = document.getElementById('stPerfModeToggle');

  if(!btn || !ov) return;

  /* Set initial toggle states from loaded settings */
  if(bounceChk)      bounceChk.checked      = SMART.bounce;
  if(dgFadeChk)      dgFadeChk.checked      = SMART.dgFade;
  if(dgSegChk)       dgSegChk.checked       = SMART.dgSeg;
  if(gridSnapChk)    gridSnapChk.checked    = SMART.gridSnap;
  if(kbShortcutsChk) kbShortcutsChk.checked = SMART.kbShortcuts;
  if(locHighlightChk) locHighlightChk.checked = SMART.locHighlight;
  if(soundChk) soundChk.checked = SMART.soundEnabled;
  if(soundVolSlider){ soundVolSlider.value = SMART.soundVolume; if(soundVolLabel) soundVolLabel.textContent = SMART.soundVolume+'%'; }
  if(emptyHintChk)    emptyHintChk.checked    = SMART.emptyHint;
  if(dgOnlyChk)       dgOnlyChk.checked       = SMART.dgOnly;
  if(perfModeChk)     perfModeChk.checked     = SMART.perfMode;

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

  if(perfModeChk) perfModeChk.addEventListener('change', () => {
    SMART.perfMode = perfModeChk.checked;
    saveSmartSettings();
    updateSmartDot();
    applyPerfMode();
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
    if(!SMART.kbShortcuts) closeKbCheat();
  });

  if(locHighlightChk) locHighlightChk.addEventListener('change', () => {
    SMART.locHighlight = locHighlightChk.checked;
    saveSmartSettings();
    updateSmartDot();
    if(!SMART.locHighlight && LOC_FILTER) clearLocFilter();
  });

  /* ── Sound Settings — 3-level hierarchy wiring ── */
  if(soundChk) soundChk.addEventListener('change', () => {
    SMART.soundEnabled = soundChk.checked;
    saveSmartSettings(); updateSmartDot();
    const subPanel = document.getElementById('sndSubPanel');
    if(subPanel) subPanel.classList.toggle('disabled', !SMART.soundEnabled);
    if(_sndMaster) _sndMaster.gain.setTargetAtTime(SMART.soundEnabled ? SMART.soundVolume/100 : 0, _sndCtx?.currentTime||0, 0.05);
    if(!SMART.soundEnabled) _sndStopAmb();
    if(SMART.soundEnabled) playSound('save');
  });
  if(soundVolSlider) soundVolSlider.addEventListener('input', () => {
    SMART.soundVolume = parseInt(soundVolSlider.value);
    if(soundVolLabel) soundVolLabel.textContent = SMART.soundVolume+'%';
    if(_sndMaster && SMART.soundEnabled) _sndMaster.gain.setTargetAtTime(SMART.soundVolume/100, _sndCtx.currentTime, 0.03);
    saveSmartSettings();
  });
  /* Master expand/collapse */
  const sndExpand = document.getElementById('sndMasterExpand');
  const sndPanel = document.getElementById('sndSubPanel');
  const sndChv = document.getElementById('sndMasterChv');
  if(sndExpand && sndPanel) sndExpand.addEventListener('click', e => {
    if(e.target.tagName === 'INPUT') return;
    sndPanel.classList.toggle('open');
    if(sndChv) sndChv.classList.toggle('open', sndPanel.classList.contains('open'));
  });
  /* Category expand/collapse + toggle */
  ['basic','ambient','advanced'].forEach(cat => {
    const hd = document.getElementById('sndCatHd-'+cat);
    const bd = document.getElementById('sndCatBody-'+cat);
    const tgl = document.getElementById('sndCatTgl-'+cat);
    if(hd && bd) hd.addEventListener('click', e => {
      if(e.target.tagName === 'INPUT' || e.target.closest('.st-toggle')) return;
      bd.style.display = bd.style.display === 'none' ? '' : 'none';
    });
    if(tgl) {
      tgl.checked = _sndCats[cat].on;
      tgl.addEventListener('change', () => {
        _sndCats[cat].on = tgl.checked;
        const catEl = document.getElementById('sndCat-'+cat);
        if(catEl) catEl.classList.toggle('disabled', !tgl.checked);
        _sndUpdateBadge(cat);
        _sndSaveSettings();
      });
    }
  });
  /* Individual sound toggles + preview buttons */
  Object.keys(_sndState).forEach(id => {
    const tgl = document.getElementById('sndTgl-'+id);
    if(tgl) {
      tgl.checked = _sndState[id];
      tgl.addEventListener('change', () => {
        _sndState[id] = tgl.checked;
        _sndUpdateBadge(_sndCatMap[id]);
        _sndSaveSettings();
      });
    }
  });
  document.querySelectorAll('.snd-preview').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.snd;
      if(id) { try{ _sndInit(); if(soundFns[id]) soundFns[id](); }catch(e){} }
    });
  });
  /* Load saved sound settings */
  _sndLoadSettings();
  /* Apply disabled states */
  if(sndPanel && !SMART.soundEnabled) sndPanel.classList.add('disabled');
  ['basic','ambient','advanced'].forEach(cat => {
    _sndUpdateBadge(cat);
    const catEl = document.getElementById('sndCat-'+cat);
    if(catEl && !_sndCats[cat].on) catEl.classList.add('disabled');
  });

  if(emptyHintChk) emptyHintChk.addEventListener('change', () => {
    SMART.emptyHint = emptyHintChk.checked;
    saveSmartSettings(); updateSmartDot(); updateStats();
  });

  if(dgOnlyChk) dgOnlyChk.addEventListener('change', () => {
    SMART.dgOnly = dgOnlyChk.checked;
    saveSmartSettings(); updateSmartDot();
    const dcv = document.getElementById('cvDECK');
    if(dcv) dcv.classList.toggle('deck-dg-only', SMART.dgOnly);
  });

  /* ── Visual Smart Tools — 13 toggles ── */
  const vstMap = {
    portStbd:     { id:'stPortStbd',     cls:'vst-no-portstbd',   target:'dcv', invert:true },
    secWatermark: { id:'stSecWatermark', cls:'vst-no-watermark',  target:'dcv', invert:true },
    dragGhost:    { id:'stDragGhost' },
    nameShimmer:  { id:'stNameShimmer',  cls:'vst-name-shimmer',  target:'body' },
  };
  const dcvEl = document.getElementById('cvDECK');
  Object.entries(vstMap).forEach(([key, cfg]) => {
    const chk = document.getElementById(cfg.id);
    if(!chk) return;
    chk.checked = SMART[key];
    /* Apply initial class */
    if(cfg.cls){
      const el = cfg.target === 'dcv' ? dcvEl : document.body;
      if(el){
        if(cfg.invert) el.classList.toggle(cfg.cls, !SMART[key]);
        else el.classList.toggle(cfg.cls, SMART[key]);
      }
    }
    chk.addEventListener('change', () => {
      SMART[key] = chk.checked;
      saveSmartSettings(); updateSmartDot();
      if(cfg.cls){
        const el = cfg.target === 'dcv' ? dcvEl : document.body;
        if(el){
          if(cfg.invert) el.classList.toggle(cfg.cls, !SMART[key]);
          else el.classList.toggle(cfg.cls, SMART[key]);
        }
      }
    });
  });

  /* Phase 30A — Smart Tools cleanup wiring. Each helper is independent
     and safe to re-invoke; failure in one does not block the others. */
  _stBindSectionCollapse();
  _stBindSearch();
  _stBindPresets();
  _stUpdateAllSectionCounters();
  /* Any checkbox inside the Smart Tools panel updates section counters. */
  document.getElementById('stOv')?.addEventListener('change', e => {
    if(e.target && e.target.matches('input[type="checkbox"]')){
      _stUpdateAllSectionCounters();
    }
  });
}

/* ════════════════════════════════════════════════════════════
   PHASE 30A — SMART TOOLS CLEANUP
   Four helpers; all additive. None mutate existing toggle IDs or
   SMART shape. Persistence keys:
     spicaTide_stSections — collapsed-state per section id
══════════════════════════════════════════════════════════════ */
const _ST_SECTIONS_KEY = 'spicaTide_stSections';

function _stBindSectionCollapse(){
  const sections = document.querySelectorAll('#stOv .st-section');
  if(!sections.length) return;
  /* Restore saved collapse state. */
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(_ST_SECTIONS_KEY) || '{}'); } catch(e){}
  sections.forEach(sec => {
    const id = sec.dataset.sectionId;
    if(id && saved[id] === true) sec.classList.add('collapsed');
    const hdr = sec.querySelector('.st-sec-hdr');
    if(!hdr) return;
    hdr.addEventListener('click', () => {
      sec.classList.toggle('collapsed');
      _stPersistSectionState();
    });
  });
}
function _stPersistSectionState(){
  const out = {};
  document.querySelectorAll('#stOv .st-section').forEach(sec => {
    const id = sec.dataset.sectionId;
    if(id) out[id] = sec.classList.contains('collapsed');
  });
  try { localStorage.setItem(_ST_SECTIONS_KEY, JSON.stringify(out)); } catch(e){}
}

function _stUpdateAllSectionCounters(){
  document.querySelectorAll('#stOv .st-section').forEach(sec => {
    const count = sec.querySelector(':scope > .st-sec-hdr > .st-sec-count');
    if(!count) return;
    const boxes = sec.querySelectorAll('.st-sec-body input[type="checkbox"]');
    if(boxes.length === 0){ count.hidden = true; return; }
    const on = Array.from(boxes).filter(b => b.checked).length;
    count.hidden = false;
    count.textContent = on + '/' + boxes.length;
  });
}

function _stBindSearch(){
  const input = document.getElementById('stSearchInput');
  const clear = document.getElementById('stSearchClear');
  const empty = document.getElementById('stEmptySearch');
  if(!input) return;
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    clear.hidden = q.length === 0;
    if(!q){
      /* Restore baseline — nothing filtered. */
      document.querySelectorAll('#stOv .st-hidden-by-filter')
        .forEach(el => el.classList.remove('st-hidden-by-filter'));
      if(empty) empty.hidden = true;
      return;
    }
    let anyVisible = false;
    document.querySelectorAll('#stOv .st-section').forEach(sec => {
      let secHasMatch = false;
      /* Match inside .st-row, .snd-item, .st-action-row, .snd-cat-hd. */
      sec.querySelectorAll('.st-row, .snd-item, .st-action-row').forEach(row => {
        const text = (row.textContent || '').toLowerCase();
        const hit  = text.includes(q);
        row.classList.toggle('st-hidden-by-filter', !hit);
        if(hit) secHasMatch = true;
      });
      sec.classList.toggle('st-hidden-by-filter', !secHasMatch);
      /* Auto-expand any section that has a match so results are readable. */
      if(secHasMatch && sec.classList.contains('collapsed')){
        sec.classList.remove('collapsed');
      }
      if(secHasMatch) anyVisible = true;
    });
    if(empty) empty.hidden = anyVisible;
  };
  input.addEventListener('input', apply);
  if(clear){
    clear.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
  }
}

/* Preset definitions — each names a curated set of SMART flags and
   sound-category on/off states. Only flags the preset CARES about are
   set; all others keep the operator's current value. */
const _ST_PRESETS = {
  operational: {
    description: 'Calm, safety-forward defaults',
    smart: {
      bounce:true, gridSnap:true, dgSeg:true, dgFade:true,
      kbShortcuts:true, soundEnabled:true,
    },
    soundCats: { basic:true, ambient:true, advanced:false },
  },
  premium: {
    description: 'Full visual & audio language',
    smart: {
      bounce:true, gridSnap:true, dgSeg:true, dgFade:true,
      kbShortcuts:true, soundEnabled:true,
      nameShimmer:true,
    },
    soundCats: { basic:true, ambient:true, advanced:true },
  },
  minimal: {
    description: 'Essentials only — quietest possible workspace',
    smart: {
      bounce:true, gridSnap:true, dgSeg:true,
      dgFade:false,
      soundEnabled:false,
      nameShimmer:false,
      dragGhost:false,
    },
    soundCats: { basic:false, ambient:false, advanced:false },
  },
};

function _stBindPresets(){
  document.querySelectorAll('#stOv .st-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.preset;
      if(id === 'reset') _stApplyReset();
      else _stApplyPreset(id);
    });
  });
}
function _stApplyPreset(id){
  const preset = _ST_PRESETS[id];
  if(!preset) return;
  /* Snapshot current state so the user can undo via toast. */
  const snap = { smart: {...SMART}, theme: document.documentElement.getAttribute('data-theme'),
                 soundCats: { basic:_sndCats.basic.on, ambient:_sndCats.ambient.on, advanced:_sndCats.advanced.on } };
  /* Apply SMART flags the preset names. */
  Object.keys(preset.smart || {}).forEach(k => { SMART[k] = preset.smart[k]; });
  /* Apply sound categories. */
  if(preset.soundCats){
    ['basic','ambient','advanced'].forEach(c => {
      if(preset.soundCats[c] !== undefined) _sndCats[c].on = preset.soundCats[c];
    });
    _sndSaveSettings();
  }
  /* Apply theme if declared. */
  if(preset.theme){
    document.documentElement.setAttribute('data-theme', preset.theme);
    try { localStorage.setItem('spicaTide_theme', preset.theme); } catch(e){}
  }
  saveSmartSettings();
  _stSyncAllCheckboxesFromSmart();
  _stUpdateAllSectionCounters();
  if(typeof updateSmartDot === 'function') updateSmartDot();
  if(typeof applyDgFade === 'function') applyDgFade();
  if(typeof showToast === 'function'){
    const label = id.charAt(0).toUpperCase() + id.slice(1).replace('w',' W');
    showToast('Preset: ' + label + ' \u00B7 click Undo to revert', 'ok');
  }
  /* Store snapshot for a revert action (8 s window). */
  window._stPresetUndoSnap = snap;
  clearTimeout(window._stPresetUndoTimer);
  window._stPresetUndoTimer = setTimeout(() => { window._stPresetUndoSnap = null; }, 8000);
}
function _stApplyReset(){
  const snap = { smart: {...SMART}, theme: document.documentElement.getAttribute('data-theme') };
  Object.keys(SMART_DEFAULTS).forEach(k => { SMART[k] = SMART_DEFAULTS[k]; });
  saveSmartSettings();
  _stSyncAllCheckboxesFromSmart();
  _stUpdateAllSectionCounters();
  if(typeof updateSmartDot === 'function') updateSmartDot();
  if(typeof applyDgFade === 'function') applyDgFade();
  if(typeof showToast === 'function'){
    showToast('Reset to Recommended', 'ok');
  }
  window._stPresetUndoSnap = snap;
  clearTimeout(window._stPresetUndoTimer);
  window._stPresetUndoTimer = setTimeout(() => { window._stPresetUndoSnap = null; }, 8000);
}
/* Map SMART keys → Smart Tools checkbox IDs for automatic re-sync. */
const _ST_SMART_TO_CHK = {
  bounce:'stBounceToggle', dgFade:'stDgFadeToggle',
  dgSeg:'stDgSegToggle',
  gridSnap:'stGridSnapToggle', kbShortcuts:'stKbShortcutsToggle',
  locHighlight:'stLocHighlightToggle',
  emptyHint:'stEmptyHintToggle', dgOnly:'stDgOnlyToggle',
  soundEnabled:'stSoundToggle',
  portStbd:'stPortStbd',
  secWatermark:'stSecWatermark', dragGhost:'stDragGhost',
  nameShimmer:'stNameShimmer',
};
function _stSyncAllCheckboxesFromSmart(){
  Object.keys(_ST_SMART_TO_CHK).forEach(key => {
    const chk = document.getElementById(_ST_SMART_TO_CHK[key]);
    if(chk && typeof SMART[key] === 'boolean') chk.checked = SMART[key];
  });
  /* Sync sound category toggles too. */
  ['basic','ambient','advanced'].forEach(c => {
    const t = document.getElementById('sndCatTgl-'+c);
    if(t) t.checked = _sndCats[c].on;
  });
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
    clr_body:   'Clears all cargo and locations from the deck.',

    /* Buttons */
    btn_cancel: 'Cancel',
    rmk_save:   'Save Notes',

    /* Voyage Remarks */
    rmk_placeholder: 'Enter operational remarks, special instructions, cargo notes, or any voyage-specific information…',
    rmk_hint:   'Notes appear in the PDF export below the deck plan and in the Excel manifest.',

    /* Smart Tools sections */
    st_sec_placement: 'Cargo Placement',
    st_sec_visual:    'Visual',
    st_persist_note:  'Settings are saved automatically and restored on next open.',

    /* Smart Tools descriptions */
    st_bounce_desc: 'When cargo overlaps after drag — the block smoothly bounces to the nearest free position instead of staying in overlap.',
    st_dgfade_desc: 'On hover over a cargo block — DG and HL badges fade to show the CCU/ID underneath.',
    st_dgseg_desc:  'When a DG item is placed or edited — automatically checks compatibility against the IMDG segregation matrix. Violations are flagged immediately with pair details.',
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
    toast_import_summary: (a, sq, sd, nc) => `Import: ${a} added · ${sq} skipped (already imported) · ${sd} skipped (already on deck)` + (nc ? ` · ${nc} without CCU imported` : ''),
    toast_no_cargo:     'No recognisable cargo data found in this file.',
    toast_read_err:     (msg) => 'Could not read Excel file: ' + msg,
    toast_preparing:    'Preparing export…',
    toast_export_fail:  'Export failed — please try again',
    toast_pdf_ok:       'PDF exported \u2713',
    toast_print_ok:     'Print dialog opened',
    m_print:            'Print\u2026',
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

    /* Hold-to-confirm */
    htc_hold_to:          (s) => `Hold to ${s}…`,
    htc_completed:        'Done',
    htc_fallback_confirm: 'Confirm',
    htc_hint:             'Press and hold to confirm',
    htc_tooltip_hold:     'Hold to confirm',
    htc_new_deck_label:   'New Deck Plan',
    htc_new_deck_warning: 'This will erase all cargo and locations',

    /* Recovery / Undo */
    restore_toast:    'Deck plan cleared.',
    restore_undo:     'Undo',
    restore_menu:     'Restore previous deck plan',
    removed_prefix:   'Removed: ',
    undo:             'Undo',
  },

  ru: {
    clr_sub:    'Это действие нельзя отменить',
    clr_body:   'Удаляет весь груз и локации с палубы.',

    btn_cancel: 'Отмена',
    rmk_save:   'Сохранить заметки',

    rmk_placeholder: 'Введите оперативные заметки, инструкции, примечания по грузу или любую информацию по рейсу…',
    rmk_hint:   'Заметки отображаются в PDF-экспорте под планом палубы и в Excel-манифесте.',

    st_sec_placement: 'Размещение груза',
    st_sec_visual:    'Отображение',
    st_persist_note:  'Настройки сохраняются автоматически и восстанавливаются при следующем открытии.',

    st_bounce_desc: 'При перекрытии грузов после drag — контейнер мягко отталкивается в ближайшую свободную позицию рядом, а не остаётся в overlap.',
    st_dgfade_desc: 'При наведении на грузовой блок — DG и HL бейджи становятся полупрозрачными, чтобы был виден CCU/ID.',
    st_dgseg_desc:  'При размещении или редактировании DG груза — автоматическая проверка совместимости по матрице IMDG. Нарушения сегрегации отображаются немедленно.',
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
    toast_import_summary: (a, sq, sd, nc) => `Импорт: ${a} добавлено · ${sq} пропущено (уже импортировано) · ${sd} пропущено (уже на палубе)` + (nc ? ` · ${nc} без CCU импортировано` : ''),
    toast_no_cargo:     'Данные о грузе в файле не распознаны.',
    toast_read_err:     (msg) => 'Ошибка чтения файла: ' + msg,
    toast_preparing:    'Подготовка экспорта…',
    toast_export_fail:  'Ошибка экспорта — попробуйте ещё раз',
    toast_pdf_ok:       'PDF \u044d\u043a\u0441\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u043d \u2713',
    toast_print_ok:     '\u0414\u0438\u0430\u043b\u043e\u0433 \u043f\u0435\u0447\u0430\u0442\u0438 \u043e\u0442\u043a\u0440\u044b\u0442',
    m_print:            '\u041f\u0435\u0447\u0430\u0442\u044c\u2026',
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

    /* Hold-to-confirm */
    htc_hold_to:          (s) => `Удержите для ${s}…`,
    htc_completed:        'Готово',
    htc_fallback_confirm: 'Подтвердить',
    htc_hint:             'Нажмите и удерживайте',
    htc_tooltip_hold:     'Удержите для подтверждения',
    htc_new_deck_label:   'Новый план',
    htc_new_deck_warning: 'Это удалит весь груз и локации',

    /* Recovery / Undo */
    restore_toast:    'План очищен.',
    restore_undo:     'Отменить',
    restore_menu:     'Восстановить предыдущий план',
    removed_prefix:   'Удалено: ',
    undo:             'Отменить',
  },

  uk: {
    clr_sub:    'Цю дію не можна скасувати',
    clr_body:   'Видаляє весь вантаж і локації з палуби.',

    btn_cancel: 'Скасувати',
    rmk_save:   'Зберегти нотатки',

    rmk_placeholder: 'Введіть оперативні нотатки, інструкції, примітки до вантажу або будь-яку інформацію щодо рейсу…',
    rmk_hint:   'Нотатки відображаються в PDF-експорті під планом палуби та в Excel-маніфесті.',

    st_sec_placement: 'Розміщення вантажу',
    st_sec_visual:    'Відображення',
    st_persist_note:  'Налаштування зберігаються автоматично та відновлюються при наступному відкритті.',

    st_bounce_desc: 'Якщо вантажі перекриваються після drag — контейнер плавно відштовхується до найближчої вільної позиції, а не залишається в overlap.',
    st_dgfade_desc: 'При наведенні на вантажний блок — DG та HL бейджі стають напівпрозорими, щоб був видимий CCU/ID.',
    st_dgseg_desc:  'При розміщенні або редагуванні DG вантажу — автоматична перевірка сумісності за матрицею IMDG. Порушення сегрегації відображаються негайно.',
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
    toast_import_summary: (a, sq, sd, nc) => `Імпорт: ${a} додано · ${sq} пропущено (вже імпортовано) · ${sd} пропущено (вже на палубі)` + (nc ? ` · ${nc} без CCU імпортовано` : ''),
    toast_no_cargo:     'Дані про вантаж у файлі не розпізнані.',
    toast_read_err:     (msg) => 'Помилка читання файлу: ' + msg,
    toast_preparing:    'Підготовка експорту…',
    toast_export_fail:  'Помилка експорту — спробуйте ще раз',
    toast_pdf_ok:       'PDF \u0435\u043a\u0441\u043f\u043e\u0440\u0442\u043e\u0432\u0430\u043d\u043e \u2713',
    toast_print_ok:     '\u0414\u0456\u0430\u043b\u043e\u0433 \u0434\u0440\u0443\u043a\u0443 \u0432\u0456\u0434\u043a\u0440\u0438\u0442\u043e',
    m_print:            '\u0414\u0440\u0443\u043a\u0443\u0432\u0430\u0442\u0438\u2026',
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

    /* Hold-to-confirm */
    htc_hold_to:          (s) => `Утримайте для ${s}…`,
    htc_completed:        'Готово',
    htc_fallback_confirm: 'Підтвердити',
    htc_hint:             'Натисніть і утримуйте',
    htc_tooltip_hold:     'Утримайте для підтвердження',
    htc_new_deck_label:   'Новий план',
    htc_new_deck_warning: 'Це видалить весь вантаж і локації',

    /* Recovery / Undo */
    restore_toast:    'План очищено.',
    restore_undo:     'Скасувати',
    restore_menu:     'Відновити попередній план',
    removed_prefix:   'Видалено: ',
    undo:             'Скасувати',
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
      /* Use state machine, not classList — class persists across closing phase. */
      const st = getLangState(dropdown);
      if (st === 'closed' || st === 'closing') {
        animateLangDropdownIn(dropdown);
        pickerBtn.classList.add('open');
      } else {
        animateLangDropdownOut(dropdown);
        pickerBtn.classList.remove('open');
      }
    });

    document.addEventListener('click', () => {
      animateLangDropdownOut(dropdown);
      pickerBtn.classList.remove('open');
    });

    dropdown.addEventListener('click', e => e.stopPropagation());
  }

  /* Bind each option */
  document.querySelectorAll('.lang-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      applyLang(btn.dataset.lang);
      if(dropdown) animateLangDropdownOut(dropdown);
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

const CURRENT_BUILD = 'v3.7.0';
const APP_VERSION   = '3.7.0';
const RELEASE_CHANNEL = 'Stable';
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
   FEATURE BADGE — registry-based NEW badge system
   Uses FEATURE_BADGE_REGISTRY (src/badgeRegistry.js).
   shouldShowBadge(key) → true/false based on semver distance.
   renderBadge() → DOM span element.
══════════════════════════════════════════════════════════ */
function _parseSemver(str){
  const m = String(str||'').replace(/^v/,'').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major:+m[1], minor:+m[2], patch:+m[3] } : null;
}

function _semverDistance(from, to){
  /* Count how many version increments from → to.
     major change = large jump; minor = medium; patch = 1 each. */
  if(!from || !to) return Infinity;
  if(to.major > from.major) return (to.major - from.major) * 100;
  if(to.major < from.major) return 0;
  if(to.minor > from.minor) return (to.minor - from.minor) * 10 + (to.patch || 0);
  if(to.minor < from.minor) return 0;
  return Math.max(0, to.patch - from.patch);
}

function shouldShowBadge(featureKey){
  const entry = FEATURE_BADGE_REGISTRY[featureKey];
  if(!entry) return false;
  const introduced = _parseSemver(entry.introducedInVersion);
  const current    = _parseSemver(APP_VERSION);
  if(!introduced || !current) return false;
  return _semverDistance(introduced, current) < entry.expiresAfterVersions;
}

function renderBadge(){
  const span = document.createElement('span');
  span.className = 'feature-badge feature-badge--new';
  span.setAttribute('aria-label', 'New feature');
  span.textContent = 'NEW';
  return span;
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
    await invoke('write_file', { path, contents: JSON.stringify(envelope,null,2) });
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
      await invoke('write_file', { path: _currentFilePath, contents: JSON.stringify(envelope,null,2) });
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
    const contents = await invoke('read_file', { path: filePath });
    _applyProjectData(contents, filePath.split(/[/\\]/).pop());
    _currentFilePath = filePath;
    _updateWindowTitle(filePath);
  } catch(e){
    console.error('[Open]', e);
    showToast('Open failed: '+(e&&e.message||e),'warn');
  }
}

/* ── Recent files for File menu ──────────────────────────── */
async function _populateMenuRecent(){
  const listEl = document.getElementById('menuRecentList');
  const lblEl  = document.getElementById('menuRecentLabel');
  const sepEl  = document.getElementById('menuRecentSep');
  if(!listEl) return;
  listEl.innerHTML = '';

  let recents = [];
  try {
    if(window.__TAURI__) recents = await invoke('get_recent_files');
  } catch(e){}

  if(!recents.length){
    if(lblEl) lblEl.style.display = 'none';
    if(sepEl) sepEl.style.display = 'none';
    return;
  }
  if(lblEl) lblEl.style.display = '';
  if(sepEl) sepEl.style.display = '';

  recents.slice(0, 5).forEach(r => {
    const el = document.createElement('div');
    el.className = 'menu-action';
    const fname = r.path.split(/[/\\]/).pop();
    el.innerHTML = '<span class="ctx-icon" style="font-size:10px;opacity:.5">\u{1F4C4}</span>' + escHtml(fname);
    el.title = r.path;
    el.addEventListener('click', e => {
      e.stopPropagation();
      /* Close menu and open the file */
      document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
      openRecentFile(r.path);
    });
    listEl.appendChild(el);
  });
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
      else {
        closeAll(); item.classList.add('open'); openMenu = item;
        /* Populate recent files when File menu opens */
        if(item.dataset.menu === 'file'){ _populateMenuRecent(); _updateRestoreMenuItem(); }
      }
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
    newDeck:       () => openNewDeckModal(),
    restoreDeck:   () => { if(_restoreFromSnapshot()) showToast(t('restore_menu'),'ok'); },
    /* Clear Deck moved out of the main ribbon into the File menu.
       Delegates to the existing #btnClrDeck handler which opens the
       confirmation modal — destructive action path unchanged. */
    clearDeck:     () => { const b = document.getElementById('btnClrDeck'); if(b) b.click(); },
    openProject:   () => menuOpen(),
    saveProject:   () => menuSave(),
    saveProjectAs: () => menuSaveAs(),
    exportPDF:     () => menuExportPDF(),
    exportExcel:   () => menuExportExcel(),
    print:         () => printDeckPlan(),
    exportJSON:    () => menuSaveAs(),
    exit:          () => { try{ window.close(); }catch(e){} },
    undo:          () => undo(),
    redo:          () => redo(),
    deleteSelected:() => { if(typeof KB_SEL!=='undefined' && KB_SEL){ const idx=S.cargo.findIndex(c=>c.id===KB_SEL); if(idx>=0){animateCargoExit(KB_SEL);S.cargo.splice(idx,1);renderAll();updateStats();buildActiveLocStrip();checkSeg();updateDGSummary();save();} } },
    zoomIn:        () => applyZoom(zoomLevel+0.1),
    zoomOut:       () => applyZoom(zoomLevel-0.1),
    zoomReset:     () => applyZoom(1.0),
    zoomFit:       () => fitToScreen(),
    toggleLibrary: () => cpToggle(),
    about:         () => document.getElementById('aboutOverlay').classList.add('open'),
    checkUpdate:   () => _checkForUpdates(true),
    releaseHistory:() => openReleaseHistory(),
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
/* ══════════════════════════════════════════════════════════
   CARGO CONTEXT MENU — right-click on cargo blocks
══════════════════════════════════════════════════════════ */
let _ctxCargoId = null;

function showCtxMenu(cargoId, x, y){
  _ctxCargoId = cargoId;
  const menu = document.getElementById('ctxMenu');
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  menu.classList.add('open');
  /* Clamp to viewport */
  const r = menu.getBoundingClientRect();
  if(r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 4) + 'px';
  if(r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 4) + 'px';
}

function hideCtxMenu(){
  document.getElementById('ctxMenu').classList.remove('open');
  _ctxCargoId = null;
}

/* ══════════════════════════════════════════════════════════
   STATUS BAR — single operational readout: total longitudinal cargo span
   (most-fore edge − most-aft edge of all cargo, gaps included).
   Position / Zoom / Cargo count / Action readouts retired; those
   duplicated info already visible elsewhere in the UI.
══════════════════════════════════════════════════════════ */
function updateStatusBar(){
  const el = document.getElementById('dsbLength');
  if(!el) return;
  const lm = _computeBlockLengthM();
  el.textContent = (lm === null) ? '—' : (lm.toFixed(1) + ' m');
}

/* Bounding-box style: returns max(right edge in metres) − min(left edge
   in metres) across all cargo on the deck. Gaps between cargo blocks are
   included in the total — this is the operational "block length" the
   operator needs (e.g. two 2 m blocks separated by 5 m of empty deck →
   9 m, not 4 m). Uses deckXToMeters() for physical-model accuracy
   (matches the ruler tool); cargo.length_m is the source-of-truth for
   individual block length per the geometry contract documented at
   ~line 490. Returns null when the deck is empty so the caller can
   render "—" instead of "0.0 m" — semantically: no block exists, not
   a block of zero span. */
function _computeBlockLengthM(){
  if(!S.cargo.length) return null;
  let aft = Infinity, fore = -Infinity;
  for(const c of S.cargo){
    const leftM  = deckXToMeters(c.x);
    const rightM = leftM + (c.length_m || (c.w / M));
    if(leftM  < aft)  aft  = leftM;
    if(rightM > fore) fore = rightM;
  }
  return Math.max(0, fore - aft);
}

/* ════════════════════════════════════════════════════════════════════
   PHASE 23 — MEASURE RULER TOOL
   Two-point ruler that reports real-world metres using the same
   geometry source of truth as the deck (Phase 22). Coordinate math:
   pointer → (clientX - cvRect.left)/zoomLevel
   gives deck-local unscaled px, then /M (along-deck) and /YS
   (across-deck) give metres independently — final distance is
   sqrt(dx_m² + dy_m²). Never use raw pixel length for the metres
   readout because horizontal and vertical scales differ.

   State:
     _RULER.active    — tool mode on/off
     _RULER.pointA    — {x,y} first click, deck-local px
     _RULER.pointB    — {x,y} second click OR null (live preview mode)
     _RULER.hover     — {x,y} current pointer during live preview
     _RULER.constrain — true while Shift is held (axis-constrain live line)
════════════════════════════════════════════════════════════════════ */
const _RULER = {
  active: false,
  pointA: null,
  pointB: null,
  hover:  null,
  constrain: false,
};

function _rulerPtrToDeckPx(ev){
  const cv = document.getElementById('cvDECK');
  if(!cv) return null;
  const r = cv.getBoundingClientRect();
  const x = (ev.clientX - r.left) / zoomLevel;
  const y = (ev.clientY - r.top)  / zoomLevel;
  return {
    x: Math.max(0, Math.min(TW,  x)),
    y: Math.max(0, Math.min(CVH, y)),
  };
}

function _rulerResolveB(){
  /* The end point for rendering: pointB if set, else the live hover. */
  let b = _RULER.pointB || _RULER.hover;
  if(!b || !_RULER.pointA) return null;
  if(_RULER.constrain && !_RULER.pointB){
    /* Shift held during live preview → constrain the longer axis. */
    const dx = Math.abs(b.x - _RULER.pointA.x);
    const dy = Math.abs(b.y - _RULER.pointA.y);
    if(dx >= dy) b = { x: b.x, y: _RULER.pointA.y };
    else         b = { x: _RULER.pointA.x, y: b.y };
  }
  return b;
}

function _rulerEnsureOverlay(){
  const cv = document.getElementById('cvDECK');
  if(!cv) return null;
  let svg = cv.querySelector(':scope > .ruler-overlay');
  if(!svg){
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ruler-overlay');
    svg.setAttribute('viewBox', `0 0 ${TW} ${CVH}`);
    svg.setAttribute('width',  TW);
    svg.setAttribute('height', CVH);
    svg.setAttribute('preserveAspectRatio', 'none');
    cv.appendChild(svg);
  }
  return svg;
}

function _rulerRender(){
  const svg = _rulerEnsureOverlay();
  const label = document.getElementById('rulerLabel');
  if(!svg || !label) return;

  const a = _RULER.pointA;
  const b = _rulerResolveB();

  if(!a || !b){
    /* No measurement to draw. */
    svg.innerHTML = '';
    label.hidden = true;
    label.setAttribute('aria-hidden', 'true');
    return;
  }

  const isLive = !_RULER.pointB;  /* B not committed yet */

  /* Line + endpoint circles inside the cvDECK-local SVG (scales with zoom) */
  svg.innerHTML = `
    <line class="ruler-line${isLive ? ' ruler-line-live' : ''}"
          x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>
    <circle class="ruler-pt" cx="${a.x}" cy="${a.y}" r="5"/>
    ${_RULER.pointB ? `<circle class="ruler-pt" cx="${b.x}" cy="${b.y}" r="5"/>` : ''}
  `;

  /* Metres — convert X via the physical segment walk (deckXToMeters so
     the reading reflects the true bay/joint model, not the rounded-
     pixel canvas) and Y via the uniform deck-width ratio (deckYToMeters).
     Then combine into a real Euclidean distance in metres. This avoids
     cumulative pixel rounding drift on long spans: a full-deck read
     returns 54.92 m instead of 55.06 m. */
  const dxM = Math.abs(deckXToMeters(b.x) - deckXToMeters(a.x));
  const dyM = Math.abs(deckYToMeters(b.y) - deckYToMeters(a.y));
  const distM = Math.sqrt(dxM*dxM + dyM*dyM);

  /* Format — emphasise the dominant axis when the other is < 0.05 m. */
  const fmt = m => m.toFixed(m < 10 ? 2 : 1) + ' m';
  const AX_THRESHOLD = 0.05;
  let distText, deltaText;
  if(dyM < AX_THRESHOLD){        /* effectively horizontal */
    distText  = fmt(dxM);
    deltaText = '';
  } else if(dxM < AX_THRESHOLD){ /* effectively vertical */
    distText  = fmt(dyM);
    deltaText = '';
  } else {                       /* diagonal — show both components */
    distText  = fmt(distM);
    deltaText = 'X ' + fmt(dxM) + '  Y ' + fmt(dyM);
  }
  document.getElementById('rulerLabelDist').textContent  = distText;
  document.getElementById('rulerLabelDelta').textContent = deltaText;

  /* Phase 29 — ship-bearing chip. Shown only when the measurement is
     longer than 0.2 m (else it's jittery noise) and when the element
     exists (fails-silent if host HTML was trimmed). Uses the signed
     deck vector so port/stbd/fore/aft is correct. */
  const bearingEl = document.getElementById('rulerLabelBearing');
  if(bearingEl){
    if(distM >= 0.2){
      const br = _rulerBearingFor(a.x, a.y, b.x, b.y);
      bearingEl.textContent = br.dir + '  \u00B7  ' + String(br.bearing).padStart(3,'0') + '\u00B0';
      bearingEl.hidden = false;
    } else {
      bearingEl.hidden = true;
    }
  }

  /* Label screen position — perpendicular offset from the line midpoint
     so the label never sits on the line, the endpoints, or the exact
     point being measured. If the preferred side would overflow the
     viewport, flip to the opposite side; if both sides overflow, clamp
     inside the viewport with a small margin.

     All calculations happen in SCREEN (client) coords so the offset is
     invariant under zoom (the label is position:fixed). */
  const cv = document.getElementById('cvDECK');
  const r  = cv.getBoundingClientRect();
  const aCx = r.left + a.x * zoomLevel, aCy = r.top + a.y * zoomLevel;
  const bCx = r.left + b.x * zoomLevel, bCy = r.top + b.y * zoomLevel;
  const midCx = (aCx + bCx) / 2, midCy = (aCy + bCy) / 2;
  const dxC = bCx - aCx, dyC = bCy - aCy;
  const lineLen = Math.hypot(dxC, dyC);

  /* Perpendicular unit vector, preferring "above" the line (negative Y
     component in screen coords). For a degenerate (zero-length) live
     measurement we just offset straight up. */
  let perpX = 0, perpY = -1;
  if(lineLen > 0.5){
    perpX = -dyC / lineLen;
    perpY =  dxC / lineLen;
    if(perpY > 0){ perpX = -perpX; perpY = -perpY; }
  }
  /* Offset scales slightly with line length so short segments don't
     get a label parked far away and long segments have breathing room.
     Clamped to a friendly range. */
  const OFFSET = Math.max(24, Math.min(34, lineLen * 0.12 + 24));

  /* Reveal + measure so we can flip if overflowing. */
  label.hidden = false;
  label.setAttribute('aria-hidden', 'false');
  /* Ensure a fresh layout cycle before reading offsetWidth/Height. */
  label.style.left = '-9999px';
  label.style.top  = '-9999px';
  const lw = label.offsetWidth;
  const lh = label.offsetHeight;

  /* Candidate A: preferred side (above). */
  const candA = { x: midCx + perpX * OFFSET, y: midCy + perpY * OFFSET };
  /* Candidate B: flipped side (below). */
  const candB = { x: midCx - perpX * OFFSET, y: midCy - perpY * OFFSET };

  /* A candidate's rect is centred horizontally on its point and ends at
     its point on the "line" side — we use top-left for final placement.
     Evaluate overflow against the viewport with a 12 px margin; pick
     the candidate with less total overflow; clamp at the end. */
  const vw = window.innerWidth, vh = window.innerHeight;
  const PAD = 12;
  const overflow = (cx, cy) => {
    const left   = cx - lw / 2;
    const right  = cx + lw / 2;
    const top    = cy - lh / 2;
    const bottom = cy + lh / 2;
    return Math.max(0, PAD - left)
         + Math.max(0, right  - (vw - PAD))
         + Math.max(0, PAD - top)
         + Math.max(0, bottom - (vh - PAD));
  };
  const chosen = overflow(candA.x, candA.y) <= overflow(candB.x, candB.y)
               ? candA : candB;

  /* Clamp inside the viewport with PAD margin, keeping it centred on
     the chosen point where possible. */
  let finalX = chosen.x - lw / 2;
  let finalY = chosen.y - lh / 2;
  finalX = Math.max(PAD, Math.min(vw - lw - PAD, finalX));
  finalY = Math.max(PAD, Math.min(vh - lh - PAD, finalY));

  label.style.left = finalX + 'px';
  label.style.top  = finalY + 'px';
}

function _rulerClear(){
  _RULER.pointA = null;
  _RULER.pointB = null;
  _RULER.hover  = null;
  _RULER.constrain = false;
  _rulerRender();
}

function rulerToggle(force){
  const next = (typeof force === 'boolean') ? force : !_RULER.active;
  if(next === _RULER.active) return;
  _RULER.active = next;
  document.body.classList.toggle('ruler-active', _RULER.active);
  const btn = document.getElementById('btnRuler');
  if(btn) btn.setAttribute('aria-pressed', _RULER.active ? 'true' : 'false');
  if(!_RULER.active){
    _rulerClear();
  } else {
    /* Entering measure mode: any existing measurement is cleared so
       the operator starts fresh. */
    _rulerClear();
    if(typeof showToast === 'function'){
      showToast('Measure · click two points on the deck', 'info');
    }
  }
}

function _rulerOnClickLayerClick(ev){
  if(!_RULER.active) return;
  ev.preventDefault();
  ev.stopPropagation();
  const pt = _rulerPtrToDeckPx(ev);
  if(!pt) return;
  if(!_RULER.pointA){
    _RULER.pointA = pt;
    _RULER.pointB = null;
    _RULER.hover  = pt;
  } else if(!_RULER.pointB){
    /* Apply shift-constrain to the committed B. */
    let b = pt;
    if(_RULER.constrain){
      const dx = Math.abs(b.x - _RULER.pointA.x);
      const dy = Math.abs(b.y - _RULER.pointA.y);
      if(dx >= dy) b = { x: b.x, y: _RULER.pointA.y };
      else         b = { x: _RULER.pointA.x, y: b.y };
    }
    _RULER.pointB = b;
  } else {
    /* Both points already set — next click starts a new measurement. */
    _RULER.pointA = pt;
    _RULER.pointB = null;
    _RULER.hover  = pt;
  }
  _rulerRender();
}

function _rulerOnClickLayerMove(ev){
  if(!_RULER.active || !_RULER.pointA || _RULER.pointB) return;
  _RULER.hover = _rulerPtrToDeckPx(ev);
  _rulerRender();
}

function bindRulerTool(){
  const btn = document.getElementById('btnRuler');
  const layer = document.getElementById('rulerClickLayer');
  const labelClear = document.getElementById('rulerLabelClear');
  if(!btn || !layer) return;

  btn.addEventListener('click', () => rulerToggle());

  layer.addEventListener('click',     _rulerOnClickLayerClick);
  layer.addEventListener('mousemove', _rulerOnClickLayerMove);

  /* Clear-(×) inside the floating label. */
  if(labelClear){
    labelClear.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _rulerClear();
    });
  }

  /* Shift constrain — track key state during live preview. */
  window.addEventListener('keydown', e => {
    if(!_RULER.active) return;
    if(e.key === 'Shift' && !_RULER.constrain){
      _RULER.constrain = true;
      _rulerRender();
    }
  });
  window.addEventListener('keyup', e => {
    if(e.key === 'Shift' && _RULER.constrain){
      _RULER.constrain = false;
      _rulerRender();
    }
  });

  /* Escape: if ruler has an in-progress measurement, cancel that first;
     otherwise exit the tool. Registered in capture so we can act before
     any other Esc handler (which also cancel generic overlays). */
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    if(!_RULER.active) return;
    if(_RULER.pointA && !_RULER.pointB){
      /* mid-measurement → drop point A but keep tool active */
      _rulerClear();
      e.stopPropagation();
      return;
    }
    if(_RULER.pointA && _RULER.pointB){
      /* completed measurement visible → clear it but keep tool active */
      _rulerClear();
      e.stopPropagation();
      return;
    }
    /* No measurement in progress → exit the tool entirely. */
    rulerToggle(false);
    e.stopPropagation();
  }, { capture: true });

  /* M key — toggle measure mode. Honours the same input-focus / overlay
     guards used by other shortcuts. */
  document.addEventListener('keydown', e => {
    if(e.key !== 'm' && e.key !== 'M') return;
    if(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if(['INPUT','SELECT','TEXTAREA'].includes(tag)) return;
    if(document.getElementById('ov')?.classList.contains('open')) return;
    if(document.getElementById('ascoOv')?.classList.contains('open')) return;
    if(document.getElementById('kbCheatOv')?.classList.contains('open')) return;
    if(document.getElementById('cmdpOv')?.classList.contains('open')) return;
    e.preventDefault();
    rulerToggle();
  });

  /* Keep the label pinned to the current midpoint when the deck is
     zoomed or the page scrolls — recompute on every relevant event. */
  window.addEventListener('resize', _rulerRender);
  window.addEventListener('scroll', _rulerRender, { passive: true });
  const deckArea = document.getElementById('deckArea');
  if(deckArea) deckArea.addEventListener('scroll', _rulerRender, { passive: true });
}

function bindContextMenu(){
  /* Close on any click outside */
  document.addEventListener('click', hideCtxMenu);
  document.addEventListener('contextmenu', e => {
    /* Only keep open if right-clicking another .cb */
    if(!e.target.closest('.cb')) hideCtxMenu();
  });

  /* Action dispatch */
  document.getElementById('ctxMenu').addEventListener('click', e => {
    const item = e.target.closest('.ctx-item');
    if(!item || !_ctxCargoId) return;
    const action = item.dataset.ctx;
    const cargo = S.cargo.find(c => c.id === _ctxCargoId);
    hideCtxMenu();
    if(!cargo) return;
    if(!isOperator()) return;          /* Viewer: block all context actions */

    if(action === 'edit'){
      openModal(cargo.id);
    } else if(action === 'rotate'){
      const cx=cargo.x+cargo.w/2, cy=cargo.y+cargo.h/2;
      const nw=cargo.h, nh=cargo.w;
      cargo.w=nw; cargo.h=nh;
      cargo.x=Math.max(0,Math.min(cx-nw/2,TW-nw));
      cargo.y=Math.max(0,Math.min(cy-nh/2,CVH-nh));
      const tmp=cargo.length_m; cargo.length_m=cargo.width_m; cargo.width_m=tmp;
      renderAll(); updateStats(); save();
    } else if(action === 'duplicate'){
      const _spot=findFreeSpot(cargo.x+cargo.w+5,cargo.y,cargo.w,cargo.h);const nc={...cargo, id:Date.now()+Math.random(), x:_spot.x, y:_spot.y};
      S.cargo.push(nc);
      renderAll(); updateStats(); buildActiveLocStrip(); checkSeg(); updateDGSummary(); save();
    } else if(action === 'delete'){
      animateCargoExit(cargo.id);
      S.cargo = S.cargo.filter(c => c.id !== cargo.id);
      dgEvictDeletedCargo(cargo.id);
      renderAll(); updateStats(); buildActiveLocStrip(); checkSeg(); updateDGSummary(); save();
    }
  });
}

function bindAboutModal(){
  const ov = document.getElementById('aboutOverlay');
  if(!ov) return;
  document.getElementById('aboutClose').addEventListener('click', () => ov.classList.remove('open'));
  ov.addEventListener('click', e => { if(e.target === ov) ov.classList.remove('open'); });

  /* Show last check time */
  const lastTs = localStorage.getItem('spicaTide_lastUpdateCheck');
  const lastEl = document.getElementById('aboutLastCheck');
  if(lastEl && lastTs) lastEl.textContent = 'Last check: ' + new Date(parseInt(lastTs)).toLocaleString();

  /* Check for updates button */
  const checkBtn = document.getElementById('aboutCheckBtn');
  if(checkBtn) checkBtn.addEventListener('click', () => _checkForUpdates(true));

  /* Changelog button */
  const clBtn = document.getElementById('aboutChangelogBtn');
  if(clBtn) clBtn.addEventListener('click', () => {
    window.open('https://github.com/lagutinpavelglebovich-droid/spica-deck-cargo-planner/blob/main/CHANGELOG.md', '_blank');
  });
}

/* ══════════════════════════════════════════════════════════
   OPERATOR / VIEWER — Modal & binding
══════════════════════════════════════════════════════════ */
function openModeModal(){
  const ov = document.getElementById('modeOverlay');
  const modal = document.getElementById('modeModal');
  if(!ov || !modal) return;

  /* Viewer → Operator: confirm dialog (no password) */
  modal.innerHTML = `
    <h3>Enable Operator Mode</h3>
    <p>You'll be able to edit, save, and modify cargo placements.</p>
    <div class="mode-modal-btns">
      <button class="mode-modal-btn secondary" id="modeCancelBtn">Cancel</button>
      <button class="mode-modal-btn primary" id="modeConfirmBtn">Enable Operator</button>
    </div>`;
  document.getElementById('modeConfirmBtn').onclick = () => { setMode('operator'); closeModeModal(); };
  document.getElementById('modeCancelBtn').onclick = closeModeModal;
  ov.addEventListener('click', e => { if(e.target === ov) closeModeModal(); });
  const onKey = (e) => {
    if(e.key === 'Escape'){ closeModeModal(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
  ov.classList.add('open');
}

function closeModeModal(){
  const ov = document.getElementById('modeOverlay');
  if(ov) ov.classList.remove('open');
}

function bindModeButton(){
  /* #modeBtn is now the .brand-block wrapper (div role="button"), not a real
     <button>. We need an explicit keydown handler for Enter/Space activation,
     and the click handler must ignore bubbles from the nested brand-edit-btn
     pencil (which already calls stopPropagation, but we defend in depth).
     Role-state plumbing (_currentMode, setMode, isOperator, openModeModal)
     is untouched — only the trigger surface moved. */
  const btn = document.getElementById('modeBtn');
  if(btn){
    btn.addEventListener('click', e => {
      if(e.target.closest('.brand-edit-btn')) return;
      if(isOperator()){ setMode('viewer'); } else { openModeModal(); }
    });
    btn.addEventListener('keydown', e => {
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        if(isOperator()){ setMode('viewer'); } else { openModeModal(); }
      }
    });
  }
  /* Apply initial mode state to UI */
  applyModeUI();
}

/* ══════════════════════════════════════════════════════════
   RELEASE NOTES — What's New modal & Update History panel
   Reads from RELEASE_NOTES registry (src/releaseNotes.js).
══════════════════════════════════════════════════════════ */

const _RN_CHANGE_ICONS = {
  feature:     '\u2605',   /* ★ */
  improvement: '\u2191',   /* ↑ */
  fix:         '\u2713',   /* ✓ */
  ui:          '\u25C8',   /* ◈ */
  sync:        '\u27F3',   /* ⟳ */
  breaking:    '\u26A0',   /* ⚠ */
};

function _getReleaseEntry(version){
  return RELEASE_NOTES.find(r => r.version === version) || null;
}

/* ── What's New: check on launch ── */
function _checkWhatsNew(){
  const current = APP_VERSION;
  const lastSeen = localStorage.getItem('spicaTideLastSeenVersion');

  /* Fresh install — no stored value: skip modal, just record */
  if(!lastSeen){
    localStorage.setItem('spicaTideLastSeenVersion', current);
    return;
  }

  /* Same version: nothing to show */
  if(lastSeen === current) return;

  /* Version changed — look up notes */
  const entry = _getReleaseEntry(current);
  if(!entry){
    /* No registry entry for this version: silently mark as seen */
    localStorage.setItem('spicaTideLastSeenVersion', current);
    return;
  }

  _showWhatsNew(entry);
}

function _showWhatsNew(entry){
  const modal = document.getElementById('wnModal');
  const ov    = document.getElementById('wnOverlay');
  if(!modal || !ov) return;

  /* Build highlights */
  const hlHtml = entry.highlights.map(h => `<li>${escHtml(h)}</li>`).join('');

  /* Build changes */
  const chHtml = entry.changes.map(c => {
    const icon = _RN_CHANGE_ICONS[c.type] || '\u2022';
    return `<li><span class="wn-change-icon">${icon}</span>${escHtml(c.text)}</li>`;
  }).join('');

  /* Format date */
  const dateFmt = _formatReleaseDate(entry.date);

  modal.innerHTML = `
    <div class="wn-header">
      <h3 class="wn-title">\u2726 What's New in ${escHtml(entry.version)}</h3>
      <p class="wn-date">Released ${dateFmt}</p>
    </div>
    <div class="wn-section">
      <div class="wn-section-label">Highlights</div>
      <ul class="wn-highlights">${hlHtml}</ul>
    </div>
    <div class="wn-section">
      <div class="wn-section-label">All Changes</div>
      <ul class="wn-changes">${chHtml}</ul>
    </div>
    <div class="wn-footer">
      <button class="mode-modal-btn secondary" id="wnHistoryBtn">View Update History</button>
      <button class="mode-modal-btn primary" id="wnGotItBtn">Got it</button>
    </div>`;

  /* Bind buttons */
  document.getElementById('wnGotItBtn').onclick = () => _closeWhatsNew();
  document.getElementById('wnHistoryBtn').onclick = () => {
    _closeWhatsNew();
    openReleaseHistory();
  };
  ov.addEventListener('click', e => { if(e.target === ov) _closeWhatsNew(); });
  document.addEventListener('keydown', _wnEscHandler);

  ov.classList.add('open');
}

function _wnEscHandler(e){
  if(e.key === 'Escape') _closeWhatsNew();
}

function _closeWhatsNew(){
  const ov = document.getElementById('wnOverlay');
  if(ov) ov.classList.remove('open');
  localStorage.setItem('spicaTideLastSeenVersion', APP_VERSION);
  document.removeEventListener('keydown', _wnEscHandler);
}

/* ── Release History panel ── */
function openReleaseHistory(){
  const panel = document.getElementById('rhPanel');
  const ov    = document.getElementById('rhOverlay');
  if(!panel || !ov) return;

  /* Show last 3 versions */
  const entries = RELEASE_NOTES.slice(0, 3);
  if(entries.length === 0){
    panel.innerHTML = `<h3 class="rh-title">Update History</h3><p style="text-align:center;color:var(--txt3);font-size:11px;">No release notes available.</p>
    <div class="rh-close-row"><button class="mode-modal-btn secondary" id="rhCloseBtn">Close</button></div>`;
  } else {
    const entriesHtml = entries.map(entry => {
      const items = entry.changes.map(c => {
        const icon = _RN_CHANGE_ICONS[c.type] || '\u2022';
        return `<li><span class="wn-change-icon">${icon}</span>${escHtml(c.text)}</li>`;
      }).join('');
      return `
        <div class="rh-entry">
          <div class="rh-entry-header">
            <span class="rh-ver">v${escHtml(entry.version)}</span>
            <span class="rh-date">${_formatReleaseDate(entry.date)}</span>
          </div>
          <ul class="rh-list">${items}</ul>
        </div>`;
    }).join('');

    panel.innerHTML = `
      <h3 class="rh-title">Update History</h3>
      ${entriesHtml}
      <div class="rh-close-row"><button class="mode-modal-btn secondary" id="rhCloseBtn">Close</button></div>`;
  }

  document.getElementById('rhCloseBtn').onclick = () => _closeReleaseHistory();
  ov.addEventListener('click', e => { if(e.target === ov) _closeReleaseHistory(); });
  ov.classList.add('open');
}

function _closeReleaseHistory(){
  const ov = document.getElementById('rhOverlay');
  if(ov) ov.classList.remove('open');
}

function _formatReleaseDate(dateStr){
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  } catch(e){ return dateStr; }
}

/* ══════════════════════════════════════════════════════════
   AUTO-UPDATE SYSTEM — checks every 5 days, shows banner
══════════════════════════════════════════════════════════ */
const UPDATE_CHECK_INTERVAL = 5 * 24 * 60 * 60 * 1000; /* 5 days in ms */
let _updateAvailable = null;
let _updateFallback   = null; /* set by Strategy 2 (GitHub API) when Tauri plugin unavailable */

/* Semantic version comparison: returns true if a > b (e.g. "2.1.0" > "1.8.1") */
function _semverNewer(a, b){
  const pa = (a||'').split('.').map(Number);
  const pb = (b||'').split('.').map(Number);
  for(let i = 0; i < 3; i++){
    const va = pa[i] || 0, vb = pb[i] || 0;
    if(va > vb) return true;
    if(va < vb) return false;
  }
  return false; /* equal */
}

async function _checkForUpdates(manual){
  const resultEl = document.getElementById('aboutCheckResult');
  const lastEl = document.getElementById('aboutLastCheck');

  if(manual) {
    showToast('Checking for updates...', 'info');
    if(resultEl) resultEl.textContent = 'Checking...';
  }

  /* Strategy 1: Tauri plugin updater (desktop builds — supports download+install) */
  if(_isTauri()){
    try {
      const updaterMod = await import('@tauri-apps/plugin-updater');
      const update = await updaterMod.check();

      localStorage.setItem('spicaTide_lastUpdateCheck', String(Date.now()));
      if(lastEl) lastEl.textContent = 'Last check: ' + new Date().toLocaleString();

      if(update && update.available){
        const ver = update.version || '';
        /* Only offer update if remote version is actually newer */
        if(_semverNewer(ver, APP_VERSION)){
          _updateAvailable = update;
          _showUpdateBanner(ver);
          if(manual){
            showToast('Update available: v' + ver, 'ok');
            if(resultEl){
              resultEl.innerHTML = 'Version <b>' + ver + '</b> is available <button id="aboutUpdateBtn" style="margin-left:6px;padding:2px 8px;border-radius:4px;border:1px solid var(--acc);background:var(--acc);color:#fff;cursor:pointer;font-size:10px;">Update</button>';
              const _aub = resultEl.querySelector('#aboutUpdateBtn');
              if(_aub) _aub.onclick = () => { _doUpdate(); };
            }
          }
        } else {
          /* Remote is older or same — ignore */
          if(manual){
            showToast('You are on the latest version', 'ok');
            if(resultEl) resultEl.textContent = 'You are on the latest version \u2713';
          }
        }
      } else {
        if(manual){
          showToast('You are on the latest version', 'ok');
          if(resultEl) resultEl.textContent = 'You are on the latest version \u2713';
        }
      }
      return;
    } catch(e) {
      /* Tauri plugin failed — fall through to GitHub API check */
      if(!manual) return; /* silent fail for auto-check */
    }
  }

  /* Strategy 2: GitHub API check (browser dev mode or Tauri plugin failure) */
  try {
    const res = await fetch('https://api.github.com/repos/lagutinpavelglebovich-droid/spica-deck-cargo-planner/releases/latest', { cache:'no-cache' });
    if(!res.ok) throw new Error('GitHub API ' + res.status);
    const data = await res.json();
    const latest = data.tag_name ? data.tag_name.replace(/^v/,'') : '';

    localStorage.setItem('spicaTide_lastUpdateCheck', String(Date.now()));
    if(lastEl) lastEl.textContent = 'Last check: ' + new Date().toLocaleString();

    if(latest && _semverNewer(latest, APP_VERSION)){
      /* Store fallback so _doUpdate() can open the release page (Tauri plugin unavailable) */
      _updateFallback = {
        version: latest,
        url: data.html_url || 'https://github.com/lagutinpavelglebovich-droid/spica-deck-cargo-planner/releases/latest'
      };
      if(manual){
        showToast('Update available: v' + latest, 'ok');
        if(resultEl) resultEl.innerHTML = 'Version <b>' + latest + '</b> available — <a href="' + (data.html_url||'#') + '" target="_blank" style="color:var(--acc);">View release</a>';
      }
      _showUpdateBanner(latest);
    } else {
      if(manual){
        showToast('You are on the latest version', 'ok');
        if(resultEl) resultEl.textContent = 'You are on the latest version \u2713';
      }
    }
  } catch(e){
    if(manual){
      showToast('Update check failed', 'warn');
      if(resultEl) resultEl.textContent = 'Check failed: ' + (e && e.message || e);
    }
  }
}

function _showUpdateBanner(ver){
  const banner = document.getElementById('updateBanner');
  const textEl = document.getElementById('ubText');
  if(banner && textEl){
    /* Enrich with highlights from release notes registry if available */
    const entry = _getReleaseEntry(ver);
    if(entry && entry.highlights && entry.highlights.length > 0){
      textEl.textContent = 'v' + ver + ': ' + entry.highlights.slice(0, 2).join(' \u00B7 ');
    } else {
      textEl.textContent = 'New version ' + ver + ' available';
    }
    banner.classList.add('show');
    setTimeout(() => banner.classList.remove('show'), 30000);
  }
}

async function _doUpdate(){
  /* Strategy 2 fallback: Tauri plugin unavailable — open GitHub release page in browser */
  if(!_updateAvailable && _updateFallback){
    try {
      const { open: shellOpen } = await import('@tauri-apps/plugin-shell');
      await shellOpen(_updateFallback.url);
    } catch(e){
      showToast('Open browser: ' + _updateFallback.url, 'info');
    }
    _hideUpdateBanner();
    return;
  }
  if(!_updateAvailable) return;
  try {
    showToast('Downloading update...', 'ok');
    await _updateAvailable.downloadAndInstall();
    /* Prompt restart */
    const { relaunch } = await import('@tauri-apps/plugin-process');
    if(confirm('Update installed. Restart now?')) relaunch();
  } catch(e){
    showToast('Update failed: ' + (e && e.message || e), 'warn');
  }
}

function _bindUpdateBanner(){
  const banner = document.getElementById('updateBanner');
  if(!banner) return;

  document.getElementById('ubUpdate').addEventListener('click', () => {
    banner.classList.remove('show');
    _doUpdate();
  });
  document.getElementById('ubLater').addEventListener('click', () => {
    banner.classList.remove('show');
  });
  document.getElementById('ubDismiss').addEventListener('click', () => {
    banner.classList.remove('show');
  });
  document.getElementById('ubWhatsNew').addEventListener('click', () => {
    window.open('https://github.com/lagutinpavelglebovich-droid/spica-deck-cargo-planner/releases', '_blank');
  });
}

function _scheduleUpdateCheck(){
  if(!_isTauri()) return;
  const lastCheck = parseInt(localStorage.getItem('spicaTide_lastUpdateCheck') || '0');
  const elapsed = Date.now() - lastCheck;
  if(elapsed >= UPDATE_CHECK_INTERVAL){
    /* Delay 8 seconds so app loads first */
    setTimeout(() => _checkForUpdates(false), 8000);
  }
}

/* ══════════════════════════════════════════════════════════
   PHASE W1 — WEATHER WIDGET + MANUAL ATMOSPHERE SHELL

   Single source of truth: _wxState. Atmosphere is applied via
   data-wx="..." on <body> (CSS picks the gradient). Chip shows
   under .brand-sub when enabled && condition !== 'off'. Persists
   to localStorage 'spicaTide_weather'. No API, no geolocation.
══════════════════════════════════════════════════════════ */
const _WX_KEY = 'spicaTide_weather';
const _WX_MOTIONS = { off:1, reduced:1, full:1 };
const _WX_ENGINES = { cinematic:1, simple:1 };
const _WX_INTENSITIES = { subtle:1, normal:1, strong:1 };
/* Phase W5 §13 v7 — _wxState shape (manual mode retired):
     - enabled: master VFX toggle. Atmosphere body[data-wx] only renders
       when true. Polling lifecycle is INDEPENDENT of this flag — the
       plate always populates from cached weather.
     - location: Location object (or null until first-run resolves).
     - intensity / motion / engine: VFX rendering knobs.
   Removed: mode (auto/manual split) and condition (atmosphere now
   always reflects real Open-Meteo data for the selected location). */
const _wxState = { enabled: false, location: null, intensity: 'normal', motion: 'full', engine: 'cinematic' };

/* Phase W6 — one-time migration from the legacy string-typed location
   ('aberdeen'/'peterhead'/'stavanger'/'esbjerg'/'custom') to the new
   Location object. Coordinates are the official port lat/lng, copied
   from the Step 6 spec. 'custom' or any unknown string maps to null,
   which triggers the first-run flow at boot (geolocation prompt). */
const _LEGACY_LOCATION_MAP = {
  aberdeen:  { name: 'Aberdeen',  region: 'Scotland',   country: 'United Kingdom', countryCode: 'GB', lat: 57.1497, lng: -2.0943 },
  peterhead: { name: 'Peterhead', region: 'Scotland',   country: 'United Kingdom', countryCode: 'GB', lat: 57.5089, lng: -1.7836 },
  stavanger: { name: 'Stavanger', region: 'Rogaland',   country: 'Norway',         countryCode: 'NO', lat: 58.9700, lng:  5.7331 },
  esbjerg:   { name: 'Esbjerg',   region: 'Syddanmark', country: 'Denmark',        countryCode: 'DK', lat: 55.4760, lng:  8.4594 },
};
function _migrateLegacyLocation(d){
  if(!d) return false;
  if(typeof d.location !== 'string') return false;   // already migrated, or null
  const m = _LEGACY_LOCATION_MAP[d.location];
  if(m){
    d.location = { ...m, source: 'manual', resolvedAt: Date.now() };
  } else {
    /* 'custom' or anything not in the map → null. The boot path will
       run resolveInitialLocation if the user accepts geolocation, or
       open the search overlay if they decline. */
    d.location = null;
  }
  return true;
}

function _wxLoad(){
  let d = null;
  try{
    d = JSON.parse(localStorage.getItem(_WX_KEY) || 'null');
  } catch(e){
    /* Corrupt storage — fall through to defaults. Boot must never
       fail because of weather state. */
    d = null;
  }
  if(!d){
    /* First load or corrupt: defaults from _wxState declaration apply.
       The null location triggers the first-run geolocation flow once
       _wxBind has wired its handlers. */
    return;
  }
  /* One-time legacy migration: location string → object. v7 silently
     drops `mode` and `condition` fields from old storage — atmosphere
     now always reflects real weather, so the next _wxSave writes a
     clean envelope without those fields. */
  let migrated = _migrateLegacyLocation(d);
  if(typeof d.mode === 'string' || typeof d.condition === 'string') migrated = true;

  if(typeof d.enabled === 'boolean') _wxState.enabled = d.enabled;
  /* Location: shape-validated object, or null. _migrateLegacyLocation
     already converted any legacy string. Anything still wrong-shaped
     after migration is treated as null (first-run flow re-resolves). */
  if(d.location === null){
    _wxState.location = null;
  } else if(d.location && typeof d.location === 'object'
            && typeof d.location.name === 'string' && d.location.name
            && typeof d.location.lat === 'number'
            && typeof d.location.lng === 'number'){
    _wxState.location = d.location;
  } else {
    _wxState.location = null;
    migrated = true;
  }
  if(typeof d.intensity === 'string'
     && _WX_INTENSITIES[d.intensity]) _wxState.intensity = d.intensity;
  if(typeof d.motion === 'string'
     && _WX_MOTIONS[d.motion]) _wxState.motion = d.motion;
  if(typeof d.engine === 'string'
     && _WX_ENGINES[d.engine]) _wxState.engine = d.engine;

  /* Seed the location module so getLocation() reflects loaded state.
     Uses hydrate() (silent — does NOT fire onLocationChange) because
     subscribers haven't been attached yet at this point in boot. */
  if(_wxState.location) _wxLocHydrate(_wxState.location);

  /* Normalise storage so next load doesn't re-migrate. */
  if(migrated) _wxSave();
}
function _wxSave(){
  try{ localStorage.setItem(_WX_KEY, JSON.stringify(_wxState)); } catch(e){}
}
function _wxApply(){
  /* Atmosphere VFX active flag — gates body[data-wx] only. The plate
     populates regardless (real weather data is useful even without
     the animated background). */
  const active = _wxState.enabled;

  /* Condition source (v7 — manual mode retired): cached weather drives
     the rendered atmosphere key. If no cache yet (first boot before
     first fetch), fall back to DEFAULT_CONDITION ('cloudy') as a
     neutral baseline. */
  const cached = _wxGetCached();
  const baseCondition = cached ? cached.condition : DEFAULT_CONDITION;

  /* _FALLBACK_MAP collapses the API's 11-key vocabulary into the
     legacy 7-key one the renderer understands (e.g. partly-cloudy-day
     → cloudy). The plate continues to reference the un-mapped key. */
  const renderedCondition = active
    ? (_WX_FALLBACK_MAP[baseCondition] || baseCondition)
    : 'off';

  if(active){
    document.body.setAttribute('data-wx', renderedCondition);
    document.body.setAttribute('data-wx-intensity', _wxState.intensity);
    document.body.setAttribute('data-wx-motion', _wxState.motion);
    document.body.setAttribute('data-wx-engine', _wxState.engine);
  } else {
    document.body.removeAttribute('data-wx');
    document.body.removeAttribute('data-wx-intensity');
    document.body.removeAttribute('data-wx-motion');
    document.body.removeAttribute('data-wx-engine');
  }
  /* wxScene.set must run AFTER attribute stamping so CSS reflows in
     the same tick. Idempotent when condition is unchanged. */
  wxScene.set({
    condition: renderedCondition,
    intensity: _wxState.intensity,
    motion:    _wxState.motion,
    engine:    _wxState.engine,
  });
  /* ── Plate render (W5 §13 v7) ─────────────────────────────────
     Plate is always visible — atmosphere toggle controls VFX only.
     With manual mode retired, the readout is unconditionally:
       city (top)  +  temp + icon (main row).
     Empty values collapse via :empty CSS so a pre-fetch boot still
     looks tidy (just the icon + an em-dash city). */
  const plate  = document.getElementById('wxChipGroup');
  const cityEl = document.getElementById('wxChipCity');
  const tempEl = document.getElementById('wxChipTemp');
  const iconEl = document.getElementById('wxChipIcon');

  /* City — name only. Region/country live in the search overlay for
     disambiguation; no need to repeat them in the chip header. */
  const loc = _wxGetLocation();
  if(cityEl) cityEl.textContent = loc ? loc.name : '—';

  /* Icon — always rendered. iconForCondition falls back to 'cloudy'
     for unmapped keys, so the plate never has a missing visual. */
  if(iconEl){
    const url = iconForCondition(baseCondition);
    iconEl.innerHTML = '<img src="' + url + '" alt="" />';
  }

  /* Temperature — populated whenever cache has data. Empty before
     the first fetch lands; CSS :empty hides the span. */
  if(tempEl) tempEl.textContent = cached ? (cached.temperature + '°') : '';

  /* Stale dot — cache older than an hour. CSS .is-stale rule
     (opacity dim + amber dot) reacts to this class toggle. */
  const stale = !!(cached && (Date.now() - cached.fetchedAt) > 3600 * 1000);
  plate?.classList.toggle('is-stale', stale);

}
/* Phase W6 — format the location strip label. Mirrors how the chip
   shows just the city name, but the strip has more room so we add
   the region and country code where present. */
function _wxFormatLocLabel(loc){
  if(!loc) return '—';
  const parts = [loc.name];
  if(loc.region)  parts.push(loc.region);
  if(loc.country) parts.push(loc.country);
  return parts.join(', ');
}

/* Phase W6 — render Open-Meteo geocoding results into the search list.
   Each <li> carries the raw CityResult on a closure so click handlers
   can call _wxSetLocation without re-parsing dataset attributes. */
function _wxRenderSearchResults(results){
  const list  = document.getElementById('wxSearchResults');
  const state = document.getElementById('wxSearchState');
  if(!list) return;
  list.innerHTML = '';
  if(!results.length){
    if(state){ state.textContent = 'No results found'; state.hidden = false; }
    return;
  }
  if(state) state.hidden = true;
  for(const r of results){
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.className = 'wx-search-name';
    name.textContent = r.name;
    li.appendChild(name);
    if(r.region){
      const region = document.createElement('span');
      region.className = 'wx-search-region';
      region.textContent = ', ' + r.region;
      li.appendChild(region);
    }
    if(r.countryCode){
      const cc = document.createElement('span');
      cc.className = 'wx-search-cc';
      cc.textContent = r.countryCode;
      li.appendChild(cc);
    }
    /* mousedown fires before blur, so preventDefault here keeps
       focus on the input — otherwise the 200ms blur-close timer
       would fire and the panel would close before click resolves. */
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('click', () => {
      _wxSetLocation({
        name:        r.name,
        region:      r.region,
        country:     r.country,
        countryCode: r.countryCode,
        lat:         r.lat,
        lng:         r.lng,
      });
      _wxCloseSearch();
    });
    list.appendChild(li);
  }
}

/* Phase W6 — the search overlay open/close lifecycle. Tracks the time
   of the last keystroke so reopening with a >5min-old query clears
   the input (per Step 2 clarification 5). */
let _wxSearchLastQueryAt = 0;
let _wxSearchDebounce    = null;

function _wxOpenSearch(){
  const panel = document.getElementById('wxSearch');
  const input = document.getElementById('wxSearchInput');
  const state = document.getElementById('wxSearchState');
  if(!panel) return;
  panel.hidden = false;
  if(input){
    if(Date.now() - _wxSearchLastQueryAt > 5 * 60 * 1000){
      input.value = '';
      const list = document.getElementById('wxSearchResults');
      if(list) list.innerHTML = '';
      if(state){ state.textContent = 'Type to search'; state.hidden = false; }
    }
    setTimeout(() => input.focus(), 0);
  }
}

function _wxCloseSearch(){
  const panel = document.getElementById('wxSearch');
  if(!panel) return;
  panel.hidden = true;
  if(_wxSearchDebounce){
    clearTimeout(_wxSearchDebounce);
    _wxSearchDebounce = null;
  }
}

function _wxBind(){
  _wxLoad();
  /* Sync form controls. v7 retired the wxCondition <select>; only
     intensity / motion / engine / enable toggle remain. */
  const intSel = document.getElementById('wxIntensity');
  const motSel = document.getElementById('wxMotion');
  const engSel = document.getElementById('wxEngine');
  const enaChk = document.getElementById('wxEnableToggle');
  if(intSel) intSel.value = _wxState.intensity;
  if(motSel) motSel.value = _wxState.motion;
  if(engSel) engSel.value = _wxState.engine;
  if(enaChk) enaChk.checked = _wxState.enabled;

  /* Sync the location strip label from current state. */
  const locNameEl = document.getElementById('wxLocName');
  if(locNameEl) locNameEl.textContent = _wxFormatLocLabel(_wxState.location);

  /* ── Subscribers ──────────────────────────────────────────────
     Order matters: subscribe BEFORE wiring handlers that might call
     setLocation, so the very first user-driven location change is
     mirrored into _wxState and persisted. */
  onLocationChange((loc) => {
    _wxState.location = loc;
    _wxSave();
    if(locNameEl) locNameEl.textContent = _wxFormatLocLabel(loc);
    _wxApply();
  });
  onWeatherChange(() => {
    /* Re-render — _wxApply reads getCachedWeather internally. */
    _wxApply();
  });

  /* ── Form handlers: same shape as before, just for the controls
        that survived the 6a restructure. ─────────────────────────── */
  intSel?.addEventListener('change', () => {
    _wxState.intensity = intSel.value;
    _wxSave();
    _wxApply();
  });
  motSel?.addEventListener('change', () => {
    _wxState.motion = motSel.value;
    _wxSave();
    _wxApply();
  });
  engSel?.addEventListener('change', () => {
    _wxState.engine = engSel.value;
    _wxSave();
    _wxApply();
  });
  enaChk?.addEventListener('change', () => {
    _wxState.enabled = enaChk.checked;
    _wxSave();
    /* Phase W5 §13 v6 — atmosphere toggle is now PURE VFX. Polling
       lifecycle is decoupled from `enabled` so the plate keeps
       populating (city/temp/icon) regardless of whether body
       atmosphere VFX is rendered. autoRefresh continues to run as
       long as we are in auto mode. */
    _wxApply();
  });

  /* ── Location strip handlers ─────────────────────────────────── */
  document.getElementById('wxLocChange')?.addEventListener('click', _wxOpenSearch);
/* ── Search input: debounced (300ms), min 2 chars ──────────── */
  const searchInput   = document.getElementById('wxSearchInput');
  const searchResults = document.getElementById('wxSearchResults');
  const searchState   = document.getElementById('wxSearchState');
  searchInput?.addEventListener('input', () => {
    _wxSearchLastQueryAt = Date.now();
    if(_wxSearchDebounce){ clearTimeout(_wxSearchDebounce); _wxSearchDebounce = null; }
    const q = searchInput.value.trim();
    if(q.length < 2){
      if(searchResults) searchResults.innerHTML = '';
      if(searchState){
        searchState.textContent = q.length === 0 ? 'Type to search' : 'Keep typing…';
        searchState.hidden = false;
      }
      return;
    }
    if(searchState){ searchState.textContent = 'Searching…'; searchState.hidden = false; }
    _wxSearchDebounce = setTimeout(async () => {
      const results = await searchCities(q);
      _wxRenderSearchResults(results);
    }, 300);
  });

  /* Blur-to-close with 200ms grace so a click on a result registers
     before the panel hides. Also ignore blur when focus moves into
     another element inside the search panel (e.g. result list). */
  searchInput?.addEventListener('blur', () => {
    setTimeout(() => {
      const panel = document.getElementById('wxSearch');
      if(panel && !panel.contains(document.activeElement)){
        _wxCloseSearch();
      }
    }, 200);
  });

  /* ── Chip click → open Smart Tools, expand Weather section. ── */
  document.getElementById('wxChip')?.addEventListener('click', () => {
    document.getElementById('btnSmartTools')?.click();
    setTimeout(() => {
      const sec = document.querySelector('#stOv .st-section[data-section-id="weather"]');
      if(!sec) return;
      sec.classList.remove('collapsed');
      if(typeof _stPersistSectionState === 'function') _stPersistSectionState();
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  });

  /* Refresh button removed (Phase W5 §13 refinement) — polling
     handles updates automatically. _wxRefreshNow is still called
     internally by the manual-override toggle when returning to auto. */

  /* Initial apply (respects persisted enabled=false → no data-wx set). */
  _wxApply();

  /* ── Boot sequence (v7 — manual mode retired) ─────────────────
     1. Always start the polling loop. autoRefresh is now the sole
        data path — no manual mode that pauses it. start() emits
        cached data immediately (instant plate population) and
        schedules first poll at delay 0 (background fetch). The
        atmosphere toggle (`_wxState.enabled`) controls only body
        VFX rendering; data lifecycle is independent.
     2. If no location is set yet (first run, or 'custom' migrated
        to null), trigger the geolocation prompt. On accept, the
        reverse geocode resolves a city and setLocation fires the
        subscriber chain (which clears autoRefresh's cache and
        triggers an immediate fetch for the new city). On deny,
        open the search overlay so the user can pick manually. */
  _wxAutoStart();

  if(!_wxState.location){
    _wxResolveInitialLocation().then((loc) => {
      if(loc) _wxSetLocation(loc);
      else    _wxOpenSearch();
    });
  }
}

/* ══════════════════════════════════════════════════════════
   PHASE 29 — SIGNATURE MARITIME INTERACTIONS
   Three quiet, premium moments:
     1) Daily identity reveal  — once-per-day wordmark breathe-in
     3) Ruler ship-bearing     — vessel-relative direction on ruler
     4) Focus Deck mode        — command-palette dim-chrome review
   Each is independent, toggleable where appropriate, and respects
   prefers-reduced-motion. No gimmicks; no cheap nautical clichés.
══════════════════════════════════════════════════════════ */

/* 1) Daily identity reveal ─────────────────────────────── */
function _maybeTriggerDailyReveal(){
  try{
    const today = new Date().toISOString().slice(0, 10);   /* YYYY-MM-DD */
    const last  = localStorage.getItem('spicaTide_lastIdReveal');
    if(last === today) return;
    localStorage.setItem('spicaTide_lastIdReveal', today);
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const brand = document.getElementById('brandName');
    if(!brand) return;
    brand.classList.remove('id-revealing');
    void brand.offsetWidth;   /* reflow so class re-fires if we ever re-call */
    brand.classList.add('id-revealing');
    brand.addEventListener('animationend',
      () => brand.classList.remove('id-revealing'),
      { once: true });
  } catch(e){ /* localStorage not available — silently skip */ }
}

/* 3) Ruler ship-bearing ────────────────────────────────── */
/* Vessel-relative convention for this deck:
     +X  → fore (bow, right on screen)
     -X  → aft  (stern, left on screen)
     +Y  → stbd (screen-down — STBD label at bottom:8px)
     -Y  → port (screen-up   — PORT label at top:8px)
   Bearing is measured clockwise from +X (fore), so 0° = fore, 90° = stbd,
   180° = aft, 270° = port. Sector width 45°; 8 primary directions. */
const _RULER_SECTORS = [
  { min: -22.5, max:  22.5, label: 'fore' },
  { min:  22.5, max:  67.5, label: 'fore-stbd' },
  { min:  67.5, max: 112.5, label: 'stbd' },
  { min: 112.5, max: 157.5, label: 'aft-stbd' },
  { min: 157.5, max: 180.1, label: 'aft' },
  { min:-180.1, max:-157.5, label: 'aft' },
  { min:-157.5, max:-112.5, label: 'aft-port' },
  { min:-112.5, max: -67.5, label: 'port' },
  { min: -67.5, max: -22.5, label: 'fore-port' },
];
function _rulerBearingFor(ax, ay, bx, by){
  const dxM = deckXToMeters(bx) - deckXToMeters(ax);
  const dyM = deckYToMeters(by) - deckYToMeters(ay);
  const deg = Math.atan2(dyM, dxM) * 180 / Math.PI;   /* -180..180 */
  const dir = (_RULER_SECTORS.find(s => deg >= s.min && deg < s.max) || {}).label || '—';
  /* Maritime convention: show 0..360 clockwise from fore. */
  const bearing = Math.round((deg + 360) % 360);
  return { dir, bearing, deg };
}

/* 4) Focus Deck mode ───────────────────────────────────── */
let _focusDeckActive = false;
function _focusDeckToggle(){
  _focusDeckActive ? _focusDeckExit() : _focusDeckEnter();
}
function _focusDeckEnter(){
  if(_focusDeckActive) return;
  _focusDeckActive = true;
  document.body.classList.add('focus-deck');
  /* Brief hint pill — does NOT stay; fades on its own. Tells the
     operator how to exit without being a UI promotion. */
  if(typeof showToast === 'function'){
    showToast('Focus Deck \u00B7 Esc to exit', 'ok');
  }
}
function _focusDeckExit(){
  if(!_focusDeckActive) return;
  _focusDeckActive = false;
  document.body.classList.remove('focus-deck');
}

/* ══════════════════════════════════════════════════════════
   SOUND ENGINE v3 — 3-level hierarchy: Master → Category → Individual
   Apple-inspired organic synthesis. 9 sounds. Ambient loop.
══════════════════════════════════════════════════════════ */
let _sndCtx=null, _sndMaster=null, _sndAnalyser=null;
/* Phase 25 — `select` and `snap` added to the `basic` category so the
   sound engine now fires on single-cargo selection and on drag-drop
   snap lock-ins, completing the tactile feedback set. Both default on
   and respect the same per-sound + per-category toggles.
   Phase 27 — `undo`, `redo`, `rotate`, `duplicate`, `export` added to
   basic; `resolved` added to ambient. Coherent audio family across
   every common mouse-first operation. */
const _sndCats={basic:{on:true,sounds:['drop','remove','warning','save','select','snap','undo','redo','rotate','duplicate','export']},ambient:{on:true,sounds:['ocean','dgDrop','overweight','resolved']},advanced:{on:true,sounds:['voice','radio']}};
const _sndState={drop:true,remove:true,warning:true,save:true,select:true,snap:true,undo:true,redo:true,rotate:true,duplicate:true,export:true,ocean:true,dgDrop:true,overweight:true,resolved:true,voice:true,radio:true};
const _sndCatMap={drop:'basic',remove:'basic',warning:'basic',save:'basic',select:'basic',snap:'basic',undo:'basic',redo:'basic',rotate:'basic',duplicate:'basic',export:'basic',ocean:'ambient',dgDrop:'ambient',overweight:'ambient',resolved:'ambient',voice:'advanced',radio:'advanced'};
let _ambNodes=null;

function _sndInit(){
  if (!_sndCtx) {
    _sndCtx = new (window.AudioContext || window.webkitAudioContext)();
    _sndMaster = _sndCtx.createGain();
    _sndMaster.gain.value = SMART.soundVolume / 100;
    _sndMaster.connect(_sndCtx.destination);
    _sndRenderAll(); // fire-and-forget; buffers populate as ready
  }
  if (_sndCtx.state === 'suspended') _sndCtx.resume();
}
function canPlaySound(id){if(!SMART.soundEnabled)return false;const c=_sndCatMap[id];if(!_sndCats[c].on)return false;if(!_sndState[id])return false;return true;}
function softTone(freq,{start=0,attack=0.04,hold=0,decay=0.3,peak=0.2,type='sine',detune=0}={}){const t=start+_sndCtx.currentTime;const o=_sndCtx.createOscillator(),g=_sndCtx.createGain();o.type=type;o.frequency.value=freq;if(detune)o.detune.value=detune;g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+attack);if(hold>0)g.gain.setValueAtTime(peak,t+attack+hold);g.gain.setTargetAtTime(0.0001,t+attack+hold,decay/4);o.connect(g);g.connect(_sndMaster);o.start(t);o.stop(t+attack+hold+decay+0.1);}
function softNoise({start=0,attack=0.03,hold=0,decay=0.25,peak=0.08,filterFreq=800,filterQ=1,filterType='bandpass'}={}){const t=start+_sndCtx.currentTime;const dur=attack+hold+decay+0.1;const buf=_sndCtx.createBuffer(1,_sndCtx.sampleRate*dur,_sndCtx.sampleRate);const d=buf.getChannelData(0);let last=0;for(let i=0;i<d.length;i++){last=(last+(Math.random()*2-1)*0.1)*0.98;d[i]=last;}const src=_sndCtx.createBufferSource();src.buffer=buf;const filt=_sndCtx.createBiquadFilter();filt.type=filterType;filt.frequency.value=filterFreq;filt.Q.value=filterQ;const g=_sndCtx.createGain();g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+attack);if(hold>0)g.gain.setValueAtTime(peak,t+attack+hold);g.gain.setTargetAtTime(0.0001,t+attack+hold,decay/4);src.connect(filt);filt.connect(g);g.connect(_sndMaster);src.start(t);src.stop(t+dur);}
function addTail(freq,delay,vol,tailDecay){softTone(freq,{start:delay,attack:0.01,decay:tailDecay,peak:vol});}

/* ===== Premium offline-rendered engine =====
   Replaced sounds (drop/remove/save/warning/overweight/snap/radio) are
   rendered ONCE into a normalised AudioBuffer at first interaction (inside
   _sndInit) and cached in _sndBuffers[id]. The soundFns.<id> becomes a thin
   buffer-player with a verbatim legacy-synth fallback for the sub-second
   window before render-all completes on the very first interaction. */
const _sndBuffers = {};
let _sndReadyPromise = null;

function _sndImpulse(oc, sec, decay){
  const len = Math.floor(oc.sampleRate * sec);
  const b = oc.createBuffer(2, len, oc.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/len, decay);
  }
  return b;
}
function _sndBrown(oc, sec){
  const len = Math.floor(oc.sampleRate * sec);
  const b = oc.createBuffer(1, len, oc.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random()*2-1; last = (last + 0.02*w)/1.02; d[i] = last * 3.4; }
  return b;
}
function _sndNormalize(buf, target){
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  if (peak < 1e-5) return;
  const g = target / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
}
async function _sndRender(seconds, build){
  const rate = 44100, len = Math.ceil(rate * seconds);
  const oc = new OfflineAudioContext(2, len, rate);
  const out = oc.createGain(); out.connect(oc.destination);
  const conv = oc.createConvolver(); conv.buffer = _sndImpulse(oc, 1.2, 3.0);
  const rev = oc.createGain(); rev.gain.value = 1; conv.connect(rev); rev.connect(out);
  build(oc, out, conv);
  const buf = await oc.startRendering();
  _sndNormalize(buf, 0.85); // headroom under master
  return buf;
}
function _vO(oc, dry, rev, o){
  const { freq, type='sine', t0=0, attack=0.005, decay=0.3, peak=0.2, glideTo, glideT, detune=0, filt, Q=0.7, send=0 } = o;
  const osc = oc.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + (glideT || decay));
  if (detune) osc.detune.value = detune;
  let n = osc;
  if (filt) { const f = oc.createBiquadFilter(); f.type='lowpass'; f.frequency.value = filt; f.Q.value = Q; osc.connect(f); n = f; }
  const g = oc.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setTargetAtTime(0.0001, t0 + attack, decay / 3.2);
  n.connect(g); g.connect(dry);
  if (send > 0) { const s = oc.createGain(); s.gain.value = send; g.connect(s); s.connect(rev); }
  osc.start(t0); osc.stop(t0 + decay*4 + 0.2);
}
function _nO(oc, dry, rev, o){
  const { filt=1500, type='lowpass', Q=0.9, decay=0.07, peak=0.4, attack=0.004, t0=0, send=0 } = o;
  const src = oc.createBufferSource(); src.buffer = _sndBrown(oc, decay + 0.06);
  const f = oc.createBiquadFilter(); f.type = type; f.frequency.value = filt; f.Q.value = Q;
  const g = oc.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setTargetAtTime(0.0001, t0 + attack, decay / 3);
  src.connect(f); f.connect(g); g.connect(dry);
  if (send > 0) { const s = oc.createGain(); s.gain.value = send; g.connect(s); s.connect(rev); }
  src.start(t0); src.stop(t0 + decay + 0.1);
}
function _modal(oc, dry, rev, { fund, ratios, peaks, decays, filt=2400, send=0.12, t0=0, glide=0 }){
  ratios.forEach((r, i) => {
    const f0 = fund * r;
    _vO(oc, dry, rev, { freq: f0, glideTo: glide ? f0*glide : null, decay: decays[i], peak: peaks[i],
      filt, attack: 0.004, t0, send: i === 0 ? send : send * 0.5, detune: (i % 2 ? 7 : -5) });
  });
}
function _sndPlayBuf(id){
  const buf = _sndBuffers[id]; if (!buf) return false;
  const s = _sndCtx.createBufferSource(); s.buffer = buf; s.connect(_sndMaster); s.start();
  return true;
}
function _sndRenderAll(){
  if (_sndReadyPromise) return _sndReadyPromise;
  const recipes = {
    drop: () => _sndRender(0.75, (oc, dry, rev) => {
      _nO(oc, dry, rev, { filt: 1700, Q: 0.9, decay: 0.07, peak: 0.55, send: 0.12 });
      _vO(oc, dry, rev, { freq: 92, glideTo: 70, decay: 0.50, peak: 0.62, filt: 1100, send: 0.20 });
      _modal(oc, dry, rev, { fund: 92, ratios: [2.4, 3.8, 5.4], peaks: [0.14, 0.07, 0.035], decays: [0.20, 0.12, 0.08], filt: 2000, send: 0.10, glide: 0.78 });
    }),
    remove: () => _sndRender(0.7, (oc, dry, rev) => {
      _nO(oc, dry, rev, { filt: 1900, Q: 1.1, decay: 0.05, peak: 0.4, send: 0.10 });
      _vO(oc, dry, rev, { freq: 80, glideTo: 118, decay: 0.36, peak: 0.58, filt: 1300, send: 0.18 });
      _modal(oc, dry, rev, { fund: 80, ratios: [2.4, 3.8], peaks: [0.11, 0.05], decays: [0.16, 0.10], filt: 1900, send: 0.10, glide: 1.45 });
      _vO(oc, dry, rev, { freq: 520, glideTo: 760, type: 'triangle', decay: 0.13, peak: 0.06, filt: 3000, send: 0.14 });
    }),
    save: () => _sndRender(0.85, (oc, dry, rev) => {
      [392, 392].forEach((f, i) => _vO(oc, dry, rev, { freq: f, detune: i ? 6 : -6, decay: 0.30, peak: 0.34, filt: 2800, send: 0.22 }));
      _vO(oc, dry, rev, { freq: 784, decay: 0.26, peak: 0.10, filt: 3200, send: 0.2 });
      [587.33, 587.33].forEach((f, i) => _vO(oc, dry, rev, { freq: f, detune: i ? 6 : -6, t0: 0.105, decay: 0.42, peak: 0.38, filt: 3000, send: 0.28 }));
      _vO(oc, dry, rev, { freq: 1174, t0: 0.105, decay: 0.30, peak: 0.07, type: 'triangle', filt: 3600, send: 0.24 });
      _vO(oc, dry, rev, { freq: 1763, t0: 0.105, decay: 0.24, peak: 0.03, type: 'triangle', filt: 4200, send: 0.26 });
    }),
    warning: () => _sndRender(0.7, (oc, dry, rev) => {
      const pulse = (s) => {
        _vO(oc, dry, rev, { freq: 415, t0: s, decay: 0.16, peak: 0.40, filt: 1400, send: 0.07 });
        _vO(oc, dry, rev, { freq: 466, t0: s, decay: 0.16, peak: 0.17, filt: 1300, send: 0.07 });
        _vO(oc, dry, rev, { freq: 110, t0: s, decay: 0.12, peak: 0.16, filt: 700 });
      };
      pulse(0); pulse(0.21);
    }),
    overweight: () => _sndRender(0.9, (oc, dry, rev) => {
      _vO(oc, dry, rev, { freq: 104, glideTo: 80, attack: 0.04, decay: 0.55, peak: 0.55, filt: 620, send: 0.14 });
      _vO(oc, dry, rev, { freq: 52, glideTo: 40, attack: 0.05, decay: 0.55, peak: 0.32, filt: 320 });
      _modal(oc, dry, rev, { fund: 104, ratios: [2.4, 4.1], peaks: [0.09, 0.04], decays: [0.26, 0.16], filt: 900, send: 0.1, t0: 0.04, glide: 0.78 });
    }),
    snap: () => _sndRender(0.4, (oc, dry, rev) => {
      _vO(oc, dry, rev, { freq: 1244.5, decay: 0.07, peak: 0.4, filt: 5200, send: 0.12 });
      _vO(oc, dry, rev, { freq: 2489, decay: 0.05, peak: 0.12, type: 'triangle', filt: 6200, send: 0.12 });
    }),
    radio: () => _sndRender(0.4, (oc, dry, rev) => {
      _vO(oc, dry, rev, { freq: 1700, decay: 0.03, peak: 0.18, type: 'square', filt: 2200 });
      _nO(oc, dry, rev, { filt: 1800, type: 'bandpass', Q: 5, decay: 0.06, peak: 0.5, t0: 0.02 });
      _vO(oc, dry, rev, { freq: 1500, t0: 0.16, decay: 0.04, peak: 0.14, type: 'square', filt: 2000 });
    }),
  };
  _sndReadyPromise = Promise.all(
    Object.entries(recipes).map(async ([k, fn]) => { _sndBuffers[k] = await fn(); })
  );
  return _sndReadyPromise;
}

/* Phase 27 — AUDIO FAMILY DYNAMICS (calibrated, do not drift):
   - Significant moments (infrequent): peak 0.10-0.30.
     drop (0.30), warning (0.15), save (0.14), overweight (0.18), export (0.10).
     These DESERVE to cut through — they mark real transitions.
   - Frequent interactions (per-click): peak 0.04-0.06.
     select (0.045), snap (0.055), undo (0.050), redo (0.045),
     rotate (0.050), duplicate (0.045), resolved (0.055).
     Must never fatigue the ear during rapid layout building.
   - Any new sound must declare which band it belongs to. */
const soundFns={
  drop(){if(_sndPlayBuf('drop'))return;softTone(150,{attack:0.008,decay:0.35,peak:0.30});softTone(75,{attack:0.012,decay:0.45,peak:0.18});softTone(220,{attack:0.005,decay:0.15,peak:0.06,detune:-15});softNoise({attack:0.003,decay:0.08,peak:0.06,filterFreq:300,filterType:'lowpass'});addTail(75,0.12,0.04,0.5);addTail(150,0.08,0.03,0.4);},
  remove(){if(_sndPlayBuf('remove'))return;const t=_sndCtx.currentTime,dur=0.4;const buf=_sndCtx.createBuffer(1,_sndCtx.sampleRate*dur,_sndCtx.sampleRate);const d=buf.getChannelData(0);let last=0;for(let i=0;i<d.length;i++){last=(last+(Math.random()*2-1)*0.08)*0.99;d[i]=last;}const src=_sndCtx.createBufferSource();src.buffer=buf;const filt=_sndCtx.createBiquadFilter();filt.type='bandpass';filt.Q.value=0.8;filt.frequency.setValueAtTime(300,t);filt.frequency.exponentialRampToValueAtTime(2500,t+0.25);filt.frequency.setTargetAtTime(600,t+0.25,0.08);const g=_sndCtx.createGain();g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(0.12,t+0.06);g.gain.setTargetAtTime(0.0001,t+0.2,0.06);src.connect(filt);filt.connect(g);g.connect(_sndMaster);src.start(t);src.stop(t+dur);softTone(1800,{attack:0.05,decay:0.2,peak:0.02});softTone(2400,{attack:0.07,decay:0.18,peak:0.012,detune:8});},
  warning(){if(_sndPlayBuf('warning'))return;softTone(587,{start:0,attack:0.04,hold:0.06,decay:0.2,peak:0.15});softTone(587*2,{start:0,attack:0.04,hold:0.06,decay:0.15,peak:0.03});softTone(698,{start:0.18,attack:0.04,hold:0.06,decay:0.2,peak:0.15});softTone(698*2,{start:0.18,attack:0.04,hold:0.06,decay:0.15,peak:0.03});softTone(587,{start:0.36,attack:0.04,hold:0.06,decay:0.35,peak:0.12});softTone(294,{start:0,attack:0.06,decay:0.6,peak:0.06});},
  save(){if(_sndPlayBuf('save'))return;[{f:523,s:0,p:0.14},{f:659,s:0.07,p:0.12},{f:784,s:0.14,p:0.10}].forEach(n=>{softTone(n.f,{start:n.s,attack:0.03,decay:0.45,peak:n.p});softTone(n.f*2,{start:n.s,attack:0.04,decay:0.3,peak:n.p*0.12,detune:3});addTail(n.f,n.s+0.15,n.p*0.08,0.6);});softTone(262,{start:0,attack:0.06,decay:0.6,peak:0.04});},
  /* Phase 25 — calibrated confirmation ticks. `select` is a very soft,
     short fifth-octave tap for selection transitions. `snap` is a
     slightly firmer, lower tap representing a physical lock-in when
     Smart Grid Snap commits a drop onto a real boundary. Both are
     quieter than drop/save so rapid firing doesn't fatigue. */
  select(){softTone(880,{attack:0.002,decay:0.08,peak:0.045});softTone(1320,{attack:0.003,decay:0.06,peak:0.020,detune:4});softNoise({attack:0.002,decay:0.03,peak:0.012,filterFreq:4200,filterType:'highpass'});},
  snap(){if(_sndPlayBuf('snap'))return;softTone(520,{attack:0.002,decay:0.10,peak:0.055});softTone(260,{attack:0.004,decay:0.15,peak:0.028});softNoise({attack:0.002,decay:0.05,peak:0.020,filterFreq:1800,filterType:'bandpass',filterQ:1.2});addTail(520,0.04,0.018,0.18);},
  /* Phase 27 — premium interaction family.
     undo:     high→low sweep ~ "rewind". 780→520 via two staggered tones.
     redo:     inverse, low→high. Same envelope, feels forward.
     rotate:   soft mechanical tap (mid body, short tail + mild click).
     duplicate: twin-tone ~ "one, and another". 660 + 880 offset 45ms.
     export:   two-tone cadence + sub body ~ "done". Slightly fuller than save.
     resolved: soft descending 640→480 with filter fade ~ tension release. */
  undo(){softTone(780,{attack:0.004,decay:0.08,peak:0.040});softTone(520,{start:0.05,attack:0.004,decay:0.12,peak:0.050});softNoise({attack:0.003,decay:0.06,peak:0.010,filterFreq:500,filterType:'lowpass'});},
  redo(){softTone(520,{attack:0.004,decay:0.08,peak:0.040});softTone(780,{start:0.05,attack:0.004,decay:0.12,peak:0.045});softNoise({attack:0.003,decay:0.06,peak:0.010,filterFreq:2200,filterType:'highpass'});},
  rotate(){softTone(420,{attack:0.002,decay:0.06,peak:0.050});softTone(840,{attack:0.003,decay:0.04,peak:0.018,detune:3});softNoise({attack:0.002,decay:0.03,peak:0.014,filterFreq:2800,filterType:'bandpass',filterQ:1.4});},
  duplicate(){softTone(660,{attack:0.003,decay:0.10,peak:0.045});softTone(880,{start:0.045,attack:0.003,decay:0.08,peak:0.035,detune:2});softNoise({attack:0.002,decay:0.04,peak:0.012,filterFreq:3200,filterType:'highpass'});},
  export(){softTone(523,{attack:0.01,decay:0.25,peak:0.10});softTone(784,{start:0.12,attack:0.01,decay:0.35,peak:0.11});softTone(261,{attack:0.03,decay:0.50,peak:0.04});addTail(784,0.28,0.04,0.4);},
  resolved(){softTone(640,{attack:0.006,decay:0.14,peak:0.055});softTone(480,{start:0.08,attack:0.008,decay:0.22,peak:0.045});softNoise({attack:0.004,decay:0.10,peak:0.012,filterFreq:1200,filterType:'lowpass'});addTail(480,0.12,0.018,0.28);},
  dgDrop(){soundFns.drop();softTone(93,{start:0.2,attack:0.15,decay:0.8,peak:0.06});softTone(139,{start:0.2,attack:0.18,decay:0.7,peak:0.04});for(let i=0;i<6;i++){const d=0.3+Math.random()*0.6;softTone(3000+Math.random()*1500,{start:d,attack:0.001,decay:0.02,peak:0.015+Math.random()*0.01});}},
  overweight(){if(_sndPlayBuf('overweight'))return;softTone(70,{attack:0.25,hold:0.3,decay:1.0,peak:0.18});softTone(71.5,{attack:0.28,hold:0.28,decay:0.9,peak:0.12});softTone(140,{attack:0.3,hold:0.2,decay:0.8,peak:0.05});softNoise({attack:0.2,hold:0.25,decay:0.8,peak:0.04,filterFreq:200,filterQ:0.5,filterType:'lowpass'});addTail(70,0.8,0.03,1.2);},
  voice(){if(!('speechSynthesis' in window))return;softTone(880,{attack:0.05,decay:0.3,peak:0.06});softTone(1320,{attack:0.06,decay:0.25,peak:0.03});setTimeout(()=>{const u=new SpeechSynthesisUtterance('DG segregation violation, Bay 4');u.rate=0.92;u.pitch=0.85;u.volume=SMART.soundEnabled?Math.min(SMART.soundVolume/100*1.2,1):0;const voices=speechSynthesis.getVoices();const v=voices.find(v=>v.lang.startsWith('en')&&/female|samantha/i.test(v.name))||voices.find(v=>v.lang.startsWith('en'));if(v)u.voice=v;speechSynthesis.speak(u);},350);},
  radio(){if(_sndPlayBuf('radio'))return;const t=_sndCtx.currentTime;const sDur=0.45;const sBuf=_sndCtx.createBuffer(1,_sndCtx.sampleRate*sDur,_sndCtx.sampleRate);const sD=sBuf.getChannelData(0);let sL=0;for(let i=0;i<sD.length;i++){sL=(sL+(Math.random()*2-1)*0.12)*0.97;sD[i]=sL;}const sSrc=_sndCtx.createBufferSource();sSrc.buffer=sBuf;const sF=_sndCtx.createBiquadFilter();sF.type='bandpass';sF.frequency.value=1800;sF.Q.value=0.6;const sG=_sndCtx.createGain();sG.gain.setValueAtTime(0.0001,t);sG.gain.exponentialRampToValueAtTime(0.1,t+0.08);sG.gain.setTargetAtTime(0.02,t+0.1,0.1);sG.gain.setTargetAtTime(0.0001,t+0.35,0.04);sSrc.connect(sF);sF.connect(sG);sG.connect(_sndMaster);sSrc.start(t);sSrc.stop(t+sDur);softTone(1100,{attack:0.01,decay:0.06,peak:0.05});setTimeout(()=>{if(!('speechSynthesis' in window))return;const u=new SpeechSynthesisUtterance('Cargo status update, all bays secured');u.rate=1.0;u.pitch=0.75;u.volume=SMART.soundEnabled?Math.min(SMART.soundVolume/100*0.85,1):0;speechSynthesis.speak(u);},450);setTimeout(()=>{softNoise({attack:0.02,hold:0.05,decay:0.2,peak:0.06,filterFreq:2000,filterQ:0.5});softTone(1100,{start:0.02,attack:0.005,decay:0.05,peak:0.04});},2200);},
  ocean(){ if (_ambNodes) _sndStopAmb(); else _sndStartAmb(); }
};

function _sndStartAmb(){
  if (_ambNodes) return;
  const src = _sndCtx.createBufferSource(); src.buffer = _sndBrown(_sndCtx, 4); src.loop = true;
  const lp = _sndCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.6;
  const lfo = _sndCtx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = _sndCtx.createGain(); lfoG.gain.value = 190; lfo.connect(lfoG); lfoG.connect(lp.frequency);
  const g = _sndCtx.createGain(); g.gain.value = 0.0001;
  g.gain.setTargetAtTime(0.22, _sndCtx.currentTime, 0.8);
  src.connect(lp); lp.connect(g); g.connect(_sndMaster);
  src.start(); lfo.start();
  _ambNodes = { src, lfo, g };
}
function _sndStopAmb(){
  if (!_ambNodes) return;
  const n = _ambNodes; _ambNodes = null;
  n.g.gain.setTargetAtTime(0.0001, _sndCtx.currentTime, 0.4);
  setTimeout(() => { try { n.src.stop(); n.lfo.stop(); } catch(e){} }, 900);
}

function playSound(type){
  if(!canPlaySound(type)) return;
  try{_sndInit();if(soundFns[type])soundFns[type]();}catch(e){}
}
if('speechSynthesis' in window){speechSynthesis.getVoices();speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices();}

function _sndUpdateBadge(cat){
  const sounds=_sndCats[cat].sounds;
  const on=sounds.filter(s=>_sndState[s]).length;
  const badge=document.getElementById('sndBadge-'+cat);
  if(!badge)return;
  badge.textContent=on+'/'+sounds.length;
  badge.className='snd-badge'+(on===sounds.length?'':on===0?' none':' some');
}
function _sndSaveSettings(){
  try{
    localStorage.setItem('spicaTide_soundSettings',JSON.stringify({
      cats:{basic:_sndCats.basic.on,ambient:_sndCats.ambient.on,advanced:_sndCats.advanced.on},
      sounds:_sndState
    }));
  }catch(e){}
}
function _sndLoadSettings(){
  try{
    const d=JSON.parse(localStorage.getItem('spicaTide_soundSettings')||'null');
    if(!d)return;
    if(d.cats){['basic','ambient','advanced'].forEach(c=>{if(typeof d.cats[c]==='boolean')_sndCats[c].on=d.cats[c];});}
    if(d.sounds){Object.keys(_sndState).forEach(s=>{if(typeof d.sounds[s]==='boolean')_sndState[s]=d.sounds[s];});}
    /* Sync UI toggles */
    ['basic','ambient','advanced'].forEach(c=>{const t=document.getElementById('sndCatTgl-'+c);if(t)t.checked=_sndCats[c].on;});
    Object.keys(_sndState).forEach(s=>{const t=document.getElementById('sndTgl-'+s);if(t)t.checked=_sndState[s];});
  }catch(e){}
}

/* ══════════════════════════════════════════════════════════
   SYNC — CouchDB integration
══════════════════════════════════════════════════════════ */
let _syncPushTimer = null;
function _syncPushDebounced(){
  if(!isOperator()) return;            /* Viewer: never push to CouchDB */
  if(Sync.getSyncStatus() === 'disabled') return;
  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(() => {
    const envelope = _buildEnvelope();
    Sync.pushState(envelope.plan);
  }, 3000); // debounce 3s — don't push on every keystroke
}

/* ── Replication activity indicators ── */
let _syncArrowUpTimer = null;
let _syncArrowDnTimer = null;

function _syncShowActivity(dir, detail){
  const arrowUp = document.getElementById('syncArrowUp');
  const arrowDn = document.getElementById('syncArrowDn');
  const badge = document.getElementById('syncErrorBadge');

  if(dir === 'push'){
    if(arrowUp){
      if(detail === 'start'){ arrowUp.classList.add('active'); clearTimeout(_syncArrowUpTimer); }
      else { _syncArrowUpTimer = setTimeout(() => arrowUp.classList.remove('active'), 1500); }
    }
    if(detail === 'conflict') _syncLog('warn', 'Push conflict — remote has newer data');
    if(detail === 'error') _syncLog('error', 'Push failed');
    if(detail === 'auth_failed') _syncLog('error', 'Push auth failed');
  }
  if(dir === 'pull'){
    if(arrowDn){
      if(detail === 'start'){ arrowDn.classList.add('active'); clearTimeout(_syncArrowDnTimer); }
      else { _syncArrowDnTimer = setTimeout(() => arrowDn.classList.remove('active'), 1500); }
    }
    if(detail === 'error') _syncLog('error', 'Pull failed');
  }

  // Update error badge
  const errCount = Sync.getErrorCount();
  if(badge){
    if(errCount > 0){ badge.style.display = ''; badge.textContent = errCount > 9 ? '9+' : errCount; }
    else { badge.style.display = 'none'; }
  }
}

/* ── Conflict resolution handler ── */
function _syncHandleConflict(conflict){
  _syncLog('warn', 'Conflict detected! Remote timestamp: ' + new Date(conflict.remoteTimestamp).toLocaleString());

  // Show conflict bar at top of screen
  let bar = document.getElementById('syncConflictBar');
  if(bar) bar.remove();
  bar = document.createElement('div');
  bar.id = 'syncConflictBar';
  bar.className = 'sync-conflict-bar';
  bar.innerHTML = '<span>⚠ Sync conflict — another device changed the plan</span>' +
    '<button id="conflictKeepLocal">Keep Mine</button>' +
    '<button id="conflictUseRemote">Use Remote</button>';
  document.body.appendChild(bar);

  document.getElementById('conflictKeepLocal').addEventListener('click', async () => {
    bar.remove();
    _syncLog('info', 'Conflict resolved: keeping local state');
    const envelope = _buildEnvelope();
    await conflict.resolve(envelope.plan);
    showToast('Local changes pushed to cloud', 'ok');
  });
  document.getElementById('conflictUseRemote').addEventListener('click', () => {
    bar.remove();
    _syncLog('info', 'Conflict resolved: using remote state');
    _syncApplyRemote(conflict.remoteState);
  });

  // Auto-dismiss after 30s (default to keeping local)
  setTimeout(() => {
    if(document.getElementById('syncConflictBar')){
      document.getElementById('syncConflictBar').remove();
      _syncLog('info', 'Conflict auto-resolved: keeping local (timeout)');
      const envelope = _buildEnvelope();
      conflict.resolve(envelope.plan);
    }
  }, 30000);
}

function _syncUpdateUI(status){
  const dotBp = document.getElementById('syncDotBp');
  const textBp = document.getElementById('syncStatusBp');
  const dotSt = document.getElementById('syncDot');
  const descSt = document.getElementById('syncDesc');
  const secBp = document.getElementById('bpSyncSection');
  const labels = {
    synced:'Synced', syncing:'Syncing...', offline:'Offline',
    error:'Error', disabled:'Sync', auth_failed:'Auth Failed'
  };
  const colors = {
    synced:'#3ea36a', syncing:'#c89a38', offline:'#888',
    error:'#c0392b', disabled:'#888', auth_failed:'#c0392b'
  };
  if(dotBp) dotBp.className = 'sync-dot-bp ' + status;
  if(textBp) textBp.textContent = labels[status] || status;
  if(secBp) secBp.style.display = status === 'disabled' ? 'none' : '';
  if(dotSt){
    dotSt.style.background = colors[status] || '#888';
    dotSt.style.animation = status==='syncing' ? 'syncPulse 1.2s infinite' : '';
  }
  if(descSt){
    const t = Sync.getLastSyncTime();
    const timeStr = t ? new Date(t).toLocaleTimeString() : '';
    const errCount = Sync.getErrorCount();
    const errSuffix = errCount > 0 ? ' · ' + errCount + ' error' + (errCount>1?'s':'') : '';
    if(status==='synced') descSt.textContent = 'Connected' + (timeStr ? ' · Last: ' + timeStr : '');
    else if(status==='syncing') descSt.textContent = 'Syncing...';
    else if(status==='offline') descSt.textContent = 'Offline — local only' + (timeStr ? ' · Last: ' + timeStr : '') + errSuffix;
    else if(status==='error') descSt.textContent = 'Sync error — will retry' + errSuffix;
    else if(status==='auth_failed') descSt.textContent = 'Authentication failed — check credentials';
    else if(status==='disabled') descSt.textContent = 'Not configured';
  }
  _syncUpdateConnectedTime();
}

function _syncApplyRemote(remoteState){
  if(!remoteState) return;
  if(remoteState.cargo) S.cargo = remoteState.cargo;
  if(remoteState.customLib) S.customLib = remoteState.customLib;
  if(remoteState.customLocs && Array.isArray(remoteState.customLocs)) S.customLocs = remoteState.customLocs;
  if(remoteState.activeLocs && remoteState.activeLocs.length) S.activeLocs = remoteState.activeLocs;
  if(remoteState.selLoc) S.selLoc = remoteState.selLoc;
  if(remoteState.voyage) document.getElementById('voyIn').value = remoteState.voyage;
  if(remoteState.date){ selDate = new Date(remoteState.date); if(isNaN(selDate)) selDate = new Date(); }
  if(remoteState.dynColors){ Object.keys(DYN_COLORS).forEach(k=>delete DYN_COLORS[k]); Object.assign(DYN_COLORS, remoteState.dynColors); }
  if(remoteState.cargoColors){ Object.keys(CARGO_COLORS).forEach(k=>delete CARGO_COLORS[k]); Object.assign(CARGO_COLORS, remoteState.cargoColors); }
  if(remoteState.voyRemarks) S.voyRemarks = remoteState.voyRemarks;
  initDynColors(); setDateDisplay();
  buildActiveLocStrip(); buildLocGrid(); buildCargoList(); buildDGList();
  renderAll(); updateStats(); updateDGSummary();
  showToast('Plan updated from another device', 'ok');
}

/* ── Sync config storage — password stored separately in encrypted store ── */
async function _syncSaveConfig(cfg){
  const publicCfg = { url:cfg.url, db:cfg.db, username:cfg.username, enabled:true };
  try {
    if(_isTauri()){
      const { load } = await import('@tauri-apps/plugin-store');
      const store = await load('sync-config.json');
      await store.set('syncConfig', publicCfg);
      await store.set('syncAuth', cfg.password || '');
      await store.save();
    } else {
      localStorage.setItem('spicaTide_syncConfig', JSON.stringify(publicCfg));
      localStorage.setItem('spicaTide_syncAuth', cfg.password || '');
    }
  } catch(e){ localStorage.setItem('spicaTide_syncConfig', JSON.stringify(publicCfg)); }
}

async function _syncLoadConfig(){
  try {
    let cfg = null, pwd = '';
    if(_isTauri()){
      const { load } = await import('@tauri-apps/plugin-store');
      const store = await load('sync-config.json');
      cfg = await store.get('syncConfig');
      pwd = await store.get('syncAuth') || '';
    } else {
      cfg = JSON.parse(localStorage.getItem('spicaTide_syncConfig') || 'null');
      pwd = localStorage.getItem('spicaTide_syncAuth') || '';
    }
    if(cfg && cfg.url) return { ...cfg, password: pwd };
    return null;
  } catch(e){ return null; }
}

async function _syncDeleteConfig(){
  try {
    if(_isTauri()){
      const { load } = await import('@tauri-apps/plugin-store');
      const store = await load('sync-config.json');
      await store.delete('syncConfig');
      await store.delete('syncAuth');
      await store.save();
    } else {
      localStorage.removeItem('spicaTide_syncConfig');
      localStorage.removeItem('spicaTide_syncAuth');
    }
  } catch(e){ localStorage.removeItem('spicaTide_syncConfig'); }
}

/* ── Sync log ring buffer (last 100 entries) ── */
const _syncLogs = [];
const SYNC_LOG_MAX = 100;
function _syncLog(type, msg){
  const entry = { time: new Date().toLocaleTimeString(), type, msg };
  _syncLogs.push(entry);
  if(_syncLogs.length > SYNC_LOG_MAX) _syncLogs.shift();
  // Update both log panels (config view + connected view)
  const logText = _syncLogs.map(l => l.time + ' [' + l.type + '] ' + l.msg).join('\n');
  const p1 = document.getElementById('syncLogContent');
  const p2 = document.getElementById('syncLogContent2');
  if(p1) p1.textContent = logText;
  if(p2) p2.textContent = logText;
}

/* ── Sync connected/edit view toggle ── */
function _syncShowConnected(cfg){
  const configPanel = document.getElementById('syncConfigPanel');
  const connView = document.getElementById('syncConnectedView');
  if(configPanel) configPanel.style.display = 'none';
  if(connView){
    connView.style.display = '';
    const dbEl = document.getElementById('syncInfoDb');
    const userEl = document.getElementById('syncInfoUser');
    const timeEl = document.getElementById('syncInfoTime');
    if(dbEl) dbEl.textContent = cfg.db || 'spica_tide';
    if(userEl) userEl.textContent = cfg.username || '—';
    _syncUpdateConnectedTime();
  }
}
function _syncShowEditForm(){
  const configPanel = document.getElementById('syncConfigPanel');
  const connView = document.getElementById('syncConnectedView');
  if(connView) connView.style.display = 'none';
  if(configPanel) configPanel.style.display = '';
}
function _syncUpdateConnectedTime(){
  const timeEl = document.getElementById('syncInfoTime');
  if(!timeEl) return;
  const t = Sync.getLastSyncTime();
  timeEl.textContent = t ? new Date(t).toLocaleTimeString() : 'not yet';
}

function _syncWireCallbacks(){
  Sync.onStatusChange(s => { _syncUpdateUI(s); _syncLog('status', s); });
  Sync.onRemoteUpdate(state => { _syncApplyRemote(state); _syncLog('pull', 'Remote state applied'); });
  Sync.onActivity((dir, detail) => { _syncShowActivity(dir, detail); _syncLog(dir, detail); });
  Sync.onConflict(_syncHandleConflict);
}

/* ── Shared action handlers (used in both config and connected views) ── */
function _syncDoBackup(){
  const envelope = _buildEnvelope();
  const json = JSON.stringify(envelope, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  a.download = 'spica-tide-backup-' + ts + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  _syncLog('info', 'Backup downloaded');
  showToast('Backup saved', 'ok');
}
function _syncDoRestore(){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.spica';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if(!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const plan = data.plan || data.state || data;
      if(plan.cargo){
        _syncApplyRemote(plan);
        _syncLog('info', 'Restored from backup: ' + file.name);
        showToast('Plan restored from backup', 'ok');
        if(Sync.getSyncStatus() !== 'disabled') _syncPushDebounced();
      } else {
        showToast('Invalid backup file', 'err');
        _syncLog('error', 'Invalid backup format');
      }
    } catch(e){
      showToast('Error reading backup: ' + e.message, 'err');
      _syncLog('error', 'Restore failed: ' + e.message);
    }
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}
async function _syncDoForcePull(){
  if(Sync.getSyncStatus() === 'disabled'){ showToast('Sync not enabled', 'err'); return; }
  _syncLog('info', 'Force pull requested');
  const remote = await Sync.pullState();
  if(remote){
    _syncApplyRemote(remote);
    _syncLog('pull', 'Force pull applied');
    showToast('Latest plan pulled from cloud', 'ok');
  } else {
    showToast('No remote data available', 'err');
    _syncLog('warn', 'Force pull: no data');
  }
}

function bindSyncSettings(){
  const toggle = document.getElementById('stSyncToggle');
  const configPanel = document.getElementById('syncConfigPanel');
  const connView = document.getElementById('syncConnectedView');
  const testBtn = document.getElementById('syncTestBtn');
  const saveBtn = document.getElementById('syncSaveBtn');
  const resultEl = document.getElementById('syncResult');
  if(!toggle) return;

  /* ── Load saved config and auto-connect ── */
  (async () => {
    try {
      const saved = await _syncLoadConfig();
      if (saved && saved.url) {
        /* Populate form fields (in case user clicks Edit) */
        document.getElementById('syncUrl').value = saved.url || '';
        document.getElementById('syncDb').value = saved.db || '';
        document.getElementById('syncUser').value = saved.username || '';
        document.getElementById('syncPass').value = saved.password || '';
        toggle.checked = true;

        /* Show connected summary, not form */
        _syncShowConnected(saved);

        _syncLog('info', 'Config loaded. Auto-connecting to ' + saved.url);
        Sync.setSyncConfig(saved);
        _syncWireCallbacks();
        Sync.startSync();
        _syncUpdateUI('offline');

        const remote = await Sync.pullState();
        if(remote) { _syncLog('pull', 'Initial pull ok'); }
        else { _syncLog('info', 'No remote data or offline'); }
      }
    } catch (e) { _syncLog('error', 'Config load failed: ' + e.message); }
  })();

  /* ── Toggle: on → show form (if no saved config) or connected view; off → disconnect ── */
  toggle.addEventListener('change', () => {
    if(toggle.checked){
      /* Check if already configured */
      const hasUrl = document.getElementById('syncUrl').value.trim();
      if(hasUrl && Sync.getSyncStatus() !== 'disabled'){
        /* Already configured — show connected view */
        _syncShowConnected({
          db: document.getElementById('syncDb').value,
          username: document.getElementById('syncUser').value
        });
      } else {
        _syncShowEditForm();
      }
    } else {
      if(configPanel) configPanel.style.display = 'none';
      if(connView) connView.style.display = 'none';
      Sync.stopSync();
      Sync.setSyncConfig(null);
      _syncDeleteConfig();
      _syncUpdateUI('disabled');
    }
  });
  /* Hide both views if toggle is off */
  if(!toggle.checked){
    if(configPanel) configPanel.style.display = 'none';
    if(connView) connView.style.display = 'none';
  }

  /* ── Test connection ── */
  if(testBtn) testBtn.addEventListener('click', async () => {
    const cfg = { url:document.getElementById('syncUrl').value.trim(), db:document.getElementById('syncDb').value.trim()||'spica_tide', username:document.getElementById('syncUser').value.trim(), password:document.getElementById('syncPass').value };
    Sync.setSyncConfig(cfg);
    resultEl.textContent = 'Testing...';
    resultEl.style.color = 'var(--txt3)';
    _syncLog('info', 'Testing connection...');
    const r = await Sync.testConnection();
    if(r.ok){
      resultEl.textContent = '\u2713 Connected — ' + r.dbName + ' (' + r.docCount + ' docs)';
      resultEl.style.color = '#3ea36a';
      _syncLog('info', 'Test OK: ' + r.dbName);
    } else {
      resultEl.textContent = '\u2717 ' + r.error;
      resultEl.style.color = '#c0392b';
      _syncLog('error', 'Test failed: ' + r.error);
    }
  });

  /* ── Save & Enable → persist, connect, switch to connected view ── */
  if(saveBtn) saveBtn.addEventListener('click', async () => {
    const cfg = { url:document.getElementById('syncUrl').value.trim(), db:document.getElementById('syncDb').value.trim()||'spica_tide', username:document.getElementById('syncUser').value.trim(), password:document.getElementById('syncPass').value };
    if(!cfg.url){ resultEl.textContent='URL required'; resultEl.style.color='#c0392b'; return; }
    await _syncSaveConfig(cfg);
    Sync.setSyncConfig(cfg);
    _syncWireCallbacks();

    const envelope = _buildEnvelope();
    const remote = await Sync.migrateIfNeeded(envelope.plan);
    if(remote) _syncApplyRemote(remote);

    Sync.startSync();
    _syncUpdateUI('synced');
    _syncLog('info', 'Sync enabled and started');
    showToast('Cloud sync enabled', 'ok');

    /* Switch to connected summary view */
    _syncShowConnected(cfg);
  });

  /* ── Edit Connection button (in connected view) → switch back to form ── */
  const editBtn = document.getElementById('syncEditBtn');
  if(editBtn) editBtn.addEventListener('click', _syncShowEditForm);

  /* ── Action buttons in connected view ── */
  const pull2 = document.getElementById('syncForcePull2');
  const backup2 = document.getElementById('syncBackupBtn2');
  const restore2 = document.getElementById('syncRestoreBtn2');
  if(pull2) pull2.addEventListener('click', _syncDoForcePull);
  if(backup2) backup2.addEventListener('click', _syncDoBackup);
  if(restore2) restore2.addEventListener('click', _syncDoRestore);

  /* ── Error badge → open log ── */
  const errBadge = document.getElementById('syncErrorBadge');
  if(errBadge) errBadge.addEventListener('click', () => {
    document.querySelectorAll('.sync-log-details').forEach(d => d.open = true);
  });
}

function init(){
  bindMenuBar();
  bindAboutModal();
  bindModeButton();
  _bindUpdateBanner();
  _scheduleUpdateCheck();
  bindContextMenu();
  bindSyncSettings();

  bindThemeToggle();   /* apply saved theme immediately, before any render */
  initResponsiveHeader();  /* apply body.hdr-compact / body.hdr-tight */
  bindSmartTools();        /* load and apply smart tool settings */
  bindLangSwitch();        /* restore and apply saved language */
  bindDGAutoCheck();       /* DG Auto-Segregation Check modal controls */
  applyNewBadges();        /* version-aware NEW badge visibility */
  setupCanvas();load();
  /* Voyage date is rolling today — today always wins over the persisted
     value on init, regardless of what was in the autosave envelope. See
     _rollDateToTodayIfNeeded() below for the recurring midnight check. */
  selDate = new Date();
  /* Initialise dynamic colour assignments for restored active locations */
  initDynColors();
  buildActiveLocStrip();buildLocGrid();buildCargoList();buildDGList();
  bindTabs();bindModal();bindInspector();bindCmdPalette();bindDGMultiPicker();bindCustomForm();bindLibPanel();
  bindLocsPanel();bindLocDrawer();bindLocDeleteDlg();bindDatePicker();
  setInterval(_rollDateToTodayIfNeeded, 5 * 60 * 1000);   /* rolling today — see fn doc */
  bindAscoUpload();
  bindSaveAs();
  bindClearDeck();
  bindNewDeckModal();
  bindVoyageRemarks();
  bindModalExtensions();
  bindManifestMatch();
  cpBind();
  bindKeyboardNav();
  bindRulerTool();        /* Phase 23 — Measure ruler */
  wxScene.init();         /* Phase W5/W6 — A/B sky + canvas precip orchestrator */
  _wxBind();              /* Phase W1 — Weather widget + atmosphere shell */
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
      /* Phase 29 — Esc also exits Focus Deck. Takes priority over other
         Esc behaviours since it's the most-recently-entered mode. */
      if(_focusDeckActive){ _focusDeckExit(); return; }
      /* Hybrid stamp: when the edit modal is open it owns Escape (closes via
         bindEscapeDismiss) — don't disarm here, so a placed stamp stays armed
         for the next placement. Escape with no modal open disarms as before. */
      if(!document.getElementById('ov').classList.contains('open')) cancelPending();
      closeAscoModal();
      if(typeof kbDeselect==='function') kbDeselect();
      /* Clear location filter if active */
      if(LOC_FILTER) clearLocFilter();
    }
  });
  renderAll();updateStats();updateDGSummary();initZoom();
  /* Seed the undo baseline once the initial state is in memory so the
     very first user action produces a clean pre-state history entry. */
  seedHistoryBaseline();

  /* ── Session recovery toast ── */
  if(S.cargo.length > 0){
    setTimeout(() => showToast('Previous session restored', 'ok'), 400);
  }

  /* Phase 29 — daily identity reveal. Once per calendar day, on first
     load of the session, the SPICA · TIDE wordmark breathes in softly.
     After that the class self-removes so later loads are silent. */
  _maybeTriggerDailyReveal();

  /* ── What's New modal (after update) ── */
  setTimeout(() => _checkWhatsNew(), 800);

  /* ── File association: open file passed as CLI argument ── */
  if(window.__TAURI__){
    setTimeout(async () => {
      try {
        const { getCurrent } = await import('@tauri-apps/api/window');
        const win = getCurrent();
        /* Listen for file-drop events (Tauri v2 deep link) */
        win.onFileDropEvent && win.onFileDropEvent(async ev => {
          if(ev.payload && ev.payload.paths && ev.payload.paths.length){
            const fp = ev.payload.paths[0];
            if(fp.endsWith('.json') || fp.endsWith('.spica')){
              try {
                const contents = await invoke('read_file', { path: fp });
                _applyProjectData(contents, fp.split(/[/\\]/).pop());
                _currentFilePath = fp;
                _updateWindowTitle(fp);
              } catch(e){}
            }
          }
        });
      } catch(e){}
    }, 500);
  }

  /* ── Periodic autosave (every 15 seconds, respects toggle).
     Persistence-only: autosave writes the current plan to localStorage
     but MUST NOT push onto the undo stack (that would inflate history
     with idle no-op entries and push genuine user actions out of the
     50-step window). */
  setInterval(() => {
    if(!_autosaveEnabled) return;
    /* Time the savePlan call. If it exceeds 150ms (e.g. future async
       cloud sync), enter the 'saving' state briefly before the success
       transition. Sync localStorage saves are typically <5ms, so the
       saving state is reserved for slow operations and skipped here. */
    const _t0 = (performance && performance.now) ? performance.now() : Date.now();
    savePlan();
    const _elapsed = ((performance && performance.now) ? performance.now() : Date.now()) - _t0;
    if(_elapsed > 150 && typeof _setSaveState === 'function'){
      _setSaveState('saving');
    }
    /* _updateSaveIndicator routes through _setSaveState; redundant when
       _flashAutosave is about to fire but harmless and keeps the
       _dirty-driven indicator state consistent in case _flashAutosave
       early-returns (autosave disabled mid-cycle, etc.). */
    if(typeof _updateSaveIndicator === 'function') _updateSaveIndicator();
    _flashAutosave();
  }, 15000);

  /* ── Autosave toggle + save state indicator ── */
  bindAutosaveToggle();
  _updateSaveIndicator();

  /* ── Close confirmation — Tauri native dialog + browser fallback ── */
  if(window.__TAURI__){
    /* Tauri: intercept close request, show native confirm dialog */
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        await win.onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            const dlg = await import('@tauri-apps/plugin-dialog');
            const msg = S.cargo.length > 0
              ? 'You have ' + S.cargo.length + ' cargo items on deck. Unsaved changes will be lost.'
              : 'Are you sure you want to close the application?';
            const confirmed = await dlg.ask(msg, {
              title: 'Confirm Exit',
              kind: 'warning',
              okLabel: 'Exit',
              cancelLabel: 'Cancel'
            });
            if(confirmed) await win.destroy();
          } catch(e){
            /* If dialog fails, allow close */
            await win.destroy();
          }
        });
      } catch(e){ /* fallback to beforeunload if Tauri API unavailable */ }
    })();
  }
  /* Browser fallback */
  window.addEventListener('beforeunload', e => {
    if(_dirty){
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ── Hide splash screen ── */
  const splash = document.getElementById('splash');
  if(splash){
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 400);
  }
}

/* ── Save-state animation system — 4-state machine ──────────────────
   States: saved | unsaved | saving | autosaved → revert
   - saved: green dot, no animation
   - unsaved: amber dot, breathing opacity loop
   - saving: grey dot + spinner ring (only entered if savePlan elapsed
     >150ms — current sync localStorage skips this state, future async
     cloud sync would hit it)
   - autosaved: green pop overshoot + checkmark draw, holds 2500ms, then
     auto-reverts via _updateSaveIndicator() to whatever _dirty reflects
     (Q1 β: visual-only revert; autosave does NOT clear _dirty since
     local autosave ≠ user manual commit intent)

   The CSS at app.css:~8690 owns all visual transitions. JS just toggles
   the .save-dot--{state} class and cross-fades the label text between
   two layered spans. Timer cleanup on every transition prevents stale
   reverts when user mutates during 'autosaved' hold. */
const _LABELS = {
  saved:     'Saved',
  unsaved:   'Unsaved',
  saving:    'Saving…',
  autosaved: 'Autosaved',
};
const _saveState = {
  current:   'saved',
  holdTimer: null,
};

function _setSaveState(next){
  /* Clear any pending revert timer so a stale 'autosaved → saved' fire
     can't override a fresher 'unsaved' set by a user mutation. */
  if(_saveState.holdTimer){
    clearTimeout(_saveState.holdTimer);
    _saveState.holdTimer = null;
  }

  _saveState.current = next;
  const dot  = document.getElementById('saveDotBottom');
  const text = document.getElementById('saveStateText');
  if(!dot || !text) return;

  /* data-state attribute available for any future selector grammar.
     class form .save-dot--{state} drives the CSS state machine. */
  dot.dataset.state = next;
  dot.className = 'save-dot save-dot--' + next;

  _crossFadeLabel(text, _LABELS[next] || 'Saved');

  /* Autosaved holds for 2500ms then auto-reverts. Revert target is
     determined by current _dirty state (Q1 β): saved if user has
     manually committed, unsaved if changes are still pending. */
  if(next === 'autosaved'){
    _saveState.holdTimer = setTimeout(() => {
      _saveState.holdTimer = null;
      _setSaveState(_dirty ? 'unsaved' : 'saved');
    }, 2500);
  }
}

function _crossFadeLabel(textEl, newText){
  const cur = textEl.querySelector('.bp-save-text__layer--current');
  const out = textEl.querySelector('.bp-save-text__layer--out');
  if(!cur || !out){
    /* Defensive fallback — if dual-span structure is missing
       (e.g. legacy DOM during incremental upgrade), set textContent
       directly. State machine still works, just no fade. */
    textEl.textContent = newText;
    return;
  }
  if(cur.textContent === newText) return;   /* no-op on same-state re-entry */

  /* Move outgoing text into the absolutely-positioned --out layer
     (which fades from opacity:1 → 0 on style change), put incoming
     text into --current (which fades from opacity:0 → 1). rAF lets
     layout commit before the transition fires so it animates
     instead of jumping straight to the final values. */
  out.textContent = cur.textContent;
  out.style.opacity = '1';
  cur.textContent = newText;
  cur.style.opacity = '0';
  requestAnimationFrame(() => {
    out.style.opacity = '0';
    cur.style.opacity = '1';
  });
}

/* Wrappers — keep existing call-site grammar working. */
function _updateSaveIndicator(){
  _setSaveState(_dirty ? 'unsaved' : 'saved');
}

function _flashAutosave(){
  if(!_autosaveEnabled) return;
  /* Bottom-left toast retired in favour of the single bottom-panel
     indicator. The 2500ms hold + auto-revert is owned by _setSaveState. */
  _setSaveState('autosaved');
}

function _markSaved(){
  _dirty = false;
  _setSaveState('saved');
  playSound('save');
  /* Surface the timestamp in Smart Tools System section. */
  if(typeof window.__spicaMarkSaveOK === 'function') window.__spicaMarkSaveOK();
}

/* ── Manual Save (Cmd+S) — overwrite or dialog ────────── */
function saveProject(){
  if(_isTauri() && _currentFilePath){
    /* Overwrite current file silently */
    const envelope = _buildEnvelope();
    const json = JSON.stringify(envelope, null, 2);
    invoke('write_file', { path: _currentFilePath, contents: json })
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
      await invoke('write_file', { path: targetPath, contents: json });
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
let _lastSaveAt = null;        /* epoch ms of last successful save */
let _systemStatus = 'ok';      /* 'ok' | 'warn' | 'error' */

function _refreshSmartToolsSystem(){
  /* Sync the Smart Tools System section with current state. Safe no-op
     if the elements don't exist (panel not yet rendered). */
  const stBtn = document.getElementById('autosaveToggleST');
  const stLbl = document.getElementById('autosaveToggleSTLbl');
  if(stBtn){
    stBtn.classList.toggle('on', _autosaveEnabled);
    stBtn.setAttribute('aria-pressed', _autosaveEnabled ? 'true' : 'false');
    stBtn.title = _autosaveEnabled ? 'Autosave is ON — click to disable' : 'Autosave is OFF — click to enable';
  }
  if(stLbl) stLbl.textContent = _autosaveEnabled ? 'ON' : 'OFF';

  const lastEl = document.getElementById('stLastSave');
  if(lastEl){
    if(!_lastSaveAt){
      lastEl.textContent = 'Not yet saved';
    } else {
      const d = new Date(_lastSaveAt);
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      const ss = String(d.getSeconds()).padStart(2,'0');
      const today = new Date(); today.setHours(0,0,0,0);
      const sameDay = d >= today;
      lastEl.textContent = sameDay
        ? `${hh}:${mm}:${ss}`
        : `${d.toISOString().slice(0,10)} ${hh}:${mm}`;
    }
  }
  const statusEl = document.getElementById('stSystemStatus');
  if(statusEl){
    statusEl.classList.remove('ok','warn','error');
    statusEl.classList.add(_systemStatus);
    statusEl.textContent = _systemStatus === 'ok' ? 'OK'
                         : _systemStatus === 'warn' ? 'Retrying…' : 'Error';
  }
}

/* Public — call after a successful save to update the System panel
   and clear any error state. Safe to call from any save path.        */
window.__spicaMarkSaveOK = function(){
  _lastSaveAt = Date.now();
  _systemStatus = 'ok';
  _refreshSmartToolsSystem();
};
/* Public — set warn/error state (drives the Status row). */
window.__spicaMarkSaveStatus = function(level){
  _systemStatus = (level === 'warn' || level === 'error') ? level : 'ok';
  _refreshSmartToolsSystem();
};

function bindAutosaveToggle(){
  /* Original bottom toggle (DOM hidden by CSS, but JS still binds so
     external triggers / tests / shortcuts continue to work). */
  const bottomBtn = document.getElementById('autosaveToggleBottom') || document.getElementById('autosaveToggle');
  /* New Smart Tools toggle — primary user-visible control. */
  const stBtn = document.getElementById('autosaveToggleST');

  /* Restore from localStorage */
  const stored = localStorage.getItem('spicaTide_autosave');
  if(stored === 'off'){
    _autosaveEnabled = false;
    if(bottomBtn){
      bottomBtn.classList.remove('on', 'is-on');
      bottomBtn.classList.add('is-off');
      bottomBtn.setAttribute('aria-pressed', 'false');
      bottomBtn.setAttribute('aria-label', 'Manual save mode, click to enable autosave');
      bottomBtn.title = 'Autosave Off';
      const lbl = bottomBtn.querySelector('.bp-autosave-lbl');
      if(lbl) lbl.textContent = 'Manual';
    }
  } else {
    if(bottomBtn) bottomBtn.classList.add('is-on');
  }

  function handleToggle(){
    _autosaveEnabled = !_autosaveEnabled;
    if(bottomBtn){
      bottomBtn.classList.toggle('is-on', _autosaveEnabled);
      bottomBtn.classList.toggle('is-off', !_autosaveEnabled);
      bottomBtn.setAttribute('aria-pressed', _autosaveEnabled ? 'true' : 'false');
      bottomBtn.setAttribute('aria-label', _autosaveEnabled
        ? 'Autosave on'
        : 'Manual save mode, click to enable autosave');
      bottomBtn.title = _autosaveEnabled ? 'Autosave On' : 'Autosave Off';
      bottomBtn.classList.add('is-flipping');
      const lbl = bottomBtn.querySelector('.bp-autosave-lbl');
      if(lbl) setTimeout(() => { lbl.textContent = _autosaveEnabled ? 'Autosave' : 'Manual'; }, 210);
      bottomBtn.addEventListener('animationend', () => {
        bottomBtn.classList.remove('is-flipping');
      }, { once: true });
    }
    localStorage.setItem('spicaTide_autosave', _autosaveEnabled ? 'on' : 'off');
    _refreshSmartToolsSystem();
  }

  if(bottomBtn) bottomBtn.addEventListener('click', handleToggle);
  if(stBtn)     stBtn.addEventListener('click', handleToggle);

  /* Initial sync of the Smart Tools panel */
  _refreshSmartToolsSystem();
}

/* ════════════════════════════════════════════════════════════
   VESSEL BACKGROUND ALIGNMENT MODE
   Interactive manual alignment for .vessel-bg. Toggle with
   Ctrl/Cmd+Shift+V. Drag to move, wheel to zoom, arrows to
   nudge (Shift=10px, Alt=0.25px). Lock saves to localStorage.
════════════════════════════════════════════════════════════ */
(function(){
  const LS_KEY  = 'spicaTide_vesselAlign';
  /* Defaults preserve the source PNG aspect ratio (1483×403) at the
     tuned width of 172.5% of .deck-outer (1653 px wide) →
       display_w = 2852 px, display_h = 2852 × 403/1483 = 775 px
       h % of .deck-outer height (409) = 189.49 */
  const DEFAULTS = { w: 172.50, h: 189.49, x: 298, y: 25 };
  const W_MIN = 20, W_MAX = 500, H_MIN = 20, H_MAX = 500;

  let mode = false;
  let state = { ...DEFAULTS };
  let preEditState = null;       /* snapshot for Cancel */

  function loadSaved(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return;
      const v = JSON.parse(raw);
      /* Migrate legacy {scale,x,y} → {w,h,x,y} preserving aspect */
      if(typeof v.scale === 'number' && !('w' in v)){
        state.w = v.scale;
        const outer = document.querySelector('.deck-outer');
        const ow = outer ? outer.getBoundingClientRect().width  : 1653;
        const oh = outer ? outer.getBoundingClientRect().height : 409;
        const displayW = (v.scale / 100) * ow;
        const displayH = displayW * 403 / 1483;
        state.h = (displayH / oh) * 100;
      } else {
        if(typeof v.w === 'number') state.w = v.w;
        if(typeof v.h === 'number') state.h = v.h;
      }
      if(typeof v.x === 'number') state.x = v.x;
      if(typeof v.y === 'number') state.y = v.y;
    }catch(e){ /* ignore */ }
  }
  function apply(){
    const img = document.querySelector('.vessel-bg');
    if(!img) return;
    img.style.setProperty('--vessel-w',       state.w.toFixed(3) + '%');
    img.style.setProperty('--vessel-h',       state.h.toFixed(3) + '%');
    img.style.setProperty('--vessel-shift-x', state.x.toFixed(2) + 'px');
    img.style.setProperty('--vessel-shift-y', state.y.toFixed(2) + 'px');
    if(mode) positionHandles();
  }
  function readouts(){
    const w = document.getElementById('vapW');
    const h = document.getElementById('vapH');
    const x = document.getElementById('vapX');
    const y = document.getElementById('vapY');
    if(w) w.textContent = state.w.toFixed(2);
    if(h) h.textContent = state.h.toFixed(2);
    if(x) x.textContent = state.x.toFixed(1);
    if(y) y.textContent = state.y.toFixed(1);
  }
  function toggle(on){
    const wasMode = mode;
    mode = (typeof on === 'boolean') ? on : !mode;
    if(mode && !wasMode) preEditState = { ...state };
    if(!mode) preEditState = null;
    document.body.classList.toggle('vessel-align-mode', mode);
    const panel = document.getElementById('vesselAlignPanel');
    if(panel){ panel.hidden = !mode; panel.setAttribute('aria-hidden', mode ? 'false' : 'true'); }
    const handles = document.getElementById('vesselAlignHandles');
    if(handles){ handles.hidden = !mode; handles.setAttribute('aria-hidden', mode ? 'false' : 'true'); }
    if(mode){ readouts(); positionHandles(); }
  }
  function lock(){
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    preEditState = null;
    toggle(false);
    console.log('[vessel-align] LOCKED:', state);
    if(typeof showToast === 'function') showToast('Vessel alignment locked', 'ok');
  }
  function cancel(){
    if(preEditState){
      state = { ...preEditState };
      apply();
    }
    toggle(false);
  }
  function reset(){
    state = { ...DEFAULTS };
    apply(); readouts();
  }

  /* ── Position the handle overlay to track .vessel-bg's screen rect ── */
  function positionHandles(){
    const handles = document.getElementById('vesselAlignHandles');
    const img = document.querySelector('.vessel-bg');
    if(!handles || !img) return;
    const r = img.getBoundingClientRect();
    handles.style.left   = r.left   + 'px';
    handles.style.top    = r.top    + 'px';
    handles.style.width  = r.width  + 'px';
    handles.style.height = r.height + 'px';
  }

  /* Drag image body to translate */
  function initDrag(){
    const img = document.querySelector('.vessel-bg');
    if(!img) return;
    let dragging = false, sx = 0, sy = 0, bx = 0, by = 0, factor = 1;
    img.addEventListener('mousedown', (e) => {
      if(!mode) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      bx = state.x;   by = state.y;
      factor = (e.altKey || e.ctrlKey) ? 0.25 : 1;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if(!dragging) return;
      state.x = bx + (e.clientX - sx) * factor;
      state.y = by + (e.clientY - sy) * factor;
      apply(); readouts();
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  /* ── Resize handles: non-uniform, anchored to opposite side/corner.
       Side middles  = one-axis resize (W or H only).
       Corners       = free resize (Shift = aspect-lock).                 */
  function initHandles(){
    const wrap = document.getElementById('vesselAlignHandles');
    if(!wrap) return;
    wrap.querySelectorAll('.vah-h').forEach(h => {
      h.addEventListener('mousedown', (e) => {
        if(!mode) return;
        e.preventDefault(); e.stopPropagation();
        const dir = h.dataset.vah;
        const img = document.querySelector('.vessel-bg');
        const outer = document.querySelector('.deck-outer');
        if(!img || !outer) return;
        const imgRect = img.getBoundingClientRect();
        const outerRect = outer.getBoundingClientRect();
        const origW = imgRect.width, origH = imgRect.height;

        /* Anchor = opposite side/corner of the handle (fixed on screen) */
        let anchorX, anchorY;
        if(dir.includes('w'))      anchorX = imgRect.right;
        else if(dir.includes('e')) anchorX = imgRect.left;
        else                        anchorX = imgRect.left + imgRect.width / 2;
        if(dir.includes('n'))      anchorY = imgRect.bottom;
        else if(dir.includes('s')) anchorY = imgRect.top;
        else                        anchorY = imgRect.top + imgRect.height / 2;

        function onMove(ev){
          let newW = origW, newH = origH;
          /* Width changes only when handle has an east/west component */
          if(dir.includes('e') || dir.includes('w')){
            newW = Math.max(20, Math.abs(ev.clientX - anchorX));
          }
          /* Height changes only when handle has a north/south component */
          if(dir.includes('n') || dir.includes('s')){
            newH = Math.max(20, Math.abs(ev.clientY - anchorY));
          }
          /* Shift + corner = aspect-lock (driven by the larger ratio) */
          const isCorner = (dir.length === 2);
          if(ev.shiftKey && isCorner){
            const wR = newW / origW, hR = newH / origH;
            const s  = Math.max(wR, hR);
            newW = origW * s;
            newH = origH * s;
          }
          /* Image center so anchor stays fixed on screen */
          let cx, cy;
          if(dir.includes('w'))      cx = anchorX - newW / 2;
          else if(dir.includes('e')) cx = anchorX + newW / 2;
          else                        cx = anchorX;
          if(dir.includes('n'))      cy = anchorY - newH / 2;
          else if(dir.includes('s')) cy = anchorY + newH / 2;
          else                        cy = anchorY;

          const outerCx = outerRect.left + outerRect.width / 2;
          const outerCy = outerRect.top  + outerRect.height / 2;

          state.w = Math.max(W_MIN, Math.min(W_MAX, (newW / outerRect.width)  * 100));
          state.h = Math.max(H_MIN, Math.min(H_MAX, (newH / outerRect.height) * 100));
          state.x = cx - outerCx;
          state.y = cy - outerCy;
          apply(); readouts();
        }
        function onUp(){
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup',   onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
      });
    });
  }

  /* Mouse wheel = scale BOTH dimensions by the same percent (aspect kept) */
  function initWheel(){
    const img = document.querySelector('.vessel-bg');
    if(!img) return;
    img.addEventListener('wheel', (e) => {
      if(!mode) return;
      e.preventDefault();
      const pct = (e.altKey || e.ctrlKey) ? 0.2 : 1.0;
      const factor = e.deltaY < 0 ? (1 + pct/100) : (1 - pct/100);
      state.w = Math.max(W_MIN, Math.min(W_MAX, state.w * factor));
      state.h = Math.max(H_MIN, Math.min(H_MAX, state.h * factor));
      apply(); readouts();
    }, { passive: false });
  }

  /* Keyboard:
       Arrows         → translate 1 px  (Shift = 10 px)
       Alt+Arrows     → resize W/H (Alt+←/→ = width, Alt+↑/↓ = height)
                        default 0.1 %, Shift = 1 %
       +/-            → scale both (Shift = larger)
       Esc            → cancel                                            */
  function onKey(e){
    const isToggle = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'V' || e.key === 'v');
    if(isToggle){ e.preventDefault(); toggle(); return; }
    if(!mode) return;
    const t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    /* Alt+Arrow = resize (width or height) */
    if(e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
                    e.key === 'ArrowUp'   || e.key === 'ArrowDown')){
      const step = e.shiftKey ? 1.0 : 0.1;
      if(e.key === 'ArrowLeft')  state.w = Math.max(W_MIN, state.w - step);
      if(e.key === 'ArrowRight') state.w = Math.min(W_MAX, state.w + step);
      if(e.key === 'ArrowUp')    state.h = Math.max(H_MIN, state.h - step);
      if(e.key === 'ArrowDown')  state.h = Math.min(H_MAX, state.h + step);
      e.preventDefault(); apply(); readouts();
      return;
    }

    const nudge = e.shiftKey ? 10 : 1;
    const zoomPct = e.shiftKey ? 2.0 : 0.5;
    let handled = true;
    switch(e.key){
      case 'ArrowLeft':  state.x -= nudge; break;
      case 'ArrowRight': state.x += nudge; break;
      case 'ArrowUp':    state.y -= nudge; break;
      case 'ArrowDown':  state.y += nudge; break;
      case '+': case '=':
        state.w = Math.min(W_MAX, state.w * (1 + zoomPct/100));
        state.h = Math.min(H_MAX, state.h * (1 + zoomPct/100));
        break;
      case '-': case '_':
        state.w = Math.max(W_MIN, state.w * (1 - zoomPct/100));
        state.h = Math.max(H_MIN, state.h * (1 - zoomPct/100));
        break;
      case 'Escape': cancel(); break;
      default: handled = false;
    }
    if(handled){ e.preventDefault(); apply(); readouts(); }
  }

  /* Panel button actions */
  function initButtons(){
    const panel = document.getElementById('vesselAlignPanel');
    if(!panel) return;
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-vap-action]');
      if(!btn) return;
      const act = btn.dataset.vapAction;
      if(act === 'zoom-in'){
        state.w = Math.min(W_MAX, state.w * 1.005);
        state.h = Math.min(H_MAX, state.h * 1.005);
        apply(); readouts();
      }
      if(act === 'zoom-out'){
        state.w = Math.max(W_MIN, state.w * 0.995);
        state.h = Math.max(H_MIN, state.h * 0.995);
        apply(); readouts();
      }
      if(act === 'reset')    reset();
      if(act === 'lock')     lock();
      if(act === 'cancel' || act === 'close') cancel();
    });
  }

  /* Keep handles aligned if the window resizes or the deck area scrolls */
  function initResizeObserver(){
    window.addEventListener('resize', () => { if(mode) positionHandles(); });
    window.addEventListener('scroll', () => { if(mode) positionHandles(); }, true);
  }

  /* Init — runs after init() to ensure .vessel-bg exists in DOM */
  function start(){
    loadSaved();
    apply();
    initDrag();
    initWheel();
    initHandles();
    initButtons();
    initResizeObserver();
    window.addEventListener('keydown', onKey, true);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* Expose for console debugging */
  window.__vesselAlign = { toggle, reset, lock, cancel, get state(){ return { ...state }; } };
})();


init();
