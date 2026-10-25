---
type: Concept
title: Web client
description: The bundled mobile-first Vite/TypeScript client — hash routes, tab bar and side rail, sticky bars, the current set and one-tap adding, song reader with chords and transpose, set editor with drag to reorder, service view with swipe and Lead (moving shared-link pages along, with a watching count), remote screen with live push and room names, the token-free /join room reader, More screen with API tokens, rooms and your password, the API reference, People screen for owners, role handling and refresh, installable app with offline copies, session and preference storage, the desktop consent screen, and what it does not expose.
tags: [web, ui, vite, typescript, mobile, pwa, offline]
status: stable
sources:
  - id: main
    resource: /web/src/main.ts
    title: Boot, auth screens, desktop consent, shell, hash router, scroll handling, theme, service worker registration
  - id: context
    resource: /web/src/context.ts
    title: AppContext (canEdit, currentSet, navigate, run) and the page header
  - id: current-set
    resource: /web/src/current-set.ts
    title: Choosing the current set, queued edits with retry, offline prefetch
  - id: install
    resource: /web/src/install.ts
    title: Install prompt and Home Screen detection
  - id: songs
    resource: /web/src/views/songs.ts
    title: Song list with paging and add buttons, reader, editor, add-to-set sheet
  - id: sets
    resource: /web/src/views/sets.ts
    title: Set list, detail, editor, service view
  - id: api-docs
    resource: /web/src/views/api-docs.ts
    title: API reference drawn from /api/openapi.json
  - id: remote
    resource: /web/src/views/remote.ts
    title: Remote list and desktop screen, room rename and link
  - id: room
    resource: /web/src/views/room.ts
    title: Join page and room reader (/join)
  - id: more
    resource: /web/src/views/more.ts
    title: Account and password, app install, theme, import/export, church, rooms, desktops, API tokens
  - id: people
    resource: /web/src/views/people.ts
    title: People (owners)
  - id: chordpro
    resource: /web/src/chordpro.ts
    title: ChordPro parsing and transposition for display
  - id: render
    resource: /web/src/song-render.ts
    title: Reader rendering, settings panel and key label
  - id: ui
    resource: /web/src/ui.ts
    title: Toasts with Undo, visibility-aware polling, preferences
  - id: api
    resource: /web/src/api.ts
    title: SongServerApi wrapper, readEvents (server-sent events over fetch)
  - id: types
    resource: /web/src/types.ts
    title: Response types (mirrors models.rs by hand)
  - id: sw
    resource: /web/public/sw.js
    title: Service worker (app shell, bundles, song and set reads)
  - id: manifest
    resource: /web/public/manifest.webmanifest
    title: Web app manifest and icons
  - id: tokens
    resource: /shared/psa150-tokens.css
    title: Shared design tokens (canonical; the desktop mirrors them)
  - id: shared-icons
    resource: /shared/icons.ts
    title: Shared icon paths (canonical; the desktop mirrors them)
  - id: styles
    resource: /web/src/styles.css
    title: Layout and components
  - id: vite
    resource: /web/vite.config.ts
    title: Dev server on 5173 proxying /api to 8080
generated: { by: agent, at: 2026-10-23T13:20:00Z }
---

# Web client

A single-page app in plain TypeScript, built for phones first: no framework,
and each screen is rendered as an `innerHTML` template string. Every
user-supplied string goes through `escapeHtml`. It talks to the server only
through `SongServerApi` and the public `/api/v1` endpoints
([API contract](api-contract.md)). `types.ts` copies the Rust models **by
hand**, so a change to the API schema needs a matching change there.

## Boot and sign-in

Boot first checks the query string for a desktop sign-in request
([below](#desktop-sign-in)). Then `/join` and `/join/{room}` open the
[room reader](#following-a-room) whatever the session, without the shell and
before anything else. Otherwise it calls `GET /info`. If the server is not
initialised it shows **Set up your song server** (church, your name, username,
password of at least 10 characters). When the stored session is missing or
expired it shows the [visitor shell](#public-library-visitors) if
`public_library` is true (and no desktop is asking to connect), else
**Sign in**. With a valid session it shows the signed-in shell (or the desktop
consent screen) and then reads the session again with `GET /session`: a new
role, name or church is stored and the screen redrawn, and a token the server
no longer accepts signs out. The same check runs when the app comes back into
view or online, at most once a minute (`refreshSession`). If the server cannot
be reached it shows "The song server is not reachable" with **Try again**. A
sign-in refused for too many wrong passwords shows the server's message, such
as "too many failed sign-ins; try again in 15 minutes". When `/info.rooms` is
true, the sign-in page has **Follow the words in a room** and the visitor
shell a **Join a room** tab, both opening `/join`.

## Public library visitors

When an owner has made the library public, a signed-out visitor gets a shell
with two tabs: **Songs** and **Sign in**. Only the routes marked `visitors`
open (`#/songs` and `#/songs/{id}`, read through `/public/songs`; the default
route is `#/songs`). The reader shows no edit or add-to-set controls. Any
members' route, such as a link to a set, opens sign-in instead. Sign-in then
has **Back to the songs**, and signing in keeps the current route, so a shared
song link stays on that song. Signing out returns to the visitor shell. The
subtitle is `public_library_name` from `/info`.

## Shell and routes

Signed in, the app is a shell with four sections: **Songs**, **Sets**,
**Remote** and **More** (visitors: **Songs** and **Sign in**). At 900 px and
wider they are a side rail with the brand, and the version and build time at
its foot (`__APP_VERSION__`, `__BUILD_TIME__` from `vite.config.ts`). On phones there is no tab bar: the
same `nav#sections` is a drawer that slides in from the left when you tap ☰
(`menuButton()`: beside the search field on Songs, in the bar on Sets, Remote
and More; screens with Back have no ☰). A dimmed shade covers the page. The
drawer closes when you pick a section (including the current one), tap the
shade, press Escape, or swipe it left: it follows the finger, and closes past
35 % of its width or on a quick flick, otherwise it springs back. In the
installed app (`display-mode: standalone` or `navigator.standalone`) a swipe
in from the left 24 px pulls the drawer out under the finger, with the same
thresholds, on screens that show ☰ and when no sheet is open. In the browser
that edge is Safari's Back, so the edge swipe is off there. At the bottom sits the **dock**: the offline notice and the
[current set](#current-set) bar. The service view hides the dock; the song and
set editors hide it too, and a set's own page hides the current set bar
(an offline notice still shows).
Routes live in the URL hash, so the server's static file serving (which has no
SPA fallback) is enough, and links can be shared or bookmarked. The real
paths are the song permalink `/songs/{id}`
([deployment](deployment.md#song-permalinks)), which the app turns into
`#/songs/{id}` with `history.replaceState`, and the room reader's `/join` and
`/join/{room}`, which stay as they are. The service worker answers any
navigation offline with the saved `/`, but saves only `/` itself.

| Route | Screen |
| --- | --- |
| `#/songs` | Song search and list |
| `#/songs/new`, `#/songs/{id}/edit` | ChordPro editor |
| `#/songs/{id}` | Song reader |
| `#/songs/{id}/chords` | Chords from the web (leaders) |
| `#/sets` | Set list (default route) |
| `#/sets/new`, `#/sets/{id}/edit` | Set editor (`#/sets/new?song=…&transpose=…` starts with one song) |
| `#/sets/{id}` | Set detail (leaders: Share on a link) |
| `#/sets/{id}/play/{index}` | Service view |
| `#/remote` | Desktops of the church |
| `#/remote/{deviceId}` | One desktop's remote |
| `#/more` | Account, app, appearance, library, church, desktops, API tokens |
| `#/people` | People of the church (owners; others get "Only owners manage people") |
| `#/api` | API reference (also `/api/docs`; visitors too when the library is public) |

An unknown route goes to `#/sets`. A 401 from any screen clears the session
and shows sign-in. A 404 shows "Not found".

**Page header** (`pageHead`): a sticky bar with Back, the screen's actions
and, once the large title has scrolled under it, the title; below it a large
title that scrolls with the page. The bar blends into the page until you
scroll. On the song reader and the service view it slides away while reading
down and comes back on any scroll up. Screens with no Back and no actions
(Remote, More) have only the large title. The church's name over the tab
screens (Songs, Sets, Remote, More) shows only at 900 px and wider. On phones
the Sets list is `compact` (the title sits in the bar beside New, with no
large title), and the Songs list has no header at all (`wideOnly`): it starts
with the search field and New beside it, stuck to the top while the list
scrolls.

**Scroll position**: Back and Forward return to where you were (the position
is saved in the history entry once scrolling settles); any other navigation
starts at the top.

**Titles and focus**: each screen sets the tab title ("Amazing Grace · Songs
· PSA150"). After navigating, focus moves to the screen's heading; a redraw
of the same screen keeps focus on the control in use. A Skip to content
link comes first. Keyboard, screen reader and contrast behaviour is on the
[accessibility](accessibility.md) page.

## Current set

The set this phone adds songs to (`current-set.ts`). A set chosen on the
phone (**Make this the current set** on a set's page, adding a song to a set
from the add-to-set sheet, or saving a set started with **New set…** from a
song; stored as the `current-set` preference) wins while it exists and its date is not past;
otherwise it is the next dated service, today included, with the most
recently edited winning a tie. Undated sets are current only when chosen.
Putting the current set away (the bar's ✕, or **Stop using as the current
set** on its page) stores `none`: there is then no current set, dated
services included, until a set is chosen again; the toast's **Undo** restores
the earlier choice. It is per phone: other people's phones and the desktops
are not affected.

- **Current set bar** in the dock, frosted over the page: date, name and song
  count; tapping it opens the set, and its ✕ puts the set away. It pulses
  when the count changes.
- **Song list**: leaders see a ＋ on every row. Tapping adds the song to the
  current set; a ✓ shows it is already there, and tapping ✓ removes its last
  entry. Both show a toast with **Undo**. Without a current set the tap opens
  the add-to-set sheet.
- **Song page**: in the bar at the top, + adds the song to the current set
  (with the reader's transpose) and turns into ✓ when it is in it (tap to
  remove, with Undo), and the sets icon opens **Add to a set** for any set
  (the only one when there is no current set).
- Edits run one at a time. Each reads the set fresh (`cache: "no-store"`),
  changes the items and saves with `base_version`; a 409 is retried once from
  the new version, so quick taps and other people's edits are not lost.
- The set reloads on sign-in, when the app comes back to the foreground, when
  the connection returns, and after saving or deleting a set.

## Songs

- **List**: search as you type (250 ms pause) over title, number, author or a
  line; the search field stays right under the bar while scrolling (the list
  always has the bar, which shows "Songs" once scrolled). Songs come 100 at
  a time (`GET /songs?limit=100&offset=…&sort=…&direction=…`); the next page
  loads as the end of the list comes near, with a **Show more songs** button
  as a fallback. The song number sits in a column left of the title. When any
  listed song has a number, the column keeps its width for every row and a
  **No** / **Song** header above the list sorts by number or title, like the
  desktop's column headers: tapping the sorted column flips the direction (↑
  or ↓), tapping the other starts ascending. Songs without a number come last.
  The choice is kept in `localStorage["psa150-song-sort"]`
  (`{column: "title"|"number"|"key", direction}`). Each row shows the song's
  key on the right; a **Key** header sorts by it (C to B, major before minor).
- **Online search**: when a search of at least 3 characters finds nothing
  (no key filter, and the person can edit), the list says "No songs match
  "…"" and offers **Search online** (or Enter in the field); it never
  searches by itself. A spinner with **Cancel** while it runs, then **Found
  online** (title, artist · site); picking one opens the **New song** editor
  filled with it ("Add song", with a "Found on <site>" link) to check and
  save. `GET /songs/online` ([online search](online-search.md)).
- **Key filter**: **Filter** at the right of the sort header opens a sheet
  (a bottom sheet on phones, a dialog on wide screens): All / Major / Minor
  and the twelve tonics, several at once, each with its song count from
  `GET /songs/keys`; keys no song is in are disabled. The list follows each
  tap (`key=…&key_mode=…`), alongside the search and any sort. While a filter
  is on, a chip under the header ("D, G · major ✕") shows it and clears it.
  Kept in `localStorage["psa150-song-key-filter"]` (`{roots, mode}`).
- **Editor header on wide screens** (1100 px and up, `DOCKED` in
  `words-editor.ts`): one bar across the page, ‹ **Back** with its word on
  the left, the Visual / Chords / ChordPro switch in the middle, and the
  section type, the details cog and **Save** on the right (the bar that
  floats at the bottom elsewhere moves into it; its panels drop down from
  it). The header has the rail's grey (`--rail-bg`), so it is not white on
  white in the light theme. The song is up to 880 px wide, and ChordPro with
  its preview beside it up to 1480 px. Narrower windows get the
  phone layout: the switch beside Back and the floating bar.
- **Song bar**: few icons. Fixed: Back, the current set's **+**/**✓**
  (leaders, when a set is current), for songs with chords a **chords
  on/off** switch (a chord diagram icon, `chordChart`; lit when on,
  remembered), **Share** and (leaders) **Edit**. With a leader's five fixed
  icons only one used-often icon comes into the bar (`barActions`'
  `maxFrequent`), two otherwise. Everything else is in **⋮** with icon and
  text: **Transpose** (icon "C → D", `transpose`; a row with − and + to tap and the key between them; the
  menu stays open while stepping), Add to a (another) set, Copy the words,
  and for leaders on a song with no chords **Chords from the web** (below). Transpose in the bar is one pill, "− G +". The key
  is the song's `{key}`, else a guess from its chords (`guessKey`: the key
  whose scale fits most chords, the last chord being home counting most,
  major over its relative minor on a tie), moved with the transpose; with no
  chords at all it shows the steps ("+2"). Transposing only changes what you
  see (and what you add to a set).
  A ⋮ action used often lately also comes into the bar as an icon, after a
  thin divider and with a small dot under it (title "… (often used)"), at
  most 2: it comes at 3 uses and goes when its uses fade (half every 14
  days) below 1.5. Uses are counted per screen in
  `localStorage["psa150-bar-usage-song"]`, from the menu and from the
  promoted icon (`bar-menu.ts`, tested). The menu closes on Escape (focus
  back on ⋮), a tap outside or Tab, and moves with the arrow keys.
- **Chords from the web** (`#/songs/{id}/chords`, `views/find-chords.ts`):
  for a song without chords. It searches online (`GET /songs/online`) for
  the song's title at once; the field can be changed and searched again.
  Each version found is laid over **our** song by `chord-match.ts`
  (tested): each of our lines takes the chords of the online line most like
  it by its words (in any order; at least 0.6 alike; of equal ones the next
  after the last match), every chord going to the same word, as far into it,
  or, for a word the online line lacks, the same share of the way between
  the matching words around it. Lines with no such line get no chords, and
  lines that already have chords are left alone. The saved `{key}` always
  fits the saved chords. The key the online chords are in (`chordKey`) is
  their `{key}` when the chords agree with it, else the key they fit best
  (`guessKey`); with a `{capo}` only the chords count, as `{key}` then often
  names the key that sounds. Keys are compared by their chords
  (`keySteps`): a minor key and its relative major (Em and G) are the same.
  When the song's key and the chords' key differ, the summary says so and
  the leader picks **Keep <song key> (chords ±n)** (the default; the chords
  are moved) or **Change the song to <chords' key>** (its `{key}` is
  rewritten). A song without a key gets the chords' key; when the chords'
  key cannot be told they are kept as written, with a note to check them.
  Only chords (and that key) change: words, sections and every other line
  stay byte for byte. The versions are listed
  best first with "N of M lines" (a version matching none is disabled); the
  chosen one shows a summary (lines, source link, key moved) with **Save
  chords** and the preview, our song with its new chords. Save sends
  `PUT /songs/{id}` on the revision opened (409: someone changed it) and
  returns to the song. Nothing is saved before that. Words that differ a lot
  from every online version, such as a Norwegian translation of an English
  song, get no chords.
- **Reader**: the song with section labels and chords above the lyrics,
  parsed in the browser by `chordpro.ts` with the desktop's stanza rules
  (a blank line starts a new verse; unlabelled verses are numbered). Chords
  on or off and Transpose (view only, never saved) are bar actions, see
  **Song bar** (`readerBarActions` and `onReaderAction` in `song-render.ts`).
  There is no text size control (see [accessibility](accessibility.md)).
  Chords are remembered. The key (with any transpose, the same key the
  transposer shows) is under the title: "Key A +2". Shows the first 8 characters of the
  revision id, and sets the tab title to the song's. **Share** (in ⋮)
  copies the song's permalink, `<origin>/songs/{id}` (a real path, so the
  server can add link-preview tags; on load the app replaces it with
  `#/songs/{id}`). **Copy the words** copies the lyrics alone: no section
  labels, chords or comments, a blank line between sections (`songText`).
  Selecting part of a song and copying (Ctrl+C) gives the same lyrics-only
  text: labels, chords and comments are unselectable, and a `copy` handler
  (`installLyricsCopy`) strips them from the selection. Both copy buttons use
  the Clipboard API, then `execCommand("copy")` (plain-HTTP LAN addresses have
  no Clipboard API), then a prompt. When the library is private, the share
  toast says only people who can sign in can open the link.
- **Editor** (`chord-editor.ts` on the model in `chord-doc.ts`): **Visual**
  by default, with a **Visual / Chords / ChordPro** switch in the bar (the
  screen's own "Edit song" heading is for screen readers only). In Visual
  and Chords the song's title is the large editable heading at the top. A
  floating bar at the bottom, in all three modes (fixed by CSS; only a
  phone's keyboard lifts it), holds Save (a floppy-disk icon and "Save"); there is no Cancel, as Back
  leaves without saving. It also has a cog (in every mode) that opens
  a panel with key and capo (changing the key offers to move
  the chords too) and *More details* (author, number, CCLI, tempo, time,
  copyright; other `{meta}` fields as read-only text). **Visual**
  (`words-editor.ts`) is the whole song as one text, as it reads: each
  section a paragraph with its name above it (verses numbered by order, or
  the section's own name), no chords shown, but every chord stays on its
  letter as the words change. Enter on an empty line starts a new section,
  and Backspace at the start of a section joins it to the one before (Delete
  at the end of one joins the next). In Visual the bar also has a button
  with the type of the section the caret is in ("Verse"); it opens a panel
  (rounded, with a check by the type in use) to change the type, name the
  section, add a note, move, duplicate or delete it. Notes and unknown lines are fixed grey rows
  (tapping a note changes it). Typing within a line is the browser's; any
  change across lines (Enter, joins, a selection over several lines, cut,
  paste) is made on the model (`replaceRange`, `splitSection`,
  `joinSection`) and drawn again. Chords on text deleted across lines are
  lost, with a toast and Undo. Copying puts the words on the clipboard, and
  pasting the same text here puts the chords back too; other pasted text
  with chords written over the words turns them into ChordPro, and
  headings such as "Chorus" start sections. **Chords** shows the same
  sections (names only) with the chords over the words and the words
  locked: they keep a caret for the keyboard but take no typing, and a
  phone shows no keyboard. With a mouse, the space above a line is split
  into unseen boxes, one per letter (as wide as the letter); the one under
  the pointer shows, reaching down over its letter, and clicking it opens
  the chord bubble there. On a touch screen, pressing a line shows the same
  box at the letter under the finger; sliding sideways moves it along the
  line (moving up or down scrolls), and letting go (or Enter, `[` or Ctrl+K
  at the caret) opens a bubble just under that letter with the chords of
  the song's key, "…" for any other chord and, on an existing chord, a
  remove button; a dashed box shows where the chord goes, and tapping a
  chord puts it in and closes the bubble. Drag a chord or use ←/→ to move it.
  Unknown directives and `#` lines show as grey rows and are kept. The
  ChordPro side is the source with colours, a list of problems by line and
  a preview (on wide screens beside it, half each, the same height, each
  scrolling in itself and both together by the same share of their length).
  The bar's section button and cog work there too: the song is read from the
  source on every change, and a change made in a panel is written back
  (untouched lines exactly), with the cursor kept on its line. It is typed as it is, `[chord]`
  too; tapping or clicking opens no bubble, and only Ctrl+K opens the same
  bubble at the cursor, which puts `[chord]` there or, inside a `[chord]`,
  changes it. The source round-trips: lines that
  were not edited are written back exactly, so saving an untouched song
  sends the same bytes (the import dedup hash is over the bytes). New songs
  start from a title/author/key/verse template. Saving an existing song
  sends its `revision_id` as the base; a 409 keeps the editor's text and
  links to the latest version ([songs and revisions](songs-and-revisions.md)).
- **Add to a set** sheet: upcoming sets (soonest first) and undated ones,
  the current one marked; appends the song with the reader's transpose
  through `PUT /sets/{id}` with the set's version, or starts a new set with it.

## Sets

- **List**: "Upcoming" (today or later, soonest first), "No date" and
  "Earlier" (newest first), with a date badge, item count and a **Current**
  badge ([sets](sets.md)).
- **Detail**: **Make this the current set** (unless its date is past), or
  **Stop using as the current set** when it is (the current set bar is hidden here), then the items in order (no
  position column) with song number, transpose and note. Tapping an item starts the service view there.
  A deleted song shows as "Deleted song". Leaders have Share and Edit in the
  bar; Share looks switched on while the set is shared and opens the share
  sheet ([shared sets](shared-sets.md)).
- **Editor**: the title in the bar beside Back on phones (`compact`, at
  the bar's 17 px rather than the 22 px of top-level compact screens); name
  and service date (defaults to the next Sunday) side by side, items by
  title only (no position number or song number) that can be dragged by
  their grip (with a mouse; touch screens have no grip) or moved with the
  arrow buttons and removed, a blank-screen item, and a song picker sheet
  that stays open while adding and marks songs already in the set. There is
  no note or transpose control: an item's note and transpose (set on the
  desktop, or a transpose from "Add to a set" in the reader) are kept, and a
  transpose shows under the title. Back is Cancel; Delete and **Save** sit in
  the bar. Item ids are made in the browser (`crypto.randomUUID()`) and kept
  across edits. Save sends the set's `version` as `base_version`; a 409 keeps
  the form and links to the other version. Delete asks for confirmation and
  sends `base_version`.
- **Service view**: one item at a time, with the key under the title, in
  the item's own transpose, with chords on or off as last set on a song
  page (no **Chords and key** panel here). Move with the bottom step bar (Previous and Next, each with the
  title it leads to; at either end of the set that button is left out, and a
  set of one item has no bar), a horizontal swipe, or
  the arrow keys. It asks for a screen wake lock where the browser supports
  it. Leaders get **Lead** in the bar: on, every page that has the set open
  through its shared link moves to the item this phone shows, whenever it
  moves; a pill on the button counts those pages (also while off). It stays on
  from item to item while the app is open (`leadingSet`), reports every 5 s
  (`PUT /sets/{id}/live` leading, `GET` otherwise) and lets go a minute after
  the phone goes quiet ([shared sets](shared-sets.md#leading-live)). The page
  also polls `GET /remote/desktops` every 15 s and redraws only when the
  **Project this on <desktop>** button changes ([remote control](remote-control.md)).
  That button is an icon in the bar beside Lead (leaders, when a desktop
  accepts commands; its label and tooltip name the room), so nothing but the
  key and the item's note sits between the title and the song.

The service view's polling stops while the page is hidden, such as a locked
phone or a background tab, and runs at once when it is shown again.

## Remote

Both Remote screens load `GET /remote/desktops` and then follow the server's
push (`GET /remote/desktops/events`, read with `fetch` by `readEvents` and
reconnected with a growing pause), so they change as soon as a desktop does,
instead of polling. Leaving the screen closes the stream; a 401 signs out
([remote control](remote-control.md#live-push)).

- **List** (`#/remote`): the church's desktops by **room name**, with the
  computer's name and what each shows underneath and an online dot. A line
  says anyone can follow a desktop's words at `<host>/join`.
- **Desktop** (`#/remote/{deviceId}`): the room name as the title and the
  computer's name and online state under it. It shows what is on screen, the
  current slide label and that slide's words, a pad with Previous, Blank and
  Next, the slide labels as buttons, and **Project** from a set item or a song
  search. Opening a desktop remembers it as the one the service view steers.
  Notices explain when the desktop is offline or has remote control off.
  Under **Room**: when the desktop shares its room, the join address with
  **Copy the link** and **Share** (where the browser can share); otherwise a
  note that its operator can turn sharing on in Psalm150's Settings. Leaders
  get a rename button in the bar: a sheet with the room name and **Pick
  another flower** (`PUT /device-tokens/{id}/room`; a taken name shows the
  server's message) ([rooms](rooms.md)).

## Movement on phones

`transitions.ts` makes the app move like a native one below 900 px, unless
reduced motion is asked for:

- **Screens slide** inside a view transition (`swapScreen`, where the browser
  has `document.startViewTransition`; elsewhere screens just change). `route`
  draws the new screen into a fresh `<main id="page">` off the page and swaps
  it in when ready (the old screen stays, dimmed after 150 ms, until then), so
  both can be animated as snapshots. `slideBetween` picks the way: deeper in
  the same section slides in from the right over the old (`push`), shallower
  slides out to the right (`pop`), a set's items slide sideways by their order
  (`next`, `prev`), another section does not slide. The bars (`.app-bar`,
  `.play-nav`, the dock, the shared page's banner) have their own
  `view-transition-name`, so they cross-fade in place while the content moves.
- **Swiping through a set** (service view and shared page, `bindItemSwipe`):
  the item follows the finger (`.play` `--drag`; the bars stay), past the ends
  it gives only a quarter; a swipe over 22 % of the width or a flick goes to
  the neighbour, whose slide starts where the finger let go; otherwise it
  springs back. Vertical scrolling stays the browser's (`touch-action: pan-y`).
  The left 24 px are left for Back.
- **Back**: in Safari, its own edge swipe animates; a `popstate` with
  `hasUAVisualTransition`, or within 1.5 s of a touch at the screen's edge, is
  not slid again (`takeBrowserAnimated`). The installed app has no browser
  gesture, so `bindSwipeBack` adds one on screens with Back: the screen follows
  the finger from the left edge (`#page` `left`, so the fixed bars stay put);
  past a third of the width, or on a flick, Back is pressed and the slide
  carries on from there.
- **Speed**: a song or set link starts loading on `pointerdown`; single song
  and set reads are remembered for 30 s and forgotten on any change made from
  the app (`SongServerApi.remembered`); the service view and shared page read
  the neighbouring items' songs ahead; taps have no highlight flash or zoom
  delay (`touch-action: manipulation`).

## Shared set page

`/shared/{key}` (`views/shared-set.ts`) is for anyone with a set's share
link, signed in or not, and stands outside the shell like the room reader:
the set, **Go through the songs**, and one item at a time at
`#/item/{itemId}` with words and chords. Its bar has the chords switch and
the transpose pill ("− G +") always in it, as there is nothing else (no ⋮).
There is no Follow or
Project. The tab title has the set's day. Moving between the set and its
items slides like the app ([movement](#movement-on-phones)). When a leader leads the set, the page moves to the item they show
and says "Following <name>" above it. An editable link adds remove buttons
(with Undo) and **Add songs**.
Details in [shared sets](shared-sets.md).

## Following a room

`/join` and `/join/{room}` (`views/room.ts`) are for anyone, signed in or not,
and stand outside the shell: type the room name a desktop shows (the last one
joined is filled in), then read the projected words live in large text. The
whole song is shown with the current slide highlighted and followed; the bar
has smaller and larger text, high contrast (yellow on black), **Follow the
screen**, announcing each new slide to a screen reader, and **Leave**. The
screen is kept awake while words show. It uses `GET /public/rooms/{room}` and
an `EventSource` on its `/events`. The details are in [rooms](rooms.md).

## More

Account (name, role, church) with **Change your password** (the lock:
current and new password, through `PUT /account/password`; your other
sessions end) and sign-out; **App**: **Install PSA150** where
the browser offers installation, or how to add it to the Home Screen in
Safari on iPhone and iPad, hidden once installed; **Appearance**: Automatic,
Light or Dark; **Import ChordPro files** (`.pro`, `.cho`, `.chordpro`, leaders
only) and **Export the library** (ZIP) ([import and export](import-export.md));
**Church** (owners only): **People**, opening [People](#people);
**Who can read the songs** (owners only): **Signed-in members** or
**Everyone**, through `PUT /church`, with a confirmation before opening it;
**Rooms** (owners only): **Shared** or **Off** (`public_rooms`), with a note
on what a room is ([rooms](rooms.md));
**Desktops** (leaders only): the active desktop tokens by room name, with the
computer's name, last use and **Revoke**, and **Create a token by hand**, shown once with a copy button, for
desktops that cannot open a browser ([auth and roles](auth-and-roles.md));
**API tokens** (everyone signed in): your tokens, or the whole church's for an
owner (with whose they are), each with its access and last use and
**Revoke**, and **Create an API token**: a name and an access level from your
own role down ("Everything, like an owner", "Songs, sets and desktops, like a
leader", "Read only"), shown once with a copy button
([auth and roles](auth-and-roles.md#api-tokens)). Offline, the section says the
tokens show when you are online and the rest of the screen still works.

## API reference

`#/api` is the server's API reference, linked from **More → About** (with the
OpenAPI document and the server's version) and from the API tokens text, and
reachable at `/api/docs` (the server answers it with the app, which moves to
the hash route). It reads `/api/openapi.json`, so it always matches the server
it comes from, and the service worker keeps a copy for offline reading.

The top says what the API is (the document's description), the base address
(`<origin>/api/v1`), how to sign requests (with a link to make an API token)
and links the raw OpenAPI document for tools such as Postman. Operations are
grouped by the document's tags (the sections of `GROUPS` in `api.rs`), each a
`<details>` that opens to its description, whether it needs a token, its
parameters, request body and answers. Fields show their type in plain words
("text (uuid) or null"), whether they are required and their description;
data types that hold other types open in place ("Fields of RoomSlide"), so
reading never leaves the page. Every operation has a curl example built from
its schema, with a Copy button. A search box filters by path, method and
words and announces how many operations match.

## People

`#/people` lists the church's people (`GET /members`) with initials, name,
username, role and "cannot sign in" for disabled people, and **Add a person**
(name, username, first password, role; viewer by default). Tapping a person
opens a sheet: name, username and role with **Save** (only changed fields are
sent); **Set the password** (they are signed out everywhere, API tokens keep
working); **Disable sign-in** or **Let them sign in again**, with a
confirmation; and **Remove from <church>**, with a confirmation. Your own sheet
has no password or disable controls (use the lock under More) and says
**Leave <church>**, which signs you out; changing your own role takes you back
to More with the new role. The server's refusals, such as the last owner or a
person who also belongs to another church, show in the sheet
([auth and roles](auth-and-roles.md#members)).

## Roles in the UI

`canEdit` is true for owner and leader sessions. Viewers see no new-song,
edit, add-to-set (＋ or button), new-set, import, desktop-token, steering,
room-rename or project buttons; editor routes send them back to the read-only screen. They
can read songs and sets, see the current set bar and choose the current set,
use the service view, watch the remote screen and export,
and make read-only API tokens. Owners alone see **Church** (People, and
**Who can read the songs**), **Rooms** and everyone's API tokens.

## Installable app and offline use

- `web/public/` holds `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`
  (180 px), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and
  `manifest.webmanifest` (standalone, start at `#/sets`, dark theme colour).
  The icons are the lime "150" mark.
- `sw.js` (registered in production builds only):
  - the page: network first, the saved copy offline;
  - `/assets/` (hashed): from the cache once saved; the current bundle is
    saved at install, the newest 40 files are kept;
  - `GET /setup`, `/sets`, `/sets/{id}`, `/songs` and `/songs/{id}`: network
    first; offline, after 4 s without an answer, or on a 5xx from the proxy,
    the saved copy. Reads with `cache: "no-store"` always go to the server;
  - writes and everything else go straight to the server.
- The current set's songs are fetched once per change of the set so the
  service view works offline. An **Offline** notice shows in the dock; writes
  fail with "You are offline. Try again when you are connected."
- Every way a session ends (sign-out, an expired session found at boot,
  **Use another account**, a 401 at desktop consent) goes through
  `clearSession`, which deletes the `psa150-api` caches and forgets the
  current set. It also posts `clear-api-cache` to the worker, which then
  saves no read that started before it.
- `#/sets/new?song=` takes only a song id; anything else is ignored.

## Desktop sign-in

The desktop opens the root URL with
`?desktop_redirect=<loopback URL>&state=…&code_challenge=…&device_name=…`.
`readDesktopRequest` accepts the redirect only when it parses as an `http:`
URL whose hostname is exactly `127.0.0.1`, `localhost` or `[::1]` with an
explicit port, and the challenge is 43–128 base64url characters. Otherwise the
page shows "This desktop sign-in link is not valid" and never redirects.

- Signed out: the sign-in screen, with the lede "Sign in to connect
  <device> to this song server."
- Signed in (or right after sign-in or setup): **Connect this desktop?**,
  naming the device and `session.church_name`, saying it can read and change
  songs and sets, with **Connect**, **Cancel** and "Use another account".
- **Connect** calls `POST /desktop-auth/codes` and then
  `location.replace(<redirect>?code=…&state=…)`, built with `URL.searchParams`
  so any existing query on the redirect is kept. A viewer session, or a 403,
  shows "Only leaders can connect a desktop. Ask a leader to sign in." and
  leaves only Cancel. A 401 returns to sign-in.
- **Cancel** goes to `<redirect>?error=access_denied&state=…`.

The session is shared by the browser's tabs, so a person already signed in
on that browser goes straight to the consent screen. The whole flow is in
[auth and roles](auth-and-roles.md#desktop-browser-sign-in).

## State and storage

- The session is kept in `localStorage["psa150-server-session"]`, so an
  installed app stays signed in until the session expires (7 days by default)
  or you sign out. A session left in `sessionStorage` by an older version moves
  over on first read.
- Per-device preferences are in `localStorage` under `psa150-*`: `theme`,
  `chords`, `desktop` and `current-set`, and for the
  room reader `room` (the last room), `room-size`, `room-contrast`,
  `room-follow` and `room-announce`. Blocked storage is ignored.
- One `busy` flag stops overlapping actions; adding and removing songs from
  the current set is exempt so quick taps all count. Feedback is a toast that
  lasts 3.2 s, or 6 s when it has **Undo**.
- Sign-out (and "Use another account" on the desktop consent screen) sends
  `DELETE /session`, so the token stops working on the server, then clears
  the session and the cached songs and sets. The request is best effort:
  offline, the token stays valid until it expires.
- The role shown and the buttons offered come from the stored session,
  read again from `GET /session` at boot and when the app comes back into
  view (at most once a minute), so a role an owner changed shows without
  signing in again. The server enforces a new role at once.

## Design tokens and themes

`shared/psa150-tokens.css` (design tokens) and `shared/icons.ts` (icon paths)
are the canonical copies for both apps. `web/src/icons.ts` wraps the paths in
an SVG string; the desktop wraps them in Lit and keeps a mirror in its
`src/shared/`, refreshed with `bun run sync:shared` and checked in its CI.
Edit the files here, never in the mirror. `<html data-theme="light|dark">`
picks a theme; without the attribute the system setting decides. "Automatic"
removes the attribute. The `theme-color` meta follows the chosen theme.

## Not exposed

Revision history (`/songs/{id}/revisions` and single revisions), deleting
and restoring songs, deleted and restored sets, paging past the first 100
sets, the `from` filter on sets, renaming the church, and choosing a church at
sign-in.

## Develop and test

`cd web && bun install && bun run dev` serves on port 5173 and proxies `/api`
to `localhost:8080` (the service worker is not registered in dev). `bun run
build` runs `tsc --noEmit` and then outputs `vite build` to `web/dist`, which
the API serves in production ([deployment](deployment.md)). `bun run test`
runs the vitest tests in `web/tests/` ([build and CI](build-and-ci.md)).
