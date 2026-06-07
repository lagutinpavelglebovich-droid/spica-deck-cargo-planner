# Changelog

All notable changes to SPICA TIDE Deck Cargo Planner will be documented in this file.

## 3.7.0

- Streamlined the Smart Tools panel: removed unused, legacy, and redundant toggles (Animated Counter, Status Bar Icons, Manifest Matching, Bay Dashed Lines, Cargo Hover Glow, Smooth Colours, Deck Shadow, Drag & Resize Readouts, Custom Scrollbars, Corner Badges, Night Watch, Weight Gauge) and the Auto Align Deck action.
- Cargo Hover Motion and Button Effects are now built-in defaults (their toggles were removed).
- DG Badge Fade on Hover now defaults to off.
- Deck weight monitoring is unchanged: the capacity bar, overweight threshold colouring, and PDF/Excel weight readout remain.

## [3.6.5] - 2026-06-07

### Performance
- New **Performance Mode** toggle in Smart Tools (default ON) — disables glass blur and decorative animations to reduce GPU load on integrated graphics. Turn OFF for the full visual experience.
- Removed the always-on amber ribbon glow in viewer mode and the brand-accent shimmer in the header — both ran continuously even when idle.
- Dropped resting GPU-layer promotion on the deck-zoom wrapper and stat numerals; inspector blur now applies only while the inspector is open.

## [3.6.4] - 2026-06-06

### Fixed
- Cargo near the bow (Bay 1–2) is no longer hidden behind the details panel — selecting it slides the deck into view so it stays fully editable (resize, duplicate, action buttons), and the deck returns to position when you close the panel.
- Cargo-block and location colours now stay identical between operator and viewer when synced online, and remain stable after restarting the app.
- Auto-update reliability improvements.

## [3.6.3] - 2026-06-04

### Fixed
- Removed the during-drag positioning guide lines that cluttered the deck when many containers were placed. Smart Grid Snap (snap-to-neighbours on drop) is unchanged.
- The DG segregation zone is now clearly visible while dragging, stays steady instead of flickering, and its label is no longer hidden behind cargo.
- The drop-preview outline that shows where a container will land is brighter with a sharper border — placement is obvious at a glance.

## [3.6.2] - 2026-06-04

### Fixed
- The "Update" button in the About window did nothing on Windows — it now correctly starts the update download and install.

## [3.6.1] - 2026-06-03

### Fixed
- Enlarged cargo-block ID labels for legibility on deck and in the printed PDF.
- Duplicating a block now drops the copy in the nearest free spot near the original instead of under existing cargo.
- Removed the floating hover info-card that overlapped neighbouring cargo on the deck.

## [3.6.0] - 2026-06-03

### Added
- Imported ASCO containers can now be placed by **dragging** the "Imported
  Cargo" cards straight onto the deck (previously click-to-place only).

### Changed
- Cargo Library drawer simplified — the manifest-comparison readout is retired,
  leaving "Imported Cargo" as the single placement surface.

### Fixed
- Unplaced ASCO list now scrolls; long manifests were previously clipped.
- Arrow-key nudging works at any zoom and immediately after selecting a block —
  it was being captured by the CCU input field on selection.
- Selection action buttons (delete / rotate / duplicate) moved to a side stack
  so they no longer cover the corner resize handles.

---

## [3.2.0] - 2026-05-21

### Added
- Unified motion language across all `+` triggers: spring blur-in cascade with stagger
- Language dropdown: floating dark glass pills paradigm with spring physics animation (60ms stagger between options, 300/20 stiffness/damping)
- Location picker: row-based wave animation when drawer opens (80ms between rows, dynamic row detection via getBoundingClientRect)
- Location picker: floating dark glass pills paradigm, replacing rows-in-container with independent pills (10px gap)
- Location picker: 45° clockwise rotation of `+` button icon when drawer opens (560ms spring-approximation with overshoot)
- Location picker: deck plan shifts down via dynamic measurement when drawer opens, returns decisively on close (460ms open, 350ms close)
- Location picker: accent border + filled accent circle check for selected state — multi-signal readability
- Active Locations: type-based SVG icons (platform/FPSO) replacing color picker dots
- Dark theme overrides for all new dropdown/picker components

### Fixed
- gp-cluster: removed `::after` pseudo-element that caused square ghost blur backdrop
- Language dropdown pill tone: warm charcoal `rgba(40,42,48,...)` instead of pure black for proper graphite read on paper-tone backgrounds
- Inline transform residue from Motion One animations cleared after entry settles, allowing CSS rest states to apply
- v3.1.0 version gap: src/app.js CURRENT_BUILD and APP_VERSION constants were not updated in previous release, now synced

### Changed
- Location picker container becomes transparent positional wrapper (no background, no padding)
- Location picker drawer no longer overlays deck plan — deck plan shifts down naturally
- Drawer max-height transition removed in favour of wave animation reveal
- Selected state in location picker uses --acc color (navy in light, lighter blue in dark) instead of subtle white border increase
- Filter blur in Motion One animations scoped to children only (avoids backdrop-filter conflict on parent containers)

### Known limitations
- Wave animation row detection measures cardsPerRow once on open — does not re-trigger on window resize while drawer is open (user can close/reopen to refresh)
- Animations use Motion One Web Animations API to bypass author !important CSS cascade conflicts; transition cleanup explicit

---

## [3.1.0] - 2026-05-16

### Added
- **Deck Used gauge** — radial circular indicator replaces the horizontal
  progress bar. Animated count-up, threshold colors that shift from green
  through amber to red as deck fills, horizontal gradient arc fill, 4
  cardinal tick marks at 12/3/6/9 o'clock. Free space shown as a smaller
  secondary label inside the gauge.

### Fixed
- Stats now refresh immediately when cargo is resized via corner handle
  or rotated (R key or inline + button). Previously the Deck Used %,
  total area, weight totals, location strip, and DG segregation check
  stayed stale until the operator made another move-mutation that hit
  the full canonical update sequence.

### Changed
- **Print menu (Cmd+P)** — now exports the deck plan to a temp PDF and
  auto-opens it in the system viewer for the native print dialog
  (closes the v3.0.0 "known limitation" workaround). Uses
  `tauri-plugin-opener` with scope locked to `**/spica-tide-print-*.pdf`
  for security.
- Removed ~108 lines of dead CSS from earlier UI iterations (legacy
  `.gst-du-*` bar styling, replaced by the new gauge selectors).

## [3.0.1] - 2026-05-14 (hotfix)

### Fixed
- Auto-update silent fail on Windows — clicking "Update" did nothing due to multiple issues:
  - Strategy 2 (GitHub API fallback) showed update banner but `_updateAvailable` reference was never set, causing `_doUpdate()` to return early
  - Missing `process:allow-relaunch` capability — `relaunch()` threw after download (caught silently)
  - `tauri-plugin-process` and `tauri-plugin-shell` referenced in JS imports but not registered in Rust backend (Cargo.toml + main.rs)
- Strategy 2 fallback now opens GitHub release page via `shell.open()` for graceful manual install when Tauri updater plugin fails

### Added (rolled in from v3.1.0 work)
- Premium animations for DECK USED indicator — count-up on number (300ms floor), Motion One spring on progress bar, threshold-crossing flash on level transitions

## [3.0.0] - 2026-05-14

### Major
- **PDF redesign** — premium typography (Inter v4 font, Latin + Cyrillic), pill-based DG
  and Location cards, compressed info section to ~30% of page, Marine Editorial aesthetic
  matching UI design language
- **PDF color sync** — status pills (L/BL/ROB) in PDF now match deck cargo block colors
  via `opColor()` (eliminates UI ↔ printed plan mismatch for crane operators and deck crew)
- **PDF export reliability** — fixed canvas tainted-origin crash in Tauri WKWebView
  (was preventing PDF export on macOS builds); fix uses DOM detach + CSS injection strategy

### Fixes
- **Edit Cargo Inspector** — cursor no longer jumps to start of input on each keystroke
- **Height-to-metres calculation** — vertical fallback now uses `YS` instead of `M`
  (eliminates edge-case miscalculation in custom container placement)
- **Bay direction arrows in PDF** — render correctly as ← / → (were broken brackets
  with default helvetica due to missing glyph)

### Added
- **Print menu** — Ctrl+P / Cmd+P opens system print dialog via `printDeckPlan()`
- **Inter v4 font embedded in PDF** — Latin + Cyrillic + Greek subsets; replaces
  jsPDF default helvetica throughout entire PDF output
- **DG card in PDF** — pill-based layout matching Location cards; chestnut accent band,
  IMDG class + short description + count in unified pill row

### Known limitations
- Print dialog not visible in Tauri WKWebView (`iframe.contentWindow.print()` blocked);
  workaround: export PDF → open in external application → print
- Cargo block labels in PDF remain ~6pt due to A4 aspect ratio cap at 62mm deck height;
  A3 paper option or detail table planned for v3.1.0

## [2.3.0] - 2026-04-15

### Added
- **Multiple DG classes per cargo item** — each item can carry up to 3 IMDG hazard classes
- Multi-select DG class picker in cargo editor with colored tags and search
- Individual DG class badges displayed on deck cargo blocks for all assigned classes
- Segregation engine checks all class combinations between item pairs — most restrictive wins
- Drag overlay and exclusion zones updated for multi-class cargo
- ASCO import extracts multiple DG classes from comma-separated hazard cells

### Changed
- Data model: `dgClass` (string) migrated to `dgClasses` (array) — backward compatible
- Excel export includes all DG classes per item (comma-separated)
- DG summary counts each class independently across multi-class items

## [2.2.1] - 2026-04-15

### Added
- Universal NEW badge system — centralized registry (`src/badgeRegistry.js`) for marking new features with auto-expiring badges
- `shouldShowBadge()` / `renderBadge()` utilities for one-line badge integration at any render site
- NEW badge applied to Operator/Viewer mode button (expires after 3 version increments)

## [2.2.0] - 2026-04-15

### Added
- **Operator / Viewer mode** — two-tier access control with persistent mode selection
  - Operator: full edit rights (password: `spica`)
  - Viewer: read-only deck view with live sync receive, export, and settings access
- Mode selector button in toolbar with password-protected Operator login modal
- All cargo mutations (drag, resize, rotate, delete, duplicate, keyboard shortcuts) blocked in Viewer mode
- CouchDB sync push blocked in Viewer mode; pull/receive remains active
- Subtle "VIEWER MODE — Read Only" banner in Viewer mode
- Mode persists across app restarts via localStorage

## [2.1.2] - 2026-04-15

### Added
- ASCO import auto-assignment rule: entries containing "food" in description are automatically assigned Mini Container (DNV) dimensions (1.95m x 1.65m)
- Green "Auto: Mini Container (DNV)" badge shown in import modal, queue list, and cargo panel for auto-assigned items

## [2.1.1] - 2026-04-15

### Changed
- Replaced inline base64 About modal icon with local asset reference (`src-tauri/icons/icon.png`)

## [1.0.0] - 2026-04-13

### Added
- Complete deck cargo planning with drag-and-drop placement
- 60+ cargo type presets across 5 categories
- 7 platform colour coding with manual colour picker
- DG dangerous goods system with IMDG segregation matrix
- PDF export with full deck plan capture
- Excel manifest export with per-location breakdown
- ASCO/iLMS Excel import with automatic cargo parsing
- Save/Open project files (.json) with native dialogs
- Undo/Redo with 50-step history
- Autosave every 15 seconds with toggle control
- Smart Tools panel (Smart Bounce, Grid Snap, DG Auto-Segregation)
- Visual Smart Tools (13 toggleable effects)
- HTML menu bar (File, Edit, View, Export, Help)
- Context menu on cargo blocks (right-click)
- Keyboard shortcuts system with cheatsheet
- Light/Dark theme with full UI coverage
- i18n support (EN, RU, UK)
- Touch/tablet support with pinch-to-zoom
- Bottom utility panel with coordinates, zoom, cargo count
- Splash screen on startup
- Unsaved changes warning on close
- Auto-update checker via GitHub Releases
- About modal with version info and update check
- Professional NSIS installer for Windows
- File associations (.spica, .json)
- Recent files in File menu

### Fixed
- Fullscreen flickering during cargo drag (throttled DG overlay + GPU layers)
- Header layout shift on save status change (fixed-width indicator)
- Toolbar overflow on narrow screens (3-tier responsive system)

### Technical
- Tauri v2 desktop shell with native file dialogs
- Vite bundler with local font bundling
- Persistence abstraction layer with versioned schema
- html2canvas deck capture with toBlob pipeline (Tauri-safe)
- GitHub Actions CI for Windows builds
