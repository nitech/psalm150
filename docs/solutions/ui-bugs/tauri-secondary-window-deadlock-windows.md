---
title: Tauri secondary projection windows deadlock on Windows when built from commands
date: 2026-06-18
category: ui-bugs
module: projection
problem_type: ui_bug
component: tooling
symptoms:
  - "Audience projection window opens as a blank white frame with no slide content"
  - "Window cannot be closed with Escape or the close button; app feels frozen"
  - "No projection debug logs appear after the window shell is shown"
  - "Moving the window to another virtual desktop is the only way to escape on single-monitor setups"
root_cause: thread_violation
resolution_type: code_fix
severity: critical
tags:
  - tauri
  - windows
  - webview2
  - projection
  - deadlock
  - audience-window
---

# Tauri secondary projection windows deadlock on Windows when built from commands

## Problem

Opening the audience projection window from a Tauri command showed a white, empty window that could not be closed. The operator UI appeared hung and slides never rendered, even though `audience.html` loaded correctly in the dev server.

## Symptoms

- Audience window shell appears (title bar, fullscreen) but content is solid white
- Escape, close button, and operator controls do not dismiss the window
- `[projection]` logs stop before window creation completes
- Single-monitor users are effectively trapped until they move the window to another desktop

## What Didn't Work

- **Treating it as a frontend/CSS bug** — `audience.html` served fine over Vite (`http://localhost:1420/audience.html`, black background). The webview never finished initializing.
- **`WebviewUrl::External(http://localhost:1420/...)`** — wrong URL type for secondary Tauri webviews; use `WebviewUrl::App("audience.html")`.
- **Emitting slides before the audience page loaded** — real race, but not the root cause while the window was deadlocked.
- **Calling `window.eval()` / `emit_to()` while holding the app state mutex** — can contribute to Windows deadlocks; refactored to build `ProjectionFrame` under lock and emit after release.
- **Fullscreen at `build()` time** — did not fix the deadlock; defer fullscreen until `show()`.
- **Global Escape shortcut alone** — correct for operator safety, but useless while the UI thread is blocked.

## Solution

**Pre-create projection windows at startup (hidden), then show/hide them from commands.** Never call `WebviewWindowBuilder::build()` from inside a command handler while the event loop is running.

### 1. Create windows in `setup()`

```rust
// src-tauri/src/lib.rs — inside setup()
commands::projection_cmd::create_projection_windows(app.handle());
```

```rust
// src-tauri/src/commands/projection_cmd.rs
pub fn create_projection_windows(app: &AppHandle) {
    if app.get_webview_window("audience").is_none() {
        let _ = WebviewWindowBuilder::new(app, "audience", WebviewUrl::App("audience.html".into()))
            .title("Audience")
            .decorations(false)
            .always_on_top(true)
            .visible(false)
            .build();
    }
    if app.get_webview_window("stage").is_none() {
        let _ = WebviewWindowBuilder::new(app, "stage", WebviewUrl::App("stage.html".into()))
            .title("Stage")
            .inner_size(900.0, 640.0)
            .visible(false)
            .build();
    }
}
```

### 2. Open/close via show/hide (not build/destroy)

```rust
#[tauri::command]
pub fn open_audience_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let window = app.get_webview_window("audience")
        .ok_or_else(|| "Audience window is not available".to_string())?;
    let _ = window.set_fullscreen(true);
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
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
```

### 3. Deliver slides without holding the state mutex

Build slide payloads while the lock is held; emit and `eval` only after releasing it:

```rust
struct ProjectionFrame {
    audience: SlidePayload,
    stage: Option<StageSlide>,
}

fn sync_projection_windows(app: &AppHandle, state: &AppState) {
    let frame = with_state(state, |runtime| Ok(build_frame(runtime, runtime.projection.blank)));
    if let Ok(frame) = frame {
        emit_frame(app, &frame); // emit + eval happens here, lock already released
    }
}
```

### 4. Register global Escape while projection is visible

Use `tauri-plugin-global-shortcut` in `setup()` to call `close_projection_windows` when audience or stage is shown. Register once — duplicate registration panics at startup.

## Official Tauri patterns (Windows)

Tauri documents three safe ways to create secondary windows on Windows ([WebviewWindowBuilder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html), [wry#583](https://github.com/tauri-apps/wry/issues/583)):

| Pattern | When to use |
|---------|-------------|
| **Create in `setup()`** (what Praise uses) | Fixed windows opened often — projection, overlays, tray companions |
| **`async` command + `build()`** | Occasional windows — settings, about, one-off dialogs |
| **Separate thread from `setup()`** | Deferred creation when startup must not block |

**Do not** call `WebviewWindowBuilder::build()` from a **synchronous** `#[tauri::command]` on Windows. That is the documented deadlock path.

### Pre-create + show/hide (projection windows)

Best for audience/stage: webviews stay warm, projection starts instantly, no init delay on first show.

### Async on-demand (settings-style windows)

For windows that open rarely and do not need to stay warm, use an `async` command. Show an existing window if present; otherwise build it:

```rust
#[tauri::command]
async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        win.show().map_err(|e| e.to_string())?;
        let _ = win.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Settings")
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

Equivalent alternatives: declare hidden windows in `tauri.conf.json`, or create them from the frontend via `@tauri-apps/api/webviewWindow` (also async under the hood).

## Why This Works

On Windows, `WebviewWindowBuilder::build()` from a Tauri command runs on the main/UI thread while the event loop is already processing. WebView2 initialization needs the event loop to make progress; blocking `build()` inside a command creates a circular wait — the window shell may appear, but the webview never loads and the thread cannot process close/focus/keyboard events.

Creating windows during `setup()` (before the loop is servicing commands) avoids the deadlock. Commands only toggle visibility and push slide data to already-initialized webviews.

## Prevention

- **Rule:** on Windows, never call `WebviewWindowBuilder::build()` from a sync `#[tauri::command]`. Use `setup()`, an `async` command, or a separate thread.
- **Choose by use case:** pre-create + show/hide for hot-path windows (projection); async on-demand for cold-path windows (settings).
- **Diagnostic:** white secondary window + frozen UI + missing logs after `build()` → suspect main-thread deadlock, not missing HTML.
- **Slide delivery:** always release mutexes before `emit`, `emit_to`, or `window.eval`.
- **URLs:** use `WebviewUrl::App("page.html")` for bundled secondary windows.
- **Dev vs test:** `npm run tauri dev` runs the app; `npm run test:rust` runs Rust tests only.

## Related

- Implementation: `src-tauri/src/commands/projection_cmd.rs`, `src-tauri/src/lib.rs`
- Audience page: `src/audience.html`, `src/audience.ts`
- [WebviewWindowBuilder docs](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html) — known Windows deadlock + three safe patterns
- [Tauri multiwindow guide](https://tauri.app/v1/guides/features/multiwindow) — async commands required for runtime creation
- [wry#583](https://github.com/tauri-apps/wry/issues/583) — WebView2 reentrancy on IPC handlers
- [docs/songs-folder-contract.md](../../songs-folder-contract.md)
