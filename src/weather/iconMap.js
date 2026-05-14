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
