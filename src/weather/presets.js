/**
 * @typedef {{ color: string, pos: number }} StopEntry
 *   color: any valid CSS color string
 *   pos:   0–100, gradient stop position; 0 = top (zenith), 100 = bottom (horizon)
 */

/* ════════════════════════════════════════════════════════════════════════
   SPICA TIDE — Weather Presets

   Pure data. No logic. Imported by src/weather/index.js (PRESETS) and
   src/app.js (DEFAULT_CONDITION).

   Per-condition fields:
     stops:     StopEntry[] — pos 0 = top (zenith), 100 = bottom (horizon)
     angle:     CSS linear-gradient angle in degrees; 180 = top→bottom (always)
     sun:       bool — show .wx-sun layer
     moon:      bool — show .wx-moon layer
     stars:     bool — show .wx-stars layer
     clouds:    'none' | 'sparse' | 'medium' | 'dense'
     fog:       0–1 opacity for the .wx-fog haze layer
     precip:    null | { kind: 'rain'|'snow', density: number }
                density 1.0 = standard count for that kind;
                wxState.intensity scales further (subtle 0.4×, normal 1×, strong 1.6×)
     lightning: bool — enables wxScene.set()'s lightning randomizer
   ════════════════════════════════════════════════════════════════════════ */

export const PRESETS = {

  'clear-day': {
    /* Phase 1b — 3-stop matching dusk's pattern. Old 2-stop was flat.
       Deeper zenith blue, saturated mid, brighter near-horizon. */
    stops: [
      { color: '#3A7AC4', pos: 0   },
      { color: '#5BA3E0', pos: 50  },
      { color: '#A8D5F0', pos: 100 },
    ],
    angle: 180,
    sun: true,  moon: false, stars: false,
    clouds: 'none',
    fog: 0,
    precip: null,
    lightning: false,
  },

  'clear-night': {
    /* Phase 1b — 3-stop. Old 2-stop was near-monochrome (#0F1B3C and
       #1A1A3E almost identical). New stops give deeper navy zenith and
       slight indigo→blue-grey lift toward the horizon. */
    stops: [
      { color: '#08102A', pos: 0   },
      { color: '#1A2548', pos: 50  },
      { color: '#2D3865', pos: 100 },
    ],
    angle: 180,
    sun: false, moon: true,  stars: true,
    clouds: 'none',
    fog: 0,
    precip: null,
    lightning: false,
  },

  'partly-cloudy-day': {
    stops: [
      { color: '#5BA3D9', pos: 0   },
      { color: '#9DCFEC', pos: 100 },
    ],
    angle: 180,
    sun: true,  moon: false, stars: false,
    clouds: 'sparse',
    fog: 0,
    precip: null,
    lightning: false,
  },

  /* stars: true is intentional. Clouds drift in front and naturally
     occlude — see W5 z-order rule that locks this stacking. */
  'partly-cloudy-night': {
    stops: [
      { color: '#15203F', pos: 0   },
      { color: '#243254', pos: 100 },
    ],
    angle: 180,
    sun: false, moon: true,  stars: true,
    clouds: 'sparse',
    fog: 0,
    precip: null,
    lightning: false,
  },

  'cloudy': {
    /* Phase 1b — 3-stop. Old 2-stop was flat mid-grey. New stops give
       a moodier darker zenith and a noticeable horizon lift so the
       overcast sky has structure. */
    stops: [
      { color: '#4A5868', pos: 0   },
      { color: '#6B7B8C', pos: 50  },
      { color: '#9AAABB', pos: 100 },
    ],
    angle: 180,
    sun: false, moon: false, stars: false,
    clouds: 'dense',
    fog: 0,
    precip: null,
    lightning: false,
  },

  /* clouds: 'none' is intentional. The .wx-fog layer carries the
     atmosphere; cloud silhouettes would compete with the haze. */
  'fog': {
    stops: [
      { color: '#B0B8BF', pos: 0   },
      { color: '#D0D5DA', pos: 100 },
    ],
    angle: 180,
    sun: false, moon: false, stars: false,
    clouds: 'none',
    fog: 0.85,
    precip: null,
    lightning: false,
  },

  /* fog: 0.15 — faint wet-air haze, deliberately low so deck cargo
     readability is unaffected. */
  'rain': {
    /* Phase 2 follow-up — sky stops lifted from the phase 1b dark
       (#1F2C3D→#243248) to medium gunmetal 3-stop. Reason: phase 1b
       paired darker clouds with a darker sky for "moody-dramatic", but
       in practice the cloud-vs-sky contrast collapsed and the storm
       layer read as a single dark blob with no shape. The dark cloud
       palette (rgba 35,48,66 at app.css:2893) is left as-is — they now
       read as visible silhouettes against the lifted gunmetal sky. */
    stops: [
      { color: '#3A4858', pos: 0   },
      { color: '#4A5868', pos: 50  },
      { color: '#5A6878', pos: 100 },
    ],
    angle: 180,
    sun: false, moon: false, stars: false,
    clouds: 'dense',
    fog: 0.15,
    precip: { kind: 'rain', density: 1.0 },
    lightning: false,
  },

  /* fog: 0.10 — cold-air diffusion. Snow already provides foreground
     motion; heavy fog on top would muddy the scene. */
  'snow': {
    stops: [
      { color: '#A8B8C8', pos: 0   },
      { color: '#E0E8F0', pos: 100 },
    ],
    angle: 180,
    sun: false, moon: false, stars: false,
    clouds: 'medium',
    fog: 0.10,
    precip: { kind: 'snow', density: 1.0 },
    lightning: false,
  },

  /* density 1.3 — visibly heavier than plain rain to sell the storm.
     fog: 0.20 — denser horizon haze; storms feel closed-in. */
  'thunderstorm': {
    stops: [
      { color: '#1A1F2E', pos: 0   },
      { color: '#2C3E50', pos: 100 },
    ],
    angle: 180,
    sun: false, moon: false, stars: false,
    clouds: 'dense',
    fog: 0.20,
    precip: { kind: 'rain', density: 1.3 },
    lightning: true,
  },

  /* 3-stop, with the user-described palette inverted to keep angle:180
     consistent with every other preset (zenith first, horizon last).
     Mid stop at 65 — narrow orange band concentrated in the bottom
     third, like real North-Sea maritime dusk, not a half-screen wash. */
  'dusk': {
    stops: [
      { color: '#1A1F3A', pos: 0   },
      { color: '#4A4E7A', pos: 65  },
      { color: '#FF8C5A', pos: 100 },
    ],
    angle: 180,
    sun: false, moon: false, stars: false,
    clouds: 'sparse',
    fog: 0,
    precip: null,
    lightning: false,
  },

};

/* First-load and corrupt-storage default. Cloudy is the most-photographed
   Peterhead reality — atmospheric without making a statement. */
export const DEFAULT_CONDITION = 'cloudy';
