use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::projection::SlideTheme;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub last_songs_folder: Option<String>,
    /// Most recently selected user-owned ChordPro folder. Kept separately so
    /// switching to a managed server cache never loses the return path.
    #[serde(default)]
    pub last_local_songs_folder: Option<String>,
    pub read_only: bool,
    /// A server-backed library uses a managed local ChordPro cache. The
    /// credential is stored separately and is never serialized to the UI.
    #[serde(default)]
    pub server_library: Option<ServerLibraryConfig>,
    /// When projecting a song, also show the stage window (musician chords).
    #[serde(default)]
    pub project_to_stage: bool,
    /// Search the web for songs when local library has no matches.
    #[serde(default = "default_web_search_enabled")]
    pub web_search_enabled: bool,
    /// Show the song-number column in the operator's song list.
    #[serde(default = "default_show_song_numbers")]
    pub show_song_numbers: bool,
    pub audience_monitor: Option<String>,
    pub stage_monitor: Option<String>,
    pub remote_enabled: bool,
    pub remote_pin: Option<String>,
    pub remote_port: u16,
    pub key_format_compressed: bool,
    pub history_days: u32,
    pub shortcuts: ShortcutConfig,
    pub first_run_complete: bool,
}

fn default_web_search_enabled() -> bool {
    true
}

fn default_show_song_numbers() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            last_songs_folder: None,
            last_local_songs_folder: None,
            read_only: false,
            server_library: None,
            project_to_stage: false,
            web_search_enabled: default_web_search_enabled(),
            show_song_numbers: default_show_song_numbers(),
            audience_monitor: None,
            stage_monitor: None,
            remote_enabled: false,
            remote_pin: None,
            remote_port: 8757,
            key_format_compressed: false,
            history_days: 30,
            shortcuts: ShortcutConfig::default(),
            first_run_complete: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerLibraryConfig {
    pub url: String,
    pub last_synced_at: String,
    pub song_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutConfig {
    pub next_slide: String,
    pub previous_slide: String,
    pub blank: String,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            next_slide: "ArrowRight".into(),
            previous_slide: "ArrowLeft".into(),
            blank: "KeyB".into(),
        }
    }
}

impl AppConfig {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let path = global_config_path(app)?;
        if path.exists() {
            let text = fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&text)?)
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = global_config_path(app).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, text).map_err(|e| e.to_string())
    }
}

pub fn global_config_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("config.json"))
}

pub fn server_token_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("server-device-token"))
        .map_err(|error| error.to_string())
}

pub fn server_library_root(app: &AppHandle, server_url: &str) -> Result<PathBuf, String> {
    let digest = Sha256::digest(server_url.as_bytes());
    let server_hash = format!("{:x}", digest)[..16].to_string();
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("server-libraries").join(server_hash))
        .map_err(|error| error.to_string())
}

pub fn library_root(app: &AppHandle, folder_hash: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("libraries").join(folder_hash))
        .map_err(|e| e.to_string())
}

pub fn hash_folder(path: &Path) -> String {
    let normalized = path.to_string_lossy().to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    format!("{:x}", digest)[..16].to_string()
}

pub fn ensure_library_layout(app: &AppHandle, folder_hash: &str) -> Result<PathBuf, String> {
    let root = library_root(app, folder_hash)?;
    for sub in ["setlists", "hold_slides"] {
        fs::create_dir_all(root.join(sub)).map_err(|e| e.to_string())?;
    }
    Ok(root)
}

pub fn theme_path(app: &AppHandle, folder_hash: &str) -> Result<PathBuf, String> {
    Ok(library_root(app, folder_hash)?.join("theme.json"))
}

pub fn load_theme(app: &AppHandle, folder_hash: &str) -> Result<SlideTheme, String> {
    let path = theme_path(app, folder_hash)?;
    if path.exists() {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    } else {
        Ok(SlideTheme::default())
    }
}

pub fn save_theme(app: &AppHandle, folder_hash: &str, theme: &SlideTheme) -> Result<(), String> {
    let path = theme_path(app, folder_hash)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(theme).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

pub fn favorites_path(app: &AppHandle, folder_hash: &str) -> Result<PathBuf, String> {
    Ok(library_root(app, folder_hash)?.join("favorites.json"))
}

pub fn load_favorites(app: &AppHandle, folder_hash: &str) -> Result<Vec<String>, String> {
    let path = favorites_path(app, folder_hash)?;
    if path.exists() {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    } else {
        Ok(vec![])
    }
}

pub fn save_favorites(
    app: &AppHandle,
    folder_hash: &str,
    favorites: &[String],
) -> Result<(), String> {
    let path = favorites_path(app, folder_hash)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(favorites).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}
