//! Background updates. Every push to `main` publishes a release; this module
//! checks for it, downloads and verifies it quietly, then tells the console.
//! The update is installed when the operator closes Psalm150, or straight away
//! if they choose "Restart now". It never interrupts a service on its own.

use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

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
    let _ = app.emit("update-ready", info);
    Ok(())
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
    ready.update.install(&ready.bytes).map_err(|e| e.to_string())?;
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
