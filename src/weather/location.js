/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Active Location State

   Owns the single active Location for weather lookups. Provides
   geolocation-based first-run resolution, reverse-geocoded city
   lookup, and a small subscriber API so autoRefresh and the chip
   stay in sync without polling.

   Persistence is NOT owned here — the location object travels under
   the existing `spicaTide_weather` envelope managed by _wxLoad /
   _wxSave in src/app.js. This module is the runtime accessor;
   localStorage is the authority across sessions. At boot, app.js
   reads storage and calls hydrate() to seed _state without firing
   listeners. After that, setLocation() is the user-action path
   and DOES fire listeners (app.js subscribes once to mirror the
   change back into _wxState and call _wxSave).

   Public API:
     resolveInitialLocation()    → Promise<Location | null>
                                   Geolocation + reverse geocode.
                                   Resolves null on user-deny,
                                   timeout, or no reverse match.
                                   Does NOT mutate state — caller
                                   decides whether to setLocation().
     setLocation(input)          → void
                                   Accepts CityResult (manual pick)
                                   or Location (geo path). Mutates
                                   _state and fires listeners.
     getLocation()               → Location | null
     hydrate(loc)                → void
                                   One-shot boot seed from storage.
                                   Does NOT fire listeners.
     onLocationChange(fn)        → unsubscribe function
                                   Returns () => void. Internal
                                   handler set is a Set, so unsub
                                   is just a Set.delete.

   Online/offline handling lives in autoRefresh.js, NOT here. The
   refresh action is autoRefresh's responsibility, and importing
   it from this module would create a cycle (autoRefresh imports
   getLocation()).

   Location shape:
     {
       source:      'geo' | 'manual',
       name:        string,   // 'Peterhead'
       region:      string,   // 'Scotland'
       country:     string,   // 'United Kingdom'
       countryCode: string,   // 'GB'
       lat:         number,
       lng:         number,
       resolvedAt:  number    // Date.now() at last set
     }
   ════════════════════════════════════════════════════════════════════════ */

import { reverseGeocode } from './api.js';

const GEO_TIMEOUT_MS = 10000;

const _state = { current: null };

/* Subscriber API — Set so each handler is registered exactly once
   and unsubscribe is O(1). The unsub closure captures the handler
   reference, NOT a token, so callers can also detach by passing
   the same fn back into a hypothetical removeListener — but the
   returned closure is the documented path. */
const _listeners = new Set();

function _emit(){
  /* Iterate a snapshot so a handler that unsubscribes during emit
     doesn't perturb the live Set mid-iteration. Each handler is
     wrapped in try/catch — one bad subscriber must not block the
     rest from being notified. */
  const snapshot = Array.from(_listeners);
  for(const fn of snapshot){
    try{ fn(_state.current); }
    catch(err){
      if(window.DEV) console.warn('[wx-location] listener threw', err);
    }
  }
}

/* Internal — coerce a CityResult or Location-like object into a
   canonical Location. Defaults source='manual' (the city-search
   path) when not specified; the geo path passes source='geo'
   explicitly. resolvedAt is always stamped at set time, even if
   the input carries an older value, so the chip's stale-after-1h
   logic measures from "user-active" rather than "geocode-fetched". */
function _toLocation(input, defaultSource){
  if(!input) return null;
  if(typeof input.lat !== 'number' || typeof input.lng !== 'number') return null;
  if(typeof input.name !== 'string' || !input.name) return null;
  return {
    source:      input.source === 'geo' ? 'geo' : (defaultSource || 'manual'),
    name:        input.name,
    region:      typeof input.region === 'string' ? input.region : '',
    country:     typeof input.country === 'string' ? input.country : '',
    countryCode: typeof input.countryCode === 'string' ? input.countryCode : '',
    lat:         input.lat,
    lng:         input.lng,
    resolvedAt:  Date.now(),
  };
}

/* Internal — Promise wrapper around navigator.geolocation. Resolves
   to GeolocationPosition.coords on success, null on user-deny,
   timeout, or unsupported. Does NOT throw. */
function _getGeoCoords(){
  return new Promise((resolve) => {
    if(!('geolocation' in navigator)){
      if(window.DEV) console.warn('[wx-location] geolocation unsupported');
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (val) => { if(!settled){ settled = true; resolve(val); } };

    navigator.geolocation.getCurrentPosition(
      (pos) => finish(pos && pos.coords ? pos.coords : null),
      (err) => {
        if(window.DEV) console.warn('[wx-location] geo failed', err && err.code, err && err.message);
        finish(null);
      },
      {
        enableHighAccuracy: false,
        timeout:            GEO_TIMEOUT_MS,
        /* TODO: maximumAge of 1 hour is fine for port-level resolution.
           When GPS-based vessel position tracking is added, reduce this
           to ~5 minutes since the ship can move significantly within
           an hour. */
        maximumAge:         3600 * 1000,
      }
    );
  });
}

/* ───────────────────────────── Public API ───────────────────────────── */

/* First-run / "Use my current location" entrypoint.
   Pipeline:
     1. navigator.geolocation.getCurrentPosition (10s timeout)
     2. on success → reverseGeocode(lat, lng)
     3. on success → build Location with source='geo'
   Any failure along the way resolves to null and the caller (app.js)
   opens the city-search overlay. Never throws, never blocks boot —
   call it without await on the boot path if instant render is more
   important than waiting for a GPS fix. */
export async function resolveInitialLocation(){
  const coords = await _getGeoCoords();
  if(!coords) return null;
  if(typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') return null;

  const city = await reverseGeocode(coords.latitude, coords.longitude);
  if(!city) return null;

  /* reverseGeocode returns lat/lng from the geocoder (the city
     centroid), not the device's actual coords. Prefer the geocoder
     coords for consistency with the city the user sees in the chip
     — fetchWeather is then keyed to the city, not to whatever
     building the device thinks it's in. */
  return _toLocation(city, 'geo');
}

/* User-driven set. Fires listeners (app.js mirrors into _wxState
   and persists; autoRefresh resets its polling timer and fetches).
   Accepts a CityResult from searchCities OR a Location from
   resolveInitialLocation — _toLocation normalises both. */
export function setLocation(input){
  const loc = _toLocation(input, 'manual');
  if(!loc) return;
  _state.current = loc;
  _emit();
}

/* Read the current active location. May be null if first-run flow
   has not completed yet or the user denied geolocation and hasn't
   picked a city. */
export function getLocation(){
  return _state.current;
}

/* Boot-time seed from localStorage. Bypasses listeners — at boot
   there is nothing to mirror back, and firing would cause the
   subscriber in app.js to redundantly _wxSave the same data. The
   input object is shallow-copied so external mutation of the
   storage-derived object doesn't leak into _state. */
export function hydrate(loc){
  if(!loc) return;
  if(typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return;
  if(typeof loc.name !== 'string' || !loc.name) return;
  _state.current = {
    source:      loc.source === 'geo' ? 'geo' : 'manual',
    name:        loc.name,
    region:      typeof loc.region === 'string' ? loc.region : '',
    country:     typeof loc.country === 'string' ? loc.country : '',
    countryCode: typeof loc.countryCode === 'string' ? loc.countryCode : '',
    lat:         loc.lat,
    lng:         loc.lng,
    resolvedAt:  typeof loc.resolvedAt === 'number' ? loc.resolvedAt : Date.now(),
  };
}

/* Subscribe to location changes.
   Usage:
     const unsub = onLocationChange((loc) => { ... });
     // ...later:
     unsub();
   Internally a Set; unsubscribe removes the handler. Calling unsub
   more than once is a safe no-op. */
export function onLocationChange(fn){
  if(typeof fn !== 'function') return () => {};
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
