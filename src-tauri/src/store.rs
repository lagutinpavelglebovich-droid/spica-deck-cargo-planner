//! Durable local storage for the plan (v3.36).
//!
//! * `atomic_write` — every file the app writes goes through a temp file in
//!   the same folder, fsync, then rename over the target. A power cut mid
//!   write leaves the old file intact instead of a half-written one.
//! * Autosave — the working plan is also kept as a real file in the app
//!   data folder (`autosave/current.json`), so it survives the WebView's
//!   storage being cleared or reset.
//! * Backups — rolling copies in `backups/plan-<unix ms>.json`, newest
//!   `KEEP` kept. Listing returns a little metadata so the restore window
//!   can show voyage name and cargo count without reading every file in JS.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::shared_sync::retry;

const KEEP: usize = 30;
const DAYS: i64 = 14;
const MAX_READ: u64 = 25 * 1024 * 1024; // a plan is KBs; refuse anything absurd

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// Write `bytes` to `target` atomically (temp file + fsync + rename).
pub fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{}.{}.{}.tmp", name, std::process::id(), now_ms()));
    let written = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new().create_new(true).write(true).open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    // Windows: std::fs::rename replaces an existing target (MOVEFILE_REPLACE_EXISTING);
    // antivirus / indexer locks are retried briefly.
    if let Err(e) = retry(|| fs::rename(&tmp, target)) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

fn sub(base: &Path, name: &str) -> PathBuf {
    let d = base.join(name);
    let _ = fs::create_dir_all(&d);
    d
}

/// Keep the working plan as a file; optionally also drop a backup copy.
pub fn autosave_store(base: &Path, contents: &str, backup: bool) -> Result<Option<String>, String> {
    let cur = sub(base, "autosave").join("current.json");
    atomic_write(&cur, contents.as_bytes()).map_err(|e| format!("Autosave failed: {}", e))?;
    if !backup {
        return Ok(None);
    }
    let dir = sub(base, "backups");
    let name = format!("plan-{}.json", now_ms());
    atomic_write(&dir.join(&name), contents.as_bytes()).map_err(|e| format!("Backup failed: {}", e))?;
    prune(&dir);
    Ok(Some(name))
}

pub fn autosave_read(base: &Path) -> Option<String> {
    read_capped(&base.join("autosave").join("current.json")).ok()
}

fn read_capped(p: &Path) -> std::io::Result<String> {
    let meta = fs::metadata(p)?;
    if meta.len() > MAX_READ {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "file too large"));
    }
    fs::read_to_string(p)
}

fn backup_files(dir: &Path) -> Vec<(u128, String)> {
    let mut v: Vec<(u128, String)> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let n = e.file_name().to_string_lossy().to_string();
                    let ts = n.strip_prefix("plan-")?.strip_suffix(".json")?.parse::<u128>().ok()?;
                    Some((ts, n))
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    v
}

/// Keep the newest `KEEP` copies, plus the newest copy of each of the last
/// `DAYS` calendar days (UTC) — so a busy day of edits never pushes out
/// yesterday's plan.
fn prune(dir: &Path) {
    let files = backup_files(dir); // newest first
    let mut seen_days = std::collections::HashSet::new();
    let today = (now_ms() / 86_400_000) as i64;
    for (i, (ts, n)) in files.into_iter().enumerate() {
        let day = (ts / 86_400_000) as i64;
        let first_of_day = seen_days.insert(day);
        let keep = i < KEEP || (first_of_day && today - day < DAYS);
        if !keep {
            let _ = fs::remove_file(dir.join(n));
        }
    }
}

#[derive(Serialize)]
pub struct BackupInfo {
    pub file: String,
    pub ts: u64,
    pub voyage: String,
    pub cargo: usize,
    pub vessel: String,
    pub ok: bool,
}

pub fn backups_list(base: &Path) -> Vec<BackupInfo> {
    let dir = sub(base, "backups");
    backup_files(&dir)
        .into_iter()
        .map(|(ts, file)| {
            let parsed = read_capped(&dir.join(&file))
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
            let plan = parsed.as_ref().and_then(|v| v.get("plan"));
            let voyage = plan
                .and_then(|p| p.get("voyage")).and_then(|v| v.as_str())
                .or_else(|| parsed.as_ref().and_then(|v| v.get("name")).and_then(|v| v.as_str()))
                .unwrap_or("").to_string();
            let cargo = plan.and_then(|p| p.get("cargo")).and_then(|c| c.as_array()).map(|a| a.len()).unwrap_or(0);
            let vessel = plan.and_then(|p| p.get("vessel")).and_then(|v| v.get("name")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            BackupInfo { file, ts: ts as u64, voyage, cargo, vessel, ok: plan.is_some() }
        })
        .collect()
}

/// Only names this module created are readable: no paths, no traversal.
pub fn backup_read(base: &Path, file: &str) -> Result<String, String> {
    let valid = file.starts_with("plan-")
        && file.ends_with(".json")
        && file.len() < 64
        && file.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    if !valid || file.contains("..") {
        return Err("Invalid backup name".into());
    }
    read_capped(&base.join("backups").join(file)).map_err(|e| format!("Read failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("decargo-store-{}-{}", tag, now_ms()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let d = tmpdir("aw");
        let f = d.join("plan.spica");
        atomic_write(&f, b"one").unwrap();
        atomic_write(&f, b"two").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "two");
        let leftovers = fs::read_dir(&d).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp")).count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn backups_rotate_and_list_newest_first() {
        let d = tmpdir("bk");
        let doc = r#"{"plan":{"voyage":"V-12","cargo":[{},{}],"vessel":{"name":"Spica Tide"}}}"#;
        for _ in 0..(KEEP + 5) {
            autosave_store(&d, doc, true).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let list = backups_list(&d);
        assert_eq!(list.len(), KEEP);
        assert!(list.windows(2).all(|w| w[0].ts >= w[1].ts));
        assert_eq!(list[0].voyage, "V-12");
        assert_eq!(list[0].cargo, 2);
        assert_eq!(list[0].vessel, "Spica Tide");
        assert_eq!(autosave_read(&d).unwrap(), doc);
        assert!(backup_read(&d, &list[0].file).is_ok());
    }

    #[test]
    fn prune_keeps_one_per_day() {
        let d = tmpdir("days");
        let b = sub(&d, "backups");
        let now = now_ms();
        // 40 copies today + one per day for the previous 20 days
        for i in 0..40u128 { fs::write(b.join(format!("plan-{}.json", now - i)), "{}").unwrap(); }
        for day in 1..=20u128 { fs::write(b.join(format!("plan-{}.json", now - day * 86_400_000)), "{}").unwrap(); }
        prune(&b);
        let left = backup_files(&b).len();
        // 30 newest + 13 older days within the 14-day window
        assert_eq!(left, 30 + 13);
    }

    #[test]
    fn backup_read_rejects_paths() {
        let d = tmpdir("rd");
        assert!(backup_read(&d, "../recent.json").is_err());
        assert!(backup_read(&d, "plan-1/../../x.json").is_err());
        assert!(backup_read(&d, "C:\\Windows\\win.ini").is_err());
    }
}
