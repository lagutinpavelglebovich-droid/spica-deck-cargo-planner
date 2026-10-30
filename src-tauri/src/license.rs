//! v3.38 — Decargo licence keys.
//!
//! A licence key is `DCL1.<payload>.<signature>`:
//!   payload   = base64url(JSON { v, id, vessel, holder, issued, until, kind })
//!   signature = base64url(Ed25519 signature over the payload text)
//! Keys are signed with the owner's private key (kept off this repository,
//! see tools/make-license.mjs); the app only holds the public key below, so
//! a key cannot be forged or edited without the signature failing.
//!
//! Checks run here (Rust), not only in the page: file and autosave writes
//! are refused without a valid licence, so removing the lock screen from
//! the web code does not make the app usable.
//!
//! Works offline. The latest date the app has seen is remembered; a system
//! clock set back by more than two days stops the licence ("clock").

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Owner's public key (Ed25519, raw 32 bytes).
pub const PUBLIC_KEY: [u8; 32] = [
    0xd7, 0x7f, 0x21, 0xd8, 0x81, 0x5b, 0xb7, 0x0a, 0xf5, 0x2c, 0xeb, 0x6f, 0x2c, 0x16, 0xca, 0x2c,
    0x5f, 0x18, 0xcb, 0x87, 0xbe, 0x55, 0x5b, 0xce, 0x36, 0xd9, 0x15, 0x19, 0xd4, 0xaa, 0x34, 0x05,
];

const PREFIX: &str = "DCL1.";
const CLOCK_TOLERANCE_DAYS: i64 = 2;
const MAX_KEY_LEN: usize = 2048;

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct Payload {
    pub v: u32,
    pub id: String,
    pub vessel: String,
    pub holder: String,
    pub issued: String,
    pub until: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub valid: bool,
    /// "ok" | "missing" | "invalid" | "expired" | "clock"
    pub reason: String,
    pub vessel: String,
    pub holder: String,
    pub until: String,
    pub kind: String,
    pub id: String,
    pub issued: String,
    /// last characters of the installed key (shown as "DCL1-…ABCD1234")
    pub key_tail: String,
    pub days_left: i64,
}

impl Status {
    fn bad(reason: &str) -> Self {
        Status {
            valid: false,
            reason: reason.into(),
            vessel: String::new(),
            holder: String::new(),
            until: String::new(),
            kind: String::new(),
            id: String::new(),
            issued: String::new(),
            key_tail: String::new(),
            days_left: 0,
        }
    }
}

/// Days since 1970-01-01 for a civil date (proleptic Gregorian).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub fn parse_date(s: &str) -> Option<i64> {
    let p: Vec<&str> = s.trim().split('-').collect();
    if p.len() != 3 {
        return None;
    }
    let (y, m, d) = (p[0].parse::<i64>().ok()?, p[1].parse::<i64>().ok()?, p[2].parse::<i64>().ok()?);
    if !(2000..=2200).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

fn b64(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s.trim_end_matches('='))
        .map_err(|_| "not a Decargo licence key".to_string())
}

/// Verify a key's signature and read its payload.
pub fn decode(key: &str, pk: &[u8; 32]) -> Result<Payload, String> {
    let k: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    if k.len() > MAX_KEY_LEN || !k.starts_with(PREFIX) {
        return Err("not a Decargo licence key".into());
    }
    let rest = &k[PREFIX.len()..];
    let (p64, s64) = rest.split_once('.').ok_or("not a Decargo licence key")?;
    let sig_bytes: [u8; 64] = b64(s64)?.try_into().map_err(|_| "damaged licence key".to_string())?;
    let vk = VerifyingKey::from_bytes(pk).map_err(|e| e.to_string())?;
    vk.verify(p64.as_bytes(), &Signature::from_bytes(&sig_bytes))
        .map_err(|_| "this licence key was not issued for Decargo, or it was changed".to_string())?;
    let payload: Payload =
        serde_json::from_slice(&b64(p64)?).map_err(|_| "damaged licence key".to_string())?;
    if payload.v != 1 || parse_date(&payload.until).is_none() || payload.vessel.trim().is_empty() {
        return Err("damaged licence key".into());
    }
    Ok(payload)
}

/// Decide validity for a verified payload at `now` (days), given the latest
/// day seen before.
pub fn evaluate(p: &Payload, now: i64, last_seen: i64) -> Status {
    let until = parse_date(&p.until).unwrap_or(i64::MIN);
    let eff = now.max(last_seen);
    let mut st = Status {
        valid: false,
        reason: String::new(),
        vessel: p.vessel.clone(),
        holder: p.holder.clone(),
        until: p.until.clone(),
        kind: p.kind.clone(),
        id: p.id.clone(),
        issued: p.issued.clone(),
        key_tail: String::new(),
        days_left: until - eff,
    };
    if now + CLOCK_TOLERANCE_DAYS < last_seen {
        st.reason = "clock".into();
    } else if eff > until {
        st.reason = "expired".into();
    } else {
        st.valid = true;
        st.reason = "ok".into();
    }
    st
}

// ── storage ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Default)]
struct Seen {
    last_day: i64,
}

fn dir() -> PathBuf {
    crate::app_data_dir()
}
fn key_path() -> PathBuf {
    dir().join("licence.key")
}
fn seen_path() -> PathBuf {
    dir().join("licence-state.json")
}

fn today() -> i64 {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    secs.div_euclid(86_400)
}

fn read_seen() -> i64 {
    std::fs::read_to_string(seen_path())
        .ok()
        .and_then(|t| serde_json::from_str::<Seen>(&t).ok())
        .map(|s| s.last_day)
        .unwrap_or(0)
}
fn write_seen(day: i64) {
    if let Ok(t) = serde_json::to_string(&Seen { last_day: day }) {
        let _ = crate::store::atomic_write(&seen_path(), t.as_bytes());
    }
}

static CACHE: Mutex<Option<(Status, Instant)>> = Mutex::new(None);

/// Last 8 characters of a key (its signature) — enough to tell keys apart
/// in the Licence window without showing the whole key.
pub fn key_tail(key: &str) -> String {
    let k: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    let n = k.chars().count();
    k.chars().skip(n.saturating_sub(8)).collect::<String>().to_uppercase()
}

/// Current licence status (reads the stored key; refreshes the cache).
pub fn status() -> Status {
    let st = match std::fs::read_to_string(key_path()) {
        Err(_) => Status::bad("missing"),
        Ok(k) => match decode(&k, &PUBLIC_KEY) {
            Err(_) => Status::bad("invalid"),
            Ok(p) => {
                let now = today();
                let seen = read_seen();
                let mut s = evaluate(&p, now, seen);
                s.key_tail = key_tail(&k);
                if now > seen && s.reason != "clock" {
                    write_seen(now);
                }
                s
            }
        },
    };
    if let Ok(mut c) = CACHE.lock() {
        *c = Some((st.clone(), Instant::now()));
    }
    st
}

/// Install a key: verified first; an invalid key never replaces a good one.
pub fn install(key: &str) -> Result<Status, String> {
    let p = decode(key, &PUBLIC_KEY)?;
    let mut seen = read_seen();
    let current_id = std::fs::read_to_string(key_path())
        .ok()
        .and_then(|k| decode(&k, &PUBLIC_KEY).ok())
        .map(|c| c.id);
    /* Recovery from a clock that was set too far ahead and then corrected:
       a NEW key from the owner resets the remembered day. Re-entering the
       same key never does, so turning the clock back stays useless. */
    if evaluate(&p, today(), seen).reason == "clock" && current_id.as_deref() != Some(p.id.as_str()) {
        seen = today();
        write_seen(seen);
    }
    let st = evaluate(&p, today(), seen);
    if st.reason == "expired" {
        return Err(format!("this licence key ended on {}", p.until));
    }
    if st.reason == "clock" {
        return Err("the computer's date is behind the last use — correct the date first".into());
    }
    let clean: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    crate::store::atomic_write(&key_path(), clean.as_bytes()).map_err(|e| format!("could not save the licence: {}", e))?;
    Ok(status())
}

/// Guard for commands that write files: Ok while the licence is valid.
pub fn require() -> Result<(), String> {
    let cached = CACHE.lock().ok().and_then(|c| c.clone());
    let st = match cached {
        Some((s, at)) if at.elapsed() < Duration::from_secs(600) => s,
        _ => status(),
    };
    if st.valid {
        Ok(())
    } else {
        Err("Decargo licence is not valid — enter a licence key (Help → Licence)".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn make(sk: &SigningKey, json: &str) -> String {
        let p64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json.as_bytes());
        let sig = sk.sign(p64.as_bytes());
        format!("DCL1.{}.{}", p64, base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sig.to_bytes()))
    }
    fn test_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }
    const GOOD: &str = r#"{"v":1,"id":"T1","vessel":"MV TEST","holder":"Tester","issued":"2026-10-29","until":"2027-04-30","kind":"trial"}"#;

    #[test]
    fn dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(parse_date("2026-10-29"), Some(20755));
        assert_eq!(parse_date("2026-13-01"), None);
        assert_eq!(parse_date("junk"), None);
    }

    #[test]
    fn verifies_and_rejects_tampering() {
        let sk = test_key();
        let pk = sk.verifying_key().to_bytes();
        let k = make(&sk, GOOD);
        let p = decode(&k, &pk).unwrap();
        assert_eq!(p.vessel, "MV TEST");
        // whitespace / line breaks from e-mail are tolerated
        let spaced = format!("  {}\n", k.replace('.', ".\n"));
        assert!(decode(&spaced, &pk).is_ok());
        // edited payload (later date) fails the signature
        let forged = make(&SigningKey::from_bytes(&[9u8; 32]), &GOOD.replace("2027-04-30", "2099-01-01"));
        assert!(decode(&forged, &pk).is_err());
        let parts: Vec<&str> = k.split('.').collect();
        let other_p = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(GOOD.replace("MV TEST", "MV OTHER"));
        assert!(decode(&format!("DCL1.{}.{}", other_p, parts[2]), &pk).is_err());
        // the real public key rejects test keys
        assert!(decode(&k, &PUBLIC_KEY).is_err());
        assert!(decode("hello", &pk).is_err());
    }

    /// A key signed on the owner's machine with the real signing key
    /// (TEST VESSEL, ended 2026-11-05): proves the embedded public key and
    /// tools/make-license.mjs agree.
    #[test]
    fn real_key_from_generator() {
        let k = "DCL1.eyJ2IjoxLCJpZCI6IkwyMDI2MTAyOS1EOTZGQkYiLCJ2ZXNzZWwiOiJURVNUIFZFU1NFTCIsImhvbGRlciI6IlRlc3QiLCJpc3N1ZWQiOiIyMDI2LTEwLTI5IiwidW50aWwiOiIyMDI2LTExLTA1Iiwia2luZCI6InRyaWFsIn0.4ZSpufS5Q8YIIQp-8lPp8ywG8pjjLuriECWsNMvpRlwewGBFl37Xyb9v5l0ARvK4e2VkDw4pFFrE42mLVk9yAA";
        let p = decode(k, &PUBLIC_KEY).expect("generator key must verify");
        assert_eq!(p.vessel, "TEST VESSEL");
        assert_eq!(p.until, "2026-11-05");
        assert_eq!(evaluate(&p, parse_date("2026-11-06").unwrap(), 0).reason, "expired");
    }

    #[test]
    fn expiry_and_clock() {
        let p: Payload = serde_json::from_str(GOOD).unwrap();
        let until = parse_date("2027-04-30").unwrap();
        assert!(evaluate(&p, until, 0).valid); // last day still valid
        assert_eq!(evaluate(&p, until, 0).days_left, 0);
        assert_eq!(evaluate(&p, until + 1, 0).reason, "expired");
        // clock set back after expiry: last seen day wins
        assert_eq!(evaluate(&p, until - 10, until + 1).reason, "clock");
        // small time-zone wobble is fine
        let st = evaluate(&p, until - 10, until - 9);
        assert!(st.valid);
        assert_eq!(st.days_left, 9);
        assert_eq!(key_tail("DCL1.abc.def ghij-K_LMNOP"), "IJ-K_LMNOP".chars().skip(2).collect::<String>().to_uppercase());
    }
}
