/* ════════════════════════════════════════════════════════════
   Hold-to-Confirm — reusable long-press confirmation pattern
   Uses Motion One for progress animation + spring rollback.

   Two variants:
   • linear  — background fill bottom→top, text changes during hold
   • circular — SVG progress ring around an icon

   Accessibility: prefers-reduced-motion → 400ms duration + visible
   "Confirm" fallback button (added automatically).
   ════════════════════════════════════════════════════════════ */

import { animate } from 'motion';

const DEFAULTS = {
  variant: 'linear',
  duration: 800,
  holdLabel: null,
  completedLabel: null,
  destructiveColor: null,
  hintText: null,
  tooltipText: null,
};

/* ── Reduced-motion query ──────────────────────────────────── */
const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Color helpers ─────────────────────────────────────────── */
function resolveColor(opt) {
  if (opt) return opt;
  /* Use the project's existing danger palette */
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return isDark ? '#ef4444' : '#9f403d';
}

/* ════════════════════════════════════════════════════════════
   LINEAR VARIANT
   ════════════════════════════════════════════════════════════ */

function bindLinear(button, onConfirm, opts) {
  const duration = (prefersReduced() ? 400 : opts.duration) / 1000; // seconds
  const color = resolveColor(opts.destructiveColor);
  const originalLabel = button.textContent;
  const holdLabel = opts.holdLabel || originalLabel;
  const completedLabel = opts.completedLabel || originalLabel;

  /* Create fill overlay inside the button */
  const fill = document.createElement('span');
  fill.className = 'htc-fill';
  fill.style.cssText = `
    position:absolute; inset:0; bottom:0;
    background:${color};
    transform-origin:bottom center;
    transform:scaleY(0);
    border-radius:inherit;
    pointer-events:none;
    z-index:0;
  `;

  /* Wrap existing content so it sits above fill */
  const label = document.createElement('span');
  label.className = 'htc-label';
  label.style.cssText = 'position:relative; z-index:1; pointer-events:none;';
  label.textContent = originalLabel;

  button.textContent = '';
  button.style.position = 'relative';
  button.style.overflow = 'hidden';
  button.appendChild(fill);
  button.appendChild(label);

  /* Shimmer hint — subtle diagonal stripe every ~3s (linear only) */
  const shimmer = document.createElement('span');
  shimmer.className = 'htc-shimmer';
  button.appendChild(shimmer);

  /* ── Part A: persistent hint below the button ────────────── */
  let hintEl = null;
  let wrapEl = null;
  if (opts.hintText) {
    /* Wrap the button so hint sits directly below it, not as a flex sibling */
    wrapEl = document.createElement('div');
    wrapEl.className = 'htc-button-wrap';
    button.parentNode.insertBefore(wrapEl, button);
    wrapEl.appendChild(button);

    hintEl = document.createElement('span');
    hintEl.className = 'htc-hint';
    hintEl.textContent = opts.hintText;
    wrapEl.appendChild(hintEl);
  }

  /* ── Part B: tooltip + wiggle state ──────────────────────── */
  const SHORT_CLICK_MS = 150;
  let tooltipEl = null;
  let tooltipVisible = false;
  let tooltipHideTimer = null;
  let downTime = 0;
  let holdThresholdTimer = null;

  const ensureTooltip = () => {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('span');
    tooltipEl.className = 'htc-tooltip';
    tooltipEl.textContent = opts.tooltipText || 'Hold to confirm';
    /* Append inside button so it positions relative to it */
    button.appendChild(tooltipEl);
    return tooltipEl;
  };

  const showTooltip = () => {
    if (tooltipVisible) return; // debounce
    const el = ensureTooltip();
    tooltipVisible = true;
    el.style.display = '';
    animate(el, { opacity: [0, 1], transform: ['scale(0.85)', 'scale(1)'] },
      { duration: 0.2, easing: [.22, 1.2, .36, 1] });

    tooltipHideTimer = setTimeout(() => hideTooltip(), 1500);
  };

  const hideTooltip = (instant) => {
    if (!tooltipEl || !tooltipVisible) return;
    clearTimeout(tooltipHideTimer);
    tooltipVisible = false;
    if (instant) {
      tooltipEl.style.display = 'none';
      return;
    }
    animate(tooltipEl,
      { opacity: [1, 0], transform: ['translateY(0)', 'translateY(-4px)'] },
      { duration: 0.2 }
    ).finished.then(() => {
      if (tooltipEl) tooltipEl.style.display = 'none';
    }).catch(() => {});
  };

  const wiggle = () => {
    animate(button,
      { transform: ['translateX(-4px)', 'translateX(4px)',
                     'translateX(-2px)', 'translateX(2px)', 'translateX(0)'] },
      { duration: 0.2, easing: 'ease-out' });
  };

  let activeAnim = null;
  let completed = false;

  const resetVisual = () => {
    label.textContent = originalLabel;
    button.classList.remove('htc-holding');
    label.style.color = '';
  };

  const startHold = (e) => {
    if (completed) return;
    if (e.button !== undefined && e.button !== 0) return; // left click only

    downTime = Date.now();

    /* After threshold — it's a real hold, hide tooltip if showing */
    holdThresholdTimer = setTimeout(() => {
      hideTooltip(true);
    }, SHORT_CLICK_MS);

    button.classList.add('htc-holding');
    label.textContent = holdLabel;
    label.style.color = '#fff';

    activeAnim = animate(
      fill,
      { transform: ['scaleY(0)', 'scaleY(1)'] },
      { duration, easing: 'linear' }
    );

    activeAnim.finished.then(() => {
      if (!activeAnim) return; // was cancelled
      completed = true;
      label.textContent = completedLabel;

      /* Flash: scale 1→1.03→1 + bright tint */
      animate(
        button,
        { transform: ['scale(1)', 'scale(1.03)', 'scale(1)'] },
        { duration: 0.25, easing: 'ease-out' }
      );
      animate(
        fill,
        { opacity: [1, 0.7, 1] },
        { duration: 0.25, easing: 'ease-out' }
      ).finished.then(() => {
        onConfirm();
      });
    }).catch(() => { /* cancelled — ignore */ });
  };

  const cancelHold = () => {
    clearTimeout(holdThresholdTimer);

    if (completed) return;

    const elapsed = Date.now() - downTime;

    /* Short click → wiggle + tooltip feedback */
    if (elapsed < SHORT_CLICK_MS && elapsed > 0) {
      wiggle();
      if (!tooltipVisible) showTooltip();
    }

    if (!activeAnim) return;
    activeAnim.cancel();
    activeAnim = null;

    /* Spring rollback — 250ms asymmetric feel */
    animate(
      fill,
      { transform: 'scaleY(0)' },
      { duration: 0.25, easing: 'cubic-bezier(.34,1.3,.64,1)' }
    );
    resetVisual();
  };

  /* Pointer events — works for mouse + touch */
  button.addEventListener('pointerdown', startHold);
  button.addEventListener('pointerup', cancelHold);
  button.addEventListener('pointerleave', cancelHold);
  button.addEventListener('pointercancel', cancelHold);

  /* Prevent context menu on long press (mobile) */
  button.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ── Accessibility fallback ──────────────────────────────── */
  let fallbackBtn = null;
  if (prefersReduced()) {
    fallbackBtn = document.createElement('button');
    fallbackBtn.className = 'htc-fallback-confirm';
    fallbackBtn.textContent = opts.fallbackLabel || 'Confirm';
    fallbackBtn.addEventListener('click', () => {
      if (!completed) {
        completed = true;
        onConfirm();
      }
    });
    /* Insert after wrapper (if present) or after button */
    const insertAfter = wrapEl || button;
    insertAfter.parentNode.insertBefore(fallbackBtn, insertAfter.nextSibling);
  }

  /* Cleanup function */
  return () => {
    if (activeAnim) activeAnim.cancel();
    clearTimeout(holdThresholdTimer);
    clearTimeout(tooltipHideTimer);
    button.removeEventListener('pointerdown', startHold);
    button.removeEventListener('pointerup', cancelHold);
    button.removeEventListener('pointerleave', cancelHold);
    button.removeEventListener('pointercancel', cancelHold);
    fill.remove();
    shimmer.remove();
    if (tooltipEl) tooltipEl.remove();
    if (hintEl) hintEl.remove();
    /* Unwrap button from htc-button-wrap back into its original parent */
    if (wrapEl && wrapEl.parentNode) {
      wrapEl.parentNode.insertBefore(button, wrapEl);
      wrapEl.remove();
    }
    label.textContent = originalLabel;
    if (fallbackBtn) fallbackBtn.remove();
    completed = false;
  };
}


/* ════════════════════════════════════════════════════════════
   CIRCULAR VARIANT
   ════════════════════════════════════════════════════════════ */

function bindCircular(button, onConfirm, opts) {
  const duration = (prefersReduced() ? 400 : opts.duration) / 1000;
  const color = resolveColor(opts.destructiveColor);
  const r = 14;
  const stroke = 2;
  const circumference = 2 * Math.PI * r;
  const size = (r + stroke) * 2;

  /* SVG ring */
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.style.cssText = `
    position:absolute; inset:0; margin:auto;
    pointer-events:none; z-index:1;
  `;

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', size / 2);
  circle.setAttribute('cy', size / 2);
  circle.setAttribute('r', r);
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', 'var(--txt4)');
  circle.setAttribute('stroke-width', stroke);
  circle.setAttribute('stroke-dasharray', circumference);
  circle.setAttribute('stroke-dashoffset', circumference);
  circle.setAttribute('stroke-linecap', 'round');
  circle.style.transform = 'rotate(-90deg)';
  circle.style.transformOrigin = 'center';
  svg.appendChild(circle);

  button.style.position = 'relative';
  button.appendChild(svg);

  let activeAnim = null;
  let pulseAnim = null;
  let completed = false;

  const startHold = (e) => {
    if (completed) return;
    if (e.button !== undefined && e.button !== 0) return;

    circle.setAttribute('stroke', color);

    activeAnim = animate(
      (progress) => {
        circle.setAttribute('stroke-dashoffset',
          String(circumference * (1 - progress)));
      },
      { duration, easing: 'linear' }
    );

    /* Icon pulse: scale 1→1.08→1 loop */
    const icon = button.querySelector('svg:not([viewBox])') ||
                 button.querySelector('.htc-icon') ||
                 button.firstElementChild;
    if (icon && icon !== svg) {
      pulseAnim = animate(
        icon,
        { transform: ['scale(1)', 'scale(1.08)', 'scale(1)'] },
        { duration: 0.6, easing: 'ease-in-out', repeat: Infinity }
      );
    }

    activeAnim.finished.then(() => {
      if (!activeAnim) return;
      completed = true;
      if (pulseAnim) pulseAnim.cancel();

      animate(
        button,
        { transform: ['scale(1)', 'scale(1.03)', 'scale(1)'] },
        { duration: 0.25, easing: 'ease-out' }
      ).finished.then(() => onConfirm());
    }).catch(() => {});
  };

  const cancelHold = () => {
    if (completed || !activeAnim) return;
    activeAnim.cancel();
    activeAnim = null;
    if (pulseAnim) { pulseAnim.cancel(); pulseAnim = null; }

    circle.setAttribute('stroke', 'var(--txt4)');
    animate(
      (progress) => {
        const current = parseFloat(circle.getAttribute('stroke-dashoffset'));
        const target = circumference;
        circle.setAttribute('stroke-dashoffset',
          String(current + (target - current) * progress));
      },
      { duration: 0.25, easing: 'cubic-bezier(.34,1.3,.64,1)' }
    );
  };

  button.addEventListener('pointerdown', startHold);
  button.addEventListener('pointerup', cancelHold);
  button.addEventListener('pointerleave', cancelHold);
  button.addEventListener('pointercancel', cancelHold);
  button.addEventListener('contextmenu', (e) => e.preventDefault());

  /* Accessibility fallback */
  let fallbackBtn = null;
  if (prefersReduced()) {
    fallbackBtn = document.createElement('button');
    fallbackBtn.className = 'htc-fallback-confirm';
    fallbackBtn.textContent = opts.fallbackLabel || 'Confirm';
    fallbackBtn.addEventListener('click', () => {
      if (!completed) { completed = true; onConfirm(); }
    });
    button.parentNode.insertBefore(fallbackBtn, button.nextSibling);
  }

  return () => {
    if (activeAnim) activeAnim.cancel();
    if (pulseAnim) pulseAnim.cancel();
    button.removeEventListener('pointerdown', startHold);
    button.removeEventListener('pointerup', cancelHold);
    button.removeEventListener('pointerleave', cancelHold);
    button.removeEventListener('pointercancel', cancelHold);
    svg.remove();
    if (fallbackBtn) fallbackBtn.remove();
    completed = false;
  };
}


/* ════════════════════════════════════════════════════════════
   PUBLIC API
   ════════════════════════════════════════════════════════════ */

export function bindHoldToConfirm(button, onConfirm, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  if (opts.variant === 'circular') {
    return bindCircular(button, onConfirm, opts);
  }
  return bindLinear(button, onConfirm, opts);
}
