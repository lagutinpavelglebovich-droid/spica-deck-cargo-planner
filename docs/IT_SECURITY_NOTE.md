# Decargo (SPICA TIDE Deck Cargo Planner) — note for IT

Version 3.43.0 · prepared for Tidewater IT · technical detail with source references: `docs/IT_SECURITY_AUDIT.md`

## What it is

A Windows desktop application (Tauri 2: a Rust program with the system WebView2 for the user interface) for planning deck cargo on a PSV. It was written by the vessel's Chief Officer.

- **Installer:** `SPICA.TIDE.Deck.Cargo.Planner_3.43.0_x64-setup.exe` (NSIS), about 245 MB. Most of the size is the offline text and number recognition models.
- **Install scope:** per user, under `%LOCALAPPDATA%`. **No administrator rights** are needed. No service, scheduled task, auto-start or driver is installed.
- **Registry and file types:** the standard per-user uninstall entry and Start menu shortcut. The only file type registered is `.spica`. Installing over an older version removes the `.json` association those versions added, so `.json` opens with the program Windows uses by default.
- **WebView2:** required. It is built into Windows 11 and up-to-date Windows 10. If it is missing, the installer downloads Microsoft's WebView2 bootstrapper from Microsoft's download servers. This happens only at install time.

## Data on the computer

| Where | What |
|---|---|
| `%APPDATA%\com.spicatide.app\autosave\`, `backups\` | Current deck plan; the last 30 automatic backups plus one per recent day |
| `%APPDATA%\com.spicatide.app\` (`recent.json`, `licence.key`, `licence-state.json`, `sync-config.json`) | Recent files (max 10), licence key, path of the shared sync folder |
| `%LOCALAPPDATA%\com.spicatide.app\EBWebView\` | Interface settings and the weather forecast cache |
| Shared folder chosen by the user (ship network) | `decargo-plan.json` and the last 30 versions in `history\` |

A plan holds cargo units (container numbers, weights, descriptions, dangerous-goods classes), voyage number and platform names. **Files are not encrypted on disk**, so BitLocker is recommended on bridge PCs. No passwords are stored.

## Network

| Host | Purpose | Data sent | When | How to turn off |
|---|---|---|---|---|
| `api.open-meteo.com` | Wind, weather | Latitude/longitude of the working platforms. The wind map also sends a grid of sea points around them | At most every 30 min while the app is open; when the wind map is opened | Smart Tools → Internet → Weather forecast, or policy `"weather":"off"` |
| `marine-api.open-meteo.com` | Waves, swell | Same coordinates | Same | Same |
| `tile.openstreetmap.org`, `tiles.openseamap.org` | Map tiles | Tile numbers (the map area being viewed) | Only while the position-check map is open | Smart Tools → Internet → Online map tiles, or policy `"maps":"off"` |
| `github.com` → `release-assets.githubusercontent.com` | Update check (`latest.json`) and download | Nothing besides the request itself | 8 s after start, every 3 h, after sleep/reconnect; manual button | Smart Tools → Internet → Check for updates automatically; policy `"updates":"off"` blocks all update traffic |

**No telemetry, no analytics, no crash reporting, no listening ports.** The two bridge PCs sync **only through a shared folder on the ship's network**. There is no cloud account, no external server and no connection to company systems. The cloud sync of earlier versions was removed in 3.43, and any saved credentials for it are deleted on first start.

The app's Content Security Policy lets it connect only to the Open-Meteo hosts above and load images only from the two tile hosts. The app has no permission to open web addresses in a browser. Updates are handled by the Rust updater, which checks a minisign signature against a public key built into the app before installing.

## Outlook

The app reads the **default Inbox of classic Outlook on the same PC**: the last **7 days**, messages with load-list, backload or manifest attachments. It uses COM automation through a local PowerShell script (`powershell.exe`, no window). The script is passed on standard input: no encoded command, no execution-policy change.

The check runs 20 seconds after start-up and then **every 3 minutes** while the app is open (and Outlook is running). It is on by default and is switched off with **Watch** in the Import window. Endpoint security software will see these PowerShell starts.

Access is **read only**: nothing is sent, moved, deleted or marked as read. The scan only lists attachments. When the officer imports one, that one attachment is copied to `%TEMP%\spica-tide-mail`, read, and deleted at once. The folder is also emptied at start-up and at exit.

## Text recognition and camera

Container-number reading uses PP-OCRv5 and RF-DETR models through ONNX Runtime with OpenVINO, all shipped in the installer. Scanned manifests use Tesseract. **All processing is local.** No images or video leave the PC, and camera recordings are saved only to a folder the user chooses.

## Licence

The licence is checked **offline**: an Ed25519 signature is verified against a public key built into the app. No licence server is involved.

## IT policy file (optional)

`%ProgramData%\Decargo\policy.json`, UTF-8, for example:

```json
{"updates":"off","weather":"on","maps":"on"}
```

| Key | Values | Effect |
|---|---|---|
| `updates` | `on` / `off` | `off`: no contact with GitHub at all (no automatic check, the manual check button is disabled, no downloads). `on`: automatic checks forced on |
| `weather` | `on` / `off` | Open-Meteo forecasts allowed or blocked |
| `maps` | `on` / `off` | Map tiles allowed or blocked (the map still works without a background) |

A key in the file overrides the user's switch and locks it with the label "Managed by your IT policy". A missing key, missing file or any other value leaves the user's setting in force. The file is read at start-up.

## Firewall allow-list (exact host names, HTTPS 443)

`api.open-meteo.com`, `marine-api.open-meteo.com`, `tile.openstreetmap.org`, `tiles.openseamap.org`, `github.com`, `release-assets.githubusercontent.com` (older GitHub releases used `objects.githubusercontent.com`).

Everything else can be blocked. With all of them blocked, planning, export, Outlook import, recognition, licence and ship-network sync still work. The app then runs without forecasts, map tiles or updates.

## Known limitation

The installer and the program are **not yet Authenticode-signed**, so Windows SmartScreen shows "unknown publisher". To check the file, compare its SHA-256 with the value below (`certutil -hashfile <file> SHA256`). The update package is signed with minisign.

- Installer SHA-256: `see the release notes of v3.43.0` <!-- filled in from the release build -->
