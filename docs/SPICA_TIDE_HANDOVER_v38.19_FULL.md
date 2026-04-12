# SPICA TIDE — Deck Cargo Plan
## Full Project Handover Document
### Version: v38.19 · Status: Active Development Prototype

---

## 1. Project Overview

### What It Is
SPICA TIDE is a single-file browser-based **deck cargo planning application** for a PSV (Platform Supply Vessel) operating in the North Sea. It is a professional operational tool for planning, visualising, and documenting cargo placement on the vessel's main deck.

### Purpose
To replace paper-based and spreadsheet-based deck cargo plans with a real-time interactive drag-and-drop interface. The tool allows deck officers and cargo planners to:
- Place cargo blocks on a scaled deck representation
- Assign cargo to specific offshore platform locations (destinations)
- Track cargo status: Load / Backload / ROB / Transfer
- Flag and validate DG (Dangerous Goods) cargo with IMDG segregation checks
- Export professional PDF and Excel cargo manifests
- Import ASCO cargo lists from Excel files

### Target Use Case
- **Vessel:** FAR SPICA, PSV, operated by NEO Energy in the North Sea
- **User:** Deck Officer or Cargo Planner, working at a desktop or laptop
- **Session model:** Single-session, browser-based, no server. Data persists via `localStorage`
- **Workflow:** Plan a voyage before departure → Export PDF for signature → Share with platform representatives

### Current Development Stage
Functional advanced prototype. All core workflows are implemented and working. The application is a single self-contained `.html` file (~482 KB, ~11,900 lines). No build step, no dependencies installed — opens directly in any modern browser. The UI quality is production-level but the architecture has not yet been separated into modules.

---

## 2. Current Visual Style and UI Direction

### Design Language
**"Marine Editorial"** — premium nautical instrument aesthetic. Inspired by high-end dashboard design, editorial typography, and professional marine software. The goal is a tool that feels authoritative, calm, and highly readable at a glance.

### Colour Palette (Light Mode)
All colours defined as CSS custom properties in `:root`:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#d5d6cc` | Workspace canvas (warm grey-green) |
| `--surf` | `#fbf9f4` | Primary surface (warm ivory) |
| `--surf2` | `#f5f4ed` | Secondary surface |
| `--surf3` | `#efeee6` | Tertiary / hover |
| `--txt` | `#31332c` | Primary text (deep charcoal, never pure black) |
| `--txt2` | `#5e6058` | Secondary text |
| `--txt3` | `#797c73` | Tertiary / labels |
| `--txt4` | `#b1b3a9` | Placeholder / muted |
| `--acc` | `#486083` | Premium navy accent |
| `--acc2` | `#3c5477` | Accent hover |
| `--s-L` | `#3a7d52` | Status: Load (green) |
| `--s-BL` | `#486083` | Status: Backload (navy) |
| `--s-ROB` | `#785a1a` | Status: ROB (warm amber) |
| `--brd` | `rgba(177,179,169,.30)` | Default border |
| `--sep` | `rgba(177,179,169,.18)` | Separator |
| `--glass` | `rgba(251,249,244,.94)` | Glassmorphism surface |

### Dark Mode
Full dark mode implemented. Triggered by `[data-theme="dark"]` on `<html>`. Dark surface stack: `#22241f` → `#2a2d27` → `#313429` → `#393c30`. Accent brightened to `#6a8cb5` for legibility on dark.

### Typography
Three fonts used throughout, loaded from Google Fonts:
- **Manrope** (weights 300–800) — display headings, vessel name, large numbers, location names
- **Inter** (weights 300–700) — UI labels, buttons, descriptions, body text
- **JetBrains Mono** (weights 400–500) — voyage number, date, coordinates, monospace data

### Visual Hierarchy (Header)
Four intentional levels:
1. **Vessel name "SPICA TIDE"** — `Manrope 900, 22px, 5px letter-spacing` — dominant
2. **Total Lifts number** — `Manrope 900, 34px` — most prominent metric
3. **L / BL / ROB counters** — `Manrope 800, 26px`, colour-coded per status
4. **Voyage / Date** — `JetBrains Mono 700, 13px` — functional, not competing

### Layout Structure
```
┌────────────────────────────────────────────────────────────────┐
│ HEADER: Brand | Stats | Controls | Voyage | Tools | Lang | Ver │
├────────────────────────────────────────────────────────────────┤
│ LOCATION STRIP: Collapsible row with loc-cards per platform    │
├────────────────────────────────────────────────────────────────┤
│ DG BAR: DG classes on board (amber warning bar)                │
├────────────────────────────────────────────────────────────────┤
│ ZOOM BAR: Zoom controls                                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│          DECK AREA (flex:1, scrollable)                        │
│          ┌──────────────────────────────┐                      │
│          │   DECK CANVAS (.dcv)         │  ◄── cargo lives here│
│          │   Bay grid, zones, cargo     │                      │
│          └──────────────────────────────┘                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
        ↑ right side: Cargo Library panel (fixed, 380px, slides in)
```

### Key Design Decisions
- **No full-page modals that block the deck** — cargo library slides in from right but doesn't block deck interaction
- **Warm paper texture** — subtle SVG noise overlay on `body::before` for premium feel
- **Glassmorphism header** — `backdrop-filter: blur(24px)` on `.hdr`
- **Everything is a CSS custom property** — dark mode works purely via variable overrides
- **Cargo blocks** — flat coloured rectangles with inset highlight and ambient shadow; colour derived from location assignment
- **No external icon libraries** — all icons are inline SVG

---

## 3. Current Implemented Functionality

### Core Deck Interaction
- **Drag-and-drop cargo placement** from Library or DG list onto deck canvas
- **Drag to reposition** existing cargo blocks
- **Click-to-edit** opens full cargo edit modal
- **Inline CCU/ID editing** via double-click on block label
- **Resize handles** — four corner handles (NW, NE, SW, SE) for manual resize
- **Rotate button** — 90° rotation, swaps real-world dimensions correctly
- **Duplicate button** — copies block, places adjacent
- **Delete button** — removes block from deck
- **Zoom system** — 0.3×–2.0×, Ctrl+Scroll, zoom buttons, fit-to-screen, keys 1–5
- **Canvas coordinate tip** — shows real-world x/y position (metres) near selected block

### Cargo Data Model
Each cargo block (`S.cargo[]`) stores:
```
id, side, x, y, w, h, length_m, width_m, rot,
ccu, desc, wt, platform, status, dgClass,
priority, trDest, heavyLift
```

### Status System
Four statuses: **Load (L)**, **Backload (BL)**, **ROB**, **Transfer (TR)**. Status drives colour tint. Transfer shows dashed border and destination badge.

### Location System
- 17 built-in platform locations (Bleo Holm, Claymore CAP/CPP/WOPS/Drill, Piper/Drilling/WOPS, Saltire, Tartan, Beatrice, Clyde, Fulmar, Auk, Montrose, Arbroath, GP3)
- Dynamic colour assignment per active location (colour pool with grouping logic)
- **Bleo Holm always grey** — fixed operational rule
- Custom locations can be added at runtime
- Locations collapsible drawer for selection
- **Location Quick Filter** — click a loc-card to isolate its cargo on deck (others dim)
- Location delete confirmation with cargo-in-use guard

### Cargo Library Panel
- Slides in from right, 380px wide, `position:fixed`
- **Now collapsible to 48px icon strip** with vertical label, badge, and L shortcut hint
- Tabs: Import Queue / Standard Library / DG Library / Custom
- Full-text search across all cargo types
- Filter pills: All / Unplaced / On Deck / DG / HL / Load / Backload / ROB / Priority
- Manifest Matching toggle (ASCO vs deck comparison)
- Custom cargo form (add/edit/delete user-defined cargo types)

### ASCO Import
- Upload Excel `.xlsx` file via drag-drop or file picker
- Parses multiple sheets, extracts cargo descriptions, CCU IDs, weights, DG classes, Heavy Lift flags, dimensions, platform assignments
- Import queue with per-item selection before committing to deck
- Queue persists in session, can be cleared

### DG Dangerous Goods System
- 20 DG classes (1.1–9) with full IMDG segregation matrix (`SEG_FULL`)
- **DG Auto-Segregation Check** — runs on every placement/move/edit/delete
  - Per-pair acknowledged state (`DG_ACK_PAIRS` Set by cargo ID)
  - `acknowledgeDGCheck()` — clears highlights, modal, marks pair as seen
  - Modal reappears only for new, previously-unseen conflict pairs
  - Deleting a block evicts its pairs from ack set
- **Live drag segregation overlay** — shows exclusion zones while dragging a DG block
- **Pending placement exclusion zones** — shown when selecting a DG item to place
- Custom DG class picker (replaces native `<select>`, fully dark-mode compatible)
- DG Badge Fade on Hover (Smart Tool, default ON)

### Smart Tools System
All toggles persist to `localStorage('spicaTide_smartTools')`:

| Key | Default | Description |
|---|---|---|
| `bounce` | ON | Smart Bounce — resolves overlaps after drop |
| `match` | OFF | Manifest Matching (ASCO vs deck) |
| `dgFade` | ON | DG badge fade on cargo hover |
| `dgSeg` | ON | DG Auto-Segregation Check |
| `hoverMotion` | ON | Cargo hover lift/scale animation |
| `gridSnap` | ON | Smart Grid Snap on drop |
| `kbShortcuts` | ON | Keyboard Shortcuts System |

Plus **Auto Align Deck** one-shot action button (not a toggle).

### Smart Placement Assists
- **Smart Bounce** — after drop, if overlap detected, pushes to nearest free position (directional push + spiral fallback)
- **Smart Grid Snap** — after drop, snaps to nearest neighbour edge, bay line, hose bay boundary, centre line, or deck edge within 0.75 m threshold. Snap is one-shot on mouseup, not persistent.
- **Auto Align Deck** — batch alignment across all cargo, 1.0 m threshold, up to 6 convergence passes, spatial sort order

### Keyboard Shortcuts
All shortcuts active when no input is focused:

| Key | Action |
|---|---|
| `E` | Edit selected block |
| `R` | Rotate selected block 90° |
| `D` | Duplicate selected block |
| `Del` / `Backspace` | Delete selected block |
| `↑↓←→` | Move 1px |
| `Alt + ↑↓←→` | Move 5px |
| `Shift + ↑↓←→` | Move 1 metre |
| `1`–`5` | Zoom 50%/75%/100%/125%/150% |
| `L` | Toggle Library panel collapse |
| `?` | Show/hide keyboard cheatsheet |
| `Esc` | Deselect / cancel / clear filter |

Arrow keys always work regardless of `kbShortcuts` toggle.

### Export
- **PDF export** — A4 landscape, jsPDF-based, includes vessel header, voyage info, stats table, deck image (canvas capture), per-location breakdown, voyage notes, DG summary. Loads jsPDF from CDN.
- **Excel export** — SheetJS-based, two worksheets: full cargo manifest + summary with location breakdown. Filename: `SPICA-TIDE_{voyage}_Manifest.xlsx`. Loads SheetJS from CDN.

### Header Controls
- **Brand block** — vessel name, "Deck Cargo Plan", vessel details. Editable via admin mode (pencil icon).
- **Stats** — Total Lifts (34px/900), weight, Load/BL/ROB/Transfer counts
- **"Placing as" status selector** — sets default status for new cargo
- **Voyage / Date card** — voyage number input, calendar date picker (custom, not native)
- **Upload Cargo List** — ASCO Excel import
- **Library** — opens Cargo Library panel
- **Clear Deck** — premium confirmation modal before clearing
- **Smart Tools** — panel with all feature toggles + Auto Align action
- **Language picker** — dropdown, EN/RU/UK. Persists. i18n for all operational strings.
- **Theme toggle** — compact icon pill, Light ↔ Dark
- **Version badge** — `Beta · v38.19`

### i18n / Multilingual
Three languages: English, Русский (Russian), Українська (Ukrainian). Implemented via `LANG` object + `data-i18n` attributes + `applyLang(code)`. All operational text, modal strings, toasts, and Smart Tools descriptions are translated.

### Feature NEW Badge System
Version-aware badge on Smart Tools rows. `data-since="vXX.YY"` attribute. Badges older than `NEW_BADGE_WINDOW = 4` minor versions are automatically hidden. SAFETY and ONE-SHOT badges are permanent (not subject to aging). Hover tooltip shows "Added in vXX.YY".

### Persistence
All state persists to `localStorage` under key `spicaTide_v13`:
```json
{ cargo, customLib, customLocs, voyage, activeLocs, selLoc, date, dynColors, voyRemarks, scaleVer }
```
Additional keys:
- `spicaTide_theme` — light/dark
- `spicaTide_lang` — language code
- `spicaTide_smartTools` — Smart Tools toggle states
- `spicaTide_brand` — admin-edited header labels
- `spicaTide_libPrefs` — library section expand/collapse + cargo aliases
- `spicaTide_cpCollapsed` — library panel collapsed state

---

## 4. Current Project Structure

### File Structure
Single file: `spica_tide_v38_19.html` (~482 KB, ~11,900 lines)

Internal structure (in order):
1. `<style>` — all CSS (~3,300 lines)
2. Inline `<script>` — theme flash prevention (3 lines)
3. External script tag — SheetJS CDN
4. `<body>` — full HTML (~900 lines)
5. Main `<script>` — all JavaScript (~7,600 lines)

### Canvas / Deck Geometry
```
M  = 31 px/m  (horizontal, aft→bow)
YS = CVH/15 ≈ 25.33 px/m  (vertical, port→stbd)
CVH = 380 px  (canvas height = 15 metres across)
TW  = 1683 px (total canvas width = 12 bays)
BW  = [129,126,147,126,147,147,126,147,126,147,144,139] px  (bay widths, Bay12→Bay1)
BL_ = cumulative left edges of each bay
```

### Deck Zones
- **Tiger zone** — `x:0, w:20` (port crash barrier, always visible)
- **Hose Bay (port)** — top-left area, `HB_H = round(2.16 × YS)` height
- **Hose Bay (stbd)** — bottom-left area, mirrored
- **STORE** — top-right, Bay1 area
- **Methanol arc** — SVG curved zone across Bay12–Bay9
- **No-DG zone** — Bay1 area with visual overlay
- **Lashing dollies and D-rings** — decorative structural markers

### State Object `S`
```javascript
S = {
  activeLocs: [],    // currently active platform IDs
  selLoc: null,      // selected/active location for new cargo
  selStatus: 'L',    // default status for new cargo
  pending: null,     // cargo pending placement { type, item, fromQueue? }
  cargo: [],         // all placed cargo blocks
  customLib: [],     // user-defined cargo library items
  customLocs: [],    // user-added custom platform locations
  voyRemarks: ''     // voyage notes text
}
```

### Key Global Variables
- `KB_SEL` — currently keyboard-selected cargo id
- `CP_OPEN` / `CP_COLLAPSED` — library panel state
- `LOC_FILTER` — active Location Quick Filter id (null = no filter)
- `DG_ACK_PAIRS` — Set of acknowledged DG conflict pair keys (`"idA::idB"`)
- `IMPORT_QUEUE` — array of ASCO-imported cargo items pending placement
- `zoomLevel` — current zoom (0.3–2.0)
- `DYN_COLORS` — dynamic colour assignments `{ locId: '#rrggbb' }`
- `SMART` — current Smart Tools settings object
- `MATCH_ACTIVE` — whether Manifest Matching is running
- `editId` — cargo id currently open in edit modal
- `selDate` — currently selected voyage date

### CCU Preset Library
60 presets across 5 categories: Container, Module, Tank, Basket, Skip. Each preset stores: `key, name, length_m, width_m, wt_default, cat`. Dimensions stored in real-world metres and converted to canvas px via `m2px_w()` / `m2px_h()`.

### Core Functions Reference
| Function | Purpose |
|---|---|
| `_placeAtCore(cx,cy)` | Creates and places cargo at canvas coords |
| `renderAll()` | Clears and redraws all cargo blocks |
| `renderBlock(cv, cargo)` | Renders a single cargo block DOM element |
| `smartBounce(cargo)` | Resolves overlaps after drop |
| `smartGridSnap(cargo)` | One-shot alignment to edges/bay lines |
| `autoAlignDeck()` | Batch alignment of all cargo |
| `checkSeg()` | IMDG segregation check, updates modal+highlights |
| `applyLocFilter(id)` | Activates Location Quick Filter |
| `clearLocFilter()` | Clears filter, restores all cargo |
| `buildActiveLocStrip()` | Rebuilds location cards in header |
| `cpOpen/Close/Toggle/Collapse/Expand()` | Library panel state management |
| `applyNewBadges()` | Version-aware NEW badge visibility |
| `applyTheme(theme)` | Applies light/dark via data-theme attribute |
| `save()` / `load()` | localStorage persistence |
| `exportPDF()` | Generates and downloads PDF |
| `exportExcel()` | Generates and downloads xlsx |
| `applyLang(code)` | Applies i18n language switch |

---

## 5. Recent Changes and Latest Completed Work

### v38.7 — UI Refinements
- Version badge added (top-right header)
- Compact icon-only theme toggle (☀/☾ pill)
- Voyage/Date panel redesigned to match design system
- Language picker consolidated to single dropdown with flags

### v38.8–38.10 — DG Auto-Segregation Check
- Full DG segregation check engine with premium violation modal
- Per-conflict-pair acknowledged state (`DG_ACK_PAIRS` by cargo ID)
- Pulsing outline on violating blocks
- Acknowledge button fully clears alert; modal won't reappear for same pair
- Deleting a block evicts its pairs from the ack set

### v38.11 — Cargo Hover Motion toggle
- Smart Tools → Visual: toggle for hover lift/scale animation
- Applied via injected `<style>` tag (same pattern as DG fade)

### v38.12 — Dark Mode DG Dropdown
- Custom DG class picker replacing native `<select>` (unstyable in dark mode)
- Hidden `<select id="mDG">` preserved for JS API compatibility
- Searchable, colour-coded options with DG badge colours

### v38.13 — Smart Grid Snap
- One-shot snap on drag drop to neighbour edges, bay lines, hose bay, centre line, deck edges
- 0.75 m threshold, independent X/Y axes, overlap safety check
- Smart Tools → Cargo Placement toggle (default ON)

### v38.14 — Auto Align Deck (fixed v38.14 syntax break)
- One-shot batch alignment button in Smart Tools → Actions
- Spatial sort, 6-pass convergence, 1.0 m threshold
- Running/done visual states with 2.2s feedback reset
- Fixed critical JS syntax error (missing `function bindSmartTools(){` declaration)

### v38.15 — Feature NEW Badge System
- `feat-badge` component with `data-since` and `data-tooltip` attributes
- Version-aware: `parseBuildVersion()` + `NEW_BADGE_WINDOW = 4`
- CSS `::after` tooltip (zero JS cost)
- SAFETY / ONE-SHOT badges always visible (not subject to aging)

### v38.16 — Location Quick Filter
- Click loc-card → isolates platform cargo (others dim to 18% opacity + desaturate)
- Injected CSS rule targeting `data-loc` attribute on `.cb` elements
- `filter-active` indicator on location bar
- ESC clears filter
- Second click on same loc-card clears filter

### v38.17 — Keyboard Shortcuts System
- E/R/D/Delete/1–5/L/? shortcuts
- Keyboard cheatsheet modal (? key)
- Zoom flash indicator (bottom-right, 0.9s)
- Smart Tools toggle (default ON); ? and arrow keys always work regardless
- L key: expand/collapse library panel

### v38.18 — Visual Hierarchy Rework
- SPICA TIDE: `Manrope 900, 22px, 5px letter-spacing`
- Total Lifts: `34px, weight 900` — dominant number
- L/BL/ROB: `26px, weight 800` — vivid, colour-coded
- Voyage/Date: `JetBrains Mono 700, 13px`
- Loc-card platform name: `Manrope 800, 11.5px`
- Loc-pill values: `17px, weight 900` (up from 14px/800)
- Loc-card dot: colour-matched ring shadow

### v38.19 — Collapsible Side Panel
- Library panel collapses to 48px icon strip (not fully closed)
- Strip shows: expand `›` button, rotated "LIBRARY" label, import queue badge, "L" hint
- `body.cp-panel-open` / `cp-panel-collapsed` classes drive `margin-right` on deck area
- Smooth `.30s` transition for deck area expansion/contraction
- Collapse state persists to `localStorage('spicaTide_cpCollapsed')`
- L key: if panel open → toggle collapse; if panel closed → open

---

## 6. Known Issues, Limitations, or Unstable Areas

### Confirmed Issues
1. **Library panel collapse on small screens** — `margin-right` on `.deck-area` correctly follows panel state, but on very small screens (< 900px) the collapsed strip may overlap deck canvas. No breakpoint override implemented.

2. **DG segregation gap calculation** — uses `Math.min(gapX, gapY)` as worst-case axis, which is correct for the most conservative reading but may occasionally flag blocks that are diagonal-only violations as closer than they geometrically are.

3. **Resize handle + Smart Grid Snap** — resize does not call `smartGridSnap()` after resize ends. Only drag-drop triggers snap. This is intentional (resize = precise manual control) but could confuse users expecting consistency.

4. **ASCO import location matching** — `resolveImportedLocId()` does fuzzy string matching between Excel sheet names and `LOC_ALL` id/name. Unusual platform name variants in the Excel file may not match and fall back to null locId.

5. **PDF export on very large deck** — `html2canvas` alternative is not used; jsPDF canvas capture via `toDataURL` works but at very high zoom levels may produce a blurry PDF capture. Zoom should be at 100% before export.

6. **Auto Align Deck + occupied positions** — the overlap safety check in `autoAlignDeck()` prevents placing a snapped block on top of another, but in dense decks some blocks may not move at all (no safe snap target within threshold). This is correct but can leave some blocks unaligned.

7. **Location Quick Filter + drag** — while a filter is active, dimmed blocks have `pointer-events: none`, meaning they cannot be dragged. This is intentional (you can only interact with the filtered platform's cargo) but may surprise users who expect to drag everything.

8. **Dark mode DG picker z-index** — the dropdown occasionally renders behind the modal overlay on some browsers at specific zoom levels. Workaround: use search to quickly find a class.

### Architecture Limitations
- **Single file** — 11,900 lines. No module separation. All CSS, HTML, JS in one file. This is intentional for the prototype phase but makes maintenance progressively harder.
- **No undo/redo** — all operations are immediate. The only recovery is browser refresh (which restores from localStorage).
- **No multi-session sync** — data lives only in one browser's localStorage. No cloud, no multi-device access.
- **No user authentication** — admin mode is a simple password field, not real auth.
- **SheetJS and jsPDF loaded from CDN** — requires internet for export on first load. After browser caching, works offline.
- **`save()` key `spicaTide_v13`** — version number in key means any future schema change needs a migration path or users lose their saved state.

---

## 7. Pending Tasks and Next Recommended Steps

### High Priority

**H1. Undo / Redo system**
Every destructive action (delete, clear deck, move) should be undoable. Implementation: maintain a `HISTORY` stack of `S.cargo` snapshots (JSON clone). Limit to 20 steps. `Ctrl+Z` / `Cmd+Z` to undo, `Ctrl+Shift+Z` to redo. This is the most frequently requested professional tool feature.

**H2. Touch / tablet support**
The app has zero touch event handling. Drag-drop uses `mousedown/mousemove/mouseup` only. PSV officers may use tablets. Need: `touchstart/touchmove/touchend` event mirrors on all interactive elements (cargo blocks, canvas drop zone). Pinch-to-zoom on deck canvas.

**H3. Real-world metre grid overlay**
Optional grid showing 1m × 1m lines across the deck canvas. Toggle in Smart Tools → Visual. Uses canvas geometry (`M = 31 px/m`). Would greatly assist manual placement precision and makes the snap system more visible.

**H4. Cargo weight totals per platform in loc-cards**
Currently loc-cards show count per status (L/BL/ROB). Should also show total weight (T) per platform, not just per-status weight. Useful for stability planning.

**H5. `spicaTide_v13` save key migration**
The localStorage key includes a version number. Plan a migration function that reads `v13` and upgrades to `v14` if schema changes are needed. Without this, any future save format change will silently wipe user data.

### Medium Priority

**M1. Undo history indicator in UI**
After implementing undo, show a subtle indicator in the header or zoom bar showing available undo steps.

**M2. Cargo block selection — multi-select**
Shift+click or rubber-band selection to select multiple blocks. Then: bulk status change, bulk delete, bulk move. Currently only single-block selection via keyboard.

**M3. Voyage remarks PDF integration polish**
Voyage remarks are already exported to PDF, but the styling in PDF is minimal. Should match the header card style of the main PDF output.

**M4. Platform-specific DG segregation display**
When a location filter is active, DG segregation warnings should still show if the filtered platform has DG violations — currently the modal shows regardless of filter state, which can be confusing.

**M5. Cargo sort / list view**
A tabular list view of all cargo on deck (alternative to the deck canvas view). Useful for verification before export. Could be a tab in the Library panel.

**M6. Snap visual indicator**
When Smart Grid Snap fires, briefly flash the snapped-to edge/line so the user understands what happened. Currently snap is silent (no visual feedback).

**M7. Library panel resize by drag**
The library panel is fixed at 380px. Allow drag-resize from its left edge (already has the edge handle for open/close). Store width in localStorage.

**M8. Auto Align Deck — preview before apply**
Show ghost positions before committing alignment. "Preview" → "Apply" / "Cancel" flow. Currently alignment is immediate and irreversible (until undo is implemented).

### Later Improvements

**L1. Multi-platform export**
Export cargo plan filtered to a single platform (e.g., only Claymore CAP items). Useful for sending individual platform manifests.

**L2. Cargo template save/load**
Save a full deck configuration as a named template and reload it. Useful for recurring voyages to the same platform cluster.

**L3. Bay capacity indicators**
Per-bay cargo count and estimated weight displayed on the deck canvas below each bay number. Visual heat-map if bay is near capacity.

**L4. Vessel profile system**
Currently hardcoded to FAR SPICA geometry. Abstract vessel geometry (BW array, CVH, zones) into a selectable profile. Would allow use for other PSVs in the fleet.

**L5. Online sync / cloud storage**
Replace localStorage with a simple API backend. Allow multiple users to view the same plan simultaneously. Out of scope for the current prototype phase.

**L6. Offline PWA packaging**
Wrap in a Progressive Web App shell with a Service Worker. Cache jsPDF and SheetJS locally. Allow full offline use without internet dependency.

---

## 8. Guidance for Future Development

### What Must Be Preserved

**Geometry constants are sacred.** `M = 31`, `CVH = 380`, `BW = [129,126,147,126,147,147,126,147,144,139]` — these are calibrated to the actual FAR SPICA deck. Any change breaks spatial accuracy. If vessel profile system is built, these must remain as the default `FAR_SPICA` profile.

**The `S.cargo` data model** should not change without a migration path. The `save()` function serialises `S.cargo` to localStorage. Any new field added to the cargo object must have a safe default when loading old saves (which won't have the field).

**DG acknowledgement logic** must stay per-cargo-ID, not per-class. The `DG_ACK_PAIRS` Set with `"idA::idB"` keys is intentional — it means acknowledging a warning for two specific blocks, not all future instances of that class combination. Reverting to class-based fingerprinting will make the system annoying again.

**The library panel** (`cp-overlay`, `position:fixed`) must not become `position:relative` or integrated into normal flow — it overlaps the deck intentionally so the deck remains interactive while the panel is open.

**CSS custom properties** — all colours must remain as `var(--xxx)` references, never hardcoded. This is what makes dark mode work without JavaScript.

**Font loading** — Manrope, Inter, JetBrains Mono are loaded via Google Fonts `@import`. If migrating offline, these must be bundled as local webfonts.

### What Should Not Be Accidentally Broken

- The `renderAll()` / `renderBlock()` cycle — re-renders all blocks on every state change. Any direct DOM manipulation of `.cb` elements will be overwritten on next `renderAll()`. All state changes must go through `S.cargo[]`, not the DOM.
- The `LOC_FILTER` / `#locFilterStyle` mechanism — the injected `<style>` tag controls cargo dimming. Don't add `opacity` styles directly to `.cb` elements outside this mechanism.
- The `kbHandleKey` capture phase listener — it must stay `{capture: true}` to get priority over browser scroll and other default handlers.
- The `data-loc` attribute on `.cb` elements — stamped in `renderBlock()`, consumed by the filter CSS. Must be kept in sync.
- `DG_ACK_PAIRS.forEach` → `DG_ACK_PAIRS.delete()` inside the loop — this is safe in JavaScript (Set allows deletion during iteration) but confusing. Don't convert to array-based iteration without testing.

### Pattern Consistency for New Features

Follow these established patterns:

1. **Injected `<style>` for CSS overrides** — see `applyDgFade()`, `applyHoverMotion()`, `applyLocFilter()`. Create `<style id="featureStyle">` in `<head>`, set `.textContent`. This avoids class proliferation and supports instant toggle.

2. **Smart Tools toggle** — add to `SMART_DEFAULTS`, add `<div class="st-row">` in HTML, add handler in `bindSmartTools()`. The pattern is established and consistent.

3. **`feat-badge` for new features** — use `<span class="feat-badge" data-since="vXX.YY" data-tooltip="Added in vXX.YY">NEW</span>`. Update `CURRENT_BUILD` constant. `applyNewBadges()` handles visibility automatically.

4. **`checkSeg()` is always called after cargo mutations** — place → edit → delete → copy. Never skip it. It's cheap (pure JS, no DOM except when violations exist).

5. **`buildActiveLocStrip()` is always called after `S.cargo` or `S.activeLocs` changes.** Same rule.

6. **Version bump** — update both `ver-badge-inner` HTML AND `CURRENT_BUILD` JS constant on each release. The `applyNewBadges()` system uses the JS constant, not the HTML badge.

---

## 9. Suggested Migration Path

### Phase 1 — File Split (No Framework, Keep Vanilla JS)
The current single file should be split into:
```
spica-tide/
  index.html          (structure only)
  css/
    base.css          (design tokens, reset, typography)
    layout.css        (hdr, deck-area, panels)
    cargo.css         (cb, loc-card, pill)
    modals.css        (all overlay/modal styles)
    dark.css          (dark mode overrides)
  js/
    constants.js      (M, BW, CVH, LOC_ALL, DG_DATA, CCU_PRESETS, SEG_FULL)
    state.js          (S object, save/load)
    canvas.js         (renderAll, renderBlock, setupCanvas, zones)
    placement.js      (_placeAtCore, smartBounce, smartGridSnap, autoAlignDeck)
    dg.js             (checkSeg, DG_ACK_PAIRS, acknowledgeDGCheck)
    library.js        (cpBind, cpOpen/Close/Collapse, cpRender*)
    locations.js      (buildActiveLocStrip, toggleLoc, filter)
    keyboard.js       (kbHandleKey, bindKeyboardNav)
    smart-tools.js    (bindSmartTools, applyDgFade, applyHoverMotion)
    i18n.js           (LANG, t(), applyLang)
    export-pdf.js     (exportPDF, buildPDF)
    export-excel.js   (exportExcel)
    modal.js          (openModal, closeModal, bindModal)
    ui.js             (header, theme, lang, version badge)
    init.js           (init() function)
  assets/
    fonts/            (local copies of Manrope, Inter, JetBrains Mono)
```

This requires no build system — just `<script type="module">` imports.

### Phase 2 — Claude Code Integration
After file split, Claude Code can work on individual files without risking the entire 11,900-line monolith. Recommended workflow:
- Use Claude Code for: adding new features, refactoring functions, fixing bugs
- Keep the `constants.js` file locked (geometry is validated against physical vessel)
- Use Claude Code's file diff view to review changes to `state.js` carefully (data migration risk)

### Phase 3 — Desktop App (Electron or Tauri)
The file-split version can be wrapped in Electron or Tauri with minimal changes:
- Replace CDN-loaded jsPDF/SheetJS with local npm packages
- Add native file dialogs for ASCO import and export
- Add auto-update mechanism
- Bundle fonts locally
- Remove CORS restrictions (allows direct Excel file access)

Tauri is preferred (smaller binary, Rust backend, better security model).

### Phase 4 — Online Sync (Optional)
If multi-user or cross-device access is needed:
- Add a minimal REST API backend (Node/Express or FastAPI)
- Replace `localStorage` with API calls in `save()` / `load()`
- Add voyage ID system (each plan has a UUID)
- Implement optimistic UI (update local state immediately, sync in background)
- Consider Supabase or PocketBase as a quick backend (real-time, self-hostable)

The frontend code needs no changes beyond `save()` and `load()` functions.

### Phase 5 — PWA Offline Mode
Add a Service Worker that caches:
- The application shell (index.html + all CSS/JS)
- jsPDF and SheetJS bundles
- Google Fonts

This enables full offline operation on tablets aboard the vessel.

---

## 10. Executive Summary

**SPICA TIDE v38.19** is a mature, feature-rich single-file browser application for PSV deck cargo planning. Built for the FAR SPICA vessel operating in the North Sea under NEO Energy, it provides a professional interactive deck plan with a complete operational workflow.

**Technical spec:** Single HTML file, 481 KB, ~11,900 lines. Vanilla JS + CSS. No framework. No build step. Three fonts (Manrope/Inter/JetBrains Mono). Two CDN dependencies (jsPDF, SheetJS) loaded on demand for export.

**Core workflow:** Import ASCO cargo list → Place cargo by drag-drop → Edit weights/status/DG → Check segregation → Export PDF + Excel manifest.

**19 major feature areas implemented:** Drag-and-drop placement, resize/rotate/duplicate, zoom system, location colour assignment, multi-platform location filtering, ASCO Excel import, DG segregation check with acknowledged-pair memory, custom DG picker, cargo library panel with collapsible strip, ASCO manifest matching, keyboard shortcuts with cheatsheet, Smart Grid Snap, Auto Align Deck, Smart Bounce, Location Quick Filter, PDF/Excel export, light/dark theme, i18n (EN/RU/UK), feature NEW badge system.

**7 Smart Tools** (all toggled and persisted): Smart Bounce, Manifest Matching, DG Badge Fade, DG Auto-Segregation Check, Cargo Hover Motion, Smart Grid Snap, Keyboard Shortcuts.

**Key architectural decisions:** All state in `S.cargo[]` array, CSS custom properties for theming, injected `<style>` tags for toggle-able CSS rules, per-cargo-ID DG acknowledgement, `data-loc` attributes for filter targeting, `position:fixed` library panel that never blocks deck.

**Highest-priority next steps:** Undo/redo system, touch/tablet support, 1m grid overlay, cargo weight per platform.

**Migration readiness:** The codebase is well-structured internally despite being a single file. The logical module boundaries are clear and a file-split requires no architectural changes — only extraction. The project is ready for Claude Code integration after file splitting.

**Current stability:** JS syntax verified clean. All major features validated. One known regression area: library panel collapse on very small screens needs breakpoint overflow handling.

---

*Document generated from source analysis of `spica_tide_v38_19.html` · 481,802 bytes · 11,895 lines*
*Build: v38.19 · CURRENT_BUILD constant confirmed matching*
