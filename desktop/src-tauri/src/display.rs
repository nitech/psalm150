use std::time::Duration;

use serde::Serialize;
use tauri::window::Monitor;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    WebviewWindow,
};

use crate::{with_state, AppState};

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

/// Cover `monitor` with the window. The audience window has no frame and stays
/// on top, so covering the monitor is fullscreen without the OS fullscreen
/// switch: that switch showed the window at its small size on the projector
/// before it filled the screen, and again when leaving it. Size and position
/// are set while the window is hidden, so it appears already full size.
pub fn place_window_on_monitor(window: &WebviewWindow, monitor: &Monitor) -> Result<(), String> {
    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
    }
    let pos = monitor.position();
    let size = monitor.size();
    window
        .set_position(Position::Physical(PhysicalPosition { x: pos.x, y: pos.y }))
        .map_err(|e| e.to_string())?;
    window
        .set_size(Size::Physical(PhysicalSize {
            width: size.width,
            height: size.height,
        }))
        .map_err(|e| e.to_string())?;
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
            window
                .set_title("Psalm150 audience display")
                .map_err(|e| e.to_string())?;
        }
        "stage" => {
            window
                .set_title("Psalm150 stage display")
                .map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    Ok(())
}

pub fn apply_monitor_to_window(
    app: &AppHandle,
    window_label: &str,
    monitor_id: Option<&str>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(window_label)
        .ok_or_else(|| format!("{window_label} window is not available"))?;

    if is_simulated_display(monitor_id) {
        return apply_simulated_display(app, &window, window_label);
    }

    restore_projection_window_chrome(&window, window_label)?;

    if let Some(monitor) = resolve_monitor(app, monitor_id)? {
        place_window_on_monitor(&window, &monitor)?;
    }
    Ok(())
}

/// A display as the watcher sees it: `key` stays the same when the display
/// moves or changes resolution (the system's name for it, else its id); `id`
/// is what the config stores.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Seen {
    key: String,
    id: String,
}

fn seen(monitor: &Monitor) -> Seen {
    let id = display_id(monitor);
    Seen {
        key: monitor.name().cloned().unwrap_or_else(|| id.clone()),
        id,
    }
}

/// The display to project to after `current` replaced `settled`: one that was
/// just connected and is not in `avoid` (the primary display and the one the
/// console is on). None unless the number of displays grew, so a display that
/// only moved or changed resolution is never taken for a new one.
fn newly_connected(settled: &[Seen], current: &[Seen], avoid: &[&str]) -> Option<String> {
    if current.len() <= settled.len() {
        return None;
    }
    current
        .iter()
        .filter(|display| !settled.iter().any(|old| old.key == display.key))
        .find(|display| !avoid.contains(&display.id.as_str()))
        .map(|display| display.id.clone())
}

/// The saved display's id now, when it changed: the system may move a display
/// as another is connected, so it is found again by its key. None when the id
/// still holds, or the display is gone.
fn follow(saved: Option<&str>, settled: &[Seen], current: &[Seen]) -> Option<String> {
    let saved = saved.filter(|id| !id.is_empty())?;
    if current.iter().any(|display| display.id == saved) {
        return None;
    }
    let key = &settled.iter().find(|display| display.id == saved)?.key;
    current
        .iter()
        .find(|display| &display.key == key)
        .map(|display| display.id.clone())
}

/// Sent to the console (`displays-changed`) when displays come or go.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaysChanged {
    pub displays: Vec<DisplayInfo>,
    pub audience_monitor: Option<String>,
    pub stage_monitor: Option<String>,
    /// The label of a display just made the congregation display.
    pub selected: Option<String>,
}

/// How often the watcher looks at the displays.
const DISPLAY_WATCH_INTERVAL: Duration = Duration::from_secs(2);

/// Watches displays being connected and disconnected. A change counts once it
/// has held for one more look, as the system settles a new screen. A newly
/// connected display becomes the congregation display unless
/// `auto_select_display` is off; projection windows follow their display when
/// the system moves it; the console hears of every change.
pub fn spawn_watcher(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut settled: Option<Vec<Seen>> = None;
        let mut pending: Option<Vec<Seen>> = None;
        loop {
            std::thread::sleep(DISPLAY_WATCH_INTERVAL);
            let Some(main) = app.get_webview_window("main") else {
                continue;
            };
            let Ok(monitors) = main.available_monitors() else {
                continue;
            };
            let current: Vec<Seen> = monitors.iter().map(seen).collect();
            let Some(before) = settled.clone() else {
                settled = Some(current);
                continue;
            };
            if current == before {
                pending = None;
                continue;
            }
            if pending.as_ref() != Some(&current) {
                pending = Some(current);
                continue;
            }
            pending = None;
            settled = Some(current.clone());
            if let Err(error) = displays_changed(&app, &main, &before, &current) {
                eprintln!("[displays] {error}");
            }
        }
    });
}

fn displays_changed(
    app: &AppHandle,
    main: &WebviewWindow,
    before: &[Seen],
    current: &[Seen],
) -> Result<(), String> {
    let primary = main
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| display_id(&m));
    let console = main
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| display_id(&m));
    let avoid: Vec<&str> = [primary.as_deref(), console.as_deref()]
        .into_iter()
        .flatten()
        .collect();
    let state = app.state::<AppState>();
    let (audience, stage, chosen, audience_moved, stage_moved) = with_state(&state, |runtime| {
        let config = &mut runtime.config;
        let chosen = if config.auto_select_display {
            newly_connected(before, current, &avoid)
        } else {
            None
        };
        let audience = chosen
            .clone()
            .or_else(|| follow(config.audience_monitor.as_deref(), before, current));
        let stage = follow(config.stage_monitor.as_deref(), before, current);
        let (audience_moved, stage_moved) = (audience.is_some(), stage.is_some());
        if let Some(id) = audience {
            config.audience_monitor = Some(id);
        }
        if let Some(id) = stage {
            config.stage_monitor = Some(id);
        }
        if audience_moved || stage_moved {
            config.save(app)?;
        }
        Ok((
            config.audience_monitor.clone(),
            config.stage_monitor.clone(),
            chosen,
            audience_moved,
            stage_moved,
        ))
    })?;
    for (label, moved, monitor) in [
        ("audience", audience_moved, &audience),
        ("stage", stage_moved, &stage),
    ] {
        let visible = app
            .get_webview_window(label)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        if moved && visible {
            apply_monitor_to_window(app, label, monitor.as_deref())?;
        }
    }
    let displays = list_displays(app)?;
    let selected = chosen.and_then(|id| {
        displays
            .iter()
            .find(|display| display.id == id)
            .map(|display| display.label.clone())
    });
    app.emit(
        "displays-changed",
        DisplaysChanged {
            displays,
            audience_monitor: audience,
            stage_monitor: stage,
            selected,
        },
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(key: &str, id: &str) -> Seen {
        Seen {
            key: key.into(),
            id: id.into(),
        }
    }

    #[test]
    fn a_connected_display_is_chosen_but_not_the_primary_or_the_consoles() {
        let laptop = display("DISPLAY1", "0,0,1920,1080");
        let projector = display("DISPLAY2", "1920,0,1280,720");
        let before = vec![laptop.clone()];
        let after = vec![laptop, projector.clone()];
        assert_eq!(
            newly_connected(&before, &after, &["0,0,1920,1080"]),
            Some(projector.id.clone())
        );
        assert_eq!(
            newly_connected(&before, &after, &[projector.id.as_str()]),
            None
        );
    }

    #[test]
    fn a_display_that_only_changed_is_not_new() {
        let before = vec![
            display("DISPLAY1", "0,0,1920,1080"),
            display("DISPLAY2", "1920,0,1280,720"),
        ];
        // The projector's resolution changed: same count, same names.
        let resized = vec![
            display("DISPLAY1", "0,0,1920,1080"),
            display("DISPLAY2", "1920,0,1920,1080"),
        ];
        assert_eq!(newly_connected(&before, &resized, &[]), None);
        // One went away.
        assert_eq!(newly_connected(&before, &before[..1], &[]), None);
    }

    #[test]
    fn the_saved_display_is_followed_when_it_moves() {
        let before = vec![
            display("DISPLAY1", "0,0,1920,1080"),
            display("DISPLAY2", "1920,0,1280,720"),
        ];
        let moved = vec![
            display("DISPLAY1", "0,0,1920,1080"),
            display("DISPLAY2", "-1280,0,1280,720"),
        ];
        assert_eq!(
            follow(Some("1920,0,1280,720"), &before, &moved),
            Some("-1280,0,1280,720".into())
        );
        // Still where it was, the primary (empty) or gone: nothing to follow.
        assert_eq!(follow(Some("1920,0,1280,720"), &before, &before), None);
        assert_eq!(follow(Some(""), &before, &moved), None);
        assert_eq!(follow(Some("1920,0,1280,720"), &before, &before[..1]), None);
    }
}
