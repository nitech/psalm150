use tauri::{AppHandle, State};

use crate::remote::{RemoteServer, RemoteStatus};
use crate::{with_state, AppState};

/// The fixed PIN older versions saved; replaced by a random one on next start.
const LEGACY_DEFAULT_PIN: &str = "1234";

/// Six random digits; the operator reads the PIN in Settings, Phone remote.
fn random_pin() -> String {
    format!("{:06}", uuid::Uuid::new_v4().as_u128() % 1_000_000)
}

/// Start the phone remote on `port` (or the configured port), persist the
/// choice, and hand the action channel to the poll thread in `lib.rs`.
/// Shared by the `start_remote` command and the auto-start in `setup()`.
pub fn start_remote_inner(
    app: &AppHandle,
    state: &AppState,
    port: Option<u16>,
) -> Result<RemoteStatus, String> {
    with_state(state, |runtime| {
        if let Some(existing) = runtime.remote.as_ref() {
            return Ok(existing.status());
        }
        let port = port.unwrap_or(runtime.config.remote_port);
        let pin = runtime
            .config
            .remote_pin
            .clone()
            .filter(|pin| !pin.trim().is_empty() && pin != LEGACY_DEFAULT_PIN)
            .unwrap_or_else(random_pin);
        let (server, rx) = RemoteServer::start(port, pin.clone())?;
        let status = server.status();
        runtime.remote = Some(server);
        *state.remote_actions.lock() = Some(rx);
        runtime.config.remote_enabled = true;
        runtime.config.remote_port = status.port;
        runtime.config.remote_pin = Some(pin);
        runtime.config.save(app)?;
        Ok(status)
    })
}

pub fn stop_remote_inner(app: &AppHandle, state: &AppState) -> Result<(), String> {
    with_state(state, |runtime| {
        if let Some(server) = runtime.remote.take() {
            server.stop();
        }
        *state.remote_actions.lock() = None;
        runtime.config.remote_enabled = false;
        runtime.config.save(app)
    })
}

#[tauri::command]
pub fn start_remote(
    app: AppHandle,
    state: State<'_, AppState>,
    port: Option<u16>,
) -> Result<RemoteStatus, String> {
    start_remote_inner(&app, &state, port)
}

#[tauri::command]
pub fn stop_remote(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    stop_remote_inner(&app, &state)
}

#[tauri::command]
pub fn get_remote_status(state: State<'_, AppState>) -> Result<Option<RemoteStatus>, String> {
    with_state(&state, |runtime| {
        Ok(runtime.remote.as_ref().map(|r| r.status()))
    })
}
