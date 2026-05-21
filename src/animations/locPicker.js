/* ════════════════════════════════════════════════════════════
   Location picker animations — Motion One spring + blur-in,
   row-based wave stagger.

   Mirrors the architecture in src/animations/langDropdown.js
   (WeakMap state machine, cancel-in-flight, finished cleanup),
   adapted for a grid surface that opens behind a max-height
   drawer transition.

   Entry: drawer .open class is applied by the caller, which kicks
          off the existing CSS max-height transition (0 → 320px,
          240ms ease). After DRAWER_OPEN_OFFSET_MS the shelf has
          enough vertical room for the first row, so cards begin
          their wave-in. Row index is computed from each card's
          bounding rect AFTER one rAF (so layout is settled and
          grid auto-fill columns are known), making the stagger
          robust to viewport width and custom-location count.

   Exit:  coordinated 150ms ease-in fade for all cards at once
          (no row stagger — close should feel snappier than open).
          Class removal happens after the exit settles so the CSS
          max-height transition collapses the drawer last.
   ════════════════════════════════════════════════════════════ */

import { animate } from 'motion';

const SPRING_IN = { type: 'spring', stiffness: 300, damping: 20 };
const ROW_STAGGER_S = 0.08;           /* 80ms between rows */
const DRAWER_OPEN_OFFSET_MS = 120;    /* wait for drawer max-height to clear space */
const EXIT_DUR_S = 0.15;
const CONTAINER_FADE_IN_S = 0.18;

/* Deck-shift coordination: the deck plan translates down by the drawer's
   measured height so the drawer doesn't overlap cargo. Motion One (WAAPI)
   is used instead of CSS transition because .deck-area has a stylesheet
   `transition:padding ... !important` rule that an inline normal transition
   cannot override — but Web Animations sits above author !important in the
   CSS cascade, so this just works. */
const DECK_SHIFT_BUFFER_PX = 16;
const DECK_SHIFT_IN_DUR_S  = 0.46;
const DECK_SHIFT_OUT_DUR_S = 0.35;
const DECK_SHIFT_IN_EASE   = 'cubic-bezier(.34,1.5,.5,1)';
const DECK_SHIFT_OUT_EASE  = 'cubic-bezier(.5,0,.25,1)';

const _states = new WeakMap();
const _inFlight = new WeakMap();      /* drawer → array of running anims */

export function getLocPickerState(drawer) {
  return _states.get(drawer) || 'closed';
}

function _cancelInFlight(drawer) {
  const anims = _inFlight.get(drawer);
  if (anims) {
    anims.forEach(a => { try { a.cancel(); } catch (_) {} });
  }
  _inFlight.set(drawer, []);
}

function _trackAnim(drawer, anim) {
  const anims = _inFlight.get(drawer) || [];
  anims.push(anim);
  _inFlight.set(drawer, anims);
}

/* Compute row index for each card from its bounding rect's top, AFTER
   layout has settled (caller must invoke from inside rAF). Cards within
   the same grid row share the same top value (within ~1px tolerance),
   so a coarse round against (cardHeight + gap) gives the row bucket.
   Robust to grid auto-fill width changes and custom card count. */
function _computeRowIndex(cards) {
  if (!cards.length) return [];
  const first = cards[0].getBoundingClientRect();
  const referenceTop = first.top;
  const rowHeight = first.height + 5; /* 5px = .loc-grid gap */
  const result = new Array(cards.length);
  for (let i = 0; i < cards.length; i++) {
    const top = cards[i].getBoundingClientRect().top;
    result[i] = Math.max(0, Math.round((top - referenceTop) / rowHeight));
  }
  return result;
}

export function animateLocPickerIn(drawer) {
  const state = getLocPickerState(drawer);
  if (state === 'open' || state === 'opening') return;

  _cancelInFlight(drawer);
  _states.set(drawer, 'opening');

  const cards = drawer.querySelectorAll('.loc-opt');

  /* Seed initial states BEFORE layout settles — avoids first-frame flash
     of the fully-laid-out grid. */
  cards.forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(12px) scale(0.92)';
    card.style.filter = 'blur(8px)';
  });

  /* Container fade — runs while drawer is still expanding. */
  const containerAnim = animate(
    drawer,
    { opacity: [0, 1] },
    { duration: CONTAINER_FADE_IN_S, easing: 'ease-out' }
  );
  _trackAnim(drawer, containerAnim);

  /* Wait one frame so the grid has computed its column layout, then
     measure row buckets and launch per-card springs with row stagger.
     The DRAWER_OPEN_OFFSET_MS delay lets the CSS max-height transition
     (240ms ease) clear enough vertical room before the first row pops. */
  requestAnimationFrame(() => {
    if (getLocPickerState(drawer) !== 'opening') return;

    /* Shift the deck plan down by the drawer's measured height + buffer so
       the floating drawer doesn't visually overlap cargo. Runs in parallel
       with the card wave — both kick off in the same RAF tick. */
    const deckArea = document.getElementById('deckArea');
    if (deckArea) {
      const shiftY = drawer.getBoundingClientRect().height + DECK_SHIFT_BUFFER_PX;
      const deckAnim = animate(
        deckArea,
        { transform: ['translateY(0px)', `translateY(${shiftY}px)`] },
        { duration: DECK_SHIFT_IN_DUR_S, easing: DECK_SHIFT_IN_EASE }
      );
      _trackAnim(drawer, deckAnim);
    }

    const rowIndices = _computeRowIndex(cards);
    let lastAnim = containerAnim;

    cards.forEach((card, i) => {
      const rowDelayS = (DRAWER_OPEN_OFFSET_MS / 1000) + rowIndices[i] * ROW_STAGGER_S;
      const anim = animate(
        card,
        {
          opacity:   [0, 1],
          transform: ['translateY(12px) scale(0.92)', 'translateY(0px) scale(1)'],
          filter:    ['blur(8px)', 'blur(0px)']
        },
        { ...SPRING_IN, delay: rowDelayS }
      );
      _trackAnim(drawer, anim);
      lastAnim = anim;
    });

    lastAnim.finished.then(() => {
      if (getLocPickerState(drawer) !== 'opening') return;
      /* Hand the rest-state back to CSS so .loc-opt.in-use, .loc-opt:hover,
         and any future static styling can apply unencumbered by Motion One's
         committed inline transform/opacity/filter. */
      cards.forEach(card => {
        card.style.opacity = '';
        card.style.transform = '';
        card.style.filter = '';
      });
      drawer.style.opacity = '';
      _states.set(drawer, 'open');
    }).catch(() => {});
  });
}

export function animateLocPickerOut(drawer) {
  const state = getLocPickerState(drawer);
  if (state === 'closed' || state === 'closing') return;

  _cancelInFlight(drawer);
  _states.set(drawer, 'closing');

  const cards = drawer.querySelectorAll('.loc-opt');

  /* Return the deck plan to its resting position — runs in parallel with
     the card fade. Faster + ease-out for a decisive snap-back. */
  const deckArea = document.getElementById('deckArea');
  if (deckArea) {
    const deckAnim = animate(
      deckArea,
      { transform: 'translateY(0px)' },
      { duration: DECK_SHIFT_OUT_DUR_S, easing: DECK_SHIFT_OUT_EASE }
    );
    _trackAnim(drawer, deckAnim);
  }

  /* Coordinated card fade-out — no row stagger on close. */
  cards.forEach(card => {
    const anim = animate(
      card,
      {
        opacity:   [parseFloat(card.style.opacity || '1'), 0],
        transform: [card.style.transform || 'translateY(0px) scale(1)', 'translateY(-8px) scale(0.96)'],
        filter:    [card.style.filter || 'blur(0px)', 'blur(6px)']
      },
      { duration: EXIT_DUR_S, easing: 'ease-in' }
    );
    _trackAnim(drawer, anim);
  });

  /* Container fade leads the timing — when it finishes, remove .open
     so the CSS max-height transition collapses the drawer last. */
  const containerAnim = animate(
    drawer,
    { opacity: [parseFloat(drawer.style.opacity || '1'), 0] },
    { duration: EXIT_DUR_S, easing: 'ease-in' }
  );
  _trackAnim(drawer, containerAnim);

  containerAnim.finished.then(() => {
    if (getLocPickerState(drawer) !== 'closing') return;
    drawer.classList.remove('open');
    /* Clear inline styles so the next open starts from a clean slate. */
    drawer.style.opacity = '';
    cards.forEach(card => {
      card.style.opacity = '';
      card.style.transform = '';
      card.style.filter = '';
    });
    /* Clear deck-shift inline transform — by now the shift-out animation
       has settled at translateY(0), so removing the inline style produces
       no visual jump (computed style falls back to stylesheet, which has
       no transform). Prevents stale inline values from leaking forward. */
    if (deckArea) deckArea.style.transform = '';
    _states.set(drawer, 'closed');
    _inFlight.set(drawer, []);
  }).catch(() => {});
}
