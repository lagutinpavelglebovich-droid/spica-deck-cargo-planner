# SPICA TIDE — Task Tracker

## Current Version: v1.8.0 Beta (Build 40)

---

## Completed (Build 40)

- [x] Persistence abstraction layer (schema v3, migration)
- [x] Vite + Tauri v2 desktop scaffold
- [x] Native file dialogs (Save/Open/Export)
- [x] PDF export (jsPDF + html2canvas + toBlob)
- [x] Excel export (SheetJS)
- [x] Undo/Redo (50 steps)
- [x] Autosave (15s + toggle)
- [x] Project Save/Open (.json)
- [x] HTML menu bar (File/Edit/View/Export/Help)
- [x] Context menu (right-click cargo)
- [x] About modal + splash screen
- [x] Close confirmation dialog
- [x] Touch/tablet + pinch zoom
- [x] Sound engine v3 (9 sounds, 3-level hierarchy)
- [x] Manual location color picker
- [x] 13 Visual Smart Tools
- [x] Weight gauge, DG-only filter, empty deck hint
- [x] Bottom utility panel (coords, zoom, status)
- [x] Dark theme full audit
- [x] Professional icon set (RGBA verified)
- [x] EULA + NSIS installer config
- [x] GitHub Actions CI (build-windows.yml)
- [x] Version tracking system (v1.8.0)

## In Progress

- [ ] Auto-update functionality (updater plugin configured, keys not generated)

## Backlog

- [ ] Updater signing keys generation
- [ ] Auto-update check logic (every 5 days)
- [ ] Update notification banner UI
- [ ] CHANGELOG.md integration with in-app display
- [ ] Build number auto-injection in CI

## Known Issues

- Tauri updater pubkey is placeholder ("REPLACE_WITH_YOUR_PUBLIC_KEY")
- `package-lock.json` still references some 1.0.0 internal versions
- Fullscreen flicker may still occur on some Windows laptops with DG overlay

## Future Ideas (not committed)

- Multi-select (Shift+click / rubber-band)
- Cargo weight per platform in location cards
- Bay capacity heat-map overlay
- Abstract vessel profiles (other PSVs)
