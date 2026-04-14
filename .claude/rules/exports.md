# Export Rules (PDF / Excel / JSON)

## PDF Export Pipeline

The PDF export has been through 6 iterations. The current working pipeline is:

1. `exportPDF()` → prepares deck (reset zoom, hide controls, hide body::before, swap zone gradients)
2. `html2canvas(dcv)` captures the live deck as a raster image
3. `buildPDF(deckCanvas)` draws header/locations/DG/deck image/footer with jsPDF
4. `canvas.toBlob()` → `Uint8Array` → `doc.addImage(bytes, 'PNG')` — **NEVER use `canvas.toDataURL()`**
5. Menu handler (`menuExportPDF()`) opens native Save As dialog FIRST, stores path in `window._pendingPdfPath`
6. `buildPDF` reads `window._pendingPdfPath` and writes via `write_file_bytes` Rust command
7. Browser fallback: `doc.save(fileName)` for non-Tauri mode

### What WILL break PDF export:

- Using `canvas.toDataURL()` — "The operation is insecure" in Tauri WebView2
- Using `doc.addImage(canvas)` directly — jsPDF calls toDataURL internally
- `allowTaint: false` on html2canvas without hiding body::before noise texture
- `contain: paint` on `.cb` elements
- Any `overflow: hidden` on `.dcv` or `.deck-outer`
- Calling `window.open()` or `window.print()` in Tauri (popup blocked)

### Zone patterns during capture:

Before html2canvas, zone elements get diagnostic solid-color fills (the CSS `repeating-linear-gradient` doesn't render in html2canvas). Originals are restored after capture.

## Excel Export Pipeline

1. `menuExportExcel()` opens native Save As dialog, stores path in `window._pendingXlsxPath`
2. `exportExcel()` builds workbook with `XLSX.utils`
3. `_saveWorkbook(wb)` reads `window._pendingXlsxPath`, writes via `write_file_bytes`
4. Browser fallback: `XLSX.writeFile(wb, fileName)`

## JSON Project Save

- `menuSave()` → overwrites `_currentFilePath` if exists, else calls `menuSaveAs()`
- `menuSaveAs()` → ALWAYS opens native dialog via `import('@tauri-apps/plugin-dialog')`
- Envelope format: `{ _schema: 3, plan: { cargo, activeLocs, dynColors, ... } }`

## Critical: Native Dialogs

ALL save/export in Tauri mode MUST use native dialogs — never write directly to Downloads.
The `_isTauri()` function (not a const!) checks `window.__TAURI__` at runtime.
