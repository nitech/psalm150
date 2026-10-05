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
    /// Visual Song Book database kept in two-way sync with the active library.
    #[serde(default)]
    pub vsb_sync: Option<VsbSyncConfig>,
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
    /// Let leaders steer this desktop from their phones through the
    /// connected song server (server library only). On unless the operator
    /// turns it off; stored under a new key because the old
    /// `server_remote_enabled` was off by default.
    #[serde(rename = "server_remote", default = "default_true")]
    pub server_remote_enabled: bool,
    /// Let anyone who knows this desktop's room name follow the words it
    /// projects, through the connected song server. On unless turned off.
    #[serde(default = "default_true")]
    pub server_room_sharing: bool,
    pub remote_pin: Option<String>,
    pub remote_port: u16,
    pub key_format_compressed: bool,
    pub history_days: u32,
    #[serde(default)]
    pub shortcuts: ShortcutConfig,
    pub first_run_complete: bool,
}

fn default_web_search_enabled() -> bool {
    true
}

fn default_true() -> bool {
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
            vsb_sync: None,
            project_to_stage: false,
            web_search_enabled: default_web_search_enabled(),
            show_song_numbers: default_show_song_numbers(),
            audience_monitor: None,
            stage_monitor: None,
            remote_enabled: false,
            server_remote_enabled: true,
            server_room_sharing: true,
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
pub struct VsbSyncConfig {
    pub mdb_path: String,
    #[serde(default)]
    pub last_synced_at: Option<String>,
    #[serde(default)]
    pub last_summary: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
}

/// Operator keyboard shortcuts as combos such as `Alt+S`, `Ctrl+F`, `B` or
/// `ArrowRight` (see `src/shortcuts.ts`). Missing fields take the defaults,
/// so older config files keep working.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ShortcutConfig {
    pub next_slide: String,
    pub previous_slide: String,
    pub blank: String,
    pub add_to_setlist: String,
    pub toggle_favorite: String,
    pub focus_search: String,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            next_slide: "ArrowRight".into(),
            previous_slide: "ArrowLeft".into(),
            blank: "B".into(),
            add_to_setlist: "Alt+S".into(),
            toggle_favorite: "Alt+F".into(),
            focus_search: "Ctrl+F".into(),
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

pub fn vsb_backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("vsb-backups"))
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

#[cfg(test)]
mod tests {
    use super::{AppConfig, ShortcutConfig};

    #[test]
    fn older_shortcut_settings_gain_the_new_defaults() {
        let shortcuts: ShortcutConfig = serde_json::from_str(
            r#"{"next_slide":"ArrowRight","previous_slide":"ArrowLeft","blank":"KeyB"}"#,
        )
        .unwrap();
        assert_eq!(shortcuts.blank, "KeyB");
        assert_eq!(shortcuts.add_to_setlist, "Alt+S");
        assert_eq!(shortcuts.focus_search, "Ctrl+F");

        let config: AppConfig = serde_json::from_str(
            &serde_json::to_string(&AppConfig::default())
                .unwrap()
                .replace(r#","shortcuts":{"next_slide":"ArrowRight","previous_slide":"ArrowLeft","blank":"B","add_to_setlist":"Alt+S","toggle_favorite":"Alt+F","focus_search":"Ctrl+F"}"#, ""),
        )
        .unwrap();
        assert_eq!(config.shortcuts.toggle_favorite, "Alt+F");
    }

    #[test]
    fn remote_control_and_rooms_are_on_unless_turned_off() {
        // Saved before they were on by default: the old key was always false.
        let mut saved = serde_json::to_value(AppConfig::default()).unwrap();
        let fields = saved.as_object_mut().unwrap();
        fields.remove("server_remote");
        fields.remove("server_room_sharing");
        fields.insert("server_remote_enabled".into(), false.into());
        let config: AppConfig = serde_json::from_value(saved).unwrap();
        assert!(config.server_remote_enabled);
        assert!(config.server_room_sharing);

        let mut off = AppConfig::default();
        off.server_remote_enabled = false;
        off.server_room_sharing = false;
        let config: AppConfig =
            serde_json::from_str(&serde_json::to_string(&off).unwrap()).unwrap();
        assert!(!config.server_remote_enabled);
        assert!(!config.server_room_sharing);
    }
}
