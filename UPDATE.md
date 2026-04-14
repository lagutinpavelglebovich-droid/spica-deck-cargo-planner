# SPICA TIDE — Auto-Update Setup Guide

## How It Works

The app checks for updates every 5 days (non-blocking, 8s after launch).  
If a new version is found, a banner appears: **"New version X.X available — [Update] [Later]"**.  
Clicking **Update** downloads, installs, and prompts to restart.  
Manual check: **Help → Check for Updates**.  
If offline or no update — silent, nothing shown.

---

## One-Time Setup: Signing Keys

### 1. Generate keys

```bash
npx tauri signer generate -w ~/.tauri/spica-tide.key
```

This outputs:
- **Private key** — saved to `~/.tauri/spica-tide.key`
- **Password** — shown in terminal (save it securely)
- **Public key** — shown in terminal (copy it)

### 2. Add public key to tauri.conf.json

Open `src-tauri/tauri.conf.json` and replace the placeholder:

```json
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/lagutinpavelglebovich-droid/spica-deck-cargo-planner/releases/latest/download/latest.json"],
    "pubkey": "PASTE_YOUR_PUBLIC_KEY_HERE"
  }
}
```

### 3. Add secrets to GitHub repository

Go to **Settings → Secrets and variables → Actions** and add:

| Secret Name | Value |
|------------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of `~/.tauri/spica-tide.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password from step 1 |

---

## Releasing a New Version

### 1. Bump version in BOTH files (must match)

- `package.json` → `"version": "X.Y.Z"`
- `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`

The CI workflow validates these match the tag — mismatches fail the build.

### 2. Commit, tag, and push

```bash
git add package.json src-tauri/tauri.conf.json
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

### 3. GitHub Actions builds automatically

The `release.yml` workflow:
1. Validates version consistency (tag = package.json = tauri.conf.json)
2. Builds the Windows NSIS installer
3. Signs the binary with your private key
4. Creates a GitHub Release with:
   - `.exe` installer
   - `.exe.sig` signature file
   - `latest.json` update manifest (auto-generated)

### 4. Running apps detect the update

Within 5 days (or via Help → Check for Updates), the app fetches
`latest.json` from GitHub Releases, compares versions, and shows
the update banner if newer.

---

## Safe Test Flow

To test the update mechanism without affecting production:

### Test from v1.8.0 → v1.8.1

1. **Install the current build** (v1.8.0) on a test machine

2. **Bump to v1.8.1:**
   ```bash
   # In package.json: "version": "1.8.1"
   # In src-tauri/tauri.conf.json: "version": "1.8.1"
   ```

3. **Tag and push:**
   ```bash
   git tag v1.8.1
   git push --tags
   ```

4. **Wait for CI** — the release appears at:
   `https://github.com/lagutinpavelglebovich-droid/spica-deck-cargo-planner/releases/tag/v1.8.1`

5. **Verify `latest.json`** is a release asset:
   ```
   https://github.com/lagutinpavelglebovich-droid/spica-deck-cargo-planner/releases/latest/download/latest.json
   ```
   It should contain `"version": "1.8.1"` and a `windows-x86_64` platform entry.

6. **On the test machine** running v1.8.0:
   - Go to **Help → Check for Updates**
   - The banner should appear: "New version 1.8.1 available"
   - Click **Update** — downloads, installs, prompts restart
   - After restart, verify the app shows v1.8.1

### Using prerelease tags for testing

To avoid polluting "latest", use prerelease tags:

```bash
git tag v1.8.1-beta.1
git push --tags
```

Then temporarily change the endpoint in `tauri.conf.json` to point to that specific tag:
```
https://github.com/.../releases/download/v1.8.1-beta.1/latest.json
```

After testing, switch back to the `/latest/download/latest.json` endpoint.

---

## File Overview

| File | Purpose |
|------|---------|
| `src-tauri/tauri.conf.json` | Updater endpoints, public key, `createUpdaterArtifacts` |
| `src-tauri/Cargo.toml` | `tauri-plugin-updater = "2"` |
| `src-tauri/src/main.rs` | Plugin registration |
| `src-tauri/capabilities/default.json` | Updater permissions |
| `src/app.js` | Check logic, banner UI, download+install, menu action |
| `index.html` | Update banner HTML, Help → Check for Updates menu item |
| `.github/workflows/release.yml` | Build + sign + publish on tag |
| `.github/workflows/build-windows.yml` | CI build on push to main |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Update check failed" | Check internet; verify `latest.json` URL is reachable |
| Signature mismatch | Regenerate keys; update `pubkey` in config AND secrets in GitHub |
| Release not detected | Ensure tag format is `vX.Y.Z`; check versions match |
| Build fails: version mismatch | Tag, package.json, and tauri.conf.json versions must be identical |
| No `latest.json` in release | Ensure `createUpdaterArtifacts: "v1Compatible"` is in bundle config |
| CI fails: missing secrets | Add `TAURI_SIGNING_PRIVATE_KEY` + password to repo secrets |
