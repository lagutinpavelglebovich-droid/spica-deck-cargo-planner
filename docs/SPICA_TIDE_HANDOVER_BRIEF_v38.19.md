# SPICA TIDE — Developer Continuation Brief
### v38.19 · Single-file prototype · Active development

---

## Project in One Paragraph

SPICA TIDE is a browser-based deck cargo planning tool for PSV **FAR SPICA** (NEO Energy, North Sea). It is a **single self-contained HTML file** (~482 KB, ~11,900 lines) — no build step, no framework, opens directly in any browser. Officers use it to place cargo on a scaled deck plan, assign to platform destinations, flag DG goods with IMDG segregation checks, and export PDF/Excel manifests. All state persists via `localStorage`. The file is the product — there is no backend, no server, no repo.

---

## Current File

**`spica_tide_v38_19.html`** — latest stable build. JS syntax verified clean. All features working.

Internal layout: `<style>` (3,300 lines) → inline HTML body (900 lines) → main `<script>` (7,600 lines).

---

## Core Architecture

### Canvas Geometry (do not change)
```
M   = 31 px/m          horizontal scale (aft → bow)
YS  = CVH/15 ≈ 25.33   vertical px/m (port → stbd)
CVH = 380 px            canvas height (15 m across deck)
TW  = 1683 px           total canvas width (12 bays)
BW  = [129,126,147,126,147,147,126,147,126,147,144,139]  bay widths px
```

### State Object
```javascript
S = { activeLocs[], selLoc, selStatus, pending, cargo[], customLib[], customLocs[], voyRemarks }
```
`S.cargo[]` is the single source of truth. **Never manipulate cargo DOM directly** — all changes go through `S.cargo`, then `renderAll()`.

### Key Globals
| Variable | Purpose |
|---|---|
| `KB_SEL` | Keyboard-selected cargo id |
| `CP_OPEN / CP_COLLAPSED` | Library panel state |
| `LOC_FILTER` | Active location filter id (null = off) |
| `DG_ACK_PAIRS` | Set of acknowledged DG conflict pair keys `"idA::idB"` |
| `IMPORT_QUEUE[]` | ASCO-imported items awaiting placement |
| `SMART` | Smart Tools settings object |
| `zoomLevel` | Current zoom (0.3–2.0) |
| `DYN_COLORS` | Dynamic colour assignments `{ locId: '#rrggbb' }` |
| `CURRENT_BUILD` | `'v38.19'` — update on every release |

### Design Tokens (CSS vars)
Light: `--bg #d5d6cc` · `--surf #fbf9f4` · `--txt #31332c` · `--acc #486083` · `--s-L #3a7d52` · `--s-BL #486083` · `--s-ROB #785a1a`
Dark: applied via `[data-theme="dark"]` attribute on `<html>`. All colours must use `var(--xxx)` — never hardcode.
Fonts: **Manrope** (display/numbers) · **Inter** (UI) · **JetBrains Mono** (data/coords)

---

## Implemented Features

### Core Deck
- Drag-and-drop placement from Library or DG list onto canvas
- Drag to reposition, resize (4 corner handles), rotate 90°, duplicate, delete
- Click-to-edit modal, inline CCU/ID double-click edit
- Zoom 0.3×–2.0×, Ctrl+Scroll, fit-to-screen

### Status & Locations
- 4 statuses: Load / Backload / ROB / Transfer (dashed border + destination)
- 17 built-in platform locations + custom locations at runtime
- Bleo Holm always grey (fixed operational rule)
- Location Quick Filter — click loc-card → isolates that platform's cargo (others dim to 18% + desaturate via injected CSS on `data-loc` attribute)

### DG System
- Full IMDG SEG_FULL matrix (20 classes)
- DG Auto-Segregation Check: per-pair acknowledged state (`DG_ACK_PAIRS` by cargo ID). Modal appears only for new, unacknowledged pairs. Deleting a block evicts its pairs.
- Live drag exclusion overlay while dragging a DG block
- Custom DG picker (not native `<select>`) — dark-mode compatible, searchable

### Smart Tools (7 toggles, all persisted)
| Toggle | Default | Notes |
|---|---|---|
| Smart Bounce | ON | Resolves overlaps after drop |
| Manifest Matching | OFF | ASCO import vs deck comparison |
| DG Badge Fade | ON | Badges fade on hover |
| DG Auto-Segregation | ON | Safety-critical |
| Cargo Hover Motion | ON | Lift/scale animation on hover |
| Smart Grid Snap | ON | One-shot snap on drop (0.75 m threshold) |
| Keyboard Shortcuts | ON | E/R/D/Del/1–5/L/? |

Plus **Auto Align Deck** — one-shot batch alignment button (1.0 m threshold, 6 convergence passes).

### Library Panel
- Fixed right, 380px, slides in/out
- **Collapsible to 48px icon strip** — `body.cp-panel-open/cp-panel-collapsed` classes drive `margin-right` on `.deck-area`
- Strip shows: expand button, rotated "LIBRARY" label, queue badge, "L" hint
- Collapse state persists: `localStorage('spicaTide_cpCollapsed')`

### Keyboard Shortcuts
`E` edit · `R` rotate · `D` duplicate · `Del` delete · `1–5` zoom levels · `L` toggle library collapse · `?` cheatsheet · `Esc` deselect/cancel/clear filter · Arrow keys always work (move 1px/5px/1m)

### Export
- **PDF** — jsPDF from CDN, A4 landscape, full deck capture + stats + voyage notes
- **Excel** — SheetJS from CDN, two sheets: manifest + summary with location breakdown

### Other
- ASCO Excel import (multi-sheet, extracts CCU/weight/DG/dims/platform)
- i18n: EN / RU / UK (all operational strings translated)
- Light/Dark theme, persisted
- Feature NEW badge system — `data-since="vXX.YY"`, auto-hides after 4 minor versions
- Version badge: `Beta · v38.19`
- Admin mode: editable vessel name/details via pencil icon (password-gated)
- 60 CCU presets in 5 categories (Container/Module/Tank/Basket/Skip)

---

## localStorage Keys
| Key | Contents |
|---|---|
| `spicaTide_v13` | Full cargo state (cargo, locations, voyage, colours, remarks) |
| `spicaTide_theme` | `'light'` or `'dark'` |
| `spicaTide_lang` | `'en'`, `'ru'`, or `'uk'` |
| `spicaTide_smartTools` | Smart Tools toggle states JSON |
| `spicaTide_cpCollapsed` | `'0'` or `'1'` |
| `spicaTide_brand` | Admin-edited vessel header labels |
| `spicaTide_libPrefs` | Library section expand state + cargo aliases |

⚠️ Key `spicaTide_v13` contains a version number — any schema change needs a migration function or users lose saved plans.

---

## Latest Changes (v38.7 → v38.19)

| Version | Change |
|---|---|
| v38.7 | Version badge, compact theme toggle, redesigned voyage/date card, language dropdown |
| v38.8–10 | DG Auto-Segregation Check engine; per-pair-ID acknowledged state; Acknowledge button |
| v38.11 | Cargo Hover Motion toggle (Smart Tools → Visual) |
| v38.12 | Custom DG class picker (replaces native select, dark-mode compatible, searchable) |
| v38.13 | Smart Grid Snap on drop (0.75 m, bay lines + neighbour edges + hose bay + centre line) |
| v38.14 | Auto Align Deck one-shot action; **fixed critical JS syntax break** (missing function declaration) |
| v38.15 | Feature NEW badge system (version-aware, CSS tooltip, aging logic) |
| v38.16 | Location Quick Filter (click loc-card → dim others; injected CSS + data-loc attribute) |
| v38.17 | Keyboard Shortcuts System (E/R/D/Del/1–5/L/?), cheatsheet modal, zoom flash |
| v38.18 | Visual Hierarchy Rework (vessel name 22px/900, Total 34px/900, L/BL/ROB 26px/800, loc-pill 17px/900) |
| v38.19 | Collapsible Library Panel (48px strip, margin-right deck transition, L key, persistence) |

---

## Known Risks and Issues

1. **No undo/redo** — all operations are immediate and permanent within the session. Only recovery: browser refresh restores last `localStorage` save.
2. **Single file monolith** — 11,900 lines. Working in it risks accidental breaks. The `bindSmartTools()` function was accidentally removed once (v38.14 incident) — always verify JS syntax after edits.
3. **ASCO location matching** — fuzzy string match between Excel sheet names and platform IDs. Unusual naming conventions in source files may produce null `locId`.
4. **Library panel collapse on small screens** — no breakpoint override for very small viewports; strip may overlap canvas.
5. **DG picker z-index on some browsers** — dropdown occasionally renders behind modal at specific zoom levels.
6. **CDN dependency for export** — jsPDF and SheetJS loaded from cdnjs. First export requires internet; cached afterwards.
7. **`spicaTide_v13` schema** — if cargo data model changes (new required fields), old saves will break silently unless migration logic is added.

---

## Development Priorities

### Do First
- **Undo/Redo** — `HISTORY` stack of `S.cargo` snapshots, `Ctrl+Z` / `Ctrl+Shift+Z`. Cap at 20 steps. Most critical missing feature.
- **Touch/tablet support** — `touchstart/touchmove/touchend` mirrors on cargo blocks and canvas. Pinch-to-zoom on deck. Officers use tablets.
- **1m grid overlay** — optional grid (toggle in Smart Tools → Visual). Uses `M = 31 px/m`. Makes snap system visible.

### Do Next
- **Multi-select** — Shift+click or rubber-band for bulk status/delete/move.
- **Cargo weight per platform** — show total MT per location in loc-cards (not just count).
- **Snap visual feedback** — brief flash on snapped-to edge/line when Smart Grid Snap fires.
- **Library panel resize** — drag left edge to resize 280–520px range. Store in localStorage.
- **`spicaTide_v13` migration** — write migration function now before schema changes pile up.

### Later
- Multi-platform filtered PDF export (one platform per export)
- Cargo plan templates (save/reload named configurations)
- Bay capacity heat-map overlay
- Abstract vessel profile (other PSVs in fleet)
- PWA / Service Worker for full offline operation

---

## Established Patterns (follow these for new features)

**Injected style toggle:**
```javascript
function applyFeature(){
  let el = document.getElementById('featureStyle');
  if(!el){ el = document.createElement('style'); el.id='featureStyle'; document.head.appendChild(el); }
  el.textContent = SMART.feature ? '.cb:hover{...on state...}' : '.cb:hover{...off state...}';
}
```

**Smart Tools toggle:**
1. Add key to `SMART_DEFAULTS` with comment
2. Add `<div class="st-row">` in HTML inside the correct section
3. Add `const featureChk = document.getElementById('stFeatureToggle')` in `bindSmartTools()`
4. Set initial checked state from `SMART.feature`
5. Add change handler: update SMART, `saveSmartSettings()`, `updateSmartDot()`, apply side-effect

**Feature NEW badge:**
```html
<span class="feat-badge" data-since="v38.XX" data-tooltip="Added in v38.XX">NEW</span>
```
Update `CURRENT_BUILD` constant. `applyNewBadges()` auto-hides badges older than 4 minor versions.

**After any cargo mutation, always call:**
```javascript
renderAll(); updateStats(); buildActiveLocStrip(); checkSeg(); updateDGSummary(); save();
```
(Some operations skip `updateDGSummary` — check context.)

**Version bump checklist:**
- [ ] Update `ver-badge-inner` HTML: `Beta · vXX.YY`
- [ ] Update `CURRENT_BUILD = 'vXX.YY'` JS constant
- [ ] Run JS syntax check before shipping

---

## Migration Path (when ready)

1. **File split** — extract JS into `constants.js`, `state.js`, `canvas.js`, `placement.js`, `dg.js`, `library.js`, `keyboard.js`, `smart-tools.js`, `i18n.js`, `export-pdf.js`, `export-excel.js`, `modal.js`, `ui.js`, `init.js`. Use `<script type="module">`. No architectural changes needed — just extraction.
2. **Claude Code** — after file split, Claude Code can safely work on individual modules.
3. **Desktop app** — wrap in Tauri (preferred) or Electron. Replace CDN exports with local npm packages. Add native file dialogs.
4. **Online sync** — replace `save()`/`load()` with API calls. No other frontend changes needed.

---

*Based on source analysis of `spica_tide_v38_19.html` · 481,802 bytes · 11,895 lines*
