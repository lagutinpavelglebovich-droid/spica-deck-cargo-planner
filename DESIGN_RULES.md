# SPICA TIDE — Authoritative Design Rules

> Single source of truth for colors, pills, zones, bay numbers, and deck chrome.
> Extracted from live code on 2026-05-29 (HEAD `7d85fbd`). When code changes, update this file.
> Any PDF export or new UI MUST follow these rules — do not invent colors or styles.
>
> Source citations are `file:line` against the working tree at extraction time. Line
> numbers drift as code changes; the symbol names (`opColor`, `PALETTE_POOL`, `DG_DATA`,
> `.loc-pill`, `.z-hose`, `.bay-num`, `.deck-compass`) are the durable anchors — grep
> those if a line number no longer matches.

---

## 1. Status colors (Load / Backload / ROB)

There is **no fixed color per status**. Status color is assigned dynamically per
`(location, status)` pair so that two LOADs from different platforms — or a LOAD and a
ROB from the same platform — never collide on the deck.

- The single live entry point is `opColor(locId, status)` — `src/app.js:829`.
  - Business override: **`BLEO` + `L` is ALWAYS grey `#b8bcc2`** — `src/app.js:830`.
  - Everything else delegates to `_assignCargoColor(locId, status)` — `src/app.js:795`.
- `_assignCargoColor` picks the `PALETTE_POOL` entry with the **maximum hue/family
  distance** from every other `(loc,status)` pair currently assigned, caches it in
  `CARGO_COLORS[`​`${locId}|${status}`​`]`, and never recomputes it — `src/app.js:795-825`.
- The same `opColor()` result drives **both** the status pills and the cargo block fill,
  so a pill and its blocks on deck always match. Cargo fill: `src/app.js:2435`
  (`const fill = opColor(cargo.platform, cargo.status) || getLocBase(loc.id);`).

### Secondary / legacy color machinery (present but NOT the live status-pill path)

- `OP_HEX` — fixed map `L:#7c3aed` (purple), `BL:#eab308` (yellow), `ROB:#16a34a`
  (green), `TR:#3b82f6` (blue) — `src/app.js:757-762`. Its comment calls it the "single
  source of truth", but the live pills/blocks call `opColor()` (per-pair), not `OP_HEX`.
  Treat `OP_HEX` as a reference/legacy constant, not the active rule. **UNDETERMINED —
  needs Pavel confirmation** whether `OP_HEX` is still intended to be authoritative.
- `deriveStatusColors(baseHex)` — hue rotation (BL = base +145°, ROB = base +255° with a
  warm-amber bias) — `src/app.js:849-889`, reached via `locColors()` `src/app.js:834`.
  Computed in the loc-card builder (`src/app.js:2143-2144`) but the rendered pill color is
  overridden by `opColor()` at `src/app.js:2188`. So `deriveStatusColors` is effectively
  dormant for pill color today.

---

## 2. Location colors

A location's **base** color (the card accent / dot, CSS var `--lc`) is distinct from its
pill colors.

- Base color = `getLocBase(locId)` — `src/app.js:680-683`:
  returns `DYN_COLORS[locId].base` if assigned, else the location's static `loc.c`, else
  fallback `#9aa0a8`.
- Dynamic assignment: `assignLocColor(locId)` chooses the `PALETTE_POOL` entry farthest
  from other active locations (group members bias toward their preferred hue) —
  `src/app.js:689-735`. `BLEO` is skipped (always grey).
- Static preferred colors + grouping live in `LOC_ALL` — `src/app.js:649-671`. Notable:
  `BLEO #9aa0a8` (fixed), Claymore group violet/purple (`CLAY_CAP #7c3aed` …), Piper group
  amber/brown (`PIPER #c27b00` …), Saltire `#c0392b`, Tartan `#1d4ed8`, etc.
- The shared color pool for both location-base and per-pair assignment is `PALETTE_POOL`
  (30 curated hex entries with `hue`/`fam` tags) — `src/app.js:590-631`.

### Pill color inside a location card — exact code path

In the active-location card builder (`buildActiveLocStrip`, around `src/app.js:2143-2198`):
- Card accent `--lc` is set to the **location base** (`effectiveBase = getLocBase(id)`) —
  `src/app.js:2149`.
- Each status pill's color is set from **`opColor(id, s.key)`** (the per-`(loc,status)`
  pair color), pushed into the pill as CSS var `--op-color` (`r,g,b`) —
  `src/app.js:2188-2191`.

So: **card dot/accent = location base; the L/BL/ROB pills = per-(location,status) unique
colors.** They are intentionally different colors, both drawn from `PALETTE_POOL`.

---

## 3. Pills (L / BL / ROB capsules) — live UI

- Element: `.loc-pill`, built in `src/app.js:2184-2197`; label `.loc-pill-lbl`, value
  `.loc-pill-val`.
- Shape: full **capsule** — `border-radius: 999px`, fixed `height: 34px`,
  2-column grid (label | value) — `src/styles/app.css:999-1017`.
- Fill: **FILLED, not light-tinted.** Background is a solid color core
  `rgba(var(--op-color), .68)` under a subtle white top gradient, plus a
  `1px solid rgba(var(--op-color), .50)` rim and a small outer glow —
  `src/styles/app.css:1024-1037`. `--op-color` defaults to slate `120,130,148` if unset
  (`src/styles/app.css:1000`) and is overwritten per pill from `opColor()`.
- Label text color: **fixed near-black** — explicitly "information, NOT decoration", no
  `--op-color` dependency — `src/styles/app.css:1077-1080`. Value text carries the color
  accent (`.loc-pill-val`, `src/styles/app.css:1123`).
- Pill width is grid-driven (fills its cell), independent of label length —
  `src/styles/app.css:1003-1006`.

---

## 4. DG class colors (IMDG)

Authoritative table is `DG_DATA` — `src/app.js:1346-1366`. Each entry: `bg` (chip fill),
`tc` (text color on chip), `bc` (border / saturated accent). Some classes add a `stripe`
or `half` gradient via `dgBg(d)` — `src/app.js:1368-1372`
(`stripe` → 45° repeating stripes; `half` → top/bottom split).

| Class | Name | bg | text (tc) | border (bc) | pattern |
|---|---|---|---|---|---|
| 1.1–1.6 | Explosives | `#f97316` | `#fff` | `#c04000` | — |
| 2.1 | Flamm. Gas | `#ef4444` | `#fff` | `#991b1b` | — |
| 2.2 | Non-fl. Gas | `#22c55e` | `#fff` | `#14532d` | — |
| 2.3 | Toxic Gas | `#e5e5e5` | `#111` | `#525252` | — |
| 3 | Flamm. Liquid | `#ef4444` | `#fff` | `#991b1b` | — |
| 4.1 | Flamm. Solid | `#f0f0f0` | `#111` | `#c03030` | stripe `#ef4444` |
| 4.2 | Spont. Comb. | `#f0f0f0` | `#111` | `#c03030` | stripe `#ef4444` |
| 4.3 | Dangerous Wet | `#3b82f6` | `#fff` | `#1e3a8a` | — |
| 5.1 | Oxidizing Agt | `#eab308` | `#111` | `#713f12` | — |
| 5.2 | Org. Peroxide | `#f97316` | `#fff` | `#7c2d12` | half `#eab308` |
| 6.1 | Toxic | `#e5e5e5` | `#111` | `#404040` | — |
| 6.2 | Infectious | `#e5e5e5` | `#111` | `#404040` | — |
| 7 | Radioactive | `#eab308` | `#111` | `#713f12` | half `#f0f0f0` |
| 8 | Corrosive | `#e5e5e5` | `#111` | `#171717` | half `#171717` |
| 9 | Misc. | `#e5e5e5` | `#111` | `#404040` | stripe `#404040` |

Rule: never hardcode a DG color — read it from `DG_DATA` by class. Chip text must use the
class's own `tc`, not a blanket white (light-bg classes like 2.3 / 6.x / 8 / 9 use `#111`).

---

## 5. Deck zones

Zones are `div.zone.z-{type}` injected by `addZone(cv,x,y,w,h,type,label)` —
`src/app.js:1892`. Container `.zone`: absolute, `z-index:2`, flex-centered label —
`src/styles/app.css:4747`. Label `.z-lbl`: 8px Inter 700 uppercase `#4a3400` —
`src/styles/app.css:4755`.

| Zone | Live styling | Source |
|---|---|---|
| **Hose Bay** (`z-hose`) | 45° repeating-linear-gradient brown `rgba(120,90,26,.18)` 8px / `rgba(120,90,26,.06)` 8px; label color `#31200a` | `src/styles/app.css:4751-4752` |
| **Store** (`z-store`) | 45° repeating gradient `rgba(120,90,26,.28)` 7px / `rgba(176,140,56,.22)` 7px; label `#3d2200` | `src/styles/app.css:4753, 4756` |
| **Tiger strip** (`z-tiger`) | 45° repeating gradient `rgba(120,90,26,.16)` 8px / `rgba(120,90,26,.05)` 8px (plus restyle rule) | `src/styles/app.css:4754, 4504` |
| **DG limit line** | 2px solid `#9f403d`, opacity .6; label `.dg-limit-lbl` 7.5px `#9f403d` 700 uppercase | `src/styles/app.css:4777-4778` |
| **No-DG zone** | inline: 45° repeating `rgba(220,38,38,.055)` 6px + `border-left:2px dashed rgba(220,38,38,.45)`; rotated "NO DG CARGO" label | `src/app.js:1690-1699` |

Zone placement (in `setupCanvas`, `src/app.js:1677-1685`):
- Tiger strip: 1.00 m longitudinal, inside Bay 12 at its aft edge — `addZone(cv,0,0,m2px_w(1.0),CVH,'tiger','')`.
- Hose Bay: two strips (top + bottom) spanning the Bay-10/Bay-9 region.
- Store: top-right, `4 m × 3.75 m` — `addZone(cv,TW-4*M,0,4*M,3.75*YS,'store','STORE')`.
- DG limit line at `BL_[10]`; No-DG zone fills from there to the bow (`TW`).

**UNDETERMINED — needs Pavel confirmation:** A **"Waste Skip"** zone and a dedicated
**"Methanol"** zone are referenced in the task brief but were **not found** in code. Only
`tiger`, `hose`, `store`, and the no-DG zone exist. "Methanol" appears only as the
class-3 example text in `DG_DATA` (`src/app.js:1356`), not as a deck zone.

---

## 6. Bay numbers

- Rendered as one `.bay-num` per bay in `setupCanvas` — `src/app.js:1644-1650`. **One row
  only — no duplicate bay-number row anywhere.**
- Font: **Manrope, weight 900, 40px**, `line-height:1` (inline style) — `src/app.js:1647`.
- Color: inline sets `rgba(49,51,44,.14)`, but CSS `.bay-num` overrides to
  `rgba(49,51,44,.10) !important` (light) / `rgba(255,255,255,.10) !important` (dark) —
  `src/styles/app.css:4490-4496`. The `.10` ghost-watermark value wins.
- Position: centered in each real bay segment — `left:BL_[i]`, `width:BW[i]`,
  `top:50%; transform:translateY(-50%); text-align:center` — `src/app.js:1646`.
- Numbering: text is `12 - i` (visual render order, aft→bow) — `src/app.js:1649`.
- Toggle: hidden when `.vst-no-watermark` is set (`opacity:0`) — `src/styles/app.css:8577`.

---

## 7. Deck header strip

The metadata line centered above the deck is `.deck-compass` in markup, **not** generated
by JS — `index.html:1151-1155`. Three spans laid out space-between:

1. `◄ AFT / STERN — BAY 12`
2. `SPICA TIDE · 54.92 m × 15 m · 752 m² · Max 2500 T · 10 T/m²`  ← exact text
3. `BAY 1 — BOW / FORE ►`

Styling `.deck-compass` — `src/styles/app.css:1748`: `display:flex; justify-content:
space-between; padding:8px 20px; background:var(--surf2); border-bottom:1px solid
var(--brd); font:9.5px 'Inter' 600; letter-spacing:1px; color:var(--txt3);
text-transform:uppercase;` with top corner radius. Dark overrides at
`src/styles/app.css:6454` and `11714`.

Authoritative vessel facts encoded here: **SPICA TIDE**, deck **54.92 m × 15 m**, area
**752 m²**, **Max 2500 T**, **10 T/m²**. Never write "FAR SPICA" or "53.7".

---

## 8. PDF export rules (how the PDF should mirror the above)

- The PDF deck image is an **html2canvas raster capture of the live `.dcv`** —
  `src/app.js:7144` (inside `_renderReport`). It is the real rendered deck, so bay
  numbers, zones, and cargo block colors in the PDF come straight from the rules above —
  not redrawn.
- Because html2canvas cannot render `repeating-linear-gradient`, each zone background is
  **temporarily swapped to a solid fill before capture and restored afterward**:
  swap at `src/app.js:7090-7119` (hose → `rgba(200,180,50,.5)`, tiger →
  `rgba(160,100,30,.5)`, store → `rgba(180,140,20,.6)`, no-DG → `rgba(220,50,50,.15)`);
  restore in the `restore()` closure at `src/app.js:7121-7132`. Keep these swap colors in
  step with the live zone hues if the zones are restyled.
- The PDF **chrome** (KPI strip, destination cards, DG card — drawn in `buildPDF`,
  `src/app.js:~7167+`) must use the **same status / location / DG colors documented
  above**, sourced via `opColor()` / `getLocBase()` / `DG_DATA` — not arbitrary
  green/amber/grey.

  **KNOWN DIVERGENCE — needs Pavel confirmation:** the current `buildPDF` destination
  cards color the L / BL / ROB pills with **fixed tints** (green / amber / navy), whereas
  the live app colors each pill by the **per-(location,status)** `opColor()` value
  (§1, §3). The DG chip color does correctly read `DG_DATA`. Before the next PDF chrome
  pass, confirm whether the destination pills should switch to the live per-pair colors
  (via `opColor(loc.id, status)`, already available in `_renderReport`) to truly mirror
  the deck.
