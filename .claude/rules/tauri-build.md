# Tauri Build Rules

## Icons

- ALL PNGs in `src-tauri/icons/` MUST be **RGBA** (color type 6), not RGB
- Verify with `file *.png` — must say "8-bit/color RGBA"
- After replacing icons, ALWAYS delete `src-tauri/target/` and rebuild
- `sips` on macOS preserves source color type — if source is RGBA, output is RGBA
- ICO must be built from RGBA PNGs, not raw bitmap data

## Config Files

- `src-tauri/tauri.conf.json` — window title, version, bundle targets, icon paths
- `src-tauri/capabilities/default.json` — plugin permissions (dialog, fs, updater)
- `src-tauri/Cargo.toml` — Rust dependencies, version

## Permissions (capabilities/default.json)

Required permissions for current features:
- `core:default` — basic Tauri
- `dialog:default`, `dialog:allow-save`, `dialog:allow-open`, `dialog:allow-message`, `dialog:allow-ask` — file dialogs + close confirmation
- `fs:default`, `fs:allow-read`, `fs:allow-write` — file I/O
- `updater:default`, `updater:allow-check`, `updater:allow-download-and-install` — auto-update

Adding a new Tauri plugin? Add its permissions here or save/open will silently fail.

## Common Tauri Errors

| Error | Cause | Fix |
|---|---|---|
| "icon.png is not RGBA" | PNG is RGB color type | Convert to RGBA: ensure alpha channel exists |
| "dialog save not allowed" | Missing capability | Add `dialog:allow-save` to capabilities |
| `window.__TAURI__` undefined at import | ES module loads before Tauri injects runtime | Use `_isTauri()` function, not const |
| `proc macro panicked` on icons | Any referenced PNG is not RGBA | Check ALL PNGs in icons/, not just icon.png |
| NSIS config invalid | Wrong keys in `bundle.windows.nsis` | Check Tauri v2 schema — only `installerIcon`, `installMode`, `languages`, `startMenuFolder` |
| `plugins.dialog: invalid type` | Empty object `{}` not accepted | Remove plugins block from tauri.conf.json entirely |

## Rust Commands

Defined in `src-tauri/src/main.rs`:
- `write_file(path, contents)` — string write
- `write_file_bytes(path, bytes)` — binary write (for PDF/Excel)
- `read_file(path)` — string read
- `get_recent_files()` / `add_recent_file(path, name)` — recent files list

## Build Commands

```bash
npm run tauri dev     # Development
npm run tauri build   # Production Windows installer
npm run release       # vite build + tauri build
```

## GitHub Actions

- `build-windows.yml` — builds on push to main / tags, uploads .exe artifact
- `release.yml` — creates GitHub Release on `v*` tags
