/* ════════════════════════════════════════════════════════════
   Modal animations — Family-style spring transitions
   Uses Motion One for Apple-like spring physics.
   ════════════════════════════════════════════════════════════ */

import { animate } from 'motion';

/* Spring preset — Apple Settings-style */
const SPRING_IN  = { type: 'spring', stiffness: 380, damping: 30 };
const SPRING_SNAP = { type: 'spring', stiffness: 420, damping: 34 };

let _inFlight = null;

/* ── Spring entrance ─────────────────────────────────────── */

export function animateModalIn(overlay, modal) {
  if (_inFlight) { _inFlight.cancel(); _inFlight = null; }

  modal.style.opacity = '0';
  modal.style.transform = 'scale(0.92) translateY(20px)';

  overlay.style.display = 'flex';
  overlay.style.opacity = '0';

  animate(overlay, { opacity: [0, 1] }, { duration: 0.22, easing: 'ease-out' });

  animate(
    modal,
    { opacity: [0, 1], transform: ['scale(0.92) translateY(20px)', 'scale(1) translateY(0px)'] },
    SPRING_IN
  );
}

/* ── Spring exit ─────────────────────────────────────────── */

export async function animateModalOut(overlay, modal) {
  const exit = animate(
    modal,
    { opacity: [1, 0], transform: ['scale(1) translateY(0px)', 'scale(0.94) translateY(10px)'] },
    { duration: 0.18, easing: 'ease-in' }
  );
  _inFlight = exit;

  animate(overlay, { opacity: [1, 0] }, { duration: 0.18, easing: 'ease-in' });

  await exit.finished;
  _inFlight = null;

  overlay.style.display = 'none';
}

/* ── Swipe-down dismiss ──────────────────────────────────── */

export function bindSwipeDismiss(modal, onDismiss) {
  let tracking = false;
  let startY = 0;
  let startX = 0;
  let lastY = 0;
  let lastTime = 0;
  let decided = false;
  let isVertical = false;

  modal.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input, button, select, textarea, [contenteditable]')) return;

    tracking = true;
    decided = false;
    isVertical = false;
    startY = e.clientY;
    startX = e.clientX;
    lastY = e.clientY;
    lastTime = Date.now();
    modal.setPointerCapture(e.pointerId);
  });

  modal.addEventListener('pointermove', (e) => {
    if (!tracking) return;

    const deltaY = e.clientY - startY;
    const deltaX = e.clientX - startX;

    if (!decided && (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8)) {
      decided = true;
      isVertical = Math.abs(deltaY) >= Math.abs(deltaX);
      if (!isVertical) { tracking = false; return; }
    }

    if (!decided || !isVertical) return;

    const dy = Math.max(0, deltaY);
    lastY = e.clientY;
    lastTime = Date.now();

    modal.style.transform = `translateY(${dy}px)`;
    modal.style.opacity = String(Math.max(0.3, 1 - dy / 400));
  });

  const end = (e) => {
    if (!tracking) return;
    tracking = false;

    const deltaY = Math.max(0, e.clientY - startY);
    const elapsed = Date.now() - lastTime || 1;
    const velocity = Math.max(0, (e.clientY - lastY)) / elapsed;

    if (deltaY > 120 || velocity > 0.5) {
      const curOpacity = modal.style.opacity || '1';
      animate(
        modal,
        { transform: [`translateY(${deltaY}px)`, `translateY(${deltaY + 80}px)`], opacity: [curOpacity, '0'] },
        { duration: 0.16, easing: 'ease-in' }
      ).finished.then(() => {
        modal.style.transform = '';
        modal.style.opacity = '';
        onDismiss();
      });
    } else {
      const curOpacity = modal.style.opacity || '1';
      animate(
        modal,
        { transform: [`translateY(${deltaY}px)`, 'translateY(0px)'], opacity: [curOpacity, '1'] },
        SPRING_SNAP
      ).finished.then(() => {
        modal.style.transform = '';
        modal.style.opacity = '';
      });
    }
  };

  modal.addEventListener('pointerup', end);
  modal.addEventListener('pointercancel', end);
}

/* ── Escape dismiss ──────────────────────────────────────── */

export function bindEscapeDismiss(overlay, onDismiss) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      e.stopPropagation();
      onDismiss();
    }
  });
}
