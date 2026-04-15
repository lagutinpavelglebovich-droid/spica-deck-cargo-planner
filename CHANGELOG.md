# Changelog

All notable changes to SPICA TIDE Deck Cargo Planner will be documented in this file.

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
