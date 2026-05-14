# Deck Used Indicator — Work Log

## Phase 1: Static version (commit 24dc993)

**Files changed:** index.html, src/app.js, src/styles/app.css (3 files, +217 lines)

**What was done:**
- Added `gst-deck-usage` card HTML inside `.gstats` after a separator, following Transfer card
- Added DECK_USABLE_AREA_PX constant (TW*CVH minus 5 exclusion zones = 596,875 px²)
- Added PX2_TO_M2 conversion factor (M * YS = ~785.23)
- Wired occupancy calculation into `updateStats()` — sums `cargo.w * cargo.h` for all items
- 4 threshold classes: calm (0-70%), warn (70-85%), alert (85-95%), critical (95-100%)
- Progress bar with tick marks at 25/50/75%, carved-in track, gradient fill
- Hover/focus tooltip showing Usable/Occupied/Free in m²
- Full dark mode support
- **Build: PASS** — `npm run build` succeeded, no errors

## Phase 2: Premium animations (commit 85af1ea)

**Files changed:** src/app.js, src/styles/app.css (2 files, +99/-6 lines)

**What was done:**
- Imported `animate` from 'motion' (aliased as `motionAnimate`)
- Speedometer number animation: rAF loop, cubic-bezier(0.34, 0.04, 0.20, 1.00), integer-only display, cancels in-flight on new update
- Bar width: Motion One spring via `easing: 'spring(260, 26, 0, 1)'` — string-form easing, NOT `spring()` function (which caused the previous TypeError)
- Threshold crossing: CSS `du-threshold-flash` keyframe (scale 1→1.05→1 over 200ms)
- Critical pulse: CSS `du-critical-pulse` keyframe (opacity oscillation, 1.2s loop) on `.deck-usage--critical .gst-du-num`
- Removed CSS `transition: width` on bar fill (now Motion One handles it)
- Animation state tracked in `_du` object to survive across updateStats() calls
- **Build: PASS** — `npm run build` succeeded, no errors

## Notes
- The previous attempt's error (`spring.ts:238 TypeError`) was caused by calling `spring()` as the animation type. Fixed by using the string-form `easing: 'spring(stiffness, damping, mass, velocity)'` which is the correct Motion One v12 API for DOM element animations.
- USABLE_AREA_PX computes to 596,875 (not 579,775 as estimated in the task spec — the difference is the tiger zone width: actual m2px_w(1.0)=31px vs task's 20px estimate, and TW*CVH=648,660 vs task's 627,380 estimate). The code uses the actual runtime constants so it's accurate.
