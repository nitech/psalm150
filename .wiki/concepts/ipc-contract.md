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
generated: { by: agent, at: 2026-09-23T20:00:00Z }
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
| `toggle_favorite` | `filename` → `bool` | yes (star) |
| `list_favorites` | → `Vec<String>` | yes |

## Songs and import

| Command | Args → Result | UI |
| --- | --- | --- |
| `load_song` | `filename` → read-only `SongDetail { parsed, projection, content_hash }` preview | yes |
| `preview_web_song` | `content` → read-only `SongDetail` preview | yes |
| `project_song` | exactly one of `filename` / `content` → `ProjectionSnapshot`; starts a new active session and logs a library song once | yes |
| `save_song` | `filename, content, expectedHash` → `SongDetail`; rejects an external edit and refreshes an active song immediately | yes |
| `save_song_lines` | `filename, expectedHash, edits[{sectionIndex,lineIndex,text}]` → `SongDetail`; Rust uses parser source-line mappings | yes |
| `save_web_song` | `content` → `SongDetail`; collision-free number/title filename | yes |
| `delete_song` | `filename` → `RecoveryItem`; blocks active and setlist-referenced files | yes |
| `renumber_songs` | `plans[{from,to}]` → messages | no |
| `compact_library` | → summary string (VACUUM + orphan count) | no |
| `import_mdb_path` | `mdbPath` → `ImportReport { written, skipped, failed, warnings, cancelled, aborted_reason, files }` | yes |
| `cancel_import` | | yes |
| `check_duplicates` | → `Vec<DuplicateWarning>` | no |
| `list_duplicate_groups` | `includeReviewed` → exact-match groups with reasons, metadata, hashes and raw text | yes |
| `mark_duplicate_keep_both` | `leftHash, rightHash` | yes |
| `list_recovery_items`, `restore_recovery_item` | → recoverable copies / restored filename | yes |
| `search_web_songs` | `query` → `Vec<WebSearchCandidate>` | yes |

## Projection

| Command | Args → Result | UI |
| --- | --- | --- |
| `open_audience_window`, `open_stage_window` | async | yes |
| `close_audience_window`, `close_stage_window` | | no (only via the pair below) |
| `close_projection_windows` | emits `projection-closed` | yes (console, audience, stage) |
| `show_slide` | `index` → `ProjectionSnapshot` | yes |
| `next_slide`, `previous_slide`, `blank_screen` | → `ProjectionSnapshot` | yes (console + audience keys + phone) |
| `get_projection_snapshot` | → the same complete revisioned snapshot used by events | all three pages |
| `get_projection_state` | → legacy `ProjectionState` | no |
| `get_next_slide_preview` | → `Option<SlidePayload>` | no |
| `set_transpose` | `semitones` → `ProjectionSnapshot` using the active song kept in memory | yes (Edit modal) |
| `set_nashville` | `enabled` → `ProjectionSnapshot` | no |
| `log_projection` | legacy explicit history + CCLI log | no (`project_song` logs once) |

## Setlists, config, reports, remote

| Command | Args → Result | UI |
| --- | --- | --- |
| `list_setlists`, `create_setlist` `name, date` | → `Vec<Setlist>` / `Setlist` | yes |
| `add_to_setlist`, `remove_from_setlist` | `id, filename` → `Setlist` | yes (add-to-setlist menu) |
| `format_short_date` | → `Option<String>`, today in the Windows short date format | yes |
| `load_setlist`, `save_setlist`, `setlist_advance`, `setlist_previous`, `list_hold_slides` | | no |
| `set_vsb_database` | `path: Option<String>` → `Option<VsbSyncConfig>`; reads the file once to validate | yes |
| `sync_vsb_database` | `force` → `Option<VsbSyncReport>`; `None` when unlinked, busy, or unchanged | yes, plus a background thread ([VSB sync](vsb-sync.md)) |
| `get_config` | → `AppConfig` | yes |
| `set_read_only`, `set_project_to_stage`, `set_web_search_enabled`, `set_show_song_numbers` | bool | yes |
| `list_displays` | → `Vec<DisplayInfo { id, label, name, width, height, isPrimary }>` | yes |
| `set_audience_monitor`, `set_stage_monitor` | `monitorId: Option<String>` (re-places a visible window) | yes |
| `get_theme` | → `SlideTheme` | audience page |
| `get_shortcuts`, `save_shortcuts` | → / `shortcuts: ShortcutConfig` (combos like `Alt+S`) | yes |
| `save_theme` | | no |
| `export_ccli_report` | `from, to` (RFC 3339) → CSV string | yes |
| `print_songbook_html` | `title, includeIndexes` → HTML string | yes |
| `start_remote` `port?`, `stop_remote`, `get_remote_status` | → `RemoteStatus { running, port, pin }`; start also runs in `setup()` when `remote_enabled` | yes (Settings) |

## Events (Rust to webviews)

| Event | Payload | Listener |
| --- | --- | --- |
| `library-changed` | none | console refreshes status and list |
| `library-external-changed` | none | an open duplicate view marks its results stale |
| `projection-closed` | none | console sets `projecting = false` |
| `projection-escaped` | none | global Escape closed the projection; console clears and focuses search |
| `projection-updated` | `ProjectionSnapshot { revision, session_id, projection, theme, audience, stage }` | console, audience and stage; older revisions are ignored |
| `import-progress` | `{ current, total, song_title }` | console import modal |
| `import-complete` | `ImportReport` | nobody (the command's return is used) |
| `vsb-sync-progress` | `{ label, current, total }` | console progress hairline and sync icon |
| `vsb-sync-finished` | `{ report: VsbSyncReport?, error? }` | console refreshes config, toasts changes or errors |

Each page subscribes before fetching `get_projection_snapshot`, closing the
startup race without targeted events or `window.eval` delivery.
