---
type: Concept
title: Web client
description: The bundled mobile-first Vite/TypeScript client — hash routes, tab bar and side rail, song reader with chords and transpose, set editor, service view with swipe and "Follow the desktop", remote screen, More screen, role handling, session and preference storage, the desktop consent screen, and what it does not expose.
tags: [web, ui, vite, typescript, mobile]
status: stable
sources:
  - id: main
    resource: /web/src/main.ts
    title: Boot, auth screens, desktop consent, shell, hash router, theme
  - id: context
    resource: /web/src/context.ts
    title: AppContext (canEdit, navigate, run)
  - id: songs
    resource: /web/src/views/songs.ts
    title: Song list, reader, editor, add-to-set sheet
  - id: sets
    resource: /web/src/views/sets.ts
    title: Set list, detail, editor, service view
  - id: remote
    resource: /web/src/views/remote.ts
    title: Remote list and desktop screen
  - id: more
    resource: /web/src/views/more.ts
    title: Account, theme, import/export, desktops
  - id: chordpro
    resource: /web/src/chordpro.ts
    title: ChordPro parsing and transposition for display
  - id: render
    resource: /web/src/song-render.ts
    title: Reader rendering and controls
  - id: api
    resource: /web/src/api.ts
    title: SongServerApi wrapper
  - id: types
    resource: /web/src/types.ts
    title: Response types (mirrors models.rs by hand)
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
generated: { by: agent, at: 2026-09-27T12:00:00Z }
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
([below](#desktop-sign-in)). It then calls `GET /setup`. If the server is not
initialised it shows **Set up your song server** (church, your name, username,
password of at least 10 characters). Otherwise it shows **Sign in** when the
stored session is missing or expired, and the signed-in shell (or the desktop
consent screen) when it is valid. If the server cannot be reached it shows
"The song server is not reachable" with **Try again**.

## Shell and routes

Signed in, the app is a shell with four tabs: **Songs**, **Sets**, **Remote**
and **More**. On narrow screens they are a bottom tab bar; at 900 px and wider
they become a side rail with the brand. The service view hides the tab bar.
Routes live in the URL hash, so the server's static file serving (which has no
SPA fallback) is enough, and links can be shared or bookmarked.

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
| `#/more` | Account, appearance, library, desktops |

An unknown route goes to `#/sets`. A 401 from any screen clears the session
and shows sign-in. A 404 shows "Not found".

## Songs

- **List**: search as you type (250 ms pause) over title, number, author or a
  line. The server returns at most 100 results; there is no paging.
- **Reader**: the song with section labels and chords above the lyrics,
  parsed in the browser by `chordpro.ts` with the desktop's stanza rules
  (a blank line starts a new verse; unlabelled verses are numbered). Controls:
  chords on or off, transpose (only when the song has chords; view only, never
  saved), and text size (−2 to +4). Chords and text size are remembered.
  Shows the first 8 characters of the revision id.
- **Editor**: a raw ChordPro textarea. New songs start from a
  title/author/key/verse template. Saving an existing song sends its
  `revision_id` as the base; a 409 keeps the text and links to the latest
  version ([songs and revisions](songs-and-revisions.md)).
- **Add to a set** (from the reader): lists upcoming sets and undated ones,
  appends the song with the reader's current transpose through `PUT /sets/{id}`
  with the set's version, or starts a new set with it.

## Sets

- **List**: "Upcoming" (today or later, and undated) and "Earlier", with a date
  badge and item count ([sets](sets.md)).
- **Detail**: the items in order with number, transpose and note. A deleted
  song shows as "Deleted song". **Open for the service** starts the service
  view at the first item.
- **Editor**: name, service date (defaults to the next Sunday), items that can
  be moved up or down, removed, transposed and given a note, a blank-screen
  item, and a song picker sheet that stays open while adding. Item ids are made
  in the browser (`crypto.randomUUID()`) and kept across edits. Save sends the
  set's `version` as `base_version`; a 409 keeps the form and links to the other
  version. Delete asks for confirmation and sends `base_version`.
- **Service view**: one item at a time, with the reader controls (transpose
  here adds to the item's own transpose, view only). Move with the bottom
  Previous/Next bar, a horizontal swipe, or the arrow keys. It asks for a
  screen wake lock where the browser supports it. **Follow the desktop**
  (remembered) polls `GET /remote/desktops` every 2.5 s and jumps to the item
  an online desktop reports for this set; without it the poll runs every
  15 s. Leaders also see **Project this on <desktop>** when a desktop accepts
  commands ([remote control](remote-control.md)).

## Remote

- **List** (`#/remote`): the church's desktops with an online dot and what
  each shows, refreshed every 4 s.
- **Desktop** (`#/remote/{deviceId}`): refreshed every 2 s. It shows what is on
  screen and the current slide label, a pad with Previous, Blank and Next,
  the slide labels as buttons, and **Project** from a set item or a song
  search. Opening a desktop remembers it as the one the service view steers.
  Notices explain when the desktop is offline or has remote control off.

## More

Account (name, role, church) with sign-out; **Appearance**: Automatic, Light
or Dark; **Import ChordPro files** (`.pro`, `.cho`, `.chordpro`, leaders only)
and **Export the library** (ZIP) ([import and export](import-export.md));
**Desktops** (leaders only): the active desktop tokens with last use and
**Revoke**, and **Create a token by hand**, shown once with a copy button, for
desktops that cannot open a browser ([auth and roles](auth-and-roles.md)).

## Roles in the UI

`canEdit` is true for owner and leader sessions. Viewers see no new-song,
edit, add-to-set, new-set, import, desktop-token, steering or project buttons;
editor routes send them back to the read-only screen. They can read songs and
sets, use the service view, follow a desktop, watch the remote screen and
export.

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

Because the session lives in `sessionStorage`, the tab the desktop opens
usually starts signed out. The whole flow is in
[auth and roles](auth-and-roles.md#desktop-browser-sign-in).

## State and storage

- The session is kept in `sessionStorage["psa150-server-session"]`, so it is
  per tab and gone when the tab closes. A phone must sign in again after its
  browser drops the tab.
- Per-device preferences are in `localStorage` under `psa150-*`: `theme`,
  `chords`, `text-size`, `follow` and `desktop`. Blocked storage is ignored.
- One `busy` flag stops overlapping actions. Feedback is a toast that lasts
  3.2 s.
- Sign-out only clears storage. The token stays valid on the server until it
  expires.

## Design tokens and themes

`shared/psa150-tokens.css` (design tokens) and `shared/icons.ts` (icon paths)
are the canonical copies for both apps. `web/src/icons.ts` wraps the paths in
an SVG string; the desktop wraps them in Lit and keeps a mirror in its
`src/shared/`, refreshed with `bun run sync:shared` and checked in its CI.
Edit the files here, never in the mirror. `<html data-theme="light|dark">` picks a theme; without the
attribute the system setting decides. "Automatic" removes the attribute. The
`theme-color` meta follows the chosen theme.

## Not exposed

Revision history (`/songs/{id}/revisions`), deleting songs, paging past the
first 100 songs or sets, the `from` filter on sets, member management, and
anything admin-only.

## Develop and test

`cd web && bun install && bun run dev` serves on port 5173 and proxies `/api`
to `localhost:8080`. `bun run build` runs `tsc --noEmit` and then outputs
`vite build` to `web/dist`, which the API serves in production
([deployment](deployment.md)). `bun run test` runs the vitest tests in
`web/tests/` ([build and CI](build-and-ci.md)).
