/* ════════════════════════════════════════════════════════════
   MOTION SYSTEM — v3.25
   One place for how SPICA TIDE moves.

   • Mode: Full / Calm / Off (Smart Tools → Animations). Calm keeps
     only short fades — for the night watch; Off removes motion.
     First run follows the OS "reduce motion" setting (→ Calm).
   • Windows launch FROM the control that opened them and return INTO
     it when closed (iOS-style), instead of popping in and vanishing.
     Works for every overlay that is shown with the `.open` class —
     no change to the code that opens / closes them: a MutationObserver
     sees the class change before the next paint and plays the motion.
   • Popovers / menus get an exit (they used to disappear instantly).
   • Library and Smart Tools fly out of / back into their header button
     when the person opens / closes them with it.
   • Theme switch: the new theme spreads in a circle from the button.
   • Press feedback on buttons, smooth section collapse, cascade when
     several cargo blocks appear at once.
   Only transform / opacity are animated; everything can be interrupted
   and reversed; nothing waits for an animation before acting.
════════════════════════════════════════════════════════════ */

const LS_KEY = 'spicaTide_motion';
const MODES = ['full', 'calm', 'off'];
let MODE = 'full';
const root = document.documentElement;
const now = () => performance.now();

/* ── Tokens ─────────────────────────────────────────────────── */
export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';        /* enter: fast start, long settle */
export const EASE_IN  = 'cubic-bezier(.4,0,1,1)';          /* exit: accelerate away */
export const EASE_MOVE = 'cubic-bezier(.4,0,.2,1)';        /* reposition */
/* Bounded spring (ζ ≈ 0.78, < 2 % overshoot) sampled into linear() */
export const SPRING = (() => {
  const z = 0.78, w = 2 * Math.PI * 1.55, wd = w * Math.sqrt(1 - z * z), pts = [];
  for(let i = 0; i <= 32; i++){
    const t = i / 32;
    const x = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
    pts.push(+(i === 32 ? 1 : x).toFixed(4));
  }
  try{ return CSS.supports('transition-timing-function', `linear(${pts.join(',')})`) ? `linear(${pts.join(',')})` : EASE_OUT; }catch(e){ return EASE_OUT; }
})();
const D = { press: 80, fast: 120, ui: 180, panel: 260, hero: 320 };
const dur = ms => MODE === 'calm' ? Math.min(ms, 140) : ms;

/* ── Running motion that must settle when the mode changes ───────
   Every temporary state (pinned display, inert, transition:none …) is
   registered with the function that puts it back; switching the mode
   (or a newer motion on the same element) runs it at once. */
const SETTLE = new Set();
function track(fn){ SETTLE.add(fn); return () => { if(SETTLE.delete(fn)) fn(); }; }
function settleAll(){ [...SETTLE].forEach(fn => { SETTLE.delete(fn); try{ fn(); }catch(e){} }); }
/* inert while leaving: a closed window must not take Tab / clicks */
function setInert(el, on){
  if(on){ if(el._moInert === undefined) el._moInert = el.inert; el.inert = true; }
  else if(el._moInert !== undefined){ el.inert = el._moInert; el._moInert = undefined; }
}

/* ── Mode ───────────────────────────────────────────────────── */
export function motionMode(){ return MODE; }
export function motionFull(){ return MODE === 'full'; }
export function setMotionMode(m, persist = true){
  const next = MODES.includes(m) ? m : 'full';
  if(next !== MODE) settleAll();
  MODE = next;
  root.setAttribute('data-motion', MODE);
  if(persist){ try{ localStorage.setItem(LS_KEY, MODE); }catch(e){} }
  document.querySelectorAll('#stMotionSeg button').forEach(b => {
    const on = b.dataset.m === MODE;
    b.classList.toggle('sel', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}
function initialMode(){
  let m = null;
  try{ m = localStorage.getItem(LS_KEY); }catch(e){}
  if(MODES.includes(m)) return m;
  try{ if(matchMedia('(prefers-reduced-motion: reduce)').matches) return 'calm'; }catch(e){}
  return 'full';
}

/* ── Where did the action come from? ────────────────────────────
   The last control the person pressed (or activated with the keyboard)
   is remembered for a moment, so the window it opens can grow out of it.
   A command inside a dropdown menu counts as its menu title (the item
   itself disappears with the menu). */
const ORIGIN_SEL = 'button, [role="button"], .menu-action, .ctx-item, .saveas-item, .loc-card, .info-block, .gp, a, .cp-qi, .cp-lc, [data-action]';
let ORIGIN = null;          /* { el, rect, at } */
let LAST_KEY = { key: '', at: 0 };
function originTarget(el){
  const mi = el.closest('.menu-item');
  if(mi && el.closest('.menu-dropdown')) return mi.querySelector('.menu-label') || mi;
  return el;
}
function remember(el){
  if(!el || el === document.body) return;
  const t = originTarget(el);
  const r = t.getBoundingClientRect();
  if(r.width < 2 || r.height < 2) return;
  ORIGIN = { el: t, rect: r, at: now() };
}
function takeOrigin(maxAge = 1500){
  if(!ORIGIN || now() - ORIGIN.at > maxAge) return null;
  const o = ORIGIN; ORIGIN = null; return o;
}
function liveRect(o){
  if(!o) return null;
  if(o.el && o.el.isConnected){
    const r = o.el.getBoundingClientRect();
    if(r.width >= 2 && r.height >= 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth){
      const cs = getComputedStyle(o.el);
      if(cs.visibility !== 'hidden' && cs.display !== 'none') return r;
    }
  }
  return null;
}

/* ── Windows: launch from the origin, return into it ───────────── */
const OVERLAYS = ['.about-overlay', '.admin-modal-ov', '.asco-ov', '.clr-deck-ov', '.cmdp-overlay', '.dg-check-ov',
  '.kb-cheat-ov', '.loc-del-ov', '.match-info-ov', '.mode-overlay', '.rh-overlay', '.rmk-ov', '.wn-overlay',
  '.fwx-ov', '.pm-ov', '.new-deck-ov', '#ov'];
const OV_SEL = OVERLAYS.join(',');

function dialogOf(ov){
  return [...ov.children].find(c => !/backdrop/.test(c.className) && getComputedStyle(c).position !== 'absolute') || null;
}
function geometry(from, to){
  /* translate + uniform scale that puts `to` (dialog) over `from` (origin) */
  const s = Math.max(0.06, Math.min(0.6, Math.max(from.width / to.width, from.height / to.height)));
  return { dx: (from.left + from.width / 2) - (to.left + to.width / 2), dy: (from.top + from.height / 2) - (to.top + to.height / 2), s };
}
function stop(list){ (list || []).forEach(a => { try{ a.cancel(); }catch(e){} }); }

function ovEnter(ov){
  const st = ov._mo;
  if(st.settle){ const f = st.settle; st.settle = null; f(); }      /* a leaving copy is put back first */
  stop(st.anims); st.anims = [];
  /* windows driven by the spring module (cargo edit, new deck) animate themselves */
  if(ov.style.display) { st.origin = null; return; }
  st.origin = takeOrigin();
  if(MODE === 'off') return;
  const dlg = dialogOf(ov);
  st.anims.push(ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur(MODE === 'calm' ? D.fast : 200), easing: 'linear' }));
  if(!dlg) return;
  if(MODE === 'calm'){
    st.anims.push(dlg.animate([{ opacity: 0, scale: '.985' }, { opacity: 1, scale: '1' }], { duration: D.fast, easing: EASE_OUT }));
    return;
  }
  const to = dlg.getBoundingClientRect();
  const from = st.origin ? (liveRect(st.origin) || st.origin.rect) : null;
  if(from && to.width > 0){
    const g = geometry(from, to);
    st.anims.push(dlg.animate([
      { translate: `${g.dx}px ${g.dy}px`, scale: String(g.s), opacity: 0 },
      { opacity: 1, offset: 0.3 },
      { translate: '0px 0px', scale: '1', opacity: 1 },
    ], { duration: D.hero, easing: EASE_OUT }));
  } else {
    st.anims.push(dlg.animate([{ translate: '0 12px', scale: '.965', opacity: 0 }, { translate: '0 0', scale: '1', opacity: 1 }],
      { duration: D.panel, easing: EASE_OUT }));
  }
}

function ovExit(ov, shownAs){
  const st = ov._mo;
  stop(st.anims); st.anims = [];
  if(MODE === 'off' || !shownAs || shownAs === 'none') return;
  /* keep it on screen (inline beats the stylesheet) while it leaves */
  if(getComputedStyle(ov).display !== 'none') return;          /* it hides by opacity itself */
  st.exiting = true;
  ov.style.setProperty('display', shownAs, 'important');
  ov.style.setProperty('pointer-events', 'none', 'important');
  setInert(ov, true);
  const dlg = dialogOf(ov);
  let fired = false;
  const cleanup = () => {
    if(fired) return; fired = true;
    st.exiting = false;
    ov.style.removeProperty('display'); ov.style.removeProperty('pointer-events');
    setInert(ov, false);
    stop(st.anims); st.anims = [];
  };
  const done = st.settle = track(cleanup);
  const T = MODE === 'calm' ? 100 : 210;
  const fade = ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T, easing: 'linear', fill: 'forwards' });
  st.anims.push(fade);
  if(dlg){
    if(MODE === 'full'){
      const from = dlg.getBoundingClientRect();
      const back = liveRect(st.origin);
      if(back && from.width > 0){
        const g = geometry(back, from);
        st.anims.push(dlg.animate([
          { translate: '0px 0px', scale: '1', opacity: 1 },
          { opacity: 1, offset: 0.5 },
          { translate: `${g.dx}px ${g.dy}px`, scale: String(g.s), opacity: 0 },
        ], { duration: 240, easing: EASE_IN, fill: 'forwards' }));
      } else {
        st.anims.push(dlg.animate([{ scale: '1', opacity: 1 }, { scale: '.97', opacity: 0 }], { duration: T, easing: EASE_IN, fill: 'forwards' }));
      }
    }
  }
  const finish = () => { if(st.settle === done){ st.settle = null; done(); } };
  Promise.all(st.anims.map(a => a.finished.catch(() => {}))).then(finish);
  setTimeout(finish, 600);                                    /* never stick */
}

function watchOverlay(ov){
  if(ov._mo) return;
  ov._mo = { open: ov.classList.contains('open'), shownAs: null, anims: [], origin: null, exiting: false, settle: null };
  if(ov._mo.open) ov._mo.shownAs = getComputedStyle(ov).display;
  new MutationObserver(() => {
    const st = ov._mo, open = ov.classList.contains('open');
    if(open === st.open) return;
    st.open = open;
    if(open){
      st.shownAs = getComputedStyle(ov).display;
      ovEnter(ov);
    } else {
      if(ov.style.display && !st.exiting) return;              /* spring module closes it */
      ovExit(ov, st.shownAs);
    }
  }).observe(ov, { attributes: true, attributeFilter: ['class'] });
}

/* ── Popovers / dropdowns: give them an exit ─────────────────────
   [element whose class toggles, element that is shown] */
const POPOVERS = [
  ['.menu-item', '.menu-dropdown'],
  ['.cal-popup', null], ['.saveas-dropdown', null], ['.dg-multi-dropdown', null],
  ['.snd-sub-panel', null], ['.loc-drawer', null],
];
function watchPopover(host, target){
  if(host._mop) return;
  host._mop = { open: host.classList.contains('open'), shownAs: null, anim: null, settle: null };
  const el = () => target ? host.querySelector(target) : host;
  if(host._mop.open) host._mop.shownAs = getComputedStyle(el()).display;
  new MutationObserver(() => {
    const st = host._mop, open = host.classList.contains('open');
    if(open === st.open) return;
    st.open = open;
    const t = el(); if(!t) return;
    if(st.settle){ const f = st.settle; st.settle = null; f(); }   /* undo a running exit completely */
    if(st.anim){ try{ st.anim.cancel(); }catch(e){} st.anim = null; }
    if(open){
      st.shownAs = getComputedStyle(t).display;
      if(MODE === 'off' || target) return;                     /* menus keep their own CSS entry */
      st.anim = t.animate([{ opacity: 0, translate: '0 -4px', scale: '.985' }, { opacity: 1, translate: '0 0', scale: '1' }],
        { duration: dur(D.fast + 20), easing: EASE_OUT });
      return;
    }
    if(MODE === 'off' || !st.shownAs || st.shownAs === 'none' || getComputedStyle(t).display !== 'none') return;
    t.style.setProperty('display', st.shownAs, 'important');
    t.style.setProperty('pointer-events', 'none', 'important');
    setInert(t, true);
    const a = st.anim = t.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 -4px' }],
      { duration: MODE === 'calm' ? 70 : 110, easing: EASE_IN, fill: 'forwards' });
    const done = st.settle = track(() => {
      t.style.removeProperty('display'); t.style.removeProperty('pointer-events'); setInert(t, false);
      if(st.anim === a) st.anim = null;
      try{ a.cancel(); }catch(e){}
    });
    const end = () => { if(st.settle === done){ st.settle = null; done(); } };
    a.finished.then(end, end);
  }).observe(host, { attributes: true, attributeFilter: ['class'] });
}

/* Remove an element with a short exit (popover that is deleted from the DOM) */
export function motionRemove(el, { y = -4 } = {}){
  if(!el) return;
  el.removeAttribute('id');
  el.style.pointerEvents = 'none';
  el.inert = true;
  if(MODE === 'off' || !el.isConnected){ el.remove(); return; }
  const a = el.animate([{ opacity: 1, translate: '0 0', scale: '1' }, { opacity: 0, translate: `0 ${y}px`, scale: '.98' }],
    { duration: MODE === 'calm' ? 70 : 120, easing: EASE_IN, fill: 'forwards' });
  const end = track(() => el.remove());
  a.finished.then(end, end);
}

/* ── Panels fly out of / into their header button ─────────────── */
const PANELS = [
  { ov: '#cpOverlay', panel: '.cp', icon: '#btnLibOpen', triggers: '#btnLibOpen, #cpClose', keys: ['l', 'L', 'Escape'] },
  { ov: '#stOv', panel: '.st-panel', icon: '#btnSmartTools', triggers: '#btnSmartTools, #stClose, #stBackdrop', keys: ['Escape'] },
];
let LAST_PRESS = { el: null, at: 0 };
function byTheButton(p){
  const t = now();
  if(LAST_PRESS.el && t - LAST_PRESS.at < 700 && LAST_PRESS.el.closest(p.triggers)) return true;
  if(t - LAST_KEY.at < 500 && p.keys.includes(LAST_KEY.key)) return true;
  return false;
}
function watchPanel(p){
  const ov = document.querySelector(p.ov);
  if(!ov || ov._mpn) return;
  ov._mpn = { open: ov.classList.contains('open'), settle: null };
  new MutationObserver(() => {
    const st = ov._mpn, open = ov.classList.contains('open');
    if(open === st.open) return;
    st.open = open;
    const panel = ov.querySelector(p.panel), icon = document.querySelector(p.icon);
    if(st.settle){ const f = st.settle; st.settle = null; f(); }
    if(!panel || !icon || MODE !== 'full' || !byTheButton(p)) return;
    const ir = icon.getBoundingClientRect();
    if(ir.width < 2) return;
    /* stop the panel's own slide so the flight is the only motion */
    panel.style.setProperty('transition', 'none', 'important');
    panel.getAnimations().forEach(a => { if(a.constructor && a.constructor.name === 'CSSTransition') try{ a.cancel(); }catch(e){} });
    const shown = panel.getBoundingClientRect();
    /* closing: the panel is already at its closed transform — measure where it was */
    let pr = shown;
    if(!open){
      const keep = panel.style.transform;
      panel.style.transform = 'none';
      pr = panel.getBoundingClientRect();
      panel.style.transform = keep;
    }
    const g = geometry(ir, pr);
    const flown = `translate(${g.dx}px, ${g.dy}px) scale(${g.s})`;
    const frames = open
      ? [{ transform: flown, opacity: 0, borderRadius: '40px' }, { opacity: 1, offset: 0.35 }, { transform: 'none', opacity: 1, borderRadius: getComputedStyle(panel).borderRadius }]
      : [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.45 }, { transform: flown, opacity: 0, borderRadius: '40px' }];
    const a = panel.animate(frames, { duration: open ? 340 : 260, easing: open ? EASE_OUT : EASE_IN, fill: open ? 'none' : 'forwards' });
    const done = st.settle = track(() => { panel.style.removeProperty('transition'); try{ a.cancel(); }catch(e){} });
    const end = () => { if(st.settle === done){ st.settle = null; done(); } };
    a.finished.then(end, end);
  }).observe(ov, { attributes: true, attributeFilter: ['class'] });
}

/* ── Theme: the new theme spreads in a circle from the button ───── */
export function motionThemeSwitch(apply, fromEl){
  if(MODE !== 'full' || typeof document.startViewTransition !== 'function'){ apply(); return; }
  const r = fromEl ? fromEl.getBoundingClientRect() : { left: innerWidth / 2, top: 0, width: 0, height: 0 };
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  if(THEME_VT){ try{ THEME_VT.skipTransition(); }catch(e){} }      /* a newer switch supersedes the running one */
  root.classList.add('mo-theme-vt');
  let vt;
  try{ vt = document.startViewTransition(() => apply()); }catch(e){ root.classList.remove('mo-theme-vt'); apply(); return; }
  THEME_VT = vt;
  const settle = track(() => { try{ vt.skipTransition(); }catch(e){} });
  vt.ready.then(() => {
    root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] },
      { duration: 560, easing: 'cubic-bezier(.45,.05,.25,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
  vt.finished.catch(() => {}).then(() => {
    SETTLE.delete(settle);
    if(THEME_VT === vt){ THEME_VT = null; root.classList.remove('mo-theme-vt'); }
  });
}
let THEME_VT = null;

/* ── Press feedback ─────────────────────────────────────────── */
const PRESS_SEL = 'button:not(:disabled), .menu-action, .saveas-item, .ctx-item, .loc-card, [role="button"]';
const PRESS_SKIP = '.cb, .cb *, #deckArea .cb-ctrl, [data-no-press], .cp-pipe-prev, input, select, textarea';
function pressDown(e){
  if(MODE === 'off' || e.button !== 0) return;
  const el = e.target.closest(PRESS_SEL);
  if(!el || el.matches(PRESS_SKIP) || el.closest('.cb')) return;
  const r = el.getBoundingClientRect();
  const k = r.width > 220 ? 0.985 : 0.965;                     /* big targets move less */
  el._mpress && el._mpress.cancel();
  el._mpress = el.animate([{ scale: '1' }, { scale: String(k) }], { duration: D.press, easing: 'ease-out', fill: 'forwards' });
  const up = () => {
    window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
    const from = el._mpress; if(!from) return;
    const a = el.animate([{ scale: String(k) }, { scale: '1' }], { duration: MODE === 'calm' ? 90 : 220, easing: MODE === 'calm' ? 'ease-out' : SPRING });
    from.cancel(); el._mpress = a;
    a.finished.then(() => { if(el._mpress === a) el._mpress = null; }, () => {});
  };
  window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
}

/* ── Smooth collapse / expand (height) ───────────────────────── */
export function motionCollapse(el, open, apply){
  /* only the latest request may commit: an older close never hides a newer open */
  if(el && el._mcol){ const f = el._mcol; el._mcol = null; f(false); }
  if(!el || MODE === 'off' || !el.isConnected){ apply(); return; }
  if(open) apply();                                             /* show first, then measure */
  const cs = getComputedStyle(el);
  if(cs.display === 'none'){ if(!open) apply(); return; }
  const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
  const box = el.offsetHeight;                                  /* untransformed border-box */
  const h = cs.boxSizing === 'border-box' ? box : Math.max(0, box - pt - pb - bt - bb);
  const full = { height: h + 'px', paddingTop: pt + 'px', paddingBottom: pb + 'px', opacity: 1 };
  const zero = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
  const prevOverflow = el.style.overflow;
  el.style.overflow = 'hidden';
  const a = el.animate(open ? [zero, full] : [full, zero],
    { duration: MODE === 'calm' ? 110 : (open ? 220 : 170), easing: open ? EASE_OUT : EASE_IN });
  let fired = false;
  const finish = commit => {                                    /* commit=false: superseded, don't apply */
    if(fired) return; fired = true;
    SETTLE.delete(settleFn);
    el.style.overflow = prevOverflow;
    try{ a.cancel(); }catch(e){}
    if(commit && !open) apply();
  };
  const settleFn = () => { if(el._mcol === finish) el._mcol = null; finish(true); };
  SETTLE.add(settleFn);
  el._mcol = finish;
  a.finished.then(() => { if(el._mcol === finish){ el._mcol = null; finish(true); } }, () => {});
}

/* ── Cascade: several cargo blocks appear at once ───────────────
   Called after every renderAll(). When 3+ blocks are new in one go
   (project opened, sync from the other computer, undo of a clear…)
   they land from stern to bow in a quick wave. If the deck is rebuilt
   while the wave is still running, the wave continues where it was. */
let PREV_IDS = null, WAVE = null;   /* WAVE = { t0, delays: Map(id → ms), until } */
export function motionAfterRender(cargo, cv){
  const ids = new Set(cargo.map(c => String(c.id)));
  const prev = PREV_IDS; PREV_IDS = ids;
  if(MODE !== 'full' || !cv) { WAVE = null; return; }
  const t = now();
  if(WAVE && t > WAVE.until) WAVE = null;
  const fresh = prev ? cargo.filter(c => !prev.has(String(c.id))) : cargo.slice();
  if(fresh.length >= 3 && fresh.length <= 400 && !document.body.classList.contains('view-3d')){
    const list = fresh.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const step = Math.min(26, 520 / list.length);
    WAVE = { t0: t, delays: new Map(list.map((c, i) => [String(c.id), i * step])), until: t + list.length * step + 420 };
  }
  if(!WAVE) return;
  WAVE.delays.forEach((d, id) => {
    const el = cv.querySelector(`.cb[data-id="${CSS.escape(id)}"]`);
    if(!el) return;
    const delay = WAVE.t0 + d - t;
    if(delay < -420) return;
    el.animate([{ opacity: 0, translate: '0 -16px', scale: '1.05' }, { opacity: 1, translate: '0 0', scale: '1' }],
      { duration: 420, delay, easing: SPRING, fill: 'backwards' });
  });
}

/* Finish any landing wave at once (before a PDF capture) */
export function motionSettleDeck(){
  WAVE = null;
  document.querySelectorAll('#cvDECK .cb').forEach(el => el.getAnimations().forEach(a => {
    if(a.constructor && (a.constructor.name === 'CSSAnimation' || a.constructor.name === 'CSSTransition')) return;
    try{ a.finish(); }catch(e){ try{ a.cancel(); }catch(_){} }
  }));
}

/* ── Start ─────────────────────────────────────────────────── */
export function initMotion(){
  setMotionMode(initialMode(), false);
  try{ matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    let saved = null; try{ saved = localStorage.getItem(LS_KEY); }catch(e){}
    if(!saved) setMotionMode(initialMode(), false);
  }); }catch(e){}
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest && e.target.closest(ORIGIN_SEL);
    if(el) remember(el);
    LAST_PRESS = { el: e.target, at: now() };
    pressDown(e);
  }, true);
  document.addEventListener('keydown', e => {
    LAST_KEY = { key: e.key, at: now() };
    if(e.key === 'Enter' || e.key === ' '){ const a = document.activeElement; if(a && a !== document.body && a.matches && a.matches(ORIGIN_SEL)) remember(a); }
  }, true);
  const scan = () => {
    document.querySelectorAll(OV_SEL).forEach(watchOverlay);
    POPOVERS.forEach(([h, t]) => document.querySelectorAll(h).forEach(el => watchPopover(el, t)));
    PANELS.forEach(watchPanel);
  };
  scan();
  /* overlays created later (field weather, position map, …) */
  new MutationObserver(recs => {
    for(const r of recs) for(const n of r.addedNodes){
      if(n.nodeType !== 1) continue;
      if(n.matches(OV_SEL)) watchOverlay(n);
      POPOVERS.forEach(([h, t]) => { if(n.matches(h)) watchPopover(n, t); });
    }
  }).observe(document.body, { childList: true });
}
