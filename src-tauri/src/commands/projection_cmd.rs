use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::config::load_theme;
use crate::display;
use crate::library::chordpro::{parse_chordpro, ParsedSong, SongMeta};
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

/// Owned slide payloads to deliver to the projection windows. These are built
/// while the state lock is held, then emitted *after* the lock is released, so
/// we never call `eval`/`emit` (which hop to the UI thread) while holding the
/// mutex — that combination can deadlock on Windows.
struct ProjectionFrame {
    audience: SlidePayload,
    stage: Option<StageSlide>,
}

fn build_frame(runtime: &RuntimeState, blank: bool) -> ProjectionFrame {
    if blank || runtime.projection.slides.is_empty() {
        return ProjectionFrame {
            audience: blank_payload(),
            stage: None,
        };
    }

    let idx = runtime
        .projection
        .current_index
        .min(runtime.projection.slides.len() - 1);
    let slide = runtime.projection.slides[idx].clone();
    let next_label = runtime
        .projection
        .slides
        .get(idx + 1)
        .map(|s| s.section_label.clone());
    let stage = stage_slide(&slide, &song_stub(runtime), next_label, runtime.projection.nashville);
    ProjectionFrame {
        audience: audience_slide(&slide),
        stage: Some(stage),
    }
}

fn push_audience_slide(window: &WebviewWindow, slide: &SlidePayload) {
    if let Ok(json) = serde_json::to_string(slide) {
        let script = format!(
            "try{{if(window.__PRAISE_RENDER__)window.__PRAISE_RENDER__({json});}}catch(e){{console.error(e)}}"
        );
        let _ = window.eval(&script);
    }
}

fn push_stage_slide(window: &WebviewWindow, slide: &StageSlide) {
    if let Ok(json) = serde_json::to_string(slide) {
        let script = format!(
            "try{{window.dispatchEvent(new CustomEvent('praise-stage-slide',{{detail:{json}}}));}}catch(e){{console.error(e)}}"
        );
        let _ = window.eval(&script);
    }
}

fn emit_frame(app: &AppHandle, frame: &ProjectionFrame) {
    let _ = app.emit("audience-slide", &frame.audience);
    let _ = app.emit_to("audience", "audience-slide", &frame.audience);
    if let Some(window) = app.get_webview_window("audience") {
        push_audience_slide(&window, &frame.audience);
    }

    if let Some(stage) = frame.stage.as_ref() {
        let _ = app.emit("stage-slide", stage);
        let _ = app.emit_to("stage", "stage-slide", stage);
        if let Some(window) = app.get_webview_window("stage") {
            push_stage_slide(&window, stage);
        }
    }
}

/// Re-send the current slide to whatever projection windows exist.
fn sync_projection_windows(app: &AppHandle, state: &AppState) {
    let frame = with_state(state, |runtime| Ok(build_frame(runtime, runtime.projection.blank)));
    if let Ok(frame) = frame {
        emit_frame(app, &frame);
    }
}

/// Create the audience and stage windows once, hidden, during app startup.
///
/// Building windows here (on the main thread during `setup`) is safe; building
/// them later from inside a command can deadlock the event loop on Windows.
pub fn create_projection_windows(app: &AppHandle) {
    if app.get_webview_window("audience").is_none() {
        if let Err(e) = WebviewWindowBuilder::new(app, "audience", WebviewUrl::App("audience.html".into()))
            .title("Audience")
            .decorations(false)
            .always_on_top(true)
            .visible(false)
            .build()
        {
            eprintln!("[projection] failed to create audience window: {e}");
        }
    }

    if app.get_webview_window("stage").is_none() {
        if let Err(e) = WebviewWindowBuilder::new(app, "stage", WebviewUrl::App("stage.html".into()))
            .title("Stage")
            .inner_size(900.0, 640.0)
            .visible(false)
            .build()
        {
            eprintln!("[projection] failed to create stage window: {e}");
        }
    }
}

#[tauri::command]
pub fn open_audience_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let monitor_id = with_state(&state, |runtime| Ok(runtime.config.audience_monitor.clone()))?;
    display::apply_monitor_to_window(&app, "audience", monitor_id.as_deref(), true)?;
    let window = app
        .get_webview_window("audience")
        .ok_or_else(|| "Audience window is not available".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    sync_projection_windows(&app, &state);
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
pub fn open_stage_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
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
pub fn show_slide(app: AppHandle, state: State<'_, AppState>, index: usize) -> Result<ProjectionState, String> {
    show_slide_inner(&app, &state, index)
}

pub fn show_slide_inner(app: &AppHandle, state: &AppState, index: usize) -> Result<ProjectionState, String> {
    let (projection, frame) = with_state(state, |runtime| {
        if index >= runtime.projection.slides.len() {
            return Err("Slide index out of range".into());
        }
        runtime.projection.current_index = index;
        runtime.projection.blank = false;
        let frame = build_frame(runtime, false);
        Ok((runtime.projection.clone(), frame))
    })?;
    emit_frame(app, &frame);
    Ok(projection)
}

#[tauri::command]
pub fn next_slide(app: AppHandle, state: State<'_, AppState>) -> Result<ProjectionState, String> {
    next_slide_inner(&app, &state)
}

pub fn next_slide_inner(app: &AppHandle, state: &AppState) -> Result<ProjectionState, String> {
    let (projection, frame) = with_state(state, |runtime| {
        if runtime.projection.slides.is_empty() {
            return Err("No slides loaded".into());
        }
        runtime.projection.blank = false;
        let before = runtime.projection.current_index;
        if runtime.projection.current_index + 1 < runtime.projection.slides.len() {
            runtime.projection.current_index += 1;
        }
        let frame = if before != runtime.projection.current_index {
            Some(build_frame(runtime, false))
        } else {
            None
        };
        Ok((runtime.projection.clone(), frame))
    })?;
    if let Some(frame) = frame {
        emit_frame(app, &frame);
    }
    Ok(projection)
}

#[tauri::command]
pub fn previous_slide(app: AppHandle, state: State<'_, AppState>) -> Result<ProjectionState, String> {
    previous_slide_inner(&app, &state)
}

pub fn previous_slide_inner(app: &AppHandle, state: &AppState) -> Result<ProjectionState, String> {
    let (projection, frame) = with_state(state, |runtime| {
        runtime.projection.blank = false;
        let before = runtime.projection.current_index;
        if runtime.projection.current_index > 0 {
            runtime.projection.current_index -= 1;
        }
        let frame = if before != runtime.projection.current_index {
            Some(build_frame(runtime, false))
        } else {
            None
        };
        Ok((runtime.projection.clone(), frame))
    })?;
    if let Some(frame) = frame {
        emit_frame(app, &frame);
    }
    Ok(projection)
}

#[tauri::command]
pub fn blank_screen(app: AppHandle, state: State<'_, AppState>) -> Result<ProjectionState, String> {
    blank_screen_inner(&app, &state)
}

pub fn blank_screen_inner(app: &AppHandle, state: &AppState) -> Result<ProjectionState, String> {
    let (projection, frame) = with_state(state, |runtime| {
        runtime.projection.blank = true;
        let frame = build_frame(runtime, true);
        Ok((runtime.projection.clone(), frame))
    })?;
    emit_frame(app, &frame);
    Ok(projection)
}

#[tauri::command]
pub fn get_projection_state(state: State<'_, AppState>) -> Result<ProjectionState, String> {
    with_state(&state, |runtime| Ok(runtime.projection.clone()))
}

#[tauri::command]
pub fn get_next_slide_preview(state: State<'_, AppState>) -> Result<Option<SlidePayload>, String> {
    with_state(&state, |runtime| {
        let next = runtime.projection.current_index + 1;
        Ok(runtime.projection.slides.get(next).cloned())
    })
}

#[tauri::command]
pub fn set_transpose(app: AppHandle, state: State<'_, AppState>, semitones: i32) -> Result<ProjectionState, String> {
    with_state(&state, |runtime| {
        runtime.projection.transpose_semitones = semitones;
        let filename = runtime
            .projection
            .filename
            .clone()
            .ok_or_else(|| "No song loaded".to_string())?;
        let folder = runtime
            .songs_folder
            .as_ref()
            .ok_or_else(|| "No songs folder".to_string())?;
        let content = std::fs::read_to_string(folder.join(filename)).map_err(|e| e.to_string())?;
        let parsed = parse_chordpro(&content, &runtime.projection.filename.clone().unwrap_or_default());
        let theme = load_theme(&app, runtime.folder_hash.as_ref().unwrap()).unwrap_or_default();
        runtime.projection.slides = build_slides(&parsed, &theme, semitones);
        Ok(runtime.projection.clone())
    })
}

#[tauri::command]
pub fn set_nashville(state: State<'_, AppState>, enabled: bool) -> Result<ProjectionState, String> {
    with_state(&state, |runtime| {
        runtime.projection.nashville = enabled;
        Ok(runtime.projection.clone())
    })
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
