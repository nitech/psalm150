---
type: Concept
title: Operator console
description: The main window — state ownership, tabs, the song list with sortable Song/No/Key columns, keyboard model, projecting mode, settings, edit and import modals.
tags: [console, ui, lit, keyboard, settings]
status: stable
sources:
  - id: app
    resource: /src/components/app.ts
    title: PraiseApp root component
  - id: song-list
    resource: /src/components/song-list.ts
    title: praise-song-list rows and row keyboard handling
  - id: sort
    resource: /src/song-sort.ts
    title: Column sort rules
  - id: sort-test
    resource: /tests/song-sort.test.ts
    title: Sort unit tests
  - id: api
    resource: /src/api.ts
    title: Typed invoke wrappers and shared types
  - id: css
    resource: /src/styles.css
    title: Design system and layout
  - id: stanza-number-input
    resource: /src/stanza-number-input.ts
    title: Multi-digit stanza shortcut input
  - id: stanza-number-test
    resource: /tests/stanza-number-input.test.ts
    title: Stanza selection and timeout tests
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Operator console

`index.html` mounts `<praise-app>`, one Lit component that owns all UI state
and IPC. Presentational pieces: `praise-song-list`, `praise-modal`,
`praise-select` (custom dropdown; native selects cannot be themed on
WebView2) and `praise-combobox` (key typeahead). Everything renders into light
DOM so `styles.css` applies; its tokens mirror `designsystem.json`, a
reference file the app never loads.

## Layout

Custom title bar (`data-tauri-drag-region`; double-click maximises; min/max/
close buttons), then a **browse pane** (tabs, toolbar, song list) and the
**song pane**, separated by a drag splitter (280–720 px, default 340, stored in
`localStorage["praise-browse-pane-width"]`).

## Tabs

| Tab | Rows come from | Order |
| --- | --- | --- |
| Search | `search_songs(query)` plus web results | column sort |
| Key | `list_by_key(selected)` (combobox over `list_keys`) | column sort |
| History | `get_history(50)` as synthesised rows, no number/key | recency, no header |
| Favourites | `search_songs("", true)` | column sort |
| Setlist | items of `currentSetlist` as synthesised rows | service order, no header |

## Song list columns

Columns **Song | No | Key | star**. The list element is one CSS grid
(`minmax(0, 1fr) max-content max-content max-content`) and every row, header
included, is a `subgrid`, so No, Key and the star are exactly as wide as their
widest content across all rows and the title takes the rest of the pane. The
header is an `li.song-list-header` rendered by `praise-song-list` (sticky at
the top of the scroll region) and emits `praise-sort`. Web-result rows are a
flex row (title + source) spanning all columns and do not widen them.

- **Numbers column**: Settings, Library, "Show song numbers in the song list".
  Stored as `config.show_song_numbers` (default on). Off adds `.hide-numbers`
  to the list, which drops the track from the grid, the header and the rows.
- **Sorting**: header buttons Song / No / Key on the sortable tabs. Click the
  active column to flip direction, another column to sort it ascending.
  Default is Song ascending. Persisted as `localStorage["praise-song-sort"]`
  (`{column, direction}`; invalid values fall back to the default). Rules in
  `song-sort.ts`: `Intl.Collator` (base sensitivity, numeric) for text,
  numeric for numbers, rows without a value last in both directions, ties by
  title then original order. Sorting is client-side over the loaded rows;
  `visibleSongs` is what the list renders and what Up/Down navigation walks.

## Keyboard

| Key | Context | Effect |
| --- | --- | --- |
| Enter | search field, a song row, or anywhere with a song selected | Project (`projectLoadedSong`) |
| Down / Up | search field | jump to first / last row |
| Down / Up | rows, not projecting | move selection (Up from the first row returns to the search field) |
| Down / Up | projecting | next / previous **stanza** |
| Right / Left | projecting | next / previous **slide** |
| 1–9, then multi-digit numbers such as 10, 11, 12 | projecting, outside text fields and modals | jump to the numbered **stanza** (first slide) and unblank |
| B | not typing | blank screen |
| Ctrl/Cmd+F | anywhere | focus search (switches to the Search tab) |
| Esc | in order | leave ad hoc edit, close Edit, close Settings, stop projection |

Text inputs and contenteditable lines swallow the navigation keys.

Number shortcuts use the digit keys (including the numeric keypad with Num
Lock). If a number could be the prefix of a higher stanza number, input waits
600 ms (`STANZA_NUMBER_TIMEOUT_MS`) for another digit; otherwise it jumps
immediately. For example, with 12 stanzas, `1` waits, while `1` then `2`
projects stanza 12 without first showing stanza 1. Zero alone and numbers
beyond the song are ignored. Modifiers, held-key repeats, text editing and
open modals do not trigger number navigation. A non-digit key, focus change,
pointer press, projection-session replacement, slide-structure change or
projection close cancels pending input. Ordinary navigation and previewing a
different song do not. These shortcuts belong to the operator console.

## Projecting mode

`load_song` and web selection are read-only previews. Project explicitly calls
`project_song`, creating the active session. The header always distinguishes
the selected song from **Now showing**. Selecting another song while A is
active leaves A on audience/stage and shows B in the flat preview; the numbered
projection controls still describe and control A.
Selecting another song or library with pending corrections offers Save,
Discard or Cancel before replacing the preview. A library switch closes the
active projection session first.

`projecting = true` after Project. When the selected song is also active, the
song pane switches from the flat view to **stanza view** (blocks from
[performance sections](performance-sections.md)). The active stanza is
highlighted and scrolled into view; clicking another stanza jumps
(`show_slide`); clicking the active stanza's lyrics enters
[ad hoc editing](adhoc-editing.md). `projection-closed` from the backend resets
`projecting`. Header buttons: Project, Prev, Next, Blank, Edit.

While projecting, the song-pane header also shows numbered stanza buttons
`1, 2, 3, …` in performance order, including choruses. They use the same
`buildStanzaMarkers` grouping as the audience counter, so a stanza spanning
multiple slides has one button. The current stanza is highlighted; clicking
a number jumps to its first slide and unblanks. The row wraps and scrolls
for long songs. Settings includes a hint for the number shortcuts.

## Settings modal

Library: folder path, Choose Songs Folder, Import MDB, Rescan, manual
[duplicate review](duplicate-review.md), song numbers toggle. Projection:
Congregation display (Primary / Simulated / monitors),
Stage display, "Also show stage window", "Read-only library". Search: web
search toggle. Phone remote: on/off toggle that shows the port and PIN while
running ([remote control](remote-control.md)). Reports: Print songbook HTML,
Export CCLI CSV. Shortcut legend.

## Edit modal

Raw ChordPro textarea: Save (`save_song`, raw text plus expected content hash),
recoverable Delete (with title and filename confirmation), Transpose plus/minus
(`set_transpose`, active slides). An external file change rejects save and
keeps the draft. Web results open here too, but there is no real file to edit.

## Toasts and bootstrap

4 s toasts (info / success / error). On start: `get_config` then
`applyConfig`, then the folder/status polling described in
[songs folder](songs-folder.md). The main window takes focus on connect and
again after opening projection, unless the audience is the simulated window.

## Related

- [IPC contract](ipc-contract.md), [Config](config.md), [Web search](web-search.md)
