# CLAUDE.md — SPICA TIDE Deck Cargo Planner

## Project

SPICA TIDE is a desktop deck cargo planning application for PSV FAR SPICA (North Sea).
Built with vanilla JS/HTML/CSS, bundled via Vite, packaged as a Windows .exe via Tauri v2.

- **Version**: 1.8.0 Beta (Build 40)
- **Developer**: Pavlo Lagutin
- **Target**: Windows desktop (developed on macOS, final product is Windows .exe)

## Architecture

```
index.html          → Entry point, all HTML structure
src/app.js          → ALL application logic (~8500 lines, single ES module)
src/styles/app.css  → ALL CSS (~4700 lines)
src/main.js         → Imports CSS + app.js
src-tauri/          → Tauri v2 Rust backend (file I/O, dialog, updater)
```

### Key conventions

- `S.cargo[]` is the single source of truth for all cargo blocks
- Every state mutation calls `save()` which pushes to undo stack + persists
- `renderAll()` wipes and rebuilds all `.cb` elements from `S.cargo`
- Never manipulate `.cb` DOM directly — always change `S.cargo` then `renderAll()`
- All colors use CSS custom properties `var(--xxx)` — never hardcode hex in styles
- Dark mode via `[data-theme="dark"]` on `<html>` — all overrides use this selector

### Critical constants (DO NOT CHANGE)

```
M   = 31 px/m       (horizontal scale)
YS  = CVH/15        (vertical scale)
CVH = 380 px        (canvas height = 15m across deck)
TW  = 1683 px       (total canvas width = 12 bays)
BW  = [129,126,147,126,147,147,126,147,126,147,144,139]  (bay widths)
```

These are calibrated to the physical vessel. Changing them breaks spatial accuracy.

## File Locations to Update on Version Bump

1. `src/app.js` → `CURRENT_BUILD`, `APP_VERSION`, `BUILD_NUMBER`
2. `index.html` → About modal, Help menu version text
3. `package.json` → `"version"`
4. `src-tauri/tauri.conf.json` → `"version"`
5. `src-tauri/Cargo.toml` → `version`

## Workflow

### Before ANY implementation
- Read relevant source sections before editing
- Use Plan Mode for tasks with more than 3 steps
- Identify all files that will be touched

### During implementation
- **Minimal impact**: do not rewrite unrelated code
- **Simplicity first**: prefer the simplest robust solution
- **No lazy fixes**: fix root causes, not symptoms
- One feature at a time — verify before moving to next

### After implementation
Run the verification checklist (see below).

## Verification Before Done

Before declaring any change complete:

1. **JS syntax**: `Braces balanced` (count `{` vs `}`, must be equal)
2. **CSS syntax**: Same brace balance check
3. **No broken references**: grep for any function/element IDs you renamed
4. **Tauri build**: if icons or config changed, `npx tauri dev` must start without errors
5. **Save/Export**: if state or rendering changed, test Save As + Export PDF
6. **Dark mode**: if CSS changed, verify `[data-theme="dark"]` overrides exist

## Common Mistakes (from project history)

| Mistake | Rule |
|---|---|
| PNG icons must be **RGBA**, not RGB | Tauri panics on non-RGBA PNGs. Always verify with `file *.png` |
| `_isTauri` must be a **function**, not a const | `window.__TAURI__` isn't available at ES module load time |
| `doc.addImage(canvas)` calls `toDataURL` internally | Use `canvas.toBlob()` → `Uint8Array` → `doc.addImage(bytes)` |
| `html2canvas` + SVG filters = tainted canvas | Hide `body::before` noise texture during PDF capture |
| `contain: paint` on `.cb` clips hover controls | Use `contain: layout style` only (no `paint`) |
| `overflow: hidden` on `.dcv`/`.deck-outer` clips controls | Must be `overflow: visible` |
| `window.open()` blocked in Tauri WebView | Use same-window approaches or native dialogs |
| `@tauri-apps/plugin-dialog` needs `@tauri-apps/api` | Both must be in package.json dependencies |
| Dialog permissions need capabilities file | `src-tauri/capabilities/default.json` must grant `dialog:allow-save` etc. |
| `XLSX.writeFile()` / `doc.save()` bypass native dialogs | In Tauri mode, use `menuExportPDF()` / `menuExportExcel()` which open dialogs first |

## UI/UX Guardrails

- Active corner controls (delete/rotate/copy) must be **fully visible** at all zoom levels
- Cargo labels must be readable and centered
- Header must be **layout-stable** — no shifting when status changes
- Bottom panel holds coordinates, save status, autosave toggle — NOT the header
- Dark theme must cover ALL elements — audit after any CSS change
- `Save As` must ALWAYS open native dialog — never auto-save to Downloads
- PDF export must not use `canvas.toDataURL()` — use `toBlob` pipeline
- Sound engine is 3-level hierarchy: Master → Category → Individual

## Lessons Rule

When the same mistake appears twice in this project:
1. Add it to the "Common Mistakes" table above
2. If it's domain-specific, add a rule file under `.claude/rules/`
3. Reference it from this file

## Rule Files

- `.claude/rules/ui-deckplanner.md` — Deck rendering, cargo blocks, visual constraints
- `.claude/rules/exports.md` — PDF/Excel export pipeline rules
- `.claude/rules/tauri-build.md` — Tauri config, icons, permissions, native dialogs
