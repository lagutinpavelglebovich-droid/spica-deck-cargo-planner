/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Weather Icon Map (Meteocons fill style)

   Maps PRESETS condition keys → bundled SVG asset URLs. Vite resolves
   each `?url` import into a hashed path under dist/assets/ at build
   time, so production paths stay valid (node_modules is not shipped
   into the Tauri bundle). MIT-licensed icons by Bas Milius.

   The Meteocons file `thunderstorms.svg` is plural; the app's PRESETS
   key is singular (`thunderstorm`). The map bridges that name diff.
   ════════════════════════════════════════════════════════════════════════ */

import clearDay           from '@meteocons/svg/fill/clear-day.svg?url';
import clearNight         from '@meteocons/svg/fill/clear-night.svg?url';
import partlyCloudyDay    from '@meteocons/svg/fill/partly-cloudy-day.svg?url';
import partlyCloudyNight  from '@meteocons/svg/fill/partly-cloudy-night.svg?url';
import cloudy             from '@meteocons/svg/fill/cloudy.svg?url';
import fog                from '@meteocons/svg/fill/fog.svg?url';
import rain               from '@meteocons/svg/fill/rain.svg?url';
import snow               from '@meteocons/svg/fill/snow.svg?url';
import thunderstorms      from '@meteocons/svg/fill/thunderstorms.svg?url';

export const ICONS = {
  'clear-day':           clearDay,
  'clear-night':         clearNight,
  'partly-cloudy-day':   partlyCloudyDay,
  'partly-cloudy-night': partlyCloudyNight,
  cloudy,
  fog,
  rain,
  snow,
  thunderstorm:          thunderstorms,
};

/* Defensive fallback to 'cloudy' so the chip never shows a broken
   image if a future PRESETS key sneaks in without a mapping entry. */
export function iconForCondition(condition){
  return ICONS[condition] || ICONS.cloudy;
}

/* v3.26.1 — the same icons as live inline SVG for the header sky.
   An <img> SVG animates only as long as the browser keeps the decoded
   image alive (WebView2 freezes it when the header block is rebuilt or
   the window goes idle); inline markup runs its SMIL on the page clock,
   can be paused for Animations → Off, and is never re-decoded. Each copy
   gets its own id prefix so gradients and clip paths never collide. */
import clearDayRaw          from '@meteocons/svg/fill/clear-day.svg?raw';
import clearNightRaw        from '@meteocons/svg/fill/clear-night.svg?raw';
import partlyCloudyDayRaw   from '@meteocons/svg/fill/partly-cloudy-day.svg?raw';
import partlyCloudyNightRaw from '@meteocons/svg/fill/partly-cloudy-night.svg?raw';
import cloudyRaw            from '@meteocons/svg/fill/cloudy.svg?raw';
import fogRaw               from '@meteocons/svg/fill/fog.svg?raw';
import rainRaw              from '@meteocons/svg/fill/rain.svg?raw';
import snowRaw              from '@meteocons/svg/fill/snow.svg?raw';
import thunderstormsRaw     from '@meteocons/svg/fill/thunderstorms.svg?raw';

const RAW = {
  'clear-day': clearDayRaw, 'clear-night': clearNightRaw,
  'partly-cloudy-day': partlyCloudyDayRaw, 'partly-cloudy-night': partlyCloudyNightRaw,
  cloudy: cloudyRaw, fog: fogRaw, rain: rainRaw, snow: snowRaw, thunderstorm: thunderstormsRaw,
};
let _inlineSeq = 0;
export function inlineIconForCondition(condition){
  const raw = RAW[condition] || RAW.cloudy;
  const p = 'mi' + (++_inlineSeq) + '-';
  return raw
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/\sid="([^"]+)"/g, (_, id) => ` id="${p}${id.replace(/\s+/g, '_')}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${p}${id.replace(/\s+/g, '_')})`)
    .replace(/(xlink:)?href="#([^"]+)"/g, (_, x, id) => `${x || ''}href="#${p}${id.replace(/\s+/g, '_')}"`)
    .replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
}
