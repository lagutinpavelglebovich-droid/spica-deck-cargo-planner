/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Weather Auto-Refresh

   Owns the polling loop, the in-memory + localStorage weather cache,
   and the visibility / online lifecycle hooks. Renders nothing
   directly — emits via onWeatherChange and lets src/app.js _wxApply
   reconcile with body[data-wx] / wxScene / chip in one place.

   Public API:
     start()                     → void
                                   Begin polling loop. Hydrates from
                                   localStorage into _cache and emits
                                   immediately so the chip populates
                                   from cache without a network round
                                   trip. Schedules first poll with
                                   delay 0 — the polling timer is
                                   what performs the first fetch, so
                                   start() never itself awaits the
                                   network. Idempotent: re-calling
                                   while already started just re-emits
                                   cached for instant chip render.
     stop()                      → void
                                   Cancel poll timer, clear _started.
                                   Cache is preserved in storage so
                                   the next start() boots warm.
     refreshNow()                → Promise<boolean>
                                   Force a fetch now, reset the poll
                                   timer relative to this fetch.
                                   Returns true if data was updated,
                                   false on any failure (offline,
                                   timeout, no active location).
     getCachedWeather()          → NormalizedWeather | null
     onWeatherChange(fn)         → unsubscribe function
                                   Set-backed; identical pattern to
                                   onLocationChange in location.js.

   Triggers that reset the poll timer to "first fetch + 20min next":
     - location change (auto-subscribed via onLocationChange)
     - manual refreshNow() (user-driven, e.g. chip refresh button,
       or app.js after setLocation in cases where the location
       subscriber path wasn't enough)
     - return-to-visible after sleep, IF stale (>20min)
     - return-to-online, IF stale (>20min)

   Cache:
     localStorage 'spicaTide_weather_cache'
     { location: { name, lat, lng }, weather: NormalizedWeather }
     Invalidated when active location's name+lat+lng differs from
     cached. Storage failures are tolerated — cache is an optim,
     not a source of truth.

   Polling cadence is setTimeout-chained, not setInterval — so a
   sleeping laptop or a backgrounded tab doesn't queue a burst of
   missed ticks on resume. _lastFetchAt anchors the next interval
   so cadence is "20min after last success", not absolute clock.
   ════════════════════════════════════════════════════════════════════════ */

import { fetchWeather } from './api.js';
import { getLocation, onLocationChange } from './location.js';

const POLL_INTERVAL_MS = 20 * 60 * 1000;
const STALE_MS         = 20 * 60 * 1000;
const CACHE_KEY        = 'spicaTide_weather_cache';

const _state = {
  cache:        null,    // NormalizedWeather | null
  cacheLocKey:  null,    // 'name|lat|lng' for invalidation match
  pollTimer:    null,    // setTimeout handle
  started:      false,
  lastFetchAt:  0,
  inFlight:     false,   // guard against overlapping fetches
};

const _listeners = new Set();

function _emit(weather){
  const snapshot = Array.from(_listeners);
  for(const fn of snapshot){
    try{ fn(weather); }
    catch(err){
      if(window.DEV) console.warn('[wx-autorefresh] listener threw', err);
    }
  }
}

/* Internal — build the location key used to detect cache staleness
   when the active location changes. Coordinate equality uses raw
   numbers (no rounding) — a 0.0001° drift would be a different
   geocoded centroid and we'd want a fresh fetch anyway. */
function _locKey(loc){
  if(!loc) return null;
  return `${loc.name}|${loc.lat}|${loc.lng}`;
}

/* Internal — load cache from localStorage on first start(). On
   schema mismatch or storage unavailable, _cache stays null; the
   next successful fetch will overwrite. */
function _hydrateCacheFromStorage(){
  let raw = null;
  try{ raw = localStorage.getItem(CACHE_KEY); }
  catch(e){ return; }
  if(!raw) return;

  let parsed = null;
  try{ parsed = JSON.parse(raw); }
  catch(e){ return; }
  if(!parsed || !parsed.location || !parsed.weather) return;

  /* Validate the cached location matches the active one. If the
     user switched cities while offline last session, we should not
     present old-city weather as if it were the new city's. */
  const active = getLocation();
  if(!active) return;
  const cachedKey = _locKey(parsed.location);
  const activeKey = _locKey(active);
  if(cachedKey !== activeKey) return;

  _state.cache = parsed.weather;
  _state.cacheLocKey = cachedKey;
  _state.lastFetchAt = (parsed.weather && parsed.weather.fetchedAt) || 0;
}

function _persistCache(loc, weather){
  try{
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      location: { name: loc.name, lat: loc.lat, lng: loc.lng },
      weather,
    }));
  } catch(e){ /* quota / private mode — non-fatal */ }
}

function _clearTimer(){
  if(_state.pollTimer != null){
    clearTimeout(_state.pollTimer);
    _state.pollTimer = null;
  }
}

/* Internal — schedule the next poll. Chained setTimeout (not
   setInterval) so a tab that sleeps doesn't accumulate a burst of
   missed ticks, and so the cadence is anchored to the last
   successful fetch rather than absolute clock time. */
function _schedulePoll(delayMs){
  _clearTimer();
  if(!_state.started) return;
  if(document.hidden) return;   // resume will re-schedule
  _state.pollTimer = setTimeout(_pollTick, Math.max(0, delayMs));
}

async function _pollTick(){
  _state.pollTimer = null;
  await _doFetch();
  _schedulePoll(POLL_INTERVAL_MS);
}

/* Internal — single fetch + cache + emit. Returns true on success.
   Concurrency-guarded so a fast double-tap of the refresh button
   doesn't issue two parallel requests; the second call short-
   circuits to false. */
async function _doFetch(){
  if(_state.inFlight) return false;
  const loc = getLocation();
  if(!loc) return false;

  _state.inFlight = true;
  let weather = null;
  try{
    weather = await fetchWeather(loc.lat, loc.lng);
  } finally {
    _state.inFlight = false;
  }
  if(!weather) return false;

  _state.cache       = weather;
  _state.cacheLocKey = _locKey(loc);
  _state.lastFetchAt = Date.now();
  _persistCache(loc, weather);
  _emit(weather);
  return true;
}

/* ───────────────────────────── Lifecycle hooks ───────────────────────── */

/* Visibility — pause when hidden, resume on visible. If we were
   gone long enough that the cached fetch is stale (>20min), do a
   refresh now instead of waiting for the scheduled tick. */
document.addEventListener('visibilitychange', () => {
  if(!_state.started) return;
  if(document.hidden){
    _clearTimer();
    return;
  }
  const age = Date.now() - _state.lastFetchAt;
  if(age >= STALE_MS) _schedulePoll(0);
  else                _schedulePoll(STALE_MS - age);
});

/* Online — when the network returns, refresh immediately if the
   last successful fetch is stale. If we just blipped offline for
   30 seconds, no need to spam the API. The 20-min staleness gate
   matches the polling cadence so the user never sees data older
   than one cycle. */
window.addEventListener('online', () => {
  if(!_state.started) return;
  const age = Date.now() - _state.lastFetchAt;
  if(age >= STALE_MS) _schedulePoll(0);
});

/* Location change — clear cache (it's keyed to the old city),
   reset the timer, fetch immediately. This is the auto-trigger
   behavior approved in Q4: when the user picks a new city, they
   see new-city weather without waiting up to 20 minutes. */
onLocationChange((loc) => {
  if(!_state.started) return;
  const newKey = _locKey(loc);
  if(newKey === _state.cacheLocKey) return;   // same place, no-op
  _state.cache = null;
  _state.cacheLocKey = null;
  _state.lastFetchAt = 0;
  _emit(null);                                // chip can show "—" until fetch lands
  _schedulePoll(0);
});

/* ───────────────────────────── Public API ───────────────────────────── */

export function start(){
  if(_state.started){
    /* Idempotent re-entry: re-emit cached so chip can re-populate
       (e.g. after _wxState.enabled was toggled off then on and the
       chip was cleared). Do not schedule a second timer. */
    _emit(_state.cache);
    return;
  }
  _state.started = true;

  /* Hydrate from localStorage so the chip can render instantly
     from last-session data. If the cache is for a different city,
     it's discarded inside _hydrateCacheFromStorage. */
  if(!_state.cache) _hydrateCacheFromStorage();

  _emit(_state.cache);

  /* First poll fires immediately (delay 0). The poll itself is
     what hits the network — start() never awaits a fetch. This
     matches the "no double-fetch" guarantee from Step 2. */
  _schedulePoll(0);
}

export function stop(){
  _state.started = false;
  _clearTimer();
}

export async function refreshNow(){
  _clearTimer();
  const ok = await _doFetch();
  /* Reset cadence relative to this fetch — user-initiated refresh
     should not still trigger a "regular" tick 30 seconds later. */
  _schedulePoll(POLL_INTERVAL_MS);
  return ok;
}

export function getCachedWeather(){
  return _state.cache;
}

export function onWeatherChange(fn){
  if(typeof fn !== 'function') return () => {};
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
