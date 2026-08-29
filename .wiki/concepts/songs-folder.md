---
type: Concept
title: Songs folder and app data
description: The synced ChordPro folder is the only shared state; everything else lives per library under the app data dir. Covers the watcher, the dirty flag and startup staging.
tags: [library, filesystem, dropbox, startup]
status: stable
sources:
  - id: contract
    resource: /docs/songs-folder-contract.md
    title: Songs folder contract
  - id: library-cmd
    resource: /src-tauri/src/commands/library.rs
    title: stage/activate songs folder, status, search commands
  - id: config
    resource: /src-tauri/src/config.rs
    title: Library root layout and hashing
  - id: scan
    resource: /src-tauri/src/library/scan.rs
    title: Folder scan, foreign files, conflicts
  - id: watcher
    resource: /src-tauri/src/library/watcher.rs
    title: notify-based watcher
  - id: lib
    resource: /src-tauri/src/lib.rs
    title: Startup restore and the 1 s poll thread
generated: { by: agent, at: 2026-08-29T19:45:00Z }
---

# Songs folder and app data

## The folder

User-chosen, often a shared Dropbox directory. The app only ever **writes
ChordPro files** there. Scans are non-recursive. Two health signals surface in
`LibraryStatus`: `foreign_files` (anything not `.pro`/`.cho`) and `conflicts`
(names containing `conflicted copy` or ` (conflict)`). The console shows a
"Changed" badge while `library_dirty` is set.

## Per-library app data

`app_data_dir/libraries/<hash>/`, where `hash` is the first 16 hex characters
of SHA-256 over the lower-cased folder path (`config::hash_folder`). On
Windows `app_data_dir` is `%APPDATA%\com.sevenfold.praise`.

| File | Owner | Purpose |
| --- | --- | --- |
| `index.sqlite` | [library index](library-index.md) | Search index, history, favourites |
| `setlists/*.json` | [setlists](setlists.md) | One file per setlist |
| `hold_slides/` | — | Created and listed by `list_hold_slides`, never written |
| `theme.json` | [config](config.md) | `SlideTheme`; written by MDB import or `save_theme` |
| `favorites.json` | — | Helpers exist in `config.rs` but nothing calls them; favourites live in SQLite |
| `ccli_log.sqlite` | [reports](reports.md) | Projection usage log |

Global: `app_data_dir/config.json` (`AppConfig`).

## Choosing and restoring

`set_songs_folder(path)` (frontend dialog) or `pick_songs_folder` (Rust
dialog; unused by the UI) call `activate_songs_folder(persist = true)`:
validate the directory, ensure the layout, open `index.sqlite`, **full rescan
and rebuild**, attach a `SetlistStore` and a watcher, save
`last_songs_folder` and `first_run_complete`, emit `library-changed`.

At startup the remembered folder is restored in two phases so the UI is not
blocked by a 15 s+ rescan of a large library:

1. `stage_songs_folder` on the main thread: attach the folder, reuse an
   existing `index.sqlite` if present, start the watcher.
2. `activate_songs_folder(persist = false)` on a background thread: rescan and
   rebuild, then `library-changed`.

The console polls `get_library_status` every 250 ms (up to 30 s, twice: first
for a folder, then for `song_count > 0`) and toasts if the folder never
appears.

## Watcher and dirty flag

`LibraryWatcher` uses `notify` (`RecommendedWatcher`, 2 s poll config,
non-recursive) and forwards create/modify/remove as `()` on a channel. A thread
in `lib.rs` drains it once a second, sets `library_dirty`, and emits
`library-changed`; the console refreshes status and the current list. Nothing
re-indexes automatically: **Rescan library** (Settings) or an import does.
Edits made through the app (`save_song`, `delete_song`) update SQLite directly.

## Read-only

`config.read_only` (Settings, "Read-only library") blocks `save_song`,
`delete_song`, `renumber_songs` and saving a web result.

## Related

- [ChordPro dialect](chordpro-dialect.md): what the files contain
- [MDB import](mdb-import.md): writes into this folder
