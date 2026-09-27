---
type: Concept
title: Config and theme
description: Global config.json fields with defaults and consumers, the per-library SlideTheme, and settings that are stored but not used.
tags: [config, settings, theme]
status: stable
sources:
  - id: config
    resource: /src-tauri/src/config.rs
    title: AppConfig, ShortcutConfig, theme/favorites helpers
  - id: cmd
    resource: /src-tauri/src/commands/config_cmd.rs
    title: Config commands
  - id: theme
    resource: /src-tauri/src/projection/mod.rs
    title: SlideTheme defaults
  - id: api
    resource: /src/api.ts
    title: AppConfig TypeScript shape
generated: { by: agent, at: 2026-09-27T12:00:00Z }
---

# Config and theme

`app_data_dir/config.json`, loaded once in `setup()` into
`RuntimeState.config` and saved by each setter. Unknown fields are ignored;
fields marked `#[serde(default)]` may be absent in old files.

| Field | Default | Set by | Used by |
| --- | --- | --- | --- |
| `last_songs_folder` | none | `activate_songs_folder(persist)` | startup restore |
| `read_only` | false | Settings | save / delete / renumber / quick save |
| `project_to_stage` | false | Settings | console opens the stage window on Project |
| `web_search_enabled` | true | Settings | console trigger and `search_web_songs` |
| `show_song_numbers` | true | Settings (Library) | song list number column |
| `server_library` | none | each server library synchronize (connect, sign-in, Synchronize); cleared on disconnect or when a local folder is chosen | `{ url, last_synced_at, song_count }`; its presence makes the library a [server library](server-library.md) (saves, sets sync, song server remote) |
| `vsb_sync` | none | Settings (Visual Song Book) via `set_vsb_database`; `last_synced_at`, `last_summary`, `last_error` by each run | [VSB sync](vsb-sync.md) |
| `audience_monitor` | none (= primary) | Settings (Congregation) | `open_audience_window`; `"__simulated__"` = window |
| `stage_monitor` | none | Settings (Stage) | `open_stage_window` (only when set) |
| `remote_enabled`, `remote_port` (8757), `remote_pin` | off | Settings (Phone remote) via `start_remote` / `stop_remote` | auto-started in `setup()` when enabled; see [remote control](remote-control.md) |
| `server_remote_enabled` | false | Settings (Church server) via `set_server_remote_enabled` | the song server remote loops, only while a server library is connected ([remote control](remote-control.md#through-the-song-server)) |
| `key_format_compressed` | false | nothing | nothing |
| `history_days` | 30 | nothing | nothing (history is never pruned) |
| `shortcuts` | `next_slide` ArrowRight, `previous_slide` ArrowLeft, `blank` B, `add_to_setlist` Alt+S, `toggle_favorite` Alt+F, `focus_search` Ctrl+F | Settings (Keyboard shortcuts) via `save_shortcuts` | console key handling (`src/shortcuts.ts`); missing fields take defaults, the old `KeyB` spelling is accepted |
| `first_run_complete` | false | first folder activation | welcome toast wording |

`runtime.read_only` is a copy of `config.read_only` taken at startup and
updated together with it.

## SlideTheme (`libraries/<hash>/theme.json`)

`font_name` (default "Arial Rounded MT Bold"), `font_size` 28, `font_bold`
true, `font_italic` false, `foreground` `#ffffff`, `background` `#000000`,
margins 40 / 48 / 48 / 48, `projection_width` 1920, `projection_height` 1080,
`show_title_overlay` / `show_key_overlay` / `show_copyright_overlay` true,
`show_ccli_overlay` false. Written by [MDB import](mdb-import.md) (from
`PageSetup`) or `save_theme` (no UI). Read by the
[slide pipeline](slide-pipeline.md) budgets and the
[audience display](audience-display.md) CSS variables. With no library open
`get_theme` errors and the audience uses CSS defaults (Geist 48 px).

## Related

- [IPC contract](ipc-contract.md): the setter commands
- [Songs folder](songs-folder.md): per-library layout
