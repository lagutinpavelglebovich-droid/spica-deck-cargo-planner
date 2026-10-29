// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod shared_sync;
mod store;
mod license;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Get the app data directory for storing recent files list
fn app_data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("com.spicatide.app");
    fs::create_dir_all(&dir).ok();
    dir
}

fn recent_file_path() -> PathBuf {
    app_data_dir().join("recent.json")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct RecentFile {
    path: String,
    name: String,
    #[serde(rename = "openedAt")]
    opened_at: String,
}

/* v3.37 — file commands run off the UI thread: a slow or vanished network
   path must never freeze the window (sync commands run on the main thread
   in Tauri v2). */
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn write_file(path: String, contents: String) -> Result<(), String> {
    license::require()?;
    blocking(move || store::atomic_write(std::path::Path::new(&path), contents.as_bytes()).map_err(|e| format!("Write failed: {}", e))).await
}

#[tauri::command]
async fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    license::require()?;
    blocking(move || store::atomic_write(std::path::Path::new(&path), &bytes).map_err(|e| format!("Write failed: {}", e))).await
}

/* v3.36 — durable autosave + rolling backups in the app data folder */
#[tauri::command]
async fn autosave_store(contents: String, backup: bool) -> Result<Option<String>, String> {
    license::require()?;
    tauri::async_runtime::spawn_blocking(move || store::autosave_store(&app_data_dir(), &contents, backup))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn autosave_read() -> Option<String> {
    store::autosave_read(&app_data_dir())
}

#[tauri::command]
async fn backups_list() -> Vec<store::BackupInfo> {
    tauri::async_runtime::spawn_blocking(|| store::backups_list(&app_data_dir())).await.unwrap_or_default()
}

#[tauri::command]
fn backup_read(file: String) -> Result<String, String> {
    store::backup_read(&app_data_dir(), &file)
}

const MAX_TEXT_READ: u64 = 50 * 1024 * 1024; // plans and manifests are KBs–MBs

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    blocking(move || {
        let len = fs::metadata(&path).map_err(|e| format!("Read failed: {}", e))?.len();
        if len > MAX_TEXT_READ {
            return Err(format!("Read failed: file is too large ({} MB)", len / 1_048_576));
        }
        fs::read_to_string(&path).map_err(|e| format!("Read failed: {}", e))
    }).await
}

#[tauri::command]
fn get_recent_files() -> Vec<RecentFile> {
    let path = recent_file_path();
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
fn add_recent_file(path: String, name: String) -> Vec<RecentFile> {
    let mut recents = get_recent_files();

    // Remove existing entry for this path (if any)
    recents.retain(|r| r.path != path);

    // Prepend new entry
    recents.insert(
        0,
        RecentFile {
            path,
            name,
            opened_at: chrono_now(),
        },
    );

    // Cap at 10
    recents.truncate(10);

    // Persist
    if let Ok(json) = serde_json::to_string_pretty(&recents) {
        store::atomic_write(&recent_file_path(), json.as_bytes()).ok();
    }

    recents
}

/// v3.16 — append raw bytes to a file (deck-camera recording). The bytes
/// arrive as a raw IPC body (no JSON), the target path in the `x-path`
/// header, percent-encoded so non-ASCII folder names survive.
#[tauri::command]
fn append_file_raw(request: tauri::ipc::Request<'_>) -> Result<u64, String> {
    license::require()?;
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(pct_decode)
        .ok_or_else(|| "missing x-path header".to_string())?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(d) => d,
        _ => return Err("expected raw bytes".into()),
    };
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent).ok();
    }
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Open failed: {}", e))?;
    f.write_all(data).map_err(|e| format!("Write failed: {}", e))?;
    Ok(f.metadata().map(|m| m.len()).unwrap_or(0))
}

/// v3.16 — read a whole file as raw bytes (mail attachments → import).
#[tauri::command]
async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || {
        let len = fs::metadata(&path).map_err(|e| format!("Read failed: {}", e))?.len();
        if len > MAX_TEXT_READ * 2 {
            return Err(format!("Read failed: file is too large ({} MB)", len / 1_048_576));
        }
        fs::read(&path).map_err(|e| format!("Read failed: {}", e))
    }).await.map(tauri::ipc::Response::new)
}

/// v3.16 — make sure a folder exists (recordings folder).
#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Folder failed: {}", e))
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let h = |c: u8| -> Option<u8> {
                match c {
                    b'0'..=b'9' => Some(c - b'0'),
                    b'a'..=b'f' => Some(c - b'a' + 10),
                    b'A'..=b'F' => Some(c - b'A' + 10),
                    _ => None,
                }
            };
            if let (Some(x), Some(y)) = (h(b[i + 1]), h(b[i + 2])) {
                out.push(x * 16 + y);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// v3.16 — look through the classic Outlook Inbox on THIS computer for
/// recent mail with load-list / backload / manifest attachments. Read
/// only: attachments are copied to %TEMP%\spica-tide-mail and their
/// paths returned as JSON. Nothing leaves the computer. Windows only.
#[tauri::command]
async fn outlook_scan(days: u32, max_items: u32, pattern: String) -> Result<String, String> {
    #[cfg(not(windows))]
    {
        let _ = (days, max_items, pattern);
        Err("Outlook scanning is available on Windows only".into())
    }
    #[cfg(windows)]
    {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        // The script goes in as plain text on stdin — no -EncodedCommand and
        // no execution-policy override, so it reads like any admin one-liner.
        let script = OUTLOOK_PS
            .replace("__DAYS__", &days.min(60).to_string())
            .replace("__MAX__", &max_items.clamp(20, 2000).to_string())
            .replace("__PATTERN__", &pattern.replace('\'', "''").replace(|c: char| !c.is_ascii(), ""));
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-NoLogo", "-Command", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("PowerShell failed to start: {}", e))?;
        if let Some(mut si) = child.stdin.take() {
            si.write_all(script.as_bytes()).map_err(|e| format!("PowerShell input failed: {}", e))?;
        }
        let out = child.wait_with_output().map_err(|e| format!("PowerShell failed: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if let Some(line) = stdout.lines().find(|l| l.contains("@@SPICA@@")) {
            return Ok(line.split("@@SPICA@@").nth(1).unwrap_or("").trim().to_string());
        }
        let err: String = String::from_utf8_lossy(&out.stderr).trim().chars().take(500).collect();
        Err(if err.is_empty() { "Outlook scan returned nothing".into() } else { err })
    }
}

#[cfg(windows)]
const OUTLOOK_PS: &str = r#"
$ErrorActionPreference = 'Stop'
$days = __DAYS__; $max = __MAX__; $pattern = '__PATTERN__'
$out = [ordered]@{ ok = $true; running = $true; scanned = 0; items = @() }
function Emit($o) { [Console]::Out.WriteLine('@@SPICA@@' + ($o | ConvertTo-Json -Compress -Depth 4)) }
if (-not (Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)) { $out.running = $false; Emit $out; exit 0 }
try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch { $ol = New-Object -ComObject Outlook.Application }
$inbox = $ol.GetNamespace('MAPI').GetDefaultFolder(6)
$items = $inbox.Items
$items.Sort('[ReceivedTime]', $true)
$since = (Get-Date).AddDays(-$days)
$dir = Join-Path $env:TEMP 'spica-tide-mail'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ext = '\.(xlsx|xlsm|xls|csv|ods|docx|pdf)$'
$n = 0
foreach ($m in $items) {
  $n++
  if ($n -gt $max) { break }
  try {
    if ($m.Class -ne 43) { continue }
    if ($m.ReceivedTime -lt $since) { break }
    if ($m.Attachments.Count -eq 0) { continue }
    $subject = [string]$m.Subject
    foreach ($a in $m.Attachments) {
      $name = [string]$a.FileName
      if ($name -notmatch $ext) { continue }
      if (($name -notmatch $pattern) -and ($subject -notmatch $pattern)) { continue }
      if ($a.Size -gt 31457280) { continue }
      $id = [string]$m.EntryID
      $key = $id.Substring([Math]::Max(0, $id.Length - 24))
      $sub = Join-Path $dir $key
      New-Item -ItemType Directory -Force -Path $sub | Out-Null
      $p = Join-Path $sub ($name -replace '[\\/:*?"<>|]', '_')
      if (-not (Test-Path -LiteralPath $p)) { $a.SaveAsFile($p) }
      $out.items += [ordered]@{ subject = $subject; from = [string]$m.SenderName; received = $m.ReceivedTime.ToString('o'); name = $name; path = $p; size = [int]$a.Size; key = $key }
    }
  } catch { }
}
$out.scanned = $n
Emit $out
exit 0


"#;

/// Simple ISO timestamp without pulling in chrono crate
fn chrono_now() -> String {
    use std::time::SystemTime;
    let d = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    // Return Unix timestamp as string — JS side will format if needed
    format!("{}", d.as_secs())
}

/* v3.28 — local sync through a shared folder (see shared_sync.rs). File work
   on a network share can block, so it runs off the main thread. */
#[tauri::command]
async fn shared_read(dir: String) -> Result<shared_sync::ReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || shared_sync::read_plan(&dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn shared_commit(dir: String, expected: Option<String>, doc: String, force: bool) -> Result<shared_sync::CommitResult, String> {
    license::require()?;
    tauri::async_runtime::spawn_blocking(move || shared_sync::commit_plan(&dir, expected, &doc, force))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn shared_probe(dir: String, write: bool) -> Result<shared_sync::ProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || shared_sync::probe(&dir, write))
        .await
        .map_err(|e| e.to_string())
}

/// v3.38 — licence key status / install (see license.rs)
#[tauri::command]
fn license_status() -> license::Status {
    license::status()
}

#[tauri::command]
fn license_install(key: String) -> Result<license::Status, String> {
    license::install(&key)
}

#[tauri::command]
fn computer_name() -> String {
    shared_sync::computer_name()
}

/// v3.37 — a plan file passed on the command line (double-click on a .spica /
/// .json associated with Decargo, or "Open with"). The executable itself and
/// any switches are skipped because they are not existing plan files.
fn plan_arg<I: IntoIterator<Item = String>>(args: I, cwd: Option<&str>) -> Option<String> {
    args.into_iter().find_map(|a| {
        let l = a.to_lowercase();
        if !(l.ends_with(".spica") || l.ends_with(".json")) {
            return None;
        }
        // a relative argument belongs to the launching process's folder
        let p = std::path::Path::new(&a);
        let full = match cwd {
            Some(dir) if p.is_relative() => std::path::Path::new(dir).join(p),
            _ => p.to_path_buf(),
        };
        if full.is_file() { Some(full.to_string_lossy().into_owned()) } else { None }
    })
}

static LAUNCH_TAKEN: AtomicBool = AtomicBool::new(false);

/// Plans handed over by a second launch. Kept here until the page takes them,
/// so a double-click while the window is still starting is never lost (an
/// event alone is dropped when nothing listens yet).
static PENDING_OPEN: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[tauri::command]
fn take_open_files() -> Vec<String> {
    PENDING_OPEN.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default()
}

/// The file this process was started with — handed out once, so a WebView
/// reload does not open it again over the officer's work.
#[tauri::command]
fn launch_file() -> Option<String> {
    if LAUNCH_TAKEN.swap(true, Ordering::SeqCst) {
        return None;
    }
    plan_arg(std::env::args().skip(1), None)
}

fn main() {
    tauri::Builder::default()
        // must be the first plugin: a second launch (double-click on another
        // plan while Decargo is open) focuses this window and hands it the file
        // instead of starting a second app writing the same autosave.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            if let Some(p) = plan_arg(argv.into_iter().skip(1), Some(&cwd)) {
                if let Ok(mut q) = PENDING_OPEN.lock() {
                    q.push(p);
                }
                let _ = app.emit("decargo://open-file", ());
            }
        }))
        // window size / position / maximised survive a restart; visibility is
        // not restored (a window saved hidden must never come back hidden)
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            write_file,
            write_file_bytes,
            read_file,
            get_recent_files,
            add_recent_file,
            append_file_raw,
            read_file_bytes,
            ensure_dir,
            outlook_scan,
            shared_read,
            shared_commit,
            shared_probe,
            computer_name,
            autosave_store,
            autosave_read,
            backups_list,
            backup_read,
            launch_file,
            take_open_files,
            license_status,
            license_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
