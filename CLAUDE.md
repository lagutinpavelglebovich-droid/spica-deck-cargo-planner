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

### Critical constants — AUTHORITATIVE DECK GEOMETRY (DO NOT CHANGE)

The deck geometry model is defined as the single source of truth in
`src/app.js` near the top. All downstream code (rendering, snap, drag,
zones, PDF/Excel export, readouts) derives from these constants.

```
M                = 31 px/m           (horizontal scale, along deck)
YS               = CVH/15            (vertical scale, across deck)
CVH              = 380 px            (canvas height = 15 m across deck)
JOINT_WIDTH_M    = 0.15 m            (steel joint between adjacent bays)
JOINT_PX         = round(0.15 × M)   ≈ 5 px

BAY_LENGTHS_M    = [                 (metres — measured aboard SPICA TIDE)
  4.15,  // [0]  Bay 12  (aft / stern / left edge on screen)
  4.04,  // [1]  Bay 11
  4.75,  // [2]  Bay 10
  4.03,  // [3]  Bay 9
  4.75,  // [4]  Bay 8
  4.76,  // [5]  Bay 7
  4.04,  // [6]  Bay 6
  4.75,  // [7]  Bay 5
  4.02,  // [8]  Bay 4
  4.75,  // [9]  Bay 3
  4.76,  // [10] Bay 2
  4.47,  // [11] Bay 1  (bow / fore / right edge on screen)
]

BW               = BAY_LENGTHS_M.map(m => round(m × M))   (px widths)
BL_              = cumulative bay-left-edge positions in px,
                   accounting for one JOINT_PX gap between adjacent bays
TW               = 1707 px           (total canvas width: 12 bays + 11 joints)
DECK_LENGTH_M    = 54.92 m           (53.27 m bays + 1.65 m joints)
```

**Visual render order (do not reorder):**

```
Bay 12 → Bay 11 → Bay 10 → Bay 9 → Bay 8 → Bay 7 →
Bay 6  → Bay 5  → Bay 4  → Bay 3 → Bay 2 → Bay 1
```

⚠ `BAY_LENGTHS_M` is stored in visual render order, NOT numerical
Bay-1-to-Bay-12 order. Do not flip the array. Index `i` corresponds to
Bay `12 − i`.

⚠ Joints between bays are **physical 0.15 m steel plates**, NOT
zero-width CSS borders. Rendered as `.bay-joint` elements with real
proportional width.

⚠ Do not hardcode the pre-correction values anywhere. The old deck
length (53.7 m), old canvas width (1651 px), and the old
`BW = [129,126,147,126,147,147,126,147,126,147,144,139]` are
archaeologically wrong and must not be reintroduced.

**Aft tiger-striped reference strip:** 1.00 m longitudinal, positioned
INSIDE Bay 12 at its aft (stern) edge. Does NOT add to deck length —
absorbed within Bay 12's 4.15 m span. Rendered via
`addZone(cv, 0, 0, m2px_w(1.0), CVH, 'tiger', '')`.

These values are calibrated to the physical vessel by direct on-board
measurement. Changing any of them breaks spatial accuracy and cargo
placement fidelity.

### Scale model — metres vs pixels (authoritative)

See the **FINAL SCALE MODEL** architecture block in `src/app.js`
(just above `deckXToMeters`) for the full rules. Summary:

- **Cargo size**: stored in metres (`length_m`, `width_m`); pixel size
  derived via `m2px_w(length_m)` and `m2px_h(width_m)`. Metres are the
  single source of truth.
- **Position readouts** (ruler, status bar, keyboard coord tip):
  MUST use `deckXToMeters(xPx)` and `deckYToMeters(yPx)`. These walk
  the real bay/joint segments so the reading is the physical model,
  not the rounded-pixel canvas.
- **Ruler tool**: always uses `deckXToMeters` / `deckYToMeters`.
- **Raw `xPx / M`** is acceptable ONLY for local cargo size math
  (e.g. reading `cargo.w / M` back to metres inside one cargo), NEVER
  for full-deck or position readouts — cumulative rounding drift
  invalidates it across multiple bay/joint segments.

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
