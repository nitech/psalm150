---
type: Concept
title: Operator console
description: The main window — state ownership, the two toolbar groups, the song server room chip, the update chip, search with #key, History/Favourites/Setlist views, the add-to-setlist button, the song list with sortable Song/No/Key columns, keyboard model, projecting mode, settings (including the room), edit and import modals.
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
    resource: /src/shared/psa150-tokens.css
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
generated: { by: agent, at: 2026-10-05T21:30:00Z }
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
`localStorage["psa150-browse-pane-width"]`). The splitter also takes focus:
←/→ resize by 16 px (Shift: 64), Home/End jump to the limits, and a
double-click toggles the default and the widest width.

- **App bar** (slim): the brand (centred over the activity bar), then on the
  right, everything in button groups (`.toolbar-group`) with icons, left to
  right: **Update ready** (once a new version is downloaded; its tooltip
  names the versions, a click asks to restart now, "Later" keeps it for close,
  see [build and release](build-and-release.md#updates-in-the-installed-app)),
  **Changed** (sync icon, while the songs folder changed since it was read; a
  click reads it again), the **active set** (sets icon and its name, or
  "Choose a set"; a click opens the list of sets to make one active, "No
  active set", or a new set that becomes active), the **room** in a
  [server library](server-library.md) (broadcast icon and the room name, a
  screen icon when the words are not shared, [below](#room)), and Project
  (highlighted while projecting), Prev, Next and Blank **only while
  projecting**, and Settings. Messages (toasts) float at the bottom.
- **Activity bar** (as in VS Code, left of the song list): Search, Setlist,
  History and Favourites choose what the song list shows; the active one has
  a lime edge. The VSB sync icon sits at the bottom when a database is linked
  ([VSB sync](vsb-sync.md)).
- **Song actions** sit on the song title row instead: Edit (icon),
  **Chords from the web** (chord icon; only for a library song that may be
  edited and has words but no chords, see
  [web search](web-search.md#chords-for-a-song-without-any)), a favourite
  star and + / ✓: the song in or out of the **active set** in one click.
  With no active set, + opens the app bar's set list ("Add to which set?"),
  and the set chosen (or created) there becomes active with the song in it.

There is no "Now showing" text in the app bar. The stanza row shows
"On screen: …" only while a different song is previewed.

## Browse views

| View | Opened by | Rows come from | Order |
| --- | --- | --- | --- |
| Search (default) | typing, Ctrl+F, closing a view | `search_songs(text)` plus web results; with `#Key`, `list_by_key(key)` intersected with the text search | column sort |
| History | activity bar | `get_history(50)`, with number, key and star from the index (synthesised rows for songs no longer in it) | recency, no header |
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
Clicking the plus opens a popup listing every setlist
(tick = contains the song; click to add or remove; Esc closes it and returns
focus to the button, tabbing out closes it) and a **New setlist**
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
server and were removed from the set"). See [server library, sets](server-library.md#sets).

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
| Enter | search field, a song row, or anywhere with a song selected, except on a button or other control Enter activates, in a dialog or in the setlist popup | Project (`projectLoadedSong`) |
| Down / Up | search field | jump to first / last row |
| Down / Up | rows, not projecting | move selection (Up from the first row returns to the search field) |
| Down / Up | projecting | next / previous **stanza** in the [sung order](performance-sections.md#sung-order) |
| → / ← (configurable) | projecting, not typing | next / previous **slide**, on through the sung order |
| 1–9, then multi-digit numbers such as 10, 11, 12 | projecting, outside text fields and modals, unless turned off | jump to the numbered **stanza** (first slide) and unblank |
| B (configurable) | projecting, not typing | blank screen |
| Alt+S (configurable) | a library song selected, also while typing | add it to the active set; with none active, open the app bar's set list |
| Alt+F (configurable) | a library song selected, also while typing | toggle favourite |
| Ctrl+F (configurable) | anywhere | focus search (returns to the Search view) |
| Ctrl+E, Ctrl+1 (fixed) | anywhere outside dialogs | Search view, focus the field and select its text |
| Ctrl+2 / Ctrl+3 / Ctrl+4 (fixed) | anywhere outside dialogs | Setlist / History / Favourites view |
| Down / Up, Enter / Tab, Esc | key list open in the search field | move, choose the key, close the list |
| ←/→, Home/End | splitter focused | resize the song list |
| Esc | in order | close an open select or the key list (they handle it), close the setlist popup, leave ad hoc edit, close Edit, close Settings, close duplicates, close the import report; the import dialog ignores it; otherwise stop projection (then clear and focus the search field) |

Text inputs and contenteditable lines swallow the navigation keys. The
number keys can be turned off in Settings, Keyboard shortcuts ("Number keys
1–9 jump to a stanza while projecting", stored per PC as
`localStorage["psa150-stanza-number-keys"] = "off"`); ↑/↓ still step
stanzas. See [accessibility](accessibility.md#keyboard-211-212-214-243-257).

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
cancels, Backspace clears, Tab leaves it unchanged and moves on), or Reset
to defaults. Saved as
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
[performance sections](performance-sections.md)). Each stanza has its number
key in a small box on its left (lime for the one on screen); intro and
interlude blocks have none. The active stanza is highlighted and scrolled into
view; clicking another stanza jumps (`show_slide`); clicking a line of the
active stanza puts the caret there for [ad hoc editing](adhoc-editing.md).
`projection-closed` from the backend resets `projecting`. Header buttons: see
Layout.

**Order column**: right of the stanzas, under "Order", the
[sung order](performance-sections.md#sung-order) as a list of steps, each
with its stanza's number key, section label and first line. The step on
screen is lime, steps already sung are dimmed, and a click shows a step
(`show_order_position`). The arrow keys walk down this list.

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
(on by default; config key `server_remote`;
[remote control](remote-control.md#through-the-song-server)), then the
[room](#room) settings. Library: folder path, Choose Songs Folder, Import MDB, Rescan, manual
[duplicate review](duplicate-review.md), song numbers toggle. Projection:
Congregation display (Primary / Simulated / monitors), Stage display, "Also
show stage window", "Read-only library". Visual Song Book: link or unlink a
database, Synchronize now, last result ([VSB sync](vsb-sync.md)). Search: web
search toggle. Phone
remote: on/off toggle that shows the port and PIN while running ([remote
control](remote-control.md)). Reports: Print songbook HTML, Export CCLI CSV.
Shortcut legend. "Find a setting" also finds the Church server section by
room, flower, join, share, phone and remote control.

## Room

In a server library the console shows this PC's
[room](remote-control.md#room) on the song server, as the server last told it
(`get_server_room` at startup and whenever Settings opens, then the
`server-room` event).

- **Room chip** in the app bar: "Room" and the name, such as "Lily". It is
  muted when the words are not shared (sharing off here, or the church's owner
  turned rooms off). Its tooltip says leaders pick this PC by the name and,
  when shared, where anyone can follow the words. A click opens Settings,
  Church server. Without a server library, or before the server first
  answers, there is no chip.
- **Settings, Church server, Room**: a **Room name** field with **Rename**
  (also on Enter; disabled while the name is unchanged) and **Pick another
  flower** (`rename_server_room`; a toast names the new room, the server's
  refusal is toasted); a note that leaders pick this PC by its room name and
  that it keeps the name until someone changes it, here or on the song
  server; the checkbox **Let people follow the projected words in this
  room** (`set_server_room_sharing`, on by default). While the church shares
  rooms, a hint says anyone who opens `<server>/join` and types the name sees
  the words on their own phone, with **Copy the room link** (the
  `join_url`, or a toast with it when the clipboard is blocked). When the
  owner has turned rooms off, a note says so instead. Before the server
  answers, "This PC's room name shows here once the song server answers."
- A name being typed is kept when a new `server-room` event arrives, unless
  it still matched the old name.

## Version

The Settings dialog shows the version, quietly under its title (`subheading` on `psa150-modal`); the logo's tooltip says "Psalm150 <version>" too. The version is the one the release stamps into `tauri.conf.json` (`<major>.<minor>.<run number>`; a dev build says 0.1.0).

## Song editor

The song server's editor, the same code (`src/shared/songs/`, mirrored):
Visual, Chords (place and drag chords, chord bubble, chord sound) and
ChordPro with problems and a preview. `psa150-song-editor` takes the song
pane's place while the list stays: the mode switch where the title is, the
editor's bar (section, details cog, Save) and Cancel (×) in the pane's
toolbar. Edit (pencil) opens the selected song; + beside the search opens a
new song (`NEW_SONG_TEMPLATE`); the pencil on a web result opens it as a new
song to check. Save: `save_song` for a song, `create_song` for a new one
(text kept as written; a missing number becomes `{meta: song_num=N}` after
the title). A failed save keeps the editor open with the error. Cancel, or
choosing another song, asks first when the text changed (compared with the
editor's own first output, since it tidies the file a little). Escape is the
editor's own (chord bubble).

## Chords, recordings and the words

The chords button (title row, songs with chords) shows chords over the
words (`chord-line.ts`, preference `console-chords`, off by default); each is
a button that opens how to play it (shared chord sheet with guitar/piano
diagrams and sound from `public/sounds/`). Lines with chords showing cannot
be corrected in place. − key + transposes: the projection's transpose for the
song on screen (`set_transpose`), else only this view. Recordings and the
YouTube pill show under the title (shared `song-media`): the video from
`{meta: youtube}` works without a server; recordings, recording (mic button
until there is one) and deleting need a [server library](server-library.md)
song and go through the device token. Copy copies the words only. Delete
(trash) is the recoverable delete. The toast can carry a button (Undo).

## Toasts and bootstrap

Toasts (info / success / error) float at the bottom of the window, centred,
above dialogs too. Errors stay until dismissed with their × or
replaced; other toasts stay at least 5 s (2 s plus 60 ms per character) and
not while the pointer or focus is on them. Long messages wrap. Every toast is
also written to a hidden live region (`role="status"`, errors
`role="alert"`) so screen readers announce it. On start: `get_config` then
`applyConfig`, then the folder/status polling described in
[songs folder](songs-folder.md). The main window takes focus on connect and
again after opening projection, unless the audience is the simulated window.

## Related

- [IPC contract](ipc-contract.md), [Config](config.md), [Web search](web-search.md)
- [Accessibility](accessibility.md): dialogs, select, focus, contrast, live regions
