// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, &contents).map_err(|e| format!("Write failed: {}", e))
}

#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, &bytes).map_err(|e| format!("Write failed: {}", e))
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Read failed: {}", e))
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
        fs::write(recent_file_path(), json).ok();
    }

    recents
}

/// Simple ISO timestamp without pulling in chrono crate
fn chrono_now() -> String {
    use std::time::SystemTime;
    let d = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    // Return Unix timestamp as string — JS side will format if needed
    format!("{}", d.as_secs())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            write_file,
            write_file_bytes,
            read_file,
            get_recent_files,
            add_recent_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
