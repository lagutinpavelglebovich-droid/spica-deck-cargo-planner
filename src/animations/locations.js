/**
 * FLIP layout animation for Active Locations Strip.
 * Uses Motion One springs for entry, CSS easing for FLIP moves and exits.
 */
import { animate } from 'motion';

/**
 * flipLayout — FLIP-pattern layout animation.
 *
 * @param {HTMLElement} container
 * @param {() => void} renderFn  — must clear + rebuild children inside container
 * @param {object}      [opts]
 * @param {string}      [opts.itemSelector='[data-loc-id]']
 * @param {string}      [opts.idAttr='data-loc-id']
 * @param {number}      [opts.duration=280]
 * @param {{ stiffness:number, damping:number }} [opts.spring]
 */
export function flipLayout(container, renderFn, opts = {}) {
  const {
    itemSelector = '[data-loc-id]',
    idAttr       = 'data-loc-id',
    duration     = 340,
    spring       = { stiffness: 260, damping: 26 },
    exit         = { duration: 170, scale: 0.96 },
  } = opts;

  /* ── 1. Snapshot phase ─────────────────────────────────── */
  const oldItems = container.querySelectorAll(itemSelector);
  /** @type {Map<string,{rect:DOMRect, el:HTMLElement}>} */
  const snapshot = new Map();
  oldItems.forEach(el => {
    const id = el.getAttribute(idAttr);
    if (id) snapshot.set(id, { rect: el.getBoundingClientRect(), el });
  });

  /* ── 2. Clone exiters (before DOM wipe) ────────────────── */
  let overlay = null;
  if (snapshot.size) {
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:9999;';
    document.body.appendChild(overlay);

    snapshot.forEach(({ rect, el }, id) => {
      const clone = el.cloneNode(true);
      clone.setAttribute('data-flip-exit', id);
      clone.style.cssText =
        `position:fixed;top:${rect.top}px;left:${rect.left}px;` +
        `width:${rect.width}px;height:${rect.height}px;` +
        `margin:0;pointer-events:none;box-sizing:border-box;` +
        `transition:none;`;
      // Copy computed styles that affect visual appearance
      const cs = getComputedStyle(el);
      clone.style.background   = cs.background;
      clone.style.borderRadius = cs.borderRadius;
      clone.style.border       = cs.border;
      clone.style.boxShadow    = cs.boxShadow;
      overlay.appendChild(clone);
    });
  }

  /* ── 3. Render phase ───────────────────────────────────── */
  renderFn();

  /* ── 4. Match phase ────────────────────────────────────── */
  const newItems = container.querySelectorAll(itemSelector);
  const newIds = new Set();

  newItems.forEach(el => {
    const id = el.getAttribute(idAttr);
    if (!id) return;
    newIds.add(id);

    if (snapshot.has(id)) {
      /* ── EXISTING: FLIP move ─────────────────────────── */
      const oldRect = snapshot.get(id).rect;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top  - newRect.top;

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        animate(
          el,
          { transform: [`translate(${dx}px,${dy}px)`, 'translate(0,0)'] },
          { duration: duration / 1000, easing: [0.22, 1, 0.36, 1] },
        );
      }
    } else {
      /* ── NEW: spring entry ───────────────────────────── */
      animate(
        el,
        { opacity: [0, 1], scale: [0.96, 1] },
        { duration: duration / 1000, easing: `spring(${spring.stiffness}, ${spring.damping}, 0, 1)` },
      );
    }
  });

  /* ── 5. Exit removed items via clones ──────────────────── */
  if (overlay) {
    let hasExiters = false;
    snapshot.forEach((_snap, id) => {
      if (newIds.has(id)) {
        /* Still present — remove clone immediately */
        const clone = overlay.querySelector(`[data-flip-exit="${id}"]`);
        if (clone) clone.remove();
      } else {
        /* Removed — animate clone out then delete */
        hasExiters = true;
        const clone = overlay.querySelector(`[data-flip-exit="${id}"]`);
        if (clone) {
          animate(
            clone,
            { opacity: [1, 0], scale: [1, 0.96] },
            { duration: exit.duration / 1000, easing: [0.22, 1, 0.36, 1] },
          ).finished.then(() => clone.remove());
        }
      }
    });

    if (!hasExiters) {
      overlay.remove();
    } else {
      /* Clean up overlay after longest exit */
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, exit.duration + 50);
    }
  }
}
