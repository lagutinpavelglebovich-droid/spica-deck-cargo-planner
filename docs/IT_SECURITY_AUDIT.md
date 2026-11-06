# DECARGO (SPICA TIDE Deck Cargo Planner) — IT Security Audit

**Prepared for:** Simon Davidson, IT Support Manager, Tidewater IT
**Version reviewed:** 3.43.0 (git `main`). The first review (3.42.2, commit `b6893bf`) found ten issues; this revision checks every address and every claim again against the 3.43.0 source.
**Date:** 2026-11-06
**Method:** Static review of the source code and configuration, plus runtime checks:
- the production web bundle run in Chromium under the shipped Content Security Policy, with every outbound request recorded;
- `cargo audit` on the Rust dependencies;
- `npm audit --omit=dev` on the JavaScript dependencies.

Evidence is given as `file:line`. Anything that can only be confirmed on Windows is marked **CHECK ON WINDOWS**.

Short version for IT: `docs/IT_SECURITY_NOTE.md`.

---

## A. Statements made to IT, checked against 3.43.0

| # | Statement | Verdict | Evidence |
|---|---|---|---|
| 1 | The app goes to the internet only for the Open-Meteo forecast (platform coordinates) and for the update check, which can be switched off | **TRUE, with map tiles added to the list.** Tiles load only while the position-check map is open, and they can be switched off. The update check can now be switched off completely. | Section B |
| 2 | Only platform coordinates are sent | **TRUE.** City search, reverse geocoding and the browser location request are deleted. The forecast and map requests carry only coordinates of the plan's working locations, or a grid of sea points around them for the wind map. | `src/weather/api.js` (now only a WMO-code table); `src/fieldWeather.js:132-137`; `src/weatherMap.js:120-128`; `location.js` and `autoRefresh.js` deleted |
| 3 | Cargo data does not leave the computer | **TRUE.** The cloud sync is deleted, and the only sync goes through a folder on the ship's network. | `src/syncHub.js` (folder only); `src/sync.js` deleted; `src/syncFolder.js:103-152` (local commands only) |
| 4 | Outlook is read locally and read-only | **TRUE.** In addition, attachments are now copied only when imported and deleted straight away. | Section D.1 |
| 5 | The two bridge PCs sync through a shared folder on the ship's network | **TRUE** | `src-tauri/src/shared_sync.rs`; `src/syncFolder.js` |
| 6 | No cloud account and no connection to company systems | **TRUE.** No cloud code is left, and saved cloud credentials are deleted at first start. | `src/app.js:18240-18264` |

---

## B. Outbound network (complete list)

| Host | Purpose | Data sent | When | Switch / policy | Evidence |
|---|---|---|---|---|---|
| `api.open-meteo.com` | Forecast for working locations | Latitude/longitude only | At most every 30 min while open (checked every 5 min) | Smart Tools → Internet → *Weather forecast*; policy `weather` | `src/fieldWeather.js:17,108-112,124-130,170-177` |
| `api.open-meteo.com` | Wind & waves map | Grid of sea points around the working locations | When the map is opened, if older than 90 min | Same | `src/weatherMap.js:21,27,110-128` |
| `marine-api.open-meteo.com` | Waves / swell | Same coordinates | With the requests above | Same | `src/fieldWeather.js:18`, `src/weatherMap.js:22` |
| `tile.openstreetmap.org`, `tiles.openseamap.org` | Tiles in the position-check map | Tile x/y/z | Only while that map is open | *Online map tiles*; policy `maps` | `src/locMap.js:50-53,67-72` |
| `github.com` → `release-assets.githubusercontent.com` | Signed update manifest `latest.json` and the signed update package | Nothing besides the request | 8 s after start, every 3 h, after wake/reconnect when due; manual button | *Check for updates automatically*; policy `updates` (`off` blocks manual checks and downloads too) | `src-tauri/tauri.conf.json:74-79`; `src/app.js:17240-17255,17337,17568-17586` |

Notes on the update host:
- Redirect target verified on 2026-11-06 with a real request. Older releases were served from `objects.githubusercontent.com`.
- The update request is made by the Rust updater (reqwest/rustls), so the WebView's CSP does not apply to it.

**Removed since 3.42.2:**
- `geocoding-api.open-meteo.com` (search and reverse);
- the `navigator.geolocation` prompt;
- the CouchDB cloud-sync endpoint;
- the `api.github.com` update fallback. This remains only in the browser development build (`src/app.js:17288`); the desktop path returns before reaching it, and the CSP refuses the host.

**Telemetry, analytics, crash reporting:** none. A search for sentry / analytics / posthog / mixpanel / sendBeacon / bugsnag / segment in `src/` and `src-tauri/src/` finds nothing.

**Listening ports:** none in the product. The only `TcpListener` is in a test (`src-tauri/src/vision.rs:699-722`, `#[cfg(test)]`).

**Capabilities:** 3.43 removed the permissions that let the interface open arbitrary web addresses (section D.6).

**Runtime check:**
- The production bundle was served with the shipped CSP and run in Chromium, recording every request.
- The app itself requested only the Open-Meteo forecast and marine hosts, and only with coordinates.
- Test requests to `geocoding-api.open-meteo.com`, `api.github.com`, `http://example.com` and an image on another host were refused by the CSP.
- Tiles from both tile hosts loaded.
- No geolocation call was made.
- After the first start, an old saved city and old cloud credentials were gone from storage.

---

## C. Content Security Policy

`src-tauri/tauri.conf.json:25`:

```
connect-src 'self' ipc: http://ipc.localhost https://api.open-meteo.com https://marine-api.open-meteo.com
img-src     'self' data: blob: https://tile.openstreetmap.org https://tiles.openseamap.org
```

- There is no bare `https:` or `http:`.
- `http://ipc.localhost` is Tauri's local IPC channel inside the process on Windows, not a network host.
- The other directives are unchanged: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `form-action 'none'`, `frame-ancestors 'none'`.

---

## D. Other findings

### D.1 Outlook (`src-tauri/src/main.rs:202-333`, `src/mailWatch.js:53-125`)

- **Mechanism:** `powershell.exe` with the script on stdin and no window (`main.rs:263-279`). There is no `-EncodedCommand` and no execution-policy change.
- **Scope:** COM `GetDefaultFolder(6)` = default Inbox (`main.rs:293`), last 7 days (`mailWatch.js:17`), attachments under 30 MB (`main.rs:312`), file types xlsx/xlsm/xls/csv/ods/docx/pdf.
- **Scan:** only lists attachment metadata. It no longer saves any file (`main.rs:314-325`).
- **Import (`outlook_fetch`):** copies the one chosen attachment to `%TEMP%\spica-tide-mail` (`main.rs:316-322`). The app reads it, then calls `mail_temp_clear` (`mailWatch.js:115-120`).
- **Clean-up:** the folder is also cleared when the app starts and when it exits (`main.rs`, `.setup` and `RunEvent::Exit`). Start-up clean-up runs in setup, so a second launch handed to the running app by the single-instance plugin never clears it.
- **Frequency:** the scan (`powershell.exe` + COM) runs 20 s after start and then every 3 min while the app is open, on by default (`mailWatch.js:17,45-51`). It is switched off with *Watch* in the Import window.
- **Writes to the mailbox:** none (no Send / Move / Delete / read flag).
- **CHECK ON WINDOWS:** Outlook scan and import work with a real mailbox, and `%TEMP%\spica-tide-mail` is empty after an import and after closing the app.

### D.2 Update switches and IT policy

- *Check for updates automatically* gates every automatic check: launch, 3-hourly, online, wake (`src/app.js:17251`). The manual button still works.
- The policy file is `%ProgramData%\Decargo\policy.json`, read by `it_policy` (`src-tauri/src/main.rs:348-375`).
  - Only the keys `updates` / `weather` / `maps` with the values `on` / `off` are accepted. Anything else is ignored.
  - A policy value overrides the user's switch and locks it with "Managed by your IT policy" (`src/netPolicy.js`, `src/app.js:17523-17566`, `index.html:1594-1636`).
  - `updates: off` also disables the About check button and all downloads (`src/app.js:17247-17250,17337`).
- Forecast and update requests wait for the policy before going out (`netReady()`; `src/fieldWeather.js:110,128`, `src/weatherMap.js:112`, `src/app.js:17246`). The wait is capped at 4 s, so a missing shell command cannot keep the app offline. In practice the policy is read within milliseconds of start-up, long before the first request: weather comes after 1.5 s, the update check after 8 s, and map tiles only when the user opens the map.
- Precedence, locking, unknown values and the no-file case are covered by `tools/test-net-policy.mjs`.
- **CHECK ON WINDOWS:** a real `policy.json` locks the switches.

### D.3 Cloud sync removed

- **Deleted:** `src/sync.js`, the Ship network / Cloud selector, the URL / database / user / password fields (`index.html` around line 1866), and every cloud branch in `src/app.js`.
- **Kept:** the Test and *Save & Enable* buttons. These belong to the shared-folder setup.
- **First start of 3.43:**
  - removes `spicaTide_syncAuth` from WebView storage;
  - removes `syncAuth` from the app's store file `sync-config.json`;
  - drops any non-folder sync config (`src/app.js:18240-18264`).
- What's New entries that mentioned the cloud were reworded (`src/releaseNotes.js`).

### D.4 File associations

- Only `.spica` is registered (`src-tauri/tauri.conf.json:52-58`).
- When 3.43 is installed over an older build, the hook `src-tauri/windows/hooks.nsh` removes Decargo's per-user `.json` default and deletes the `HKCU\Software\Classes\json` class. It acts only if that class still points at Decargo.
- Each earlier install or update overwrote the installer's `json_backup` value with Decargo's own class, so the original owner usually cannot be restored. The default is cleared instead, and `.json` opens with whatever program Windows uses without Decargo. A genuine earlier value is put back when one exists.
- **CHECK ON WINDOWS:** after an upgrade, double-clicking a `.json` file no longer opens Decargo.

### D.5 Data at rest (unchanged)

- Everything is in plain files under `%APPDATA%\com.spicatide.app\` (`src-tauri/src/main.rs:17-22`): autosave, 30 backups (`store.rs:21`), recent files (max 10), licence key and state, and `sync-config.json` (folder path only).
- WebView storage is in `%LOCALAPPDATA%\com.spicatide.app\EBWebView\`. It holds settings and the forecast cache. Since 3.43 it holds no city name, PC position or password.
- Nothing is encrypted; BitLocker is recommended.

### D.6 Privileges (unchanged)

- Per-user NSIS installer, no admin rights (`tauri.conf.json:64`). No service, autostart, scheduled task or driver.
- **Capabilities** (`src-tauri/capabilities/default.json`): dialog, store, updater, process restart, and `opener:allow-open-path` restricted to the app's own print PDFs. There is no file-system plugin scope.
- 3.43 also removed `shell:allow-open` and `opener:default`. Together they would have let the interface open any http/https/mailto/tel address in the default program. Nothing used them.
- **External process:** only `powershell.exe`, for Outlook.

### D.7 Licence (unchanged)

- Offline Ed25519 verification against an embedded public key (`src-tauri/src/license.rs`). No server.
- The write commands refuse without a valid licence (`main.rs:45,51,58,134,386`).

---

## E. Dependencies

**npm:** `npm audit --omit=dev` reports **0 vulnerabilities** (2026-11-06).

**cargo-audit 0.22.2** (advisory database of 2026-11-06). First run: 15 vulnerabilities and 17 warnings. After `cargo update` of semver-compatible versions:

| Crate | Was → now | Advisories | Status |
|---|---|---|---|
| rustls | 0.23.38 → 0.23.46 | RUSTSEC-2026-0285 / -0346 / -0348 / -0349 | **Fixed** |
| rustls-webpki | 0.103.11 → 0.103.16 | RUSTSEC-2026-0098 / -0099 / -0104 / -0382 | **Fixed** |
| webpki-root-certs | 1.0.6 → 1.0.11 | RUSTSEC-2026-0383 | **Fixed** |
| tokio, anyhow, event-listener, async-executor (yanked) | updated to the latest compatible versions | unsound / yanked warnings | **Fixed** |
| quick-xml 0.38.4 | — | RUSTSEC-2026-0194 / -0195 (slow parsing / memory on hostile XML) | **Not in the Windows build.** It enters only through `plist`, a macOS dependency of Tauri. `cargo tree --target x86_64-pc-windows-msvc -i quick-xml` is empty. |
| zip 4.6.1 | — | RUSTSEC-2026-0367 / -0368 / -0369 / -0429 (symlink and Unix-permission handling on extraction) | **Accepted, documented.** Used only by `tauri-plugin-updater` 2.10.1 (the latest stable) to unpack the update package. The updater verifies the package's minisign signature against the app's built-in key before unpacking, so only archives signed by the developer are ever extracted. Fix: updater 3.x, currently alpha only. |
| fxhash, unic-* | — | unmaintained | **Accepted.** Build-time and URL-pattern helpers inside Tauri; no known vulnerability. |
| rand 0.8.5 | — | RUSTSEC-2026-0097 (unsound only with a custom logger that calls `rand::rng()`) | **Not applicable.** The app installs no such logger. |
| glib, zbus*, zvariant*, proc-macro-error | — | unmaintained / unsound | **Not in the Windows build** (Linux GTK/D-Bus stack). |

**ONNX Runtime binding `ort`:** stays pinned to the exact version `=2.0.0-rc.12` (`src-tauri/Cargo.toml:28`).
- There is no stable 2.x release; the newest is `2.0.0-rc.15`. The only stable line, 1.x, is an older, incompatible API without the `api-24` / OpenVINO features the vision engine uses.
- Moving to rc.15 means a new ONNX Runtime binary (1.31) and a full re-test of number reading on real deck video. That is not part of this security release.
- The exact pin means the build cannot drift to another pre-release unnoticed.

---

## F. Issues from the first review

| # | Issue (3.42.2) | 3.43.0 |
|---|---|---|
| 1 | Outbound list broader than stated | **Fixed.** Geocoding, geolocation, cloud and the GitHub API fallback were removed; the full list is in section B and the IT note. |
| 2 | CSP allowed any host | **Fixed.** Exact hosts only (section C). |
| 3 | Update check could not be switched off | **Fixed.** New switch plus `policy.json`. |
| 4 | Installer not Authenticode-signed | **Open.** Needs a code-signing certificate. The installer's SHA-256 is published with the release; the update package stays minisign-signed. |
| 5 | Dormant CouchDB sync with plaintext password | **Fixed.** Removed; stored credentials are deleted. |
| 6 | Geocoding sent text / PC position | **Fixed.** Removed. |
| 7 | Generic `.json` association | **Fixed.** Removed, and cleaned up on upgrade. |
| 8 | Outlook attachments left in `%TEMP%` | **Fixed.** Copied only on import and deleted, plus clean-up at start and exit. |
| 9 | Rust dependencies not scanned; `ort` is an RC | **Done.** Scanned and fixed where possible, the remainder documented; `ort` stays exact-pinned (section E). |
| 10 | Data unencrypted (informational) | **Unchanged.** BitLocker recommended. |
