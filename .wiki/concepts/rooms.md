---
type: Concept
title: Rooms
description: Every desktop's room name (a flower unless renamed), unique on the server; who may rename it; the church's public_rooms switch and the desktop's shares_room; the token-free room view and its server-sent event stream; the /join page that shows the words live in large text; and what is not limited yet.
tags: [rooms, remote, desktop, public, server-sent-events, accessibility]
status: stable
sources:
  - id: rooms
    resource: /api/src/rooms.rs
    title: FLOWERS, room_key, clean_room_name, assign_room_name, handlers
  - id: remote
    resource: /api/src/remote.rs
    title: RemoteHub.room_view, live_events, event_stream
  - id: models
    resource: /api/src/models.rs
    title: DesktopRoom, RoomNameRequest, RoomView, RoomStatus, RoomSlide
  - id: mig9
    resource: /api/migrations/0009_desktop_rooms.sql
    title: device_tokens.room_name and room_key, churches.public_rooms
  - id: lib
    resource: /api/src/lib.rs
    title: /join and /join/{room_name} routes
  - id: pages
    resource: /api/src/pages.rs
    title: app_page
  - id: test
    resource: /api/tests/api_flow.rs
    title: rooms_flow
  - id: webroom
    resource: /web/src/views/room.ts
    title: Join page and room reader
  - id: webremote
    resource: /web/src/views/remote.ts
    title: Room names, rename, copy and share the link
generated: { by: agent, at: 2026-10-05T18:00:00Z }
---

# Rooms

Every desktop has a **room**: a short name, a flower such as "Lily" unless
someone chose another. Leaders pick the desktop by it in the remote
([remote control](remote-control.md)), and anyone may type it at
`<server>/join` to follow the words that desktop projects on their own phone,
live and as large as they need. It is made for people who cannot read the
screen well. Following a room needs no account and no public library.

## Room names

- A desktop gets a random free flower from `FLOWERS` (105 common,
  easy-to-spell names without accents) when its token is made, by
  `POST /device-tokens` or browser sign-in (`room_name` in both answers). A
  desktop made before rooms gets one the next time it talks to the server.
- Names are stored in `device_tokens.room_name` and matched by `room_key`: lower
  case, accents taken off, only letters and digits. "Lily", "LILY " and "lily"
  are the same room, and so are "Forget-me-not" and "forget me not".
- A name is **unique across the server**, not per church, because a room is
  joined without naming a church (unique index on `room_key` among desktops
  that are not revoked). Revoking a desktop frees its name.
- With every flower taken, numbered ones follow ("Lily 2").
- A desktop keeps its name until someone renames it.

## Renaming

| Who | Endpoint |
| --- | --- |
| The desktop itself | `PUT /remote/desktop/room` |
| A person owner or leader of its church (`require_editor`) | `PUT /device-tokens/{device_id}/room` |

Body `{room_name}`. Null, empty or left out picks a new random flower. A chosen
name has its spaces collapsed and must have 2–30 letters, digits, spaces,
hyphens or apostrophes (400 otherwise); a name another desktop has is 409.
Both answer `DesktopRoom` `{device_id, room_name, public_rooms}`, which the
desktop also reads with `GET /remote/desktop`. A rename reaches open remote
and room streams at once. Someone already following the room keeps following
it under its new name (the stream is tied to the desktop, and the page
reconnects by the name it last received); the old name answers 404 to anyone
new.

## Who sees the words

Two switches, both on by default:

- **The church**: `churches.public_rooms`, changed by an owner with
  `PUT /church {public_rooms}` (More → Rooms in the web client). Off closes
  every room of the church: they answer 404, like a name no one has.
  `GET /info` has `rooms: true` while any church has them open.
- **The desktop**: `shares_room` in its state report, from the operator's
  "Let people follow the projected words in this room" checkbox. Off keeps the
  room but shows no words.

## Following a room

`GET /public/rooms/{room_name}` (no token) answers `RoomView`
`{room_name, status, song_title, slide_index, slides}`:

| `status` | When | Words |
| --- | --- | --- |
| `live` | Online, projecting, sharing, rooms open, words on screen | Title, slide index and every slide's `{label, lines}` |
| `blank` | As `live`, but the screen is blanked | Same, so the reader keeps its place |
| `idle` | Online, but not projecting, not sharing, or the church closed rooms meanwhile | None |
| `offline` | Not heard from in 45 s, or not since the server started | None |

Only words reach a room: no chords, set, song id or computer name.
`GET /public/rooms/{room_name}/events` sends the same view as a `room`
server-sent event at once and whenever it changes, with the same wake-ups,
10 s re-check and keep-alive comments as the remote's live list
([remote control](remote-control.md#live-push)). A browser reads it with
`EventSource`. What a room shows lives in memory with the relay, so a restart
shows rooms `offline` until their desktops report again (within seconds).

## The join page

The server answers `/join` and `/join/{room_name}` with the web client's
`index.html` (`pages::app_page`, only when a web build is present). The page
stands outside the app shell and needs no sign-in:

- `/join` asks for the room name, filled with the last room joined on this
  phone; `/join/{room}` opens the room straight away. An unknown name says so
  and asks again.
- The room shows the whole song in large text with the current slide
  highlighted and scrolled into view, and a status ("Live", "Screen is
  blank", "Waiting", "Not connected", "Reconnecting…"). While idle or offline
  it says so and waits; the page can be left open.
- An open stream stays open when the room closes (it then shows `idle` or
  `offline`). When a dropped stream cannot reconnect, the page looks the room
  up again after 4 s and goes back to `/join` with a note if it is gone.
- Reading tools: smaller and larger text (seven sizes), high contrast (yellow
  on black), **Follow the screen** on or off, and an optional screen-reader
  announcement of each new slide. They are remembered on the phone.
- The screen is kept awake while words are shown, where the browser allows it.
- **Leave** forgets the remembered room and goes back to `/join`.

The sign-in page and the visitor menu link to `/join` when `/info.rooms` is
true. Leaders find each desktop's room on the Remote screen, with **Copy the
link** and **Share** for `<server>/join/<room>` and a rename sheet with
**Pick another flower** ([web client](web-client.md#remote)). The Psalm150
desktop shows its room as a chip in the console's header and under Settings →
Church server, where the operator renames it, turns sharing off and copies the
link (client repo, `src/components/app.ts` and
`src-tauri/src/commands/server_remote.rs`; its wiki page "Remote control").

## Not limited yet

- The public room reads and streams are not rate-limited, and the number of
  people following a room (open streams) is not capped.
- Room names are short and guessable on purpose. An owner's switch, the
  operator's checkbox and renaming are the only controls; there is no room
  code or PIN.
- Like the relay, rooms work with one server process only, and a reverse
  proxy must not buffer `text/event-stream` ([deployment](deployment.md)).

See [gaps](gaps.md).
