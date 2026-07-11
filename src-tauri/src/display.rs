use serde::Serialize;
use tauri::window::Monitor;
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow,
};

/// Saved in config when the user picks "Simulated display" instead of a physical monitor.
pub const SIMULATED_DISPLAY_ID: &str = "__simulated__";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: String,
    pub label: String,
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

pub fn display_id(monitor: &Monitor) -> String {
    let pos = monitor.position();
    let size = monitor.size();
    format!("{},{},{},{}", pos.x, pos.y, size.width, size.height)
}

fn display_label(monitor: &Monitor, index: usize, is_primary: bool) -> String {
    let size = monitor.size();
    let resolution = format!("{}×{}", size.width, size.height);
    let name = monitor
        .name()
        .map(|n| format!(" · {n}"))
        .unwrap_or_default();
    let primary = if is_primary { "Primary · " } else { "" };
    format!("{primary}Display {index}{name} · {resolution}")
}

pub fn list_displays(app: &AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available".to_string())?;
    let monitors = main.available_monitors().map_err(|e| e.to_string())?;
    let primary = main.primary_monitor().ok().flatten();
    let primary_id = primary.as_ref().map(display_id);

    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let id = display_id(&monitor);
            let is_primary = primary_id.as_deref() == Some(id.as_str());
            DisplayInfo {
                label: display_label(&monitor, index + 1, is_primary),
                name: monitor.name().cloned(),
                width: monitor.size().width,
                height: monitor.size().height,
                is_primary,
                id,
            }
        })
        .collect())
}

pub fn find_monitor(app: &AppHandle, monitor_id: &str) -> Result<Option<Monitor>, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available".to_string())?;
    let monitors = main.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .into_iter()
        .find(|monitor| display_id(monitor) == monitor_id))
}

pub fn is_simulated_display(monitor_id: Option<&str>) -> bool {
    monitor_id == Some(SIMULATED_DISPLAY_ID)
}

pub fn resolve_monitor(
    app: &AppHandle,
    monitor_id: Option<&str>,
) -> Result<Option<Monitor>, String> {
    if is_simulated_display(monitor_id) {
        return Ok(None);
    }
    match monitor_id {
        Some(id) if !id.is_empty() => find_monitor(app, id),
        _ => {
            let main = app
                .get_webview_window("main")
                .ok_or_else(|| "Main window is not available".to_string())?;
            Ok(main.primary_monitor().map_err(|e| e.to_string())?)
        }
    }
}

pub fn place_window_on_monitor(
    window: &WebviewWindow,
    monitor: &Monitor,
    fullscreen: bool,
) -> Result<(), String> {
    let pos = monitor.position();
    let _ = window.set_fullscreen(false);
    window
        .set_position(Position::Physical(PhysicalPosition { x: pos.x, y: pos.y }))
        .map_err(|e| e.to_string())?;

    if fullscreen {
        window.set_fullscreen(true).map_err(|e| e.to_string())?;
    } else {
        let size = monitor.size();
        window
            .set_size(Size::Physical(PhysicalSize {
                width: size.width,
                height: size.height,
            }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn simulated_origin(app: &AppHandle, cascade: i32) -> PhysicalPosition<i32> {
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(pos) = main.outer_position() {
            let offset = 40 + cascade * 32;
            return PhysicalPosition {
                x: pos.x + offset,
                y: pos.y + offset,
            };
        }
    }
    PhysicalPosition {
        x: 80 + cascade * 32,
        y: 80 + cascade * 32,
    }
}

fn apply_simulated_display(
    app: &AppHandle,
    window: &WebviewWindow,
    window_label: &str,
) -> Result<(), String> {
    let cascade = match window_label {
        "stage" => 1,
        _ => 0,
    };
    let (title, width, height) = match window_label {
        "stage" => ("Stage (Simulated Display)", 900.0, 640.0),
        _ => ("Congregation (Simulated Display)", 960.0, 540.0),
    };

    let _ = window.set_fullscreen(false);
    window.set_decorations(true).map_err(|e| e.to_string())?;
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.set_title(title).map_err(|e| e.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize { width, height }))
        .map_err(|e| e.to_string())?;
    window
        .set_position(Position::Physical(simulated_origin(app, cascade)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn restore_projection_window_chrome(
    window: &WebviewWindow,
    window_label: &str,
) -> Result<(), String> {
    match window_label {
        "audience" => {
            window.set_decorations(false).map_err(|e| e.to_string())?;
            window.set_always_on_top(true).map_err(|e| e.to_string())?;
            window.set_title("Audience").map_err(|e| e.to_string())?;
        }
        "stage" => {
            window.set_title("Stage").map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    Ok(())
}

pub fn apply_monitor_to_window(
    app: &AppHandle,
    window_label: &str,
    monitor_id: Option<&str>,
    fullscreen: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(window_label)
        .ok_or_else(|| format!("{window_label} window is not available"))?;

    if is_simulated_display(monitor_id) {
        return apply_simulated_display(app, &window, window_label);
    }

    restore_projection_window_chrome(&window, window_label)?;

    if let Some(monitor) = resolve_monitor(app, monitor_id)? {
        place_window_on_monitor(&window, &monitor, fullscreen)?;
    }
    Ok(())
}
