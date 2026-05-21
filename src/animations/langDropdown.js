/* ════════════════════════════════════════════════════════════
   Language dropdown animations — Motion One spring + blur-in + stagger.
   Mirrors the state-machine pattern from modal.js.

   Entry: opacity + translateY + scale + filter blur, spring (300/20),
          staggered 60ms per option from the top.
   Exit:  coordinated reverse-direction, 160ms ease-in (no stagger, snappier).
   ════════════════════════════════════════════════════════════ */

import { animate } from 'motion';

const SPRING_IN = { type: 'spring', stiffness: 300, damping: 20 };
const STAGGER_S = 0.06;       /* 60ms per option */
const EXIT_DUR_S = 0.16;
const CONTAINER_FADE_IN_S = 0.18;

const _states = new WeakMap();
const _inFlight = new WeakMap();    /* dropdown → array of running anims */

export function getLangState(dropdown) {
  return _states.get(dropdown) || 'closed';
}

function _cancelInFlight(dropdown) {
  const anims = _inFlight.get(dropdown);
  if (anims) {
    anims.forEach(a => { try { a.cancel(); } catch (_) {} });
  }
  _inFlight.set(dropdown, []);
}

function _trackAnim(dropdown, anim) {
  const anims = _inFlight.get(dropdown) || [];
  anims.push(anim);
  _inFlight.set(dropdown, anims);
}

export function animateLangDropdownIn(dropdown) {
  const state = getLangState(dropdown);
  if (state === 'open' || state === 'opening') return;

  _cancelInFlight(dropdown);
  _states.set(dropdown, 'opening');

  const options = dropdown.querySelectorAll('.lang-opt');

  /* Seed initial states BEFORE making visible — avoids first-frame flash. */
  dropdown.style.opacity = '0';
  options.forEach(opt => {
    opt.style.opacity = '0';
    opt.style.transform = 'translateY(10px) scale(0.92)';
    opt.style.filter = 'blur(10px)';
  });

  /* Class drives display:flex (CSS rule .lang-dropdown.open) — still needed
     for outside-click detection elsewhere. */
  dropdown.classList.add('open');

  /* Container fade. */
  const containerAnim = animate(
    dropdown,
    { opacity: [0, 1] },
    { duration: CONTAINER_FADE_IN_S, easing: 'ease-out' }
  );
  _trackAnim(dropdown, containerAnim);

  /* Per-option spring with stagger. */
  let lastAnim = containerAnim;
  options.forEach((opt, i) => {
    const anim = animate(
      opt,
      {
        opacity:   [0, 1],
        transform: ['translateY(10px) scale(0.92)', 'translateY(0px) scale(1)'],
        filter:    ['blur(10px)', 'blur(0px)']
      },
      { ...SPRING_IN, delay: i * STAGGER_S }
    );
    _trackAnim(dropdown, anim);
    lastAnim = anim;
  });

  lastAnim.finished.then(() => {
    if (getLangState(dropdown) === 'opening') {
      _states.set(dropdown, 'open');
    }
  }).catch(() => {});
}

export function animateLangDropdownOut(dropdown) {
  const state = getLangState(dropdown);
  if (state === 'closed' || state === 'closing') return;

  _cancelInFlight(dropdown);
  _states.set(dropdown, 'closing');

  const options = dropdown.querySelectorAll('.lang-opt');

  const containerAnim = animate(
    dropdown,
    { opacity: [parseFloat(dropdown.style.opacity || '1'), 0] },
    { duration: EXIT_DUR_S, easing: 'ease-in' }
  );
  _trackAnim(dropdown, containerAnim);

  options.forEach(opt => {
    const anim = animate(
      opt,
      {
        opacity:   [parseFloat(opt.style.opacity || '1'), 0],
        transform: [opt.style.transform || 'translateY(0px) scale(1)', 'translateY(-6px) scale(0.96)'],
        filter:    [opt.style.filter || 'blur(0px)', 'blur(4px)']
      },
      { duration: EXIT_DUR_S, easing: 'ease-in' }
    );
    _trackAnim(dropdown, anim);
  });

  containerAnim.finished.then(() => {
    if (getLangState(dropdown) !== 'closing') return;
    dropdown.classList.remove('open');
    /* Clear inline styles so the next open starts from a clean slate. */
    dropdown.style.opacity = '';
    options.forEach(opt => {
      opt.style.opacity = '';
      opt.style.transform = '';
      opt.style.filter = '';
    });
    _states.set(dropdown, 'closed');
    _inFlight.set(dropdown, []);
  }).catch(() => {});
}
