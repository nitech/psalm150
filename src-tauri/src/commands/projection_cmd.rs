use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

use crate::display;
use crate::library::chordpro::{ParsedSong, SongMeta};
use crate::projection::modes::{audience_slide, stage_slide, StageSlide};
use crate::projection::{blank_payload, build_slides, ProjectionState, SlidePayload};
use crate::state::RuntimeState;
use crate::{with_state, AppState};

fn song_stub(runtime: &RuntimeState) -> ParsedSong {
    ParsedSong {
        meta: SongMeta {
            filename: runtime.projection.filename.clone().unwrap_or_default(),
            title: runtime.projection.title.clone().unwrap_or_default(),
            key: runtime.projection.key.clone(),
            ..Default::default()
        },
        raw: String::new(),
        sections: vec![],
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProjectionSnapshot {
    pub revision: u64,
    pub session_id: Option<String>,
    pub projection: ProjectionState,
    pub theme: crate::projection::SlideTheme,
    pub audience: SlidePayload,
    pub stage: Option<StageSlide>,
}

pub(crate) fn build_snapshot(runtime: &RuntimeState) -> ProjectionSnapshot {
    let slide = runtime
        .projection
        .slides
        .get(runtime.projection.current_index)
        .cloned();
    let audience = if runtime.projection.blank {
        blank_payload()
    } else {
        slide
            .as_ref()
            .map(audience_slide)
            .unwrap_or_else(blank_payload)
    };
    let next_label = runtime
        .projection
        .slides
        .get(runtime.projection.current_index + 1)
        .map(|s| s.section_label.clone());
    let stage = slide.as_ref().map(|slide| {
        stage_slide(
            slide,
            &song_stub(runtime),
            next_label,
            runtime.projection.nashville,
        )
    });
    ProjectionSnapshot {
        revision: runtime.projection_revision,
        session_id: runtime.projection_session_id.clone(),
        projection: runtime.projection.clone(),
        theme: runtime.active_theme.clone(),
        audience,
        stage,
    }
}

pub fn emit_snapshot(app: &AppHandle, snapshot: &ProjectionSnapshot) {
    let _ = app.emit("projection-updated", snapshot);
}

/// Re-send the current slide to whatever projection windows exist.
fn sync_projection_windows(app: &AppHandle, state: &AppState) {
    let snapshot = with_state(state, |runtime| Ok(build_snapshot(runtime)));
    if let Ok(snapshot) = snapshot {
        emit_snapshot(app, &snapshot);
    }
}

fn build_audience_window(app: &AppHandle) -> Result<WebviewWindow, tauri::Error> {
    WebviewWindowBuilder::new(app, "audience", WebviewUrl::App("audience.html".into()))
        .title("Psalm150 audience display")
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .build()
}

fn build_stage_window(app: &AppHandle) -> Result<WebviewWindow, tauri::Error> {
    WebviewWindowBuilder::new(app, "stage", WebviewUrl::App("stage.html".into()))
        .title("Psalm150 stage display")
        .inner_size(900.0, 640.0)
        .visible(false)
        .build()
}

/// Intercept the title-bar close button so projection windows are hidden, not
/// destroyed. Simulated-display mode enables decorations; destroying a window
/// makes later `open_*` calls fail because sync rebuild deadlocks on Windows.
fn attach_projection_close_handler(window: &WebviewWindow, app: AppHandle) {
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = close_projection_windows(app.clone());
        }
    });
}

fn ensure_projection_window(app: &AppHandle, label: &str) -> Result<(), String> {
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }
    let window = match label {
        "audience" => build_audience_window(app),
        "stage" => build_stage_window(app),
        _ => return Err(format!("Unknown projection window: {label}")),
    }
    .map_err(|e| e.to_string())?;
    attach_projection_close_handler(&window, app.clone());
    Ok(())
}

/// Create the audience and stage windows once, hidden, during app startup.
///
/// Building windows here (on the main thread during `setup`) is safe; building
/// them later from inside a command can deadlock the event loop on Windows.
pub fn create_projection_windows(app: &AppHandle) {
    if app.get_webview_window("audience").is_none() {
        match build_audience_window(app) {
            Ok(window) => attach_projection_close_handler(&window, app.clone()),
            Err(e) => eprintln!("[projection] failed to create audience window: {e}"),
        }
    } else if let Some(window) = app.get_webview_window("audience") {
        attach_projection_close_handler(&window, app.clone());
    }

    if app.get_webview_window("stage").is_none() {
        match build_stage_window(app) {
            Ok(window) => attach_projection_close_handler(&window, app.clone()),
            Err(e) => eprintln!("[projection] failed to create stage window: {e}"),
        }
    } else if let Some(window) = app.get_webview_window("stage") {
        attach_projection_close_handler(&window, app.clone());
    }
}

#[tauri::command]
pub async fn open_audience_window(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    ensure_projection_window(&app, "audience")?;
    let monitor_id = with_state(&state, |runtime| {
        Ok(runtime.config.audience_monitor.clone())
    })?;
    display::apply_monitor_to_window(&app, "audience", monitor_id.as_deref(), true)?;
    let window = app
        .get_webview_window("audience")
        .ok_or_else(|| "Audience window is not available".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    sync_projection_windows(&app, &state);
    if display::is_simulated_display(monitor_id.as_deref()) {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn close_audience_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("audience") {
        let _ = window.set_fullscreen(false);
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_stage_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    ensure_projection_window(&app, "stage")?;
    let monitor_id = with_state(&state, |runtime| Ok(runtime.config.stage_monitor.clone()))?;
    if monitor_id.as_deref().is_some_and(|id| !id.is_empty()) {
        display::apply_monitor_to_window(&app, "stage", monitor_id.as_deref(), false)?;
    }
    let window = app
        .get_webview_window("stage")
        .ok_or_else(|| "Stage window is not available".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    sync_projection_windows(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn close_stage_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("stage") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn close_projection_windows(app: AppHandle) -> Result<(), String> {
    close_audience_window(app.clone())?;
    close_stage_window(app.clone())?;
    let _ = app.emit("projection-closed", ());
    Ok(())
}

#[tauri::command]
pub fn show_slide(
    app: AppHandle,
    state: State<'_, AppState>,
    index: usize,
) -> Result<ProjectionSnapshot, String> {
    show_slide_inner(&app, &state, index)
}

pub fn show_slide_inner(
    app: &AppHandle,
    state: &AppState,
    index: usize,
) -> Result<ProjectionSnapshot, String> {
    let snapshot = with_state(state, |runtime| {
        if index >= runtime.projection.slides.len() {
            return Err("Slide index out of range".into());
        }
        runtime.projection.current_index = index;
        runtime.projection.blank = false;
        runtime.projection_revision += 1;
        Ok(build_snapshot(runtime))
    })?;
    emit_snapshot(app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn next_slide(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectionSnapshot, String> {
    next_slide_inner(&app, &state)
}

pub fn next_slide_inner(app: &AppHandle, state: &AppState) -> Result<ProjectionSnapshot, String> {
    let (snapshot, changed) = with_state(state, |runtime| {
        if runtime.projection.slides.is_empty() {
            return Err("No slides loaded".into());
        }
        let was_blank = runtime.projection.blank;
        runtime.projection.blank = false;
        let before = runtime.projection.current_index;
        if runtime.projection.current_index + 1 < runtime.projection.slides.len() {
            runtime.projection.current_index += 1;
        }
        let changed = before != runtime.projection.current_index || was_blank;
        if changed {
            runtime.projection_revision += 1;
        }
        Ok((build_snapshot(runtime), changed))
    })?;
    if changed {
        emit_snapshot(app, &snapshot);
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn previous_slide(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectionSnapshot, String> {
    previous_slide_inner(&app, &state)
}

pub fn previous_slide_inner(
    app: &AppHandle,
    state: &AppState,
) -> Result<ProjectionSnapshot, String> {
    let (snapshot, changed) = with_state(state, |runtime| {
        let was_blank = runtime.projection.blank;
        runtime.projection.blank = false;
        let before = runtime.projection.current_index;
        if runtime.projection.current_index > 0 {
            runtime.projection.current_index -= 1;
        }
        let changed = before != runtime.projection.current_index || was_blank;
        if changed {
            runtime.projection_revision += 1;
        }
        Ok((build_snapshot(runtime), changed))
    })?;
    if changed {
        emit_snapshot(app, &snapshot);
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn blank_screen(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProjectionSnapshot, String> {
    blank_screen_inner(&app, &state)
}

pub fn blank_screen_inner(app: &AppHandle, state: &AppState) -> Result<ProjectionSnapshot, String> {
    let snapshot = with_state(state, |runtime| {
        runtime.projection.blank = true;
        runtime.projection_revision += 1;
        Ok(build_snapshot(runtime))
    })?;
    emit_snapshot(app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn get_projection_state(state: State<'_, AppState>) -> Result<ProjectionState, String> {
    with_state(&state, |runtime| Ok(runtime.projection.clone()))
}

#[tauri::command]
pub fn get_projection_snapshot(state: State<'_, AppState>) -> Result<ProjectionSnapshot, String> {
    with_state(&state, |runtime| Ok(build_snapshot(runtime)))
}

#[tauri::command]
pub fn get_next_slide_preview(state: State<'_, AppState>) -> Result<Option<SlidePayload>, String> {
    with_state(&state, |runtime| {
        let next = runtime.projection.current_index + 1;
        Ok(runtime.projection.slides.get(next).cloned())
    })
}

#[tauri::command]
pub fn set_transpose(
    app: AppHandle,
    state: State<'_, AppState>,
    semitones: i32,
) -> Result<ProjectionSnapshot, String> {
    let snapshot = with_state(&state, |runtime| {
        let parsed = runtime
            .active_song
            .as_ref()
            .ok_or_else(|| "No active song".to_string())?;
        let current_index = runtime.projection.current_index;
        runtime.projection.transpose_semitones = semitones;
        runtime.projection.slides = build_slides(parsed, &runtime.active_theme, semitones);
        runtime.projection.current_index =
            current_index.min(runtime.projection.slides.len().saturating_sub(1));
        runtime.projection_revision += 1;
        Ok(build_snapshot(runtime))
    })?;
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn set_nashville(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<ProjectionSnapshot, String> {
    let snapshot = with_state(&state, |runtime| {
        runtime.projection.nashville = enabled;
        runtime.projection_revision += 1;
        Ok(build_snapshot(runtime))
    })?;
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn log_projection(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    with_state(&state, |runtime| {
        let filename = runtime.projection.filename.clone().unwrap_or_default();
        let title = runtime.projection.title.clone().unwrap_or_default();
        if let Some(db) = runtime.db.as_ref() {
            db.add_history(&filename, &title)?;
        }
        if let Some(hash) = runtime.folder_hash.clone() {
            let log_path = crate::config::library_root(&app, &hash)?.join("ccli_log.sqlite");
            if let Ok(log) = crate::ccli::CcliLog::open(log_path) {
                let ccli = runtime.projection.ccli.as_deref();
                let _ = log.log(&filename, &title, ccli);
            }
        }
        Ok(())
    })
}
