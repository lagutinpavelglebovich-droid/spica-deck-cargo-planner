/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Weather Precipitation (canvas engine)

   Pure module. No DOM queries outside the canvas it's handed. Imported
   by src/weather/index.js.

   Public API:
     start(canvas, kind, intensity, density)
        kind:      'rain' | 'snow'
        intensity: 'subtle' | 'normal' | 'strong'   (wxState.intensity)
        density:   number, preset density multiplier (default 1.0)
        Idempotent — calling start() while running is a clean restart.
     stop()
        Cancels rAF, disconnects ResizeObserver, nulls particle pool,
        clears canvas. Module returns to its initial state; start() can
        be called again without leaks.
     pause()
        Freezes rAF without losing particle state.
     resume()
        Restarts loop from current state. No-op under reduced motion.
     resize(w, h, dpr)
        Re-fits canvas (DPR-correct) and reseeds particles.
     setReducedMotion(matches)
        Live-update entry point for the matchMedia listener in index.js.
        Drops to ~25% count + single static frame; restoring brings the
        loop back. Safe to call before start().

   Count math:
     count = baseCount × (areaW × areaH) / (1920 × 1080)
                       × intensityMul[intensity]
                       × density
                       × (reducedMotion ? 0.25 : 1)
     baseCount: rain = 150, snow = 120 (both at 1080p reference)
     intensityMul: subtle 0.4, normal 1.0, strong 1.6

   Timer accounting:
     The only timer in this module is one requestAnimationFrame id.
     No setInterval, no setTimeout. ResizeObserver isn't a timer but
     is tracked the same way and disconnected on stop().

   Failure mode:
     If canvas.getContext('2d') returns null, start() bails silently
     and leaves the canvas blank. Per the W5 hard-fails-visible policy,
     empty sky is preferable to a hidden fallback that masks the bug.
   ════════════════════════════════════════════════════════════════════════ */

/* ── Tunables ─────────────────────────────────────────────────────────── */
const INTENSITY_MUL    = { subtle: 0.4, normal: 1.0, strong: 1.6 };
const REDUCED_MUL      = 0.25;
const REF_AREA         = 1920 * 1080;

const RAIN_BASE_1080P  = 150;
const RAIN_ANGLE_DEG   = 15;
const RAIN_VY_MIN      = 720;   // px/sec, CSS units
const RAIN_VY_MAX      = 1040;
const RAIN_LEN_MIN     = 12;    // streak length, px
const RAIN_LEN_MAX     = 22;
const RAIN_COLOR       = 'rgba(186, 206, 226, 0.55)';
const RAIN_LINE_W      = 1.1;

const SNOW_BASE_1080P  = 120;
const SNOW_VY_MIN      = 32;
const SNOW_VY_MAX      = 92;
const SNOW_R_MIN       = 1.4;   // flake radius, px
const SNOW_R_MAX       = 3.4;
const SNOW_AMP_MIN     = 8;     // sine-drift amplitude, px
const SNOW_AMP_MAX     = 28;
const SNOW_PHASE_SPD_MIN = 0.5; // rad/sec
const SNOW_PHASE_SPD_MAX = 1.5;
const SNOW_COLOR       = 'rgba(255, 255, 255, 0.78)';

/* Pre-resolved rain geometry. The 15° angle is uniform across particles
   so we precompute the streak unit-vector once at module load and the
   per-frame loop only needs per-particle vy and len. */
const _RAD = RAIN_ANGLE_DEG * Math.PI / 180;
const RAIN_VX_PER_VY = -Math.tan(_RAD);   // negative = leftward fall lean
const STREAK_DX      =  Math.sin(_RAD);   // streak trails up-right of head
const STREAK_DY      = -Math.cos(_RAD);

/* ── Module-private state ─────────────────────────────────────────────── */
let _canvas = null;
let _ctx    = null;
let _kind   = null;
let _intensity = 'normal';
let _density   = 1.0;
let _w = 0, _h = 0, _dpr = 1;
let _rafId  = null;
let _ro     = null;
let _paused = false;
let _reducedMotion = false;
let _lastT  = 0;
let _N      = 0;

/* Particle arrays — Float32Array, allocated per-kind in _initParticles().
   Shared across kinds: _x, _y, _vy, _r. Snow-only: _amp, _phase, _phaseSpd. */
let _x = null, _y = null, _vy = null, _r = null;
let _amp = null, _phase = null, _phaseSpd = null;

/* ── Public API ──────────────────────────────────────────────────────── */

export function start(canvas, kind, intensity, density){
  if(_canvas) stop();   // idempotent restart

  const ctx = canvas.getContext('2d');
  if(!ctx) return;      // hard-fails-visible: empty sky is the signal

  _canvas    = canvas;
  _ctx       = ctx;
  _kind      = (kind === 'snow') ? 'snow' : 'rain';
  _intensity = INTENSITY_MUL[intensity] != null ? intensity : 'normal';
  _density   = (typeof density === 'number' && density > 0) ? density : 1.0;
  _paused    = false;

  /* getBoundingClientRect returns 0×0 if any ancestor is display:none
     (e.g. body.pdf-capture .wx-scene). _initParticles seeds with 1
     particle in that case — a benign no-op that self-heals: the
     ResizeObserver below fires once the parent un-hides, resize() is
     called with real dimensions, and the pool is reseeded correctly. */
  const r = canvas.getBoundingClientRect();
  resize(r.width, r.height, window.devicePixelRatio || 1);

  _ro = new ResizeObserver(_onResize);
  _ro.observe(canvas);

  if(_reducedMotion){
    _paintFrame(0);     // single static frame, no rAF
  } else {
    _lastT = performance.now();
    _rafId = requestAnimationFrame(_frame);
  }
}

export function stop(){
  if(_rafId !== null){ cancelAnimationFrame(_rafId); _rafId = null; }
  if(_ro){ _ro.disconnect(); _ro = null; }
  if(_ctx) _ctx.clearRect(0, 0, _w, _h);
  _x = _y = _vy = _r = _amp = _phase = _phaseSpd = null;
  _canvas = null; _ctx = null; _kind = null;
  _intensity = 'normal'; _density = 1.0;
  _w = 0; _h = 0; _dpr = 1; _N = 0;
  _paused = false;
  /* _reducedMotion is intentionally preserved — it tracks a system
     setting, not a per-engine session, and a fresh start() should
     respect the latest known value. */
}

export function pause(){
  if(!_canvas || _paused) return;
  _paused = true;
  if(_rafId !== null){ cancelAnimationFrame(_rafId); _rafId = null; }
}

export function resume(){
  if(!_canvas || !_paused) return;
  _paused = false;
  if(_reducedMotion) return;   // static mode never re-enters the loop
  _lastT = performance.now();
  _rafId = requestAnimationFrame(_frame);
}

export function resize(w, h, dpr){
  if(!_canvas) return;
  _w   = Math.max(1, w);
  _h   = Math.max(1, h);
  _dpr = Math.max(1, dpr || 1);
  _canvas.width        = Math.round(_w * _dpr);
  _canvas.height       = Math.round(_h * _dpr);
  _canvas.style.width  = _w + 'px';
  _canvas.style.height = _h + 'px';
  /* setTransform replaces ctx.scale so resize is idempotent — successive
     resizes don't compound the DPR scale factor. */
  _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
  _initParticles();
  if(_reducedMotion) _paintFrame(0);
}

/* Phase 1a — Size the canvas backing buffer to its parent .wx-scene so
   the canvas is render-ready BEFORE any precipitation session begins.
   Two reasons this matters:
     1. <canvas> default intrinsic size is 300×150; without an inline
        width/height attribute, drawing operations are clipped to that
        box even after the CSS display box matches the parent.
     2. On retina, the backing buffer must be parent dims × DPR for
        sharp output; setTransform(dpr,…) maps logical px → device px.
   No-op while a session is active — start()/resize() own the canvas
   then. Idempotent and safe to call multiple times. */
export function prime(canvas){
  if(_canvas)  return;            // active session → resize() owns sizing
  if(!canvas)  return;
  const parent = canvas.parentElement;
  if(!parent)  return;
  const rect   = parent.getBoundingClientRect();
  if(rect.width === 0 || rect.height === 0) return;
  const dpr    = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  if(ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function setReducedMotion(matches){
  const m = !!matches;
  if(m === _reducedMotion) return;
  _reducedMotion = m;
  if(!_canvas) return;          // safe before start(); flag persists

  if(_reducedMotion){
    if(_rafId !== null){ cancelAnimationFrame(_rafId); _rafId = null; }
    _initParticles();
    _paintFrame(0);
  } else {
    _initParticles();
    if(!_paused){
      _lastT = performance.now();
      _rafId = requestAnimationFrame(_frame);
    }
  }
}

/* ── Internals ───────────────────────────────────────────────────────── */

function _onResize(entries){
  /* Self-healing path: when the canvas's parent transitions from
     display:none to visible (e.g. exiting body.pdf-capture mode),
     the contentRect arrives non-zero and we reseed at full size.
     Until then, _N stays at 1 and the canvas is invisible anyway. */
  const e = entries[0];
  if(!e) return;
  const cr = e.contentRect;
  resize(cr.width, cr.height, window.devicePixelRatio || 1);
}

function _computeCount(){
  const base   = (_kind === 'rain') ? RAIN_BASE_1080P : SNOW_BASE_1080P;
  const scale  = (_w * _h) / REF_AREA;
  const intMul = INTENSITY_MUL[_intensity] || 1.0;
  const redMul = _reducedMotion ? REDUCED_MUL : 1.0;
  return Math.max(1, Math.round(base * scale * intMul * _density * redMul));
}

function _initParticles(){
  _N = _computeCount();
  _x  = new Float32Array(_N);
  _y  = new Float32Array(_N);
  _vy = new Float32Array(_N);
  _r  = new Float32Array(_N);

  if(_kind === 'rain'){
    _amp = _phase = _phaseSpd = null;
    for(let i = 0; i < _N; i++){
      _x[i]  = Math.random() * _w;
      _y[i]  = Math.random() * _h;
      _vy[i] = RAIN_VY_MIN + Math.random() * (RAIN_VY_MAX - RAIN_VY_MIN);
      _r[i]  = RAIN_LEN_MIN + Math.random() * (RAIN_LEN_MAX - RAIN_LEN_MIN);
    }
  } else {
    _amp      = new Float32Array(_N);
    _phase    = new Float32Array(_N);
    _phaseSpd = new Float32Array(_N);
    for(let i = 0; i < _N; i++){
      _x[i]        = Math.random() * _w;   // baseX (oscillation centre)
      _y[i]        = Math.random() * _h;
      _vy[i]       = SNOW_VY_MIN + Math.random() * (SNOW_VY_MAX - SNOW_VY_MIN);
      _r[i]        = SNOW_R_MIN  + Math.random() * (SNOW_R_MAX  - SNOW_R_MIN);
      _amp[i]      = SNOW_AMP_MIN + Math.random() * (SNOW_AMP_MAX - SNOW_AMP_MIN);
      _phase[i]    = Math.random() * Math.PI * 2;
      _phaseSpd[i] = SNOW_PHASE_SPD_MIN + Math.random() * (SNOW_PHASE_SPD_MAX - SNOW_PHASE_SPD_MIN);
    }
  }
}

function _frame(t){
  if(_paused){ _rafId = null; return; }
  /* Clamp dt to 50ms. On tab-restore, performance timestamps can jump
     by seconds and uncorrected dt would teleport every particle to
     the bottom of the screen on the first frame back. 50ms = 3×16.6ms,
     enough to absorb a few skipped frames without visible lurch. */
  const dt = Math.min(0.05, (t - _lastT) / 1000);
  _lastT = t;
  _paintFrame(dt);
  _rafId = requestAnimationFrame(_frame);
}

function _paintFrame(dt){
  _ctx.clearRect(0, 0, _w, _h);
  if(_kind === 'rain') _stepRain(dt);
  else                 _stepSnow(dt);
}

function _stepRain(dt){
  _ctx.strokeStyle = RAIN_COLOR;
  _ctx.lineWidth   = RAIN_LINE_W;
  _ctx.lineCap     = 'round';
  _ctx.beginPath();
  for(let i = 0; i < _N; i++){
    const vy = _vy[i];
    _x[i] += vy * RAIN_VX_PER_VY * dt;
    _y[i] += vy * dt;
    const len = _r[i];
    if(_y[i] > _h){
      _y[i] = -len;
      _x[i] = Math.random() * (_w + len);
    }
    /* Streak head at (_x, _y), tail at (_x + STREAK_DX×len, _y + STREAK_DY×len).
       STREAK_DY is negative so the tail trails upward of the head. */
    _ctx.moveTo(_x[i], _y[i]);
    _ctx.lineTo(_x[i] + STREAK_DX * len, _y[i] + STREAK_DY * len);
  }
  _ctx.stroke();
}

function _stepSnow(dt){
  _ctx.fillStyle = SNOW_COLOR;
  _ctx.beginPath();
  for(let i = 0; i < _N; i++){
    _phase[i] += _phaseSpd[i] * dt;
    _y[i]     += _vy[i] * dt;
    if(_y[i] > _h + _r[i]){
      _y[i] = -_r[i];
      _x[i] = Math.random() * _w;          // re-seed baseX on wrap
    }
    /* x = baseX + sin(phase) × amp — oscillates around the seed x without
       drifting in one direction over time. */
    const x = _x[i] + Math.sin(_phase[i]) * _amp[i];
    _ctx.moveTo(x + _r[i], _y[i]);
    _ctx.arc(x, _y[i], _r[i], 0, Math.PI * 2);
  }
  _ctx.fill();
}
