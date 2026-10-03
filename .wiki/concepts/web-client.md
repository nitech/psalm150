---
type: Concept
title: Web client
description: The bundled mobile-first Vite/TypeScript client — hash routes, tab bar and side rail, sticky bars, the current set and one-tap adding, song reader with chords and transpose, set editor with drag to reorder, service view with swipe and "Follow the desktop", remote screen, More screen, role handling, installable app with offline copies, session and preference storage, the desktop consent screen, and what it does not expose.
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
  - id: remote
    resource: /web/src/views/remote.ts
    title: Remote list and desktop screen
  - id: more
    resource: /web/src/views/more.ts
    title: Account, app install, theme, import/export, desktops
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
    title: SongServerApi wrapper
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
generated: { by: agent, at: 2026-10-03T10:00:00Z }
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
([below](#desktop-sign-in)). It then calls `GET /info`. If the server is not
initialised it shows **Set up your song server** (church, your name, username,
password of at least 10 characters). When the stored session is missing or
expired it shows the [visitor shell](#public-library-visitors) if
`public_library` is true (and no desktop is asking to connect), else
**Sign in**. With a valid session it shows the signed-in shell (or the desktop
consent screen). If the server cannot be reached it shows "The song server is
not reachable" with **Try again**.

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
wider they are a side rail with the brand. On phones there is no tab bar: the
same `nav#sections` is a drawer that slides in from the left when you tap ☰
(`menuButton()`: beside the search field on Songs, in the bar on Sets, Remote
and More; screens with Back have no ☰). A dimmed shade covers the page. The
drawer closes when you pick a section (including the current one), tap the
shade, press Escape, or swipe it left: it follows the finger, and closes past
35 % of its width or on a quick flick, otherwise it springs back. Opening by
swiping from the screen edge is left out, since iOS Safari uses that gesture
for Back. At the bottom sits the **dock**: the offline notice and the
[current set](#current-set) bar. The service view hides the dock; the song and
set editors hide it too.
Routes live in the URL hash, so the server's static file serving (which has no
SPA fallback) is enough, and links can be shared or bookmarked. The one real
path is the song permalink `/songs/{id}`
([deployment](deployment.md#song-permalinks)), which the app turns into
`#/songs/{id}` with `history.replaceState`. The service worker answers any
navigation offline with the saved `/`, but saves only `/` itself.

| Route | Screen |
| --- | --- |
| `#/songs` | Song search and list |
| `#/songs/new`, `#/songs/{id}/edit` | ChordPro editor |
| `#/songs/{id}` | Song reader |
| `#/sets` | Set list (default route) |
| `#/sets/new`, `#/sets/{id}/edit` | Set editor (`#/sets/new?song=…&transpose=…` starts with one song) |
| `#/sets/{id}` | Set detail |
| `#/sets/{id}/play/{index}` | Service view |
| `#/remote` | Desktops of the church |
| `#/remote/{deviceId}` | One desktop's remote |
| `#/more` | Account, app, appearance, library, desktops |

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

## Current set

The set this phone adds songs to (`current-set.ts`). A set chosen on the
phone (**Make this the current set** on a set's page, stored as the
`current-set` preference) wins while it exists and its date is not past;
otherwise it is the next dated service, today included, with the most
recently edited winning a tie. Undated sets are current only when chosen.
**Use the next service instead** goes back to the calendar. It is per phone:
other people's phones and the desktops are not affected.

- **Current set bar** in the dock: date, name and song count; tapping it
  opens the set. It pulses when the count changes.
- **Song list**: leaders see a ＋ on every row. Tapping adds the song to the
  current set; a ✓ shows it is already there, and tapping ✓ removes its last
  entry. Both show a toast with **Undo**. Without a current set the tap opens
  the add-to-set sheet.
- **Song page**: **Add to <set>** (with the reader's transpose), which turns
  into **In <set>** (tap to remove, with Undo), and a button for any other set.
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
  (`{column: "title"|"number", direction}`).
- **Reader**: the song with section labels and chords above the lyrics,
  parsed in the browser by `chordpro.ts` with the desktop's stanza rules
  (a blank line starts a new verse; unlabelled verses are numbered). The
  **Text and chords** button in the bar opens a panel under it: chords on or
  off, transpose (only when the song has chords; view only, never saved), and
  text size (−2 to +4). Chords and text size are remembered. The key (with
  any transpose) shows under the title. Shows the first 8 characters of the
  revision id, and sets the tab title to the song's. **Share** in the bar
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
- **Editor**: a raw ChordPro textarea. New songs start from a
  title/author/key/verse template. Saving an existing song sends its
  `revision_id` as the base; a 409 keeps the text and links to the latest
  version ([songs and revisions](songs-and-revisions.md)).
- **Add to a set** sheet: upcoming sets (soonest first) and undated ones,
  the current one marked; appends the song with the reader's transpose
  through `PUT /sets/{id}` with the set's version, or starts a new set with it.

## Sets

- **List**: "Upcoming" (today or later, soonest first), "No date" and
  "Earlier" (newest first), with a date badge, item count and a **Current**
  badge ([sets](sets.md)).
- **Detail**: whether it is the current set (or **Make this the current
  set**, unless its date is past), then the items in order with number,
  transpose and note. A deleted song shows as "Deleted song". **Open for the
  service** starts the service view at the first item.
- **Editor**: name, service date (defaults to the next Sunday), items that can
  be dragged by their grip or moved with the arrow buttons, removed,
  transposed and given a note, a blank-screen item, and a song picker sheet
  that stays open while adding and marks songs already in the set. Item ids
  are made in the browser (`crypto.randomUUID()`) and kept across edits. Save
  sends the set's `version` as `base_version`; a 409 keeps the form and links
  to the other version. Delete asks for confirmation and sends `base_version`.
- **Service view**: one item at a time, with the key under the title and the
  **Text and chords** panel (transpose here adds to the item's own transpose,
  view only). Move with the bottom Previous/Next bar, a horizontal swipe, or
  the arrow keys. It asks for a screen wake lock where the browser supports
  it. **Follow the desktop** (remembered) polls `GET /remote/desktops` every
  2.5 s and jumps to the item an online desktop reports for this set; without
  it the poll runs every 15 s. A poll redraws the page only when the
  **Project this on <desktop>** button (leaders, when a desktop accepts
  commands) changes ([remote control](remote-control.md)).

All polling (service view and Remote) stops while the page is hidden, such as
a locked phone or a background tab, and runs at once when it is shown again.

## Remote

- **List** (`#/remote`): the church's desktops with an online dot and what
  each shows, refreshed every 4 s.
- **Desktop** (`#/remote/{deviceId}`): refreshed every 2 s. It shows what is on
  screen and the current slide label, a pad with Previous, Blank and Next,
  the slide labels as buttons, and **Project** from a set item or a song
  search. Opening a desktop remembers it as the one the service view steers.
  Notices explain when the desktop is offline or has remote control off.

## More

Account (name, role, church) with sign-out; **App**: **Install PSA150** where
the browser offers installation, or how to add it to the Home Screen in
Safari on iPhone and iPad, hidden once installed; **Appearance**: Automatic,
Light or Dark; **Import ChordPro files** (`.pro`, `.cho`, `.chordpro`, leaders
only) and **Export the library** (ZIP) ([import and export](import-export.md));
**Who can read the songs** (owners only): **Signed-in members** or
**Everyone**, through `PUT /church`, with a confirmation before opening it;
**Desktops** (leaders only): the active desktop tokens with last use and
**Revoke**, and **Create a token by hand**, shown once with a copy button, for
desktops that cannot open a browser ([auth and roles](auth-and-roles.md)).

## Roles in the UI

`canEdit` is true for owner and leader sessions. Viewers see no new-song,
edit, add-to-set (＋ or button), new-set, import, desktop-token, steering or
project buttons; editor routes send them back to the read-only screen. They
can read songs and sets, see the current set bar and choose the current set,
use the service view, follow a desktop, watch the remote screen and export.

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
- Sign-out deletes the `psa150-api` caches.

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
  `chords`, `text-size`, `follow`, `desktop` and `current-set`. Blocked
  storage is ignored.
- One `busy` flag stops overlapping actions; adding and removing songs from
  the current set is exempt so quick taps all count. Feedback is a toast that
  lasts 3.2 s, or 6 s when it has **Undo**.
- Sign-out clears the session and the cached songs and sets. The token stays
  valid on the server until it expires.

## Design tokens and themes

`shared/psa150-tokens.css` (design tokens) and `shared/icons.ts` (icon paths)
are the canonical copies for both apps. `web/src/icons.ts` wraps the paths in
an SVG string; the desktop wraps them in Lit and keeps a mirror in its
`src/shared/`, refreshed with `bun run sync:shared` and checked in its CI.
Edit the files here, never in the mirror. `<html data-theme="light|dark">`
picks a theme; without the attribute the system setting decides. "Automatic"
removes the attribute. The `theme-color` meta follows the chosen theme.

## Not exposed

Revision history (`/songs/{id}/revisions`), deleting songs, paging past the
first 100 sets, the `from` filter on sets, member management, and anything
admin-only.

## Develop and test

`cd web && bun install && bun run dev` serves on port 5173 and proxies `/api`
to `localhost:8080` (the service worker is not registered in dev). `bun run
build` runs `tsc --noEmit` and then outputs `vite build` to `web/dist`, which
the API serves in production ([deployment](deployment.md)). `bun run test`
runs the vitest tests in `web/tests/` ([build and CI](build-and-ci.md)).
