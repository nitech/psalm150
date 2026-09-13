---
type: Overview
title: Psalm150
description: Church worship projection — a Tauri 2 desktop app that indexes a folder of ChordPro songs and projects lyrics to a congregation screen and chords to a stage screen.
tags: [psalm150, overview, tauri]
status: stable
sources:
  - id: readme
    resource: /README.md
    title: README
  - id: concepts
    resource: /CONCEPTS.md
    title: Domain glossary
  - id: lib
    resource: /src-tauri/src/lib.rs
    title: App setup, state, command registration
  - id: app
    resource: /src/components/app.ts
    title: Operator console component
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Psalm150

Psalm150 replaces a VB6 "Visual Song Book" used in a Norwegian church. A worship
leader searches the song library on the **operator console**, presses Project,
and the lyrics appear on the **audience window** (congregation) while chords
appear on the optional **stage window** (musicians).

## Two halves, one state

| Half | Where | Role |
| --- | --- | --- |
| Rust core (`src-tauri/`) | One process, `psalm150_lib::run()` | Owns all state: config, songs folder, SQLite index, the current `ProjectionState`, setlists, remote server |
| Web UI (`src/`) | Three webviews: `index.html`, `audience.html`, `stage.html` | Lit components in light DOM sharing one `styles.css`; talk to Rust with `invoke` and `listen` |

`RuntimeState` lives behind a `parking_lot::Mutex` in `AppState`; every command
goes through `with_state`. The rule that keeps Windows from deadlocking: build
the slide payload under the lock and **emit after the lock is released**
([projection windows](concepts/projection-windows.md)).

## Data flow

1. A **songs folder** of `.pro` / `.cho` files is the shared truth (often
   Dropbox). Nothing else is written there ([songs folder](concepts/songs-folder.md)).
2. Files are parsed by the [ChordPro dialect](concepts/chordpro-dialect.md)
   parser and indexed into a per-library SQLite file
   ([library index](concepts/library-index.md)).
3. `load_song` is a read-only preview. `project_song` creates the active
   projection session and runs the [slide pipeline](concepts/slide-pipeline.md).
4. `show_slide` / `next_slide` / `previous_slide` / `blank_screen` mutate that
   session and publish one revisioned `ProjectionSnapshot` to the console,
   [audience](concepts/audience-display.md) and [stage](concepts/stage-display.md).
5. The console mirrors the same section/stanza structure client-side
   ([performance sections](concepts/performance-sections.md)) so the highlighted
   stanza matches the projected slide and lyrics can be corrected live
   ([ad hoc editing](concepts/adhoc-editing.md)).

Songs missing from the library can be fetched from the web and projected or
saved ([web search](concepts/web-search.md)). Legacy libraries arrive through
[MDB import](concepts/mdb-import.md). Possible duplicate songs are never merged
automatically; they go through [manual duplicate review](concepts/duplicate-review.md).

## Standing rules

- Never call `WebviewWindowBuilder::build()` from a synchronous command on
  Windows. Projection windows are created hidden at startup and only shown or
  hidden afterwards.
- Never `emit` or `eval` while holding the state mutex.
- Only ChordPro files go in the songs folder; everything else lives under the
  app data dir.
- A lyric line on the audience screen is never broken by the browser: the block
  is scaled to fit, and only an extreme line falls back to balanced wrapping.
- The chorus2 alternation and the blank-line stanza rule exist in both Rust and
  TypeScript. Change them together and keep `tests/adhoc-edit.test.ts` and the
  Rust unit tests green.
- Docs and wiki describe behaviour, not models. Say "the agent".

## Where to look

- Operating it: [operator console](concepts/operator-console.md),
  [setlists](concepts/setlists.md), [config](concepts/config.md).
- Contracts: [IPC contract](concepts/ipc-contract.md),
  [ChordPro dialect](concepts/chordpro-dialect.md),
  [songs folder](concepts/songs-folder.md).
- Shipping: [build and release](concepts/build-and-release.md).
- What is missing or half-wired: [gaps and backlog](concepts/gaps.md).
