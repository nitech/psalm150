# Praise

Church worship projection: a Tauri 2 desktop app (Rust core + Lit/TypeScript webviews). Start at [overview](overview.md).

# Projection

* [Slide pipeline](concepts/slide-pipeline.md) - ChordPro sections to slides: stanza blocks, wrap and height budgets, chorus2 alternation, transposition, overlays
* [Projection windows](concepts/projection-windows.md) - Pre-created audience/stage webviews, monitors vs simulated display, Escape, lock-free frame delivery
* [Audience display](concepts/audience-display.md) - Theme CSS variables, fit-to-screen that never breaks a lyric line, overlay pill, stanza counter
* [Stage display](concepts/stage-display.md) - Musician view with chord rows, next section, key

# Library

* [ChordPro dialect](concepts/chordpro-dialect.md) - Parser semantics, section kinds, the blank-line stanza rule, what a rewrite drops
* [Songs folder and app data](concepts/songs-folder.md) - The synced folder contract, per-library app data, watcher and dirty flag, startup staging
* [Library index](concepts/library-index.md) - SQLite schema, what search actually matches, history, favourites
* [MDB import](concepts/mdb-import.md) - Visual Song Book `.mdb` to ChordPro, theme from PageSetup, progress and cancel
* [Web search](concepts/web-search.md) - DuckDuckGo discovery, site scrapers, chord-chart conversion, preview vs save

# Operator console

* [Operator console](concepts/operator-console.md) - Main window state, tabs, song list columns and sorting, keyboard model, projecting mode, settings
* [Performance sections](concepts/performance-sections.md) - Console-side mirror of chorus2 expansion; stanza markers that tie the song view to slides
* [Ad hoc editing](concepts/adhoc-editing.md) - Fix a lyric while projecting; patch raw ChordPro without touching chords
* [Setlists](concepts/setlists.md) - Per-PC JSON setlists, advance/previous, and how little has UI

# Platform

* [Config and theme](concepts/config.md) - `config.json` fields with consumers, per-library `SlideTheme`, stored-but-unused settings
* [IPC contract](concepts/ipc-contract.md) - Every Tauri command and event, grouped, with whether the UI calls it
* [Remote control](concepts/remote-control.md) - PIN-guarded HTTP remote for next/prev/blank
* [Reports](concepts/reports.md) - CCLI usage log and CSV export, printable songbook HTML
* [Build and release](concepts/build-and-release.md) - Bun + Vite multi-entry, the Tauri CLI shim, test suites, GitHub release and updater
* [Gaps and backlog](concepts/gaps.md) - Known limitations, the Todo list with status, unwired commands
