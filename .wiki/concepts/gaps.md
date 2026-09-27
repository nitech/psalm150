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
generated: { by: agent, at: 2026-09-27T12:00:00Z }
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

- **Setlists** cannot be reordered, stepped back, renamed or deleted from the UI, and there is no delete-setlist command; hold slides are never created ([setlists](setlists.md)).
- **Sets sync** ([server library](server-library.md#sets)):
  - Setlists from a local folder library stay with that library and are not uploaded when switching to a server library. Setlists that existed in a server library before sets sync have no `server` marker and are uploaded only after their next edit.
  - Song items whose song is not on the server are left out of the upload (toast only); once the upload succeeds the local copy is replaced by the server's, so those items disappear from this PC too.
  - Hold items are uploaded as `blank` and come back as blank items; `arrangement` is not synced; item transposes are clamped to −11…11.
  - A 5xx or other unexpected answer for one set stops the run before the remaining sets and the download.
  - `sync_server_sets` has no button; the 60 s timer and edits are the only triggers besides a full Synchronize. The full Synchronize and `sync_server_sets` call the sync directly, outside the guard that keeps background runs from overlapping.
- **Remote control**: the LAN page can only step slides and blank, and its PIN travels in clear over HTTP. The song server remote can project songs and set items but is opt-in (off by default) and only works in a server library ([remote control](remote-control.md)).
- **Web search**: the title is the first scraped line, often a lyric ([web search](web-search.md)).
- **Transpose** treats flats other than `Db`/`Eb` as `C`; Nashville is a flag with no rendering ([slide pipeline](slide-pipeline.md)).
- **Stanza view** highlight is off by one for songs with `Intro`/`Interlude` sections ([performance sections](performance-sections.md)).
- **Search** ignores the FTS table and returns unranked `LIKE` matches ([library index](library-index.md)).
- **Simulated display** is not a true miniature: the theme font is fixed px, so the 960 px window relies on the fit scaler more than a 1920 px projector would; MDB margins may be twips ([audience display](audience-display.md), [MDB import](mdb-import.md)).
- **Reports**: CCLI export only reaches the devtools console; the songbook has no lyrics ([reports](reports.md)).
- `history_days` and `key_format_compressed` are stored but unused ([config](config.md)).
- **Design tokens**: the two copies of `psa150-tokens.css` (here and in the song server repo) are kept identical by hand; nothing checks them. `designsystem.json` is reference only and still carries component specs (anatomy tags, metric values, nav pills) from the original dashboard reference ([design tokens](design-tokens.md)).
- Stray/unused: `src-tauri/2` (npm log), `.live-preview` CSS with no markup, `config::load_favorites/save_favorites`.

## Commands without UI

`pick_songs_folder`, `get_songs_folder`, `list_foreign_files`,
`list_conflicts`, `list_categories`, `renumber_songs`, `compact_library`, `check_duplicates`,
`close_audience_window`, `close_stage_window`, `get_next_slide_preview`,
`set_nashville`, `load_setlist`, `save_setlist`, `setlist_advance`,
`setlist_previous`, `list_hold_slides`, `save_theme`, `sync_server_sets`
([IPC contract](ipc-contract.md)).

## Test blind spots

No UI tests. Rust integration tests skip silently when fixtures are missing
([build and release](build-and-release.md)).
