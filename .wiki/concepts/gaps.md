---
type: Overview
title: Gaps and backlog
description: Known limitations found in the code, the Todo list with status, and commands that exist without UI — the honest map of what is half-built.
tags: [backlog, gaps, todo]
status: stable
stale_after: 2026-11-29
sources:
  - id: todo
    resource: /Todo.md
    title: Todo list (Norwegian)
  - id: app
    resource: /src/components/app.ts
    title: Console (what has UI)
  - id: lib
    resource: /src-tauri/src/lib.rs
    title: Registered commands
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Gaps and backlog

## Todo.md, with status

| Item (paraphrased) | Status |
| --- | --- |
| Choruses alternate during projection; support `chorus2` | Done: [slide pipeline](slide-pipeline.md) and [performance sections](performance-sections.md) |
| Colour choruses differently in the minimap | Obsolete: the minimap was removed |
| Lines of song 227 wrap wrongly when projecting to the hall | Fixed 2026-08-29: [audience display](audience-display.md) |
| Show 1/7, 2/7… with up/down arrows bottom-right | Done: stanza counter |
| Chords in text must not reach the congregation | Done and tested |
| Bottom-left: song name, key, song number | Done: overlay pill |
| Search the web when a song is missing; offer alternatives; project or save | Done: [web search](web-search.md), with the save-name limitation below |
| Switch the package manager to bun and remove npm traces | Mostly done: `bun.lock`, scripts; `src-tauri/2` is a leftover npm log |

## Behaviour gaps seen in the code

- **Favourites** cannot be toggled from the UI; only listed ([library index](library-index.md)).
- **Setlists** cannot gain items, be reloaded or stepped back from the UI; hold slides are never created ([setlists](setlists.md)).
- **Remote control** page can only step slides and blank; picking a song still needs the console. The PIN travels in clear over HTTP ([remote control](remote-control.md)).
- **Web search**: the title is the first scraped line, often a lyric ([web search](web-search.md)).
- **Transpose** treats flats other than `Db`/`Eb` as `C`; Nashville is a flag with no rendering ([slide pipeline](slide-pipeline.md)).
- **Stanza view** highlight is off by one for songs with `Intro`/`Interlude` sections ([performance sections](performance-sections.md)).
- **Search** ignores the FTS table and returns unranked `LIKE` matches ([library index](library-index.md)).
- **Simulated display** is not a true miniature: the theme font is fixed px, so the 960 px window relies on the fit scaler more than a 1920 px projector would; MDB margins may be twips ([audience display](audience-display.md), [MDB import](mdb-import.md)).
- **Reports**: CCLI export only reaches the devtools console; the songbook has no lyrics ([reports](reports.md)).
- `history_days`, `key_format_compressed` and `shortcuts` are stored but unused ([config](config.md)).
- Stray/unused: `src-tauri/2` (npm log), `.live-preview` CSS with no markup, `designsystem.json` (reference only), `config::load_favorites/save_favorites`.

## Commands without UI

`pick_songs_folder`, `get_songs_folder`, `list_foreign_files`,
`list_conflicts`, `list_categories`, `toggle_favorite`, `list_favorites`,
`renumber_songs`, `compact_library`, `check_duplicates`,
`close_audience_window`, `close_stage_window`, `get_next_slide_preview`,
`set_nashville`, `list_setlists`, `load_setlist`, `save_setlist`,
`setlist_previous`, `list_hold_slides`, `save_theme`, `get_shortcuts`,
`save_shortcuts` ([IPC contract](ipc-contract.md)).

## Test blind spots

No UI tests. Rust integration tests skip silently when fixtures are missing
([build and release](build-and-release.md)).
