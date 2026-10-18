//! Background updates. Every push to `main` publishes a release; this module
//! checks for it, downloads and verifies it quietly, then tells the console.
//! The update is installed when the operator closes Psalm150, or straight away
//! if they choose "Restart now". It never interrupts a service on its own.
//!
//! A desktop connected to a song server only takes a release that server can
//! serve. Each release's `latest.json` carries `server_endpoints`, every
//! server path that build calls (`scripts/server-endpoints.mjs` finds them),
//! and the server must describe each one in `GET /api/openapi.json`. It also
//! carries `desktop_api` (`REQUIRED_DESKTOP_API`), which the server's
//! `GET /api/v1/info` must match or exceed: a manual lever, only for a
//! behaviour change on a path that already exists.

use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::AppState;

/// The song server contract this build needs. New server paths are checked
/// on their own; raise this together with the server's `DESKTOP_API` only
/// when this build depends on changed behaviour of a path that already
/// exists. The release workflow copies it into `latest.json`.
pub const REQUIRED_DESKTOP_API: u32 = 1;

/// Servers from before the contract number existed speak contract 1.
const UNVERSIONED_DESKTOP_API: u32 = 1;
const SERVER_TIMEOUT: Duration = Duration::from_secs(10);

/// Let startup (songs folder, server sync) settle before the first check.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);

#[derive(Default)]
pub struct UpdateState {
    ready: Mutex<Option<ReadyUpdate>>,
}

struct ReadyUpdate {
    update: Update,
    bytes: Vec<u8>,
}

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
}

impl ReadyUpdate {
    fn info(&self) -> UpdateInfo {
        UpdateInfo {
            version: self.update.version.clone(),
            current_version: self.update.current_version.clone(),
            notes: self.update.body.clone(),
        }
    }
}

/// Check now and then every hour. Debug builds never update themselves.
pub fn spawn_background(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            if let Err(err) = check_and_download(&app).await {
                eprintln!("[updater] {err}");
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

async fn check_and_download(app: &AppHandle) -> Result<(), String> {
    let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };

    let state = app.state::<UpdateState>();
    if let Err(reason) = server_can_serve(app, &update).await {
        eprintln!("[updater] not taking {}: {reason}", update.version);
        // A download held for an older or different server is no longer safe.
        if state.ready.lock().take().is_some() {
            let _ = app.emit("update-ready", None::<UpdateInfo>);
        }
        return Ok(());
    }

    let already_ready = state
        .ready
        .lock()
        .as_ref()
        .is_some_and(|ready| ready.update.version == update.version);
    if already_ready {
        return Ok(());
    }

    // `download` verifies the signature against the public key in tauri.conf.json.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    let ready = ReadyUpdate { update, bytes };
    let info = ready.info();
    *state.ready.lock() = Some(ready);
    eprintln!("[updater] {} downloaded, installs on close", info.version);
    let _ = app.emit("update-ready", Some(info));
    Ok(())
}

/// Ok when no song server is connected, or the connected one has every path
/// the release calls and speaks at least the contract it needs. An
/// unreachable server means "not now".
async fn server_can_serve(app: &AppHandle, update: &Update) -> Result<(), String> {
    let needed = update
        .raw_json
        .get("desktop_api")
        .and_then(|value| value.as_u64())
        .unwrap_or(u64::from(UNVERSIONED_DESKTOP_API));
    let server_url = app
        .state::<AppState>()
        .inner
        .lock()
        .config
        .server_library
        .as_ref()
        .map(|server| server.url.clone());
    let Some(server_url) = server_url else {
        return Ok(());
    };
    let offered = server_desktop_api(&server_url).await?;
    if u64::from(offered) < needed {
        return Err(format!(
            "it needs song server contract {needed}, {server_url} offers {offered}"
        ));
    }

    // Releases from before the endpoint list existed carry none.
    let Some(needed_paths) = update.raw_json.get("server_endpoints") else {
        return Ok(());
    };
    let needed_paths: Vec<String> =
        serde_json::from_value(needed_paths.clone()).map_err(|e| e.to_string())?;
    let offered_paths = server_paths(&server_url).await?;
    let missing = missing_paths(&needed_paths, &offered_paths);
    if !missing.is_empty() {
        return Err(format!("{server_url} does not have {}", missing.join(", ")));
    }
    Ok(())
}

/// `/api/v1/sets/{set_id}?wait=5` → `/api/v1/sets/{}`, the form
/// `scripts/server-endpoints.mjs` writes.
fn normalize_path(path: &str) -> String {
    let path = path
        .split('?')
        .next()
        .unwrap_or_default()
        .trim_end_matches('/');
    let mut normalized = String::with_capacity(path.len() + 1);
    if !path.starts_with('/') {
        normalized.push('/');
    }
    let mut in_parameter = false;
    for ch in path.chars() {
        match ch {
            '{' => {
                in_parameter = true;
                normalized.push_str("{}");
            }
            '}' => in_parameter = false,
            _ if in_parameter => {}
            _ => normalized.push(ch),
        }
    }
    normalized
}

fn missing_paths(needed: &[String], offered: &[String]) -> Vec<String> {
    let offered: std::collections::HashSet<String> =
        offered.iter().map(|path| normalize_path(path)).collect();
    needed
        .iter()
        .map(|path| normalize_path(path))
        .filter(|path| !offered.contains(path))
        .collect()
}

/// The paths the server describes in its OpenAPI document.
async fn server_paths(server_url: &str) -> Result<Vec<String>, String> {
    #[derive(serde::Deserialize)]
    struct OpenApi {
        paths: serde_json::Map<String, serde_json::Value>,
    }
    let url = format!("{}/api/openapi.json", server_url.trim_end_matches('/'));
    let document: OpenApi = server_get_json(&url).await?;
    Ok(document.paths.keys().cloned().collect())
}

async fn server_get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T, String> {
    reqwest::Client::builder()
        .timeout(SERVER_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| format!("could not ask {url}: {e}"))?
        .json()
        .await
        .map_err(|e| format!("unexpected answer from {url}: {e}"))
}

async fn server_desktop_api(server_url: &str) -> Result<u32, String> {
    #[derive(serde::Deserialize)]
    struct Info {
        desktop_api: Option<u32>,
    }
    let url = format!("{}/api/v1/info", server_url.trim_end_matches('/'));
    let info: Info = server_get_json(&url).await?;
    Ok(info.desktop_api.unwrap_or(UNVERSIONED_DESKTOP_API))
}

/// The downloaded update, for a console that loaded after `update-ready` fired.
#[tauri::command]
pub fn get_ready_update(state: tauri::State<'_, UpdateState>) -> Option<UpdateInfo> {
    state.ready.lock().as_ref().map(ReadyUpdate::info)
}

/// Install the downloaded update and start the new version.
#[tauri::command]
pub fn restart_to_update(app: AppHandle) -> Result<(), String> {
    let Some(ready) = app.state::<UpdateState>().ready.lock().take() else {
        return Err("No update is ready".into());
    };
    // On Windows this hands over to the installer, which restarts the app.
    ready
        .update
        .install(&ready.bytes)
        .map_err(|e| e.to_string())?;
    app.restart();
}

/// Called once the console window is gone: install quietly, without
/// reopening Psalm150 the operator just closed.
pub fn install_on_quit(app: &AppHandle) {
    let Some(ready) = app.state::<UpdateState>().ready.lock().take() else {
        return;
    };
    #[cfg(windows)]
    if start_windows_installer_without_restart(&ready).is_ok() {
        return;
    }
    // macOS and Linux replace the app in place; nothing is relaunched.
    if let Err(err) = ready.update.install(&ready.bytes) {
        eprintln!("[updater] install failed: {err}");
    }
}

/// The updater plugin always passes `/R` to the NSIS installer, which reopens
/// the app. Run the verified installer ourselves without it.
#[cfg(windows)]
fn start_windows_installer_without_restart(ready: &ReadyUpdate) -> Result<(), String> {
    // NSIS installers are executables; anything else (an MSI) goes the plugin's way.
    if !ready.bytes.starts_with(b"MZ") {
        return Err("not an NSIS installer".into());
    }
    let path = std::env::temp_dir().join(format!("Psalm150_{}_setup.exe", ready.update.version));
    std::fs::write(&path, &ready.bytes).map_err(|e| e.to_string())?;
    std::process::Command::new(&path)
        .args(["/P", "/UPDATE"])
        .spawn()
        .map_err(|e| {
            eprintln!("[updater] could not start installer: {e}");
            e.to_string()
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_parameters_queries_and_roots() {
        assert_eq!(normalize_path("/api/v1/sets/{set_id}"), "/api/v1/sets/{}");
        assert_eq!(
            normalize_path("api/v1/remote/desktop/commands?wait={}"),
            "/api/v1/remote/desktop/commands"
        );
        assert_eq!(normalize_path("/api/v1/songs/"), "/api/v1/songs");
    }

    #[test]
    fn reports_only_paths_the_server_lacks() {
        let needed = vec![
            "/api/v1/sets/{}".to_string(),
            "/api/v1/remote/desktop/room".to_string(),
        ];
        let offered = vec![
            "/api/v1/sets/{set_id}".to_string(),
            "/api/v1/remote/desktop".to_string(),
        ];
        assert_eq!(
            missing_paths(&needed, &offered),
            vec!["/api/v1/remote/desktop/room"]
        );
        assert!(missing_paths(&needed[..1], &offered).is_empty());
    }
}
