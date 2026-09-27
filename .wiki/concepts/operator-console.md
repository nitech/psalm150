---
type: Concept
title: Operator console
description: The main window — state ownership, the two toolbar groups, search with #key, History/Favourites/Setlist views, the add-to-setlist button, the song list with sortable Song/No/Key columns, keyboard model, projecting mode, settings, edit and import modals.
tags: [console, ui, lit, keyboard, settings]
status: stable
sources:
  - id: app
    resource: /src/components/app.ts
    title: Psa150App root component
  - id: song-list
    resource: /src/components/song-list.ts
    title: psa150-song-list rows and row keyboard handling
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
    title: Console aliases for the shared tokens, layout
  - id: tokens
    resource: /src/psa150-tokens.css
    title: Shared PSA150 design tokens
  - id: stanza-number-input
    resource: /src/stanza-number-input.ts
    title: Multi-digit stanza shortcut input
  - id: stanza-number-test
    resource: /tests/stanza-number-input.test.ts
    title: Stanza selection and timeout tests
  - id: search-query
    resource: /src/search-query.ts
    title: "#key token parsing for the search field"
  - id: search-query-test
    resource: /tests/search-query.test.ts
    title: Key token tests
  - id: icons
    resource: /src/icons.ts
    title: Toolbar icon set (Lucide geometry)
generated: { by: agent, at: 2026-09-27T12:00:00Z }
---

# Operator console

`index.html` mounts `<psa150-app>`, one Lit component that owns all UI state
and IPC. Presentational pieces: `psa150-song-list`, `psa150-modal`,
and `psa150-select` (custom dropdown; native selects cannot be themed on
WebView2). Icons come from `icons.ts`. Everything renders into light DOM so
`styles.css` applies. Its colours, type, radii and motion alias the shared
[design tokens](design-tokens.md) in `psa150-tokens.css`, and `index.html`
sets `data-theme="dark"`, so the console is always dark.

## Layout

Custom title bar (`data-tauri-drag-region`; double-click maximises; min/max/
close buttons) with the brand on the left and two toolbar groups on the
right, then a **browse pane** (search
field or view title, song list) and the **song pane**, separated by a drag
splitter (280–720 px, default 340, stored in
`localStorage["psa150-browse-pane-width"]`).

- **App bar** (slim): the brand (centred over the activity bar), then on the
  right one group: Project in the quiet ghost style (highlighted while
  projecting), Prev, Next and Blank **only while projecting**, and Settings.
- **Activity bar** (as in VS Code, left of the song list): Search, Setlist,
  History and Favourites choose what the song list shows; the active one has
  a lime edge. The VSB sync icon sits at the bottom when a database is linked
  ([VSB sync](vsb-sync.md)).
- **Song actions** sit on the song title row instead: Edit (icon), a
  favourite star and the add-to-setlist button.

There is no "Now showing" text in the app bar. The stanza row shows
"On screen: …" only while a different song is previewed.

## Browse views

| View | Opened by | Rows come from | Order |
| --- | --- | --- | --- |
| Search (default) | typing, Ctrl+F, closing a view | `search_songs(text)` plus web results; with `#Key`, `list_by_key(key)` intersected with the text search | column sort |
| History | activity bar | `get_history(50)` as synthesised rows | recency, no header |
| Favourites | activity bar | `search_songs("", true)` | column sort |
| Setlist | activity bar | items of the current setlist, titles from the index | service order, no header |

View buttons toggle: pressing the active one, or the view's close button,
returns to Search. **Ctrl+1–4** open Search, Setlist, History and Favourites
(they never toggle back), and the activity bar tooltips name them.

**Search field**: it selects all of its text whenever it gains focus
(keyboard, Ctrl+E / Ctrl+F / Ctrl+1, the Search button, or a click: the
mouseup that would collapse the selection is cancelled for the click that
focuses it), so typing replaces the previous search. Search matches words in
titles, lyrics and tags and tolerates spelling mistakes
([library index](library-index.md#search-semantics)). When a search returns
**exactly one song**, it is selected and shown at once while focus stays in
the field (skipped while the editor or unsaved corrections are open).

**Key search**: typing `#` in the search field opens a list of the library's
keys under the field (prefix match on what follows, arrow keys, Enter or Tab
to choose, Esc to close). A chosen `#Key` filters to songs in that key and a
chip echoes it; the rest of the text still searches. `#` followed by a digit
stays a song-number search. Parsing lives in `search-query.ts`.

## Favourite star and add to setlist

The star toggles the song's favourite (`toggle_favorite`; filled amber when
set, like the star column in the list, which refreshes). Favourites are
loaded with `list_favorites` on start-up and library changes.

Library songs (not web previews) show an **add to setlist** button: the
plain + (grey) when the song is not in the **active setlist**, a ✓ (lime)
when it is. Clicking the check removes the song from the active setlist at once.
Clicking the plus opens a menu listing every setlist
(tick = contains the song; click to add or remove) and a **New setlist**
field prefilled with today in the PC's short date format (`format_short_date`,
Windows `GetDateFormatEx(DATE_SHORTDATE)`; for example 23.09.26 with
Norwegian settings), falling back to the browser locale.

There is no default active setlist. One becomes active when the operator
picks it in the Setlist view's dropdown, or when a song is added (or a new
setlist created) while none is active; adding to another setlist later leaves
the active one alone. The choice is remembered in
`localStorage["psa150-current-setlist"]` and reported to the backend with
`set_active_setlist` (the song server remote names it to phones). See
[setlists](setlists.md).

**Next song** in the Setlist view projects the next song item and then
applies that item's transpose (`set_transpose`), so a key chosen for the set
is used.

In a server library the setlists are the church's shared sets. On
`setlists-changed` the console reloads them (and the Setlist view) and toasts
conflicts ("“<name>” was changed elsewhere; your changes are kept as a copy")
and song items left out of an upload ("N setlist song(s) are not on the song
server and were left out"). See [server library, sets](server-library.md#sets).

**remote-project** (from the [song server remote](remote-control.md#through-the-song-server)):
the console chooses the named setlist if any, selects the song, projects it
through the same path as Enter, applies the transpose and toasts "Projected
from <name>'s phone".

## Song list columns

Columns **Song | No | Key | star**. `psa150-song-list` renders a fixed
header (`.song-list-head`, emits `psa150-sort`) above the scrolling body
(`ul.song-list`), so the scrollbar starts below the header and the header's
rule spans the sidebar. The body is one CSS grid whose rows are `subgrid`s, so
No, Key and the star are exactly as wide as their widest content and the title
takes the rest. After each layout (and on resize) the header copies the body's
resolved column widths and pads for the scrollbar; the header labels feed the
body's minimum No/Key widths (`--num-min`, `--key-min`). Web-result rows are a
flex row (title + source) spanning all columns and do not widen them.

- **Numbers column**: Settings, Library, "Show song numbers in the song list".
  Stored as `config.show_song_numbers` (default on). Off adds `.hide-numbers`
  to the list, which drops the track from the grid, the header and the rows.
- **Sorting**: header buttons Song / No / Key on the sortable tabs. Click the
  active column to flip direction, another column to sort it ascending.
  Default is Song ascending. Persisted as `localStorage["psa150-song-sort"]`
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
| → / ← (configurable) | projecting, not typing | next / previous **slide** |
| 1–9, then multi-digit numbers such as 10, 11, 12 | projecting, outside text fields and modals | jump to the numbered **stanza** (first slide) and unblank |
| B (configurable) | projecting, not typing | blank screen |
| Alt+S (configurable) | a library song selected, also while typing | add it to the active setlist; with none active, open the add-to-setlist menu |
| Alt+F (configurable) | a library song selected, also while typing | toggle favourite |
| Ctrl+F (configurable) | anywhere | focus search (returns to the Search view) |
| Ctrl+E, Ctrl+1 (fixed) | anywhere outside dialogs | Search view, focus the field and select its text |
| Ctrl+2 / Ctrl+3 / Ctrl+4 (fixed) | anywhere outside dialogs | Setlist / History / Favourites view |
| Down / Up, Enter / Tab, Esc | key list open in the search field | move, choose the key, close the list |
| Esc | in order | close the setlist menu, leave ad hoc edit, close Edit, close Settings, stop projection (then clear and focus the search field) |

Text inputs and contenteditable lines swallow the navigation keys.

Starting a projection moves focus out of the search field (Enter there
projects), so digits, arrows and B work immediately; Ctrl+F returns to
searching. Number shortcuts use the digit keys (including the numeric keypad with Num
Lock). If a number could be the prefix of a higher stanza number, input waits
600 ms (`STANZA_NUMBER_TIMEOUT_MS`) for another digit; otherwise it jumps
immediately. For example, with 12 stanzas, `1` waits, while `1` then `2`
projects stanza 12 without first showing stanza 1. Zero alone and numbers
beyond the song are ignored. Modifiers, held-key repeats, text editing and
open modals do not trigger number navigation. A non-digit key, focus change,
pointer press, projection-session replacement, slide-structure change or
projection close cancels pending input. Ordinary navigation and previewing a
different song do not. These shortcuts belong to the operator console.

**Configurable shortcuts** (`src/shortcuts.ts`, tested): Settings, Keyboard
shortcuts lists each action with its combo; click it, press new keys (Esc
cancels, Backspace clears), or Reset to defaults. Saved as
`config.shortcuts`. Enter, Esc, ↑/↓, Tab, the digits, Ctrl+E and Ctrl+1–4
(`VIEW_SHORTCUTS`) are fixed and cannot be assigned; a bare Shift+letter is refused, and so is a combo another action
uses. Combos with Ctrl, Alt or Meta fire inside text fields too; plain keys
only outside them. Letters come from `KeyboardEvent.code`, so Alt combos work
on layouts where Alt changes the character.

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
`projecting`. Header buttons: see Layout.

There are **no stanza buttons**: the number keys (above) and clicking a stanza
switch stanzas. While a different song is previewed, an "On screen: …" line
pinned at the top of the song body says which song the keys control.

The search heading and the song-name heading share one height
(`--pane-head-height`); the song heading is a single row (title, then the
Edit / star / add-to-setlist group). Category and CCLI sit under the number and key,
floated top right in the song text; the correction bar and "On screen" line
are pinned at the top of the song body. The History / Favourites / Setlist
headings use the same height; the Setlist view puts its picker and a
Next song button in that row.

**Esc** that ends a projection (in the console, or the global Escape shortcut
while the congregation window has focus, which emits `projection-escaped`)
clears the search field, returns to the Search view and focuses the field.

## Settings modal

Settings is a two-pane dialog. A persistent category menu selects Library,
Church server, Visual Song Book, Projection, Search, Phone remote, Reports, or
Keyboard shortcuts; the current category stays focused in the main pane. The menu's
**Find a setting** search filters the pane to every matching category and
marks matching menu items, so a term such as "display", "remote", or
"import" leads directly to its controls.

Church server: see [server library](server-library.md) (address check,
Sign in with browser, token fallback, Synchronize, Disconnect). While
connected it also shows a note that setlists are the church's shared sets
and the checkbox **Allow remote control through the song server**
(`server_remote_enabled`; [remote control](remote-control.md#through-the-song-server)). Library: folder path, Choose Songs Folder, Import MDB, Rescan, manual
[duplicate review](duplicate-review.md), song numbers toggle. Projection:
Congregation display (Primary / Simulated / monitors), Stage display, "Also
show stage window", "Read-only library". Visual Song Book: link or unlink a
database, Synchronize now, last result ([VSB sync](vsb-sync.md)). Search: web
search toggle. Phone
remote: on/off toggle that shows the port and PIN while running ([remote
control](remote-control.md)). Reports: Print songbook HTML, Export CCLI CSV.
Shortcut legend.

## Edit modal

Raw ChordPro textarea: Save (`save_song`, raw text plus expected content hash;
closes the editor on success; in a [server library](server-library.md) the
save goes to the song server),
recoverable Delete (with title and filename confirmation), Transpose plus/minus
(`set_transpose`, active slides). An external file change rejects save and
keeps the draft. Web results open here too, but there is no real file to edit.

## Toasts and bootstrap

4 s toasts (info / success / error). They sit in the app bar; while a dialog
is open the toast is drawn after the dialogs, centred at the top
(`.toast.over-modal`), because the app bar's stacking context would keep it
under the dialog backdrop. On start: `get_config` then
`applyConfig`, then the folder/status polling described in
[songs folder](songs-folder.md). The main window takes focus on connect and
again after opening projection, unless the audience is the simulated window.

## Related

- [IPC contract](ipc-contract.md), [Config](config.md), [Web search](web-search.md)
