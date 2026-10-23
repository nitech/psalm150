# Psalm150

Church worship projection: a Tauri 2 desktop app (Rust core + Lit/TypeScript webviews). Start at [overview](overview.md).

# Projection

* [Slide pipeline](concepts/slide-pipeline.md) - ChordPro sections to slides: stanza blocks, wrap and height budgets, chorus2 alternation, transposition, overlays
* [Projection windows](concepts/projection-windows.md) - Pre-created audience/stage webviews, monitors vs simulated display, Escape, lock-free frame delivery
* [Audience display](concepts/audience-display.md) - Theme CSS variables, fit-to-screen that never breaks a lyric line, overlay pill, stanza counter
* [Stage display](concepts/stage-display.md) - Musician view with chord rows, next section, key

# Library

* [ChordPro dialect](concepts/chordpro-dialect.md) - Parser semantics, section kinds, the blank-line stanza rule, what a rewrite drops
* [Songs folder and app data](concepts/songs-folder.md) - The synced folder contract, per-library app data, watcher and dirty flag, startup staging
* [Library index](concepts/library-index.md) - SQLite schema, word search with spelling tolerance and match ranks, history, favourites
* [MDB import](concepts/mdb-import.md) - Visual Song Book `.mdb` to ChordPro, theme from PageSetup, progress and cancel
* [Server library](concepts/server-library.md) - Song server as the library: address check, browser sign-in over a loopback redirect (PKCE), offline copy and manifest, saving edits to the server, sets sync with conflict copies and fetching missing songs, remote and room on by default once connected, revoking the token on disconnect
* [VSB sync](concepts/vsb-sync.md) - Two-way sync with a linked VSB database: hashes and links, Psalm150-wins conflicts, Access ODBC writer, backups, write-back to a song server
* [Online song search](concepts/web-search.md) - Offered when the library has no match and run only when asked (button or Enter, Cancel); the shared `psa150-lyrics` crate mirrored from the song server and run in-process, async; preview, project or save
* [Duplicate review](concepts/duplicate-review.md) - Exact candidate grouping, side-by-side human review, pair decisions, recoverable delete and restore

# Operator console

* [Operator console](concepts/operator-console.md) - Main window state, toolbar groups, the room chip, #key search, History/Favourites/Setlist views, setlist heart, song list columns and sorting, number-key stanza shortcuts, projecting mode, settings (including the room name and sharing)
* [Performance sections](concepts/performance-sections.md) - Console-side mirror of chorus2 expansion; stanza markers that tie the song view to slides
* [Ad hoc editing](concepts/adhoc-editing.md) - Fix a lyric while projecting; patch raw ChordPro without touching chords
* [Setlists](concepts/setlists.md) - JSON setlists per library (local, or mirrors of the server's sets), the add-to-setlist menu, the Setlist view and Next song with the item's transpose
* [Accessibility](concepts/accessibility.md) - WCAG 2.2 AA for the console and the LAN remote page: names and landmarks, dialogs and keyboard model, focus ring, contrast and state cues, live-region toasts, reduced motion, zoom and reflow, how to test, exceptions (projection windows, song language, ad hoc editing)

# Platform

* [Config and theme](concepts/config.md) - `config.json` fields with consumers (including `server_remote` and `server_room_sharing`, both on by default), per-library `SlideTheme`, stored-but-unused settings
* [Design tokens](concepts/design-tokens.md) - Shared `psa150-tokens.css` and icons mirrored from the song server in `src/shared/`, dark/light themes, console aliases, `designsystem.json` as reference
* [IPC contract](concepts/ipc-contract.md) - Every Tauri command and event, grouped, with whether the UI calls it
* [Remote control](concepts/remote-control.md) - LAN remote for next/prev/blank (random PIN, lockout after wrong PINs, Host check); the song server remote (on by default) that also projects songs and set items; the PC's room on the song server (flower name, rename, sharing the projected words, `server-room`)
* [Reports](concepts/reports.md) - CCLI usage log and CSV export, printable songbook HTML
* [Build and release](concepts/build-and-release.md) - Bun + Vite multi-entry, the Tauri CLI shim, test suites, release on every push to main, background updates
* [Works without a server](concepts/standalone.md) - The app must work stand-alone; code shared with the song server is mirrored from its `shared/` (`bun run sync:shared`), never called on the server
* [Gaps and backlog](concepts/gaps.md) - Known limitations, the Todo list with status, unwired commands
