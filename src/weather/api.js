/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Open-Meteo WMO weather codes → app weather conditions

   v3.43 (IT review) — this module no longer talks to the network. The city
   weather (city search, reverse geocoding of the PC's position, the
   browser location prompt) is gone: all weather comes from the working
   locations of the plan (src/fieldWeather.js, src/weatherMap.js), and those
   requests carry nothing but platform coordinates.
   ════════════════════════════════════════════════════════════════════════ */

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

/* shared with the field weather (location-based atmosphere) */
export { _wmoToCondition as wmoToCondition };
