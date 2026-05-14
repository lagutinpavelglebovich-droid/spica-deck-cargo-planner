/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Weather API (Open-Meteo wrapper)

   Imported by location.js (geocoding + reverse geocoding) and
   autoRefresh.js (forecast). All three exported functions are total:
   they catch every failure mode (network, abort, HTTP non-200, JSON
   parse, missing fields) and return `null` (or `[]` for searchCities)
   instead of throwing. The caller never needs try/catch.

   Public API:
     fetchWeather(lat, lng)        → Promise<NormalizedWeather | null>
     searchCities(query)           → Promise<CityResult[]>
     reverseGeocode(lat, lng)      → Promise<CityResult | null>

   Endpoints (no API key required, CORS-friendly, free for commercial):
     Geocoding   https://geocoding-api.open-meteo.com/v1/search
     Reverse     https://geocoding-api.open-meteo.com/v1/reverse
     Forecast    https://api.open-meteo.com/v1/forecast

   Wind speed: ALWAYS knots. The forecast URL pins
   `wind_speed_unit=kn` (maritime convention). Do not change.

   Timeout: 8 seconds per call, enforced via AbortController. Slower
   networks fail closed — the chip keeps showing last cached data
   rather than spinning forever.

   Debug logging gated by `window.DEV === true`. Production must stay
   quiet so API content never leaks into devtools captures.
   ════════════════════════════════════════════════════════════════════════ */

const TIMEOUT_MS = 8000;

const URL_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const URL_REVERSE = 'https://geocoding-api.open-meteo.com/v1/reverse';
const URL_FORECAST = 'https://api.open-meteo.com/v1/forecast';

/* Internal — AbortController-wrapped fetch with hard timeout.
   Returns parsed JSON on 2xx, or null on any failure. Never throws.
   Failure modes covered:
     - network error (offline, DNS, refused)
     - timeout (AbortError after TIMEOUT_MS)
     - HTTP non-2xx (4xx, 5xx)
     - JSON parse error
   `label` is used only for DEV-mode logging context. */
async function _safeFetch(url, label){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try{
    const res = await fetch(url, { signal: ctrl.signal });
    if(!res.ok){
      if(window.DEV) console.warn(`[wx-api] ${label} HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    return json;
  } catch(err){
    if(window.DEV){
      const reason = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'error';
      console.warn(`[wx-api] ${label} failed: ${reason}`);
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* Internal — WMO weather_code → app condition + intensity.
   Source: WMO Code Table 4677 as exposed by Open-Meteo.
   The day/night split is applied by the caller using is_day from
   the API response. Anything not in the table maps to cloudy/normal
   so the renderer always has a valid PRESETS key. */
function _wmoToCondition(code, isDay){
  const day = isDay ? 'day' : 'night';
  switch(code){
    case 0:  return { condition: `clear-${day}`,          intensity: 'normal' };
    case 1:
    case 2:  return { condition: `partly-cloudy-${day}`,  intensity: 'normal' };
    case 3:  return { condition: 'cloudy',                intensity: 'normal' };
    case 45:
    case 48: return { condition: 'fog',                   intensity: 'normal' };
    /* Drizzle */
    case 51: return { condition: 'rain', intensity: 'subtle' };
    case 53: return { condition: 'rain', intensity: 'normal' };
    case 55: return { condition: 'rain', intensity: 'strong' };
    /* Freezing drizzle */
    case 56:
    case 57: return { condition: 'rain', intensity: 'normal' };
    /* Rain */
    case 61: return { condition: 'rain', intensity: 'subtle' };
    case 63: return { condition: 'rain', intensity: 'normal' };
    case 65: return { condition: 'rain', intensity: 'strong' };
    /* Freezing rain */
    case 66:
    case 67: return { condition: 'rain', intensity: 'normal' };
    /* Snowfall */
    case 71: return { condition: 'snow', intensity: 'subtle' };
    case 73: return { condition: 'snow', intensity: 'normal' };
    case 75: return { condition: 'snow', intensity: 'strong' };
    /* Snow grains */
    case 77: return { condition: 'snow', intensity: 'subtle' };
    /* Rain showers */
    case 80: return { condition: 'rain', intensity: 'subtle' };
    case 81: return { condition: 'rain', intensity: 'normal' };
    case 82: return { condition: 'rain', intensity: 'strong' };
    /* Snow showers */
    case 85: return { condition: 'snow', intensity: 'normal' };
    case 86: return { condition: 'snow', intensity: 'strong' };
    /* Thunderstorm */
    case 95: return { condition: 'thunderstorm', intensity: 'normal' };
    case 96:
    case 99: return { condition: 'thunderstorm', intensity: 'strong' };
    default: return { condition: 'cloudy', intensity: 'normal' };
  }
}

/* Internal — coerce a Open-Meteo geocoding result row to our
   CityResult shape. Returns null if any required field is missing.
   Open-Meteo result rows look like:
     { id, name, latitude, longitude, country, country_code,
       admin1, admin2, ..., population } */
function _toCityResult(row){
  if(!row) return null;
  if(typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return null;
  if(typeof row.name !== 'string' || !row.name) return null;
  return {
    name:        row.name,
    region:      typeof row.admin1 === 'string' ? row.admin1 : '',
    country:     typeof row.country === 'string' ? row.country : '',
    countryCode: typeof row.country_code === 'string' ? row.country_code : '',
    lat:         row.latitude,
    lng:         row.longitude,
    population:  typeof row.population === 'number' ? row.population : 0,
  };
}

/* ───────────────────────────── Public API ───────────────────────────── */

/* Fetch current weather for a coordinate.
   Resolves to a NormalizedWeather:
     {
       condition:    one of the 11 PRESETS keys,
       intensity:    'subtle' | 'normal' | 'strong',
       daynight:     'day' | 'night',
       temperature:  Celsius integer (rounded for chip display),
       windSpeed:    KNOTS integer (rounded for chip display),
       weatherCode:  raw WMO code,
       fetchedAt:    Date.now() at fetch time
     }
   Returns null on any failure. */
export async function fetchWeather(lat, lng){
  if(typeof lat !== 'number' || typeof lng !== 'number') return null;

  const params = new URLSearchParams({
    latitude:        String(lat),
    longitude:       String(lng),
    current:         'weather_code,is_day,temperature_2m,wind_speed_10m',
    wind_speed_unit: 'kn',
    timezone:        'auto',
  });
  const url = `${URL_FORECAST}?${params.toString()}`;
  const json = await _safeFetch(url, 'forecast');
  if(!json || !json.current) return null;

  const cur = json.current;
  if(typeof cur.weather_code !== 'number')  return null;
  if(typeof cur.temperature_2m !== 'number') return null;
  if(typeof cur.wind_speed_10m !== 'number') return null;

  const isDay = cur.is_day === 1 || cur.is_day === true;
  const { condition, intensity } = _wmoToCondition(cur.weather_code, isDay);

  return {
    condition,
    intensity,
    daynight:    isDay ? 'day' : 'night',
    temperature: Math.round(cur.temperature_2m),
    windSpeed:   Math.round(cur.wind_speed_10m),
    weatherCode: cur.weather_code,
    fetchedAt:   Date.now(),
  };
}

/* Search cities by free-text name. Used by the city search overlay
   for the autocomplete list. Resolves to up to 10 CityResults sorted
   by Open-Meteo's relevance ranking (which factors in population,
   so disambiguating "Peter" surfaces Peterhead before tiny villages).
   Returns [] on any failure (including empty / too-short queries). */
export async function searchCities(query){
  if(typeof query !== 'string') return [];
  const q = query.trim();
  if(q.length < 2) return [];

  const params = new URLSearchParams({
    name:     q,
    count:    '10',
    language: 'en',
    format:   'json',
  });
  const url = `${URL_GEOCODE}?${params.toString()}`;
  const json = await _safeFetch(url, 'geocode');
  if(!json || !Array.isArray(json.results)) return [];

  const out = [];
  for(const row of json.results){
    const c = _toCityResult(row);
    if(c) out.push(c);
  }
  return out;
}

/* Resolve a coordinate back to a city. Used after navigator.geolocation
   succeeds, to give the chip a human-readable label. Open-Meteo's
   reverse endpoint returns a single best match (top of `results`).
   Returns null on any failure or if no result is returned. */
export async function reverseGeocode(lat, lng){
  if(typeof lat !== 'number' || typeof lng !== 'number') return null;

  const params = new URLSearchParams({
    latitude:  String(lat),
    longitude: String(lng),
    language:  'en',
    format:    'json',
  });
  const url = `${URL_REVERSE}?${params.toString()}`;
  const json = await _safeFetch(url, 'reverse');
  if(!json || !Array.isArray(json.results) || !json.results.length) return null;

  return _toCityResult(json.results[0]);
}
