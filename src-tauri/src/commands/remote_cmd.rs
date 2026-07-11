use tauri::{AppHandle, State};

use crate::remote::RemoteStatus;
use crate::{with_state, AppState};

#[tauri::command]
pub fn start_remote(
    app: AppHandle,
    state: State<'_, AppState>,
    port: Option<u16>,
) -> Result<RemoteStatus, String> {
    with_state(&state, |runtime| {
        let port = port.unwrap_or(runtime.config.remote_port);
        let pin = runtime
            .config
            .remote_pin
            .clone()
            .unwrap_or_else(|| "1234".into());
        let (server, rx) = crate::remote::RemoteServer::start(port, pin.clone())?;
        let status = server.status();
        runtime.remote = Some(server);
        *state.remote_actions.lock() = Some(rx);
        runtime.config.remote_enabled = true;
        runtime.config.remote_port = port;
        runtime.config.remote_pin = Some(pin);
        runtime.config.save(&app)?;
        Ok(status)
    })
}

#[tauri::command]
pub fn stop_remote(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    with_state(&state, |runtime| {
        if let Some(server) = runtime.remote.take() {
            server.stop();
        }
        *state.remote_actions.lock() = None;
        runtime.config.remote_enabled = false;
        runtime.config.save(&app)?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_remote_status(state: State<'_, AppState>) -> Result<Option<RemoteStatus>, String> {
    with_state(&state, |runtime| {
        Ok(runtime.remote.as_ref().map(|r| r.status()))
    })
}
