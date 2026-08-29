---
type: Concept
title: Projection windows
description: Audience and stage webviews are created hidden at startup and shown on a monitor or as a simulated window; frames are emitted after the state lock is released.
tags: [projection, windows, tauri, webview2]
status: stable
sources:
  - id: projection-cmd
    resource: /src-tauri/src/commands/projection_cmd.rs
    title: Window creation, open/close, frame delivery, navigation commands
  - id: display
    resource: /src-tauri/src/display.rs
    title: Monitor ids, simulated display, placement
  - id: lib
    resource: /src-tauri/src/lib.rs
    title: setup(): global Escape shortcut, create_projection_windows
  - id: deadlock-doc
    resource: /docs/solutions/ui-bugs/tauri-secondary-window-deadlock-windows.md
    title: Why windows are pre-created (WebView2 deadlock)
generated: { by: agent, at: 2026-08-29T19:45:00Z }
---

# Projection windows

Three webviews exist for the whole app lifetime:

| Label | Page | Created | Chrome |
| --- | --- | --- | --- |
| `main` | `index.html` | `tauri.conf.json`, 1280x900, no decorations (custom title bar) | operator console |
| `audience` | `audience.html` | `create_projection_windows` in `setup()`, hidden | no decorations, always on top |
| `stage` | `stage.html` | same, hidden, 900x640 | normal window |

They are **shown and hidden, never destroyed**. Building a webview from a
synchronous command deadlocks WebView2 on Windows (white window, frozen UI);
the full story is in the deadlock solution doc. `ensure_projection_window`
rebuilds one only if it is missing, and the title-bar close button is
intercepted (`CloseRequested` → `prevent_close` → `close_projection_windows`).

## Opening

`open_audience_window` (async): read `config.audience_monitor`, then
`display::apply_monitor_to_window(.., fullscreen = true)`:

- **Simulated display** (`audience_monitor == "__simulated__"`): decorations
  on, not on top, resizable, titled "Congregation (Simulated Display)", 960x540
  logical, cascaded 40 px from the main window. Focus moves to it.
- **A monitor id** (`"x,y,w,h"` of the monitor) or empty (primary): chrome
  restored, window moved to the monitor origin and set fullscreen. The console
  re-takes focus afterwards so keyboard navigation keeps working.

`open_stage_window` only repositions when `stage_monitor` is set ("Stage
(Simulated Display)" 900x640, cascade 1). The console opens it when
`config.project_to_stage` is on. Changing a monitor in Settings while a window
is visible re-applies placement immediately.

## Closing and Escape

`close_projection_windows` hides both windows, leaves fullscreen, and emits
`projection-closed`; the console flips `projecting = false`. Escape reaches it
three ways: a **global** shortcut registered once in `setup()` (acts only while
a projection window is visible; registering twice panics), the audience and
stage pages' own `keydown`, and the console's Escape when no modal is open.

## Frame delivery

`ProjectionFrame { audience: SlidePayload, stage: Option<StageSlide> }` is
built inside `with_state`; `emit_frame` runs after the guard drops:

1. `app.emit("audience-slide")` (all windows) **and** `emit_to("audience", …)`.
   The audience page listens on both, so each slide arrives twice; `onSlide` is
   idempotent.
2. `window.eval("window.__PRAISE_RENDER__(json)")`: a hook the current audience
   page does not define; a harmless no-op kept for a non-Lit renderer.
3. Stage: `stage-slide` global plus targeted, plus an eval that dispatches a
   `praise-stage-slide` CustomEvent. Three paths, all setting the same state.

Navigation commands (`show_slide`, `next_slide`, `previous_slide`,
`blank_screen`) return the new `ProjectionState` to the caller and push a frame
only when the index actually changed. `sync_projection_windows` re-sends the
current frame when a window is (re)opened. `save_song` rebuilds slides but does
**not** push a frame; the screen updates on the next navigation.

## Related

- [Audience display](audience-display.md), [Stage display](stage-display.md)
- [Config](config.md): `audience_monitor`, `stage_monitor`, `project_to_stage`
- [Remote control](remote-control.md): next/prev/blank from a phone
