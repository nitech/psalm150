use tauri::{AppHandle, Manager, State};

use crate::config::{self, AppConfig};
use crate::display::{self, DisplayInfo};
use crate::projection::SlideTheme;
use crate::{with_state, AppState};

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    with_state(&state, |runtime| Ok(runtime.config.clone()))
}

#[tauri::command]
pub fn set_read_only(app: AppHandle, state: State<'_, AppState>, read_only: bool) -> Result<(), String> {
    with_state(&state, |runtime| {
        runtime.read_only = read_only;
        runtime.config.read_only = read_only;
        runtime.config.save(&app)
    })
}

#[tauri::command]
pub fn set_project_to_stage(
    app: AppHandle,
    state: State<'_, AppState>,
    project_to_stage: bool,
) -> Result<(), String> {
    with_state(&state, |runtime| {
        runtime.config.project_to_stage = project_to_stage;
        runtime.config.save(&app)
    })
}

#[tauri::command]
pub fn save_theme(app: AppHandle, state: State<'_, AppState>, theme: SlideTheme) -> Result<(), String> {
    with_state(&state, |runtime| {
        let hash = runtime
            .folder_hash
            .as_ref()
            .ok_or_else(|| "No library open".to_string())?;
        config::save_theme(&app, hash, &theme)
    })
}

#[tauri::command]
pub fn get_theme(app: AppHandle, state: State<'_, AppState>) -> Result<SlideTheme, String> {
    with_state(&state, |runtime| {
        let hash = runtime
            .folder_hash
            .as_ref()
            .ok_or_else(|| "No library open".to_string())?;
        config::load_theme(&app, hash)
    })
}

#[tauri::command]
pub fn save_shortcuts(app: AppHandle, state: State<'_, AppState>, shortcuts: config::ShortcutConfig) -> Result<(), String> {
    with_state(&state, |runtime| {
        runtime.config.shortcuts = shortcuts;
        runtime.config.save(&app)
    })
}

#[tauri::command]
pub fn get_shortcuts(state: State<'_, AppState>) -> Result<config::ShortcutConfig, String> {
    with_state(&state, |runtime| Ok(runtime.config.shortcuts.clone()))
}

#[tauri::command]
pub fn list_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    display::list_displays(&app)
}

#[tauri::command]
pub fn set_audience_monitor(
    app: AppHandle,
    state: State<'_, AppState>,
    monitor_id: Option<String>,
) -> Result<(), String> {
    with_state(&state, |runtime| {
        runtime.config.audience_monitor = monitor_id.clone();
        runtime.config.save(&app)
    })?;
    if let Some(window) = app.get_webview_window("audience") {
        if window.is_visible().unwrap_or(false) {
            display::apply_monitor_to_window(&app, "audience", monitor_id.as_deref(), true)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_stage_monitor(
    app: AppHandle,
    state: State<'_, AppState>,
    monitor_id: Option<String>,
) -> Result<(), String> {
    with_state(&state, |runtime| {
        runtime.config.stage_monitor = monitor_id.clone();
        runtime.config.save(&app)
    })?;
    if let Some(window) = app.get_webview_window("stage") {
        if window.is_visible().unwrap_or(false) {
            display::apply_monitor_to_window(&app, "stage", monitor_id.as_deref(), false)?;
        }
    }
    Ok(())
}
