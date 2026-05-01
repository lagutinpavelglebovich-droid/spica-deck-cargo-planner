/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Weather Orchestrator

   Imported by src/app.js. Owns the A/B sky crossfade DOM, the canvas
   precipitation lifecycle, the lightning randomizer, the visibility
   pause gate, and the matchMedia(prefers-reduced-motion) handler.

   Does NOT own:
     - _wxState, localStorage, the chip, or the Smart Tools form
       (all kept in src/app.js)
     - data-wx attribute stamping on <body> (still done by _wxApply
       in src/app.js; CSS-driven visuals continue to read it directly)

   Public API:
     wxScene.init()      Mount DOM refs, attach visibility +
                         matchMedia listeners. Idempotent.
     wxScene.set({ condition, intensity, motion, engine })
                         Orchestrate the data flow:
                           1. clear pending timers if condition changed
                           2. crossfade A/B sky (cinematic only)
                           3. start/stop canvas precip
                           4. arm lightning scheduler if applicable
                           5. apply motion / visibility gate
     wxScene.destroy()   Tear down everything; safe to call after
                         init(). After destroy, init() works fresh.

   Timer accounting:
     _wxTimers.lightningTimeout    setTimeout for next strike
     _wxTimers.crossfadeFallback   setTimeout safety-net for crossfade
                                   cleanup if transitionend skipped
     precip's internal rAF         owned by precip.js; tracked there

   _clearAllTimers() defensively clearTimeout's every slot regardless
   of null state — clearTimeout(null) is a legal no-op per MDN.
   ════════════════════════════════════════════════════════════════════════ */

import { PRESETS } from './presets.js';
import * as precip from './precip.js';

const CROSSFADE_FALLBACK_MS = 1700;   // 1500ms transition + jitter buffer
const LIGHTNING_MIN_MS      = 8000;
const LIGHTNING_MAX_MS      = 18000;

/* TODO(weather): temporary visual fallback. The dedicated render paths
   for partly-cloudy-*, fog, snow, and thunderstorm have artifacts in
   the current legacy CSS scene (cloud band, vertical fog seam, snow
   particles bunched in the upper-left, weak lightning flash). Until
   those are reimplemented (likely WebGL or refined CSS), each entry
   here routes a user-selectable condition to a polished neighbour:
   gray dense sky for fog/snow/thunderstorm, sun-and-blue for
   partly-cloudy-day, moon-and-stars for partly-cloudy-night.

   Removing an entry restores the original render. The Smart Tools
   dropdown is intentionally NOT trimmed so user choice persists in
   localStorage; only the rendered output is mapped.

   Exported (with a leading-underscore name kept verbatim from the
   spec) so src/app.js _wxApply can apply the same mapping when it
   stamps body[data-wx]. Single source of truth — no duplication.

   Pass-through (no mapping): clear-day, clear-night, cloudy, dusk,
   rain, off. */
export const _FALLBACK_MAP = Object.freeze({
  'partly-cloudy-day':   'clear-day',
  'partly-cloudy-night': 'clear-night',
  'fog':                 'cloudy',
  'snow':                'cloudy',
  'thunderstorm':        'cloudy',
});

/* ── Module-private state ─────────────────────────────────────────────── */
const _wxTimers = {
  lightningTimeout:  null,
  crossfadeFallback: null,
};
let _initialized = false;
let _skyA = null, _skyB = null, _canvasEl = null, _lightningEl = null;
let _activeLayer       = null;   // 'a' | 'b' | null
let _currentCondition  = null;
let _currentEngine     = null;
let _currentMotion     = null;
let _currentIntensity  = null;
let _currentPreset     = null;
let _crossfadeCleanup  = null;   // { el, fn } — in-flight transitionend listener
let _mql = null;
let _onVisibilityHandler    = null;
let _onReducedMotionHandler = null;

/* ── Public API ──────────────────────────────────────────────────────── */

export const wxScene = { init, set, destroy };

function init(){
  if(_initialized) return;

  _skyA        = document.querySelector('.wx-scene .wx-sky-a');
  _skyB        = document.querySelector('.wx-scene .wx-sky-b');
  _canvasEl    = document.querySelector('.wx-scene .wx-precip-canvas');
  _lightningEl = document.querySelector('.wx-scene .wx-lightning');

  /* Defensive: if any element is missing (HTML out of sync), bail.
     set() and destroy() become no-ops in that state. */
  if(!_skyA || !_skyB || !_canvasEl || !_lightningEl){
    _skyA = _skyB = _canvasEl = _lightningEl = null;
    return;
  }

  _onVisibilityHandler = _onVisibilityChange;
  document.addEventListener('visibilitychange', _onVisibilityHandler);

  if(window.matchMedia){
    _mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    _onReducedMotionHandler = _onReducedMotionChange;
    /* Pre-sync precip's reduced-motion flag BEFORE any start() so the
       initial particle pool is sized correctly on first set(). */
    precip.setReducedMotion(_mql.matches);
    _mql.addEventListener('change', _onReducedMotionHandler);
  }

  _initialized = true;
}

function set(state){
  if(!_initialized) return;

  /* Phase 1a — prime canvas backing buffer to parent dims. First set()
     after boot is when .wx-scene transitions display:none → display:block
     (because _wxApply stamped body[data-wx] just before this call), so
     this is the first moment parent.getBoundingClientRect() returns
     non-zero. precip.prime is a no-op while a session is active, so
     calling it on every set() is cheap and idempotent — the existing
     ResizeObserver inside start() handles subsequent window resizes. */
  precip.prime(_canvasEl);

  const condition = state && state.condition;
  const intensity = (state && state.intensity) || 'normal';
  const motion    = (state && state.motion)    || 'full';
  const engine    = (state && state.engine)    || 'cinematic';

  /* Off / disabled — full shutdown. */
  if(!condition || condition === 'off'){
    _shutdownActive();
    _currentCondition = 'off';
    _currentEngine    = engine;
    _currentMotion    = motion;
    _currentIntensity = intensity;
    _currentPreset    = null;
    return;
  }

  /* Apply the visual fallback table — see _FALLBACK_MAP comment above.
     `condition` (the local) is the user's request; `renderedCondition`
     is what we actually paint. Tracking `renderedCondition` in
     `_currentCondition` means switching between two requesteds that
     map to the same rendered (e.g. partly-cloudy-day → clear-day
     while clear-day was already active) is correctly a no-op. */
  const requestedCondition = condition;
  const renderedCondition  = _FALLBACK_MAP[requestedCondition] || requestedCondition;

  const preset = PRESETS[renderedCondition];
  if(!preset){
    /* Unknown condition — treat as off so the system fails visibly
       rather than silently hanging in a partial-state. */
    _shutdownActive();
    _currentCondition = 'off';
    _currentPreset    = null;
    return;
  }

  /* Simple engine: legacy CSS-only path. JS does minimal work — kill
     anything cinematic-owned (canvas, lightning timer, A/B layers).
     The existing W2/W3/W4A rules paint the sky via .wx-sky element. */
  if(engine === 'simple'){
    _clearAllTimers();
    _cancelCrossfadeCleanup();
    precip.stop();
    _skyA.classList.remove('is-active');
    _skyB.classList.remove('is-active');
    _canvasEl.classList.remove('is-active');
    _skyA.style.removeProperty('--wx-sky-grad-a');
    _skyB.style.removeProperty('--wx-sky-grad-b');
    _lightningEl.classList.remove('firing');
    _activeLayer = null;
    _currentCondition = renderedCondition;
    _currentEngine    = engine;
    _currentMotion    = motion;
    _currentIntensity = intensity;
    _currentPreset    = preset;
    return;
  }

  /* Cinematic path. */
  const condChanged = (renderedCondition !== _currentCondition)
                   || (engine            !== _currentEngine);
  const intChanged  = (intensity !== _currentIntensity);

  if(condChanged){
    _clearLightning();              // kill pending strike before crossfade
    _runCrossfade(preset);
    if(preset.lightning && _isReducedMotionClear()){
      _scheduleLightning();
    }
  }

  if(condChanged || intChanged){
    if(preset.precip){
      /* precip.start is idempotent — calling while running cleanly
         restarts with new kind/intensity/density. */
      precip.start(_canvasEl, preset.precip.kind, intensity, preset.precip.density);
      _canvasEl.classList.add('is-active');
    } else {
      _canvasEl.classList.remove('is-active');
      precip.stop();
    }
  }

  _currentCondition = renderedCondition;
  _currentEngine    = engine;
  _currentMotion    = motion;
  _currentIntensity = intensity;
  _currentPreset    = preset;

  /* Motion gate runs LAST so it sees the freshly-stored _currentMotion.
     Pauses precip if motion='off' or document.hidden, resumes otherwise. */
  _applyMotionGate();
}

function destroy(){
  if(!_initialized) return;
  _shutdownActive();

  if(_onVisibilityHandler){
    document.removeEventListener('visibilitychange', _onVisibilityHandler);
    _onVisibilityHandler = null;
  }
  if(_mql && _onReducedMotionHandler){
    _mql.removeEventListener('change', _onReducedMotionHandler);
    _onReducedMotionHandler = null;
  }
  _mql = null;
  _skyA = _skyB = _canvasEl = _lightningEl = null;
  _activeLayer       = null;
  _currentCondition  = null;
  _currentEngine     = null;
  _currentMotion     = null;
  _currentIntensity  = null;
  _currentPreset     = null;
  _initialized = false;
}

/* ── Internals ───────────────────────────────────────────────────────── */

function _buildGradient(preset){
  const stops = preset.stops.map(s => `${s.color} ${s.pos}%`).join(', ');
  return `linear-gradient(${preset.angle}deg, ${stops})`;
}

function _clearAllTimers(){
  /* Defensive — clearTimeout(null) is a legal no-op per MDN; calling
     unconditionally guarantees both slots are empty regardless of state. */
  clearTimeout(_wxTimers.lightningTimeout);
  _wxTimers.lightningTimeout = null;
  clearTimeout(_wxTimers.crossfadeFallback);
  _wxTimers.crossfadeFallback = null;
}

function _clearLightning(){
  clearTimeout(_wxTimers.lightningTimeout);
  _wxTimers.lightningTimeout = null;
}

function _isReducedMotionClear(){
  return _mql ? !_mql.matches : true;
}

function _stillThunderstorm(){
  return _currentCondition === 'thunderstorm'
      && _currentEngine    === 'cinematic'
      && _isReducedMotionClear();
}

function _randLightningInterval(){
  return LIGHTNING_MIN_MS + Math.random() * (LIGHTNING_MAX_MS - LIGHTNING_MIN_MS);
}

function _scheduleLightning(){
  /* Atomic recursive setTimeout (per Step 4 clarification 1):
       - id sits in the registry the moment setTimeout returns
         (assignment is synchronous after the setTimeout call in
         single-threaded JS — no race window)
       - id is cleared inside the callback BEFORE fireLightning runs
       - re-arm only after a fresh _stillThunderstorm() check
       - _clearAllTimers() can clearTimeout the slot at any time and
         the chain stops cleanly (the callback's fire is skipped if
         the timeout was cleared; if the callback is already running,
         the post-fire _stillThunderstorm() check prevents re-arm)
  */
  _wxTimers.lightningTimeout = setTimeout(() => {
    _wxTimers.lightningTimeout = null;
    _fireLightning();
    if(_stillThunderstorm()) _scheduleLightning();
  }, _randLightningInterval());
}

function _fireLightning(){
  if(!_lightningEl) return;
  /* Class toggle plays one cycle of W5's wxLightningFire keyframe.
     One-shot animationend listener removes the class so the next
     fireLightning re-triggers cleanly. If animationend never fires
     (element hidden mid-flash, etc.), the stale class is harmless —
     the keyframe ends at opacity 0 and the next fire would have
     re-added the class anyway. No timer needed for cleanup. */
  _lightningEl.classList.add('firing');
  _lightningEl.addEventListener(
    'animationend',
    () => _lightningEl && _lightningEl.classList.remove('firing'),
    { once: true }
  );
}

function _runCrossfade(preset){
  /* Cancel any in-flight cleanup BEFORE setting new gradients. The
     stale cleanup would otherwise fire later and clear the gradient
     we just installed on what it considers the "old" layer. */
  _cancelCrossfadeCleanup();

  const newKey = (_activeLayer === 'a') ? 'b' : 'a';
  const oldKey = (newKey === 'a') ? 'b' : 'a';
  const newEl  = (newKey === 'a') ? _skyA : _skyB;
  const oldEl  = (newKey === 'a') ? _skyB : _skyA;

  /* Set gradient on the inactive (opacity:0) layer — invisible flash
     because the layer isn't painted at the moment of the change. */
  newEl.style.setProperty('--wx-sky-grad-' + newKey, _buildGradient(preset));

  /* Trigger the fade. .is-active flip starts the opacity transition. */
  newEl.classList.add('is-active');
  oldEl.classList.remove('is-active');

  /* Cleanup runs after the new layer reaches opacity 1 (fully covers
     the old) — at that point we can safely clear the old layer's
     inline gradient property without a visible flash. transitionend
     is the primary trigger; the setTimeout safety-net mirrors the
     repo idiom (app.js:2581 / app.js:2814) for the case where
     transitionend is skipped (tab blur during transition, parent
     hidden mid-fade, etc.).

     cleanup is declared before onTransEnd because onTransEnd's body
     calls cleanup; both consts must be defined by the time either
     is invoked, which they are (synchronous declarations). */
  const cleanup = () => {
    newEl.removeEventListener('transitionend', onTransEnd);
    clearTimeout(_wxTimers.crossfadeFallback);
    _wxTimers.crossfadeFallback = null;
    _crossfadeCleanup = null;
    oldEl.style.removeProperty('--wx-sky-grad-' + oldKey);
  };
  const onTransEnd = (e) => {
    if(e.propertyName !== 'opacity') return;
    cleanup();
  };
  newEl.addEventListener('transitionend', onTransEnd);
  _wxTimers.crossfadeFallback = setTimeout(cleanup, CROSSFADE_FALLBACK_MS);
  _crossfadeCleanup = { el: newEl, fn: onTransEnd };

  _activeLayer = newKey;
}

function _cancelCrossfadeCleanup(){
  if(_crossfadeCleanup){
    _crossfadeCleanup.el.removeEventListener('transitionend', _crossfadeCleanup.fn);
    _crossfadeCleanup = null;
  }
  clearTimeout(_wxTimers.crossfadeFallback);
  _wxTimers.crossfadeFallback = null;
}

function _applyMotionGate(){
  if(!_currentPreset || !_currentPreset.precip) return;
  if(document.hidden || _currentMotion === 'off'){
    precip.pause();
  } else {
    precip.resume();
  }
}

function _shutdownActive(){
  _clearAllTimers();
  _cancelCrossfadeCleanup();
  precip.stop();
  if(_skyA){
    _skyA.classList.remove('is-active');
    _skyA.style.removeProperty('--wx-sky-grad-a');
  }
  if(_skyB){
    _skyB.classList.remove('is-active');
    _skyB.style.removeProperty('--wx-sky-grad-b');
  }
  if(_canvasEl)    _canvasEl.classList.remove('is-active');
  if(_lightningEl) _lightningEl.classList.remove('firing');
  _activeLayer = null;
}

function _onVisibilityChange(){
  if(document.hidden){
    document.body.setAttribute('data-wx-paused', '1');
    precip.pause();
  } else {
    document.body.removeAttribute('data-wx-paused');
    /* Honour an active motion='off' override even when becoming
       visible — the user explicitly asked for no motion. The next
       set() call (or motion-mode change) will resume if appropriate. */
    if(_currentMotion !== 'off') precip.resume();
  }
}

function _onReducedMotionChange(e){
  /* Pending lightning strike must not fire under reduced motion. */
  _clearLightning();
  precip.setReducedMotion(e.matches);
  /* If the system flipped FROM reduced TO normal and we're still on
     thunderstorm, re-arm the scheduler — otherwise lightning stays
     dead until the next set() call. NOT in the Step 6 spec but is
     the only way to make reduced-motion truly live for thunderstorm. */
  if(!e.matches && _stillThunderstorm()){
    _scheduleLightning();
  }
}
