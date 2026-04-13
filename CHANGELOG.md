# Changelog

All notable changes to SPICA TIDE Deck Cargo Planner will be documented in this file.

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
