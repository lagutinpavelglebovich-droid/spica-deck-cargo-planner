//! v3.28 — local sync through a shared folder on the ship's network drive.
//!
//! One plan file per folder, replaced atomically. Writers serialise on an
//! OS lock held on a separate lock file and publish only when the file still
//! carries the commit they started from (compare-and-swap); otherwise the
//! caller gets the current file back and resolves the conflict. Readers
//! (the other computer) read the whole file on every poll. Nothing here
//! talks to the network beyond the file share itself.

use serde::Serialize;
use std::fs::{self, OpenOptions, TryLockError};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PLAN: &str = "decargo-plan.json";
const LOCK: &str = ".decargo-sync.lock";
const HISTORY: &str = "history";
const KEEP_HISTORY: usize = 30;
const MAX_BYTES: u64 = 25 * 1024 * 1024;
const LOCK_WAIT: Duration = Duration::from_secs(6);

#[derive(Serialize)]
pub struct ReadResult {
    exists: bool,
    text: Option<String>,
}

#[derive(Serialize)]
pub struct CommitResult {
    ok: bool,
    conflict: bool,
    /// the plan file as it is now, when the commit was refused
    current: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct ProbeResult {
    ok: bool,
    writable: bool,
    has_plan: bool,
    error: Option<String>,
}

/// Sharing violations, lock violations and access-denied blips from
/// antivirus or the share are retried a few times with backoff.
fn transient(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33))
        || matches!(e.kind(), ErrorKind::PermissionDenied | ErrorKind::WouldBlock | ErrorKind::Interrupted)
}

pub(crate) fn retry<T>(mut f: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let mut delay = 40u64;
    let mut attempt = 0;
    loop {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => {
                attempt += 1;
                if attempt >= 8 || !transient(&e) {
                    return Err(e);
                }
                std::thread::sleep(Duration::from_millis(delay));
                delay = (delay * 2).min(600);
            }
        }
    }
}

fn plan_path(dir: &str) -> PathBuf {
    Path::new(dir).join(PLAN)
}

fn read_text(path: &Path) -> std::io::Result<Option<String>> {
    match fs::metadata(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
        Ok(m) if m.len() > MAX_BYTES => {
            return Err(std::io::Error::new(ErrorKind::InvalidData, "plan file is too large"))
        }
        Ok(_) => {}
    }
    match retry(|| fs::read_to_string(path)) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn read_plan(dir: &str) -> Result<ReadResult, String> {
    if !Path::new(dir).is_dir() {
        return Err("Folder not reachable".into());
    }
    let text = read_text(&plan_path(dir)).map_err(|e| format!("Read failed: {}", e))?;
    Ok(ReadResult { exists: text.is_some(), text })
}

fn commit_id_of(text: &str) -> Result<Option<String>, ()> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|_| ())?;
    Ok(v.get("commit").and_then(|c| c.as_str()).map(|s| s.to_string()))
}

fn nanos() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

/// Exclusive OS lock on the shared lock file; released when the handle drops.
fn take_lock(dir: &str) -> Result<fs::File, String> {
    let f = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(Path::new(dir).join(LOCK))
        .map_err(|e| format!("Lock file: {}", e))?;
    let start = Instant::now();
    loop {
        match f.try_lock() {
            Ok(()) => return Ok(f),
            Err(TryLockError::WouldBlock) => {
                if start.elapsed() > LOCK_WAIT {
                    return Err("The other computer is writing — try again".into());
                }
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(TryLockError::Error(e)) => return Err(format!("Lock failed: {}", e)),
        }
    }
}

fn write_history(dir: &str, doc: &serde_json::Value, text: &str) {
    let hdir = Path::new(dir).join(HISTORY);
    if fs::create_dir_all(&hdir).is_err() {
        return;
    }
    let rev = doc.get("rev").and_then(|r| r.as_u64()).unwrap_or(0);
    let commit: String = doc
        .get("commit")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    let _ = fs::write(hdir.join(format!("plan-{:07}-{}.json", rev, commit)), text);
    if let Ok(rd) = fs::read_dir(&hdir) {
        let mut names: Vec<String> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("plan-") && n.ends_with(".json"))
            .collect();
        names.sort();
        if names.len() > KEEP_HISTORY {
            for n in &names[..names.len() - KEEP_HISTORY] {
                let _ = fs::remove_file(hdir.join(n));
            }
        }
    }
}

/// Publish `doc` if the plan file still carries `expected` (None = no file
/// yet). `force` overwrites a file that cannot be parsed at all.
pub fn commit_plan(dir: &str, expected: Option<String>, doc: &str, force: bool) -> CommitResult {
    let fail = |e: String| CommitResult { ok: false, conflict: false, current: None, error: Some(e) };
    if !Path::new(dir).is_dir() {
        return fail("Folder not reachable".into());
    }
    let parsed: serde_json::Value = match serde_json::from_str(doc) {
        Ok(v) => v,
        Err(e) => return fail(format!("Bad document: {}", e)),
    };
    if parsed.get("commit").and_then(|c| c.as_str()).is_none() {
        return fail("Document has no commit id".into());
    }
    let _lock = match take_lock(dir) {
        Ok(l) => l,
        Err(e) => return fail(e),
    };
    let target = plan_path(dir);
    let current = match read_text(&target) {
        Ok(t) => t,
        Err(e) => return fail(format!("Read failed: {}", e)),
    };
    if let Some(cur) = &current {
        match commit_id_of(cur) {
            Ok(cur_commit) => {
                if cur_commit != expected {
                    return CommitResult { ok: false, conflict: true, current: Some(cur.clone()), error: None };
                }
            }
            Err(()) => {
                if !force {
                    return CommitResult {
                        ok: false,
                        conflict: true,
                        current: None,
                        error: Some("The plan file in the folder is damaged".into()),
                    };
                }
            }
        }
    } else if expected.is_some() && !force {
        // we expected a plan that is gone (folder emptied / replaced)
        return CommitResult { ok: false, conflict: true, current: None, error: None };
    }
    let tmp = Path::new(dir).join(format!(".decargo-plan.{}.{}.tmp", std::process::id(), nanos()));
    let written = (|| -> std::io::Result<()> {
        let mut f = OpenOptions::new().create_new(true).write(true).open(&tmp)?;
        f.write_all(doc.as_bytes())?;
        f.sync_all()?;
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return fail(format!("Write failed: {}", e));
    }
    if let Err(e) = retry(|| fs::rename(&tmp, &target)) {
        let _ = fs::remove_file(&tmp);
        return fail(format!("Replace failed: {}", e));
    }
    write_history(dir, &parsed, doc);
    CommitResult { ok: true, conflict: false, current: None, error: None }
}

pub fn probe(dir: &str, write: bool) -> ProbeResult {
    let p = Path::new(dir);
    if dir.trim().is_empty() || !p.is_dir() {
        return ProbeResult { ok: false, writable: false, has_plan: false, error: Some("Folder not found or not reachable".into()) };
    }
    if let Err(e) = fs::read_dir(p) {
        return ProbeResult { ok: false, writable: false, has_plan: false, error: Some(format!("Cannot read folder: {}", e)) };
    }
    let has_plan = plan_path(dir).is_file();
    if !write {
        return ProbeResult { ok: true, writable: false, has_plan, error: None };
    }
    let probe = p.join(format!(".decargo-probe.{}.{}", std::process::id(), nanos()));
    let r = fs::write(&probe, b"probe").and_then(|_| fs::read(&probe)).and_then(|_| fs::remove_file(&probe));
    match r {
        Ok(()) => ProbeResult { ok: true, writable: true, has_plan, error: None },
        Err(e) => {
            let _ = fs::remove_file(&probe);
            ProbeResult { ok: false, writable: false, has_plan, error: Some(format!("Cannot write to folder: {}", e)) }
        }
    }
}

pub fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> String {
        let d = std::env::temp_dir().join(format!("decargo-test-{}", nanos()));
        fs::create_dir_all(&d).unwrap();
        d.to_string_lossy().to_string()
    }

    #[test]
    fn cas_and_history() {
        let d = tmpdir();
        assert!(!read_plan(&d).unwrap().exists);
        let r = commit_plan(&d, None, r#"{"commit":"a1","rev":1,"state":{}}"#, false);
        assert!(r.ok);
        // stale writer (expects nothing) is refused and gets the current file
        let r = commit_plan(&d, None, r#"{"commit":"b1","rev":1,"state":{}}"#, false);
        assert!(r.conflict && r.current.unwrap().contains("a1"));
        let r = commit_plan(&d, Some("a1".into()), r#"{"commit":"a2","rev":2,"state":{}}"#, false);
        assert!(r.ok);
        assert!(read_plan(&d).unwrap().text.unwrap().contains("a2"));
        assert_eq!(fs::read_dir(Path::new(&d).join(HISTORY)).unwrap().count(), 2);
        // damaged file: refused unless forced
        fs::write(plan_path(&d), "{oops").unwrap();
        assert!(commit_plan(&d, Some("a2".into()), r#"{"commit":"a3","rev":3}"#, false).conflict);
        assert!(commit_plan(&d, Some("a2".into()), r#"{"commit":"a3","rev":3}"#, true).ok);
        assert!(probe(&d, true).writable);
        fs::remove_dir_all(&d).ok();
    }
}
