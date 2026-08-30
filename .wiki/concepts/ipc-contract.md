---
type: Concept
title: IPC contract
description: Every Tauri command and event between the webviews and the Rust core, grouped, with whether the UI calls it today.
tags: [ipc, tauri, contract, commands, events]
status: stable
sources:
  - id: lib
    resource: /src-tauri/src/lib.rs
    title: generate_handler registration
  - id: api
    resource: /src/api.ts
    title: Typed wrappers used by the console
  - id: client
    resource: /src/projection-client.ts
    title: Wrappers used by the audience page
generated: { by: agent, at: 2026-08-29T19:45:00Z }
---

# IPC contract

Arguments are camelCase on the JS side and snake_case in Rust (Tauri converts).
Errors are `String`. "UI" says whether any page calls it today; unused
commands are real and tested but reachable only over IPC.

## Library

| Command | Args → Result | UI |
| --- | --- | --- |
| `get_library_status` | → `LibraryStatus { songs_folder, song_count, library_dirty, foreign_files, conflicts }` | yes |
| `set_songs_folder` | `path` → `LibraryStatus` | yes (after the JS dialog) |
| `pick_songs_folder` | Rust dialog → `LibraryStatus` | no |
| `get_songs_folder` | → `Option<String>` | no |
| `rescan_songs` | → `LibraryStatus` | yes |
| `list_foreign_files`, `list_conflicts` | → `Vec<String>` | no (status carries them) |
| `search_songs` | `query, favoritesOnly` → `Vec<SongRow>` | yes |
| `list_by_key` | `key` → `Vec<SongRow>` | yes |
| `list_keys`, `list_categories` | → `Vec<String>` | keys yes, categories no |
| `get_history` | `limit` → `Vec<(filename, title, accessed_at)>` | yes |
| `toggle_favorite` | `filename` → `bool` | no |
| `list_favorites` | → `Vec<String>` | no |

## Songs and import

| Command | Args → Result | UI |
| --- | --- | --- |
| `load_song` | `filename` → `SongDetail { parsed, projection }` (resets projection to slide 0) | yes |
| `save_song` | `filename, content` → `SongDetail` (rebuilds slides, keeps index) | yes |
| `delete_song` | `filename` | yes |
| `quick_project` | `text, save` → `SongDetail` (`__quick__.pro` or `0000-quick-song.pro`) | yes |
| `renumber_songs` | `plans[{from,to}]` → messages | no |
| `compact_library` | → summary string (VACUUM + orphan count) | no |
| `import_mdb_path` | `mdbPath` → `ImportReport { written, skipped, warnings, cancelled }` | yes |
| `cancel_import` | | yes |
| `check_duplicates` | → `Vec<DuplicateWarning>` | no |
| `search_web_songs` | `query` → `Vec<WebSearchCandidate>` | yes |

## Projection

| Command | Args → Result | UI |
| --- | --- | --- |
| `open_audience_window`, `open_stage_window` | async | yes |
| `close_audience_window`, `close_stage_window` | | no (only via the pair below) |
| `close_projection_windows` | emits `projection-closed` | yes (console, audience, stage) |
| `show_slide` | `index` → `ProjectionState` | yes |
| `next_slide`, `previous_slide`, `blank_screen` | → `ProjectionState` | yes (console + audience keys) |
| `get_projection_state` | → `ProjectionState` | audience page |
| `get_next_slide_preview` | → `Option<SlidePayload>` | no |
| `set_transpose` | `semitones` → `ProjectionState` (re-reads the file) | yes (Edit modal) |
| `set_nashville` | `enabled` → `ProjectionState` (flag only) | no |
| `log_projection` | history + CCLI log | yes (on Project) |

## Setlists, config, reports, remote

| Command | Args → Result | UI |
| --- | --- | --- |
| `create_setlist` `name, date`; `setlist_advance` | → `Setlist` / `Option<SetlistItem>` | yes |
| `list_setlists`, `load_setlist`, `save_setlist`, `setlist_previous`, `list_hold_slides` | | no |
| `get_config` | → `AppConfig` | yes |
| `set_read_only`, `set_project_to_stage`, `set_web_search_enabled`, `set_show_song_numbers` | bool | yes |
| `list_displays` | → `Vec<DisplayInfo { id, label, name, width, height, isPrimary }>` | yes |
| `set_audience_monitor`, `set_stage_monitor` | `monitorId: Option<String>` (re-places a visible window) | yes |
| `get_theme` | → `SlideTheme` | audience page |
| `save_theme`, `get_shortcuts`, `save_shortcuts` | | no |
| `export_ccli_report` | `from, to` (RFC 3339) → CSV string | yes |
| `print_songbook_html` | `title, includeIndexes` → HTML string | yes |
| `start_remote` `port?`, `stop_remote`, `get_remote_status` | → `RemoteStatus { running, port, pin }`; start also runs in `setup()` when `remote_enabled` | yes (Settings) |

## Events (Rust to webviews)

| Event | Payload | Listener |
| --- | --- | --- |
| `library-changed` | none | console refreshes status and list |
| `projection-closed` | none | console sets `projecting = false` |
| `audience-slide` | `SlidePayload` (global and `emit_to("audience")`) | audience page |
| `stage-slide` | `StageSlide` (global and `emit_to("stage")`) | stage page |
| `import-progress` | `{ current, total, song_title }` | console import modal |
| `import-complete` | `ImportReport` | nobody (the command's return is used) |

Plus two `window.eval` pushes described in
[projection windows](projection-windows.md).
