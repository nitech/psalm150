---
type: Concept
title: Remote control
description: The in-memory relay that lets a leader's phone steer a projection desktop through the server — desktop state reports (with the slide words rooms show), the command long poll, the live desktop list pushed as server-sent events, actions, timeouts and limits, who may do what, and what a restart forgets.
tags: [remote, desktop, projection, long-poll, server-sent-events, in-memory]
status: stable
sources:
  - id: remote
    resource: /api/src/remote.rs
    title: RemoteHub, handlers, timeouts
  - id: models
    resource: /api/src/models.rs
    title: DesktopState, RoomSlide, RemoteDesktop, RemoteAction, RemoteCommandRequest, RemoteCommand, CommandsQuery
  - id: rooms
    resource: /api/src/rooms.rs
    title: Desktop identity (computer and room name) for the relay
  - id: lib
    resource: /api/src/lib.rs
    title: AppState.remote
  - id: test
    resource: /api/tests/api_flow.rs
    title: remote_control_flow, rooms_flow
  - id: webremote
    resource: /web/src/views/remote.ts
    title: Remote screens
  - id: webapi
    resource: /web/src/api.ts
    title: readEvents, watchDesktops
generated: { by: agent, at: 2026-10-05T18:00:00Z }
---

# Remote control

A desktop that allows it reports what it projects to the server and waits for
commands. A leader's phone lists the church's desktops by their room names and
sends commands: next, previous, blank, jump to a slide, or project a song or a
set item. The server only relays. The desktop stays in charge: it may ignore a
command, and a service keeps running when the server is gone. The same reports
feed the desktop's [room](rooms.md), where anyone may follow the words.

## State lives in memory

`AppState.remote` is an `Arc<RemoteHub>` created in `AppState::new`. It holds
one entry per desktop (church, computer name, room name, whether the church
has rooms open, last seen, last reported state, queued commands) and a watch
channel that is bumped whenever a desktop's state, names or presence changes.
Nothing is written to PostgreSQL. So:

- A restart forgets every desktop and every queued command. Desktops appear
  again when they next report (the desktop sends its state at least every
  15 s).
- The relay works only with **one** server process. Two instances behind a
  load balancer would each see only some desktops ([gaps](gaps.md)).

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/remote/desktop` | desktop token only | 200 `DesktopRoom`: the desktop's room ([rooms](rooms.md)) |
| PUT | `/remote/desktop` | desktop token only | Body `DesktopState`. 204. Marks the desktop seen, stores the state, and forgets desktops silent for 24 h. `accepts_commands: false` drops any queued commands |
| DELETE | `/remote/desktop` | desktop token only | 204. Removes the desktop and wakes its pending long poll |
| PUT | `/remote/desktop/room` | desktop token only | Renames the desktop's own room ([rooms](rooms.md)) |
| GET | `/remote/desktop/commands?wait=` | desktop token only | Returns and removes the queued commands, oldest first. With none queued it waits up to `wait` seconds (0–30, default 0) for one. Also counts as "seen" |
| GET | `/remote/desktops` | any token | `RemoteDesktop[]` for the caller's church: `{device_id, name, room_name, online, last_seen, state}`. `name` is the computer's name the desktop was connected with, `room_name` what leaders pick it by. Online first, then by room name. Desktops whose token was revoked are left out |
| GET | `/remote/desktops/events` | any token | Server-sent events: a `desktops` event with the same list, at once and whenever it changes |
| POST | `/remote/desktops/{device_id}/commands` | editor (person owner or leader) | Body `RemoteCommandRequest`. 202 with the queued `RemoteCommand` |

A person session on a desktop-only route gets 403 `a desktop token is
required`. A desktop token or viewer sending a command gets 403
`leader access is required` (`require_editor`). Revoking a desktop's token
(`DELETE /device-tokens/{id}`) removes it from the hub at once, so it drops
off every list and out of its room without waiting for the 24 h forget.

## Live push

`GET /remote/desktops/events` is a `text/event-stream`. The first `desktops`
event carries the list straight away; after that the stream wakes whenever
the hub's watch channel is bumped, and also every 10 s (`LIVE_REFRESH`) so a
desktop that went quiet shows as offline, and sends the list again only when
it differs from the last one sent. Every wake checks the token again: once it
stops working (signed out, expired, revoked, or the person disabled or
removed) the stream ends. Keep-alive comments keep idle connections open, and
the response carries `X-Accel-Buffering: no` so nginx does not hold events
back; other proxies must be told not to buffer `text/event-stream`
([deployment](deployment.md)).

A browser's `EventSource` cannot send a bearer token, so the web client reads
the stream with `fetch` (`readEvents` in `web/src/api.ts`), reconnecting after
a dropped connection with a pause that grows from 1 s to 15 s; a 4xx answer
ends it (401 signs the person out). This replaced the remote screens' 2 s
polling. The room stream (`/public/rooms/{room_name}/events`) works the same
way without a token ([rooms](rooms.md)).

## Desktop state

`DesktopState` is `{accepts_commands, projecting, blanked, song_id,
song_title, slide_index, slide_labels, set_id, set_item_index, shares_room,
slides}`. `shares_room` says the operator lets people follow the words in the
desktop's room; `slides` is the projected song's words, slide by slide in the
order shown, as `{label, lines[]}` without chords. Both default to off and
empty, so an older desktop simply shares nothing. The server trims the report:
at most 200 slide labels of at most 60 characters each, a song title of at
most 200 characters, and at most 200 slides of 40 lines of 300 characters.
The desktop's computer name comes from its token row (`device_tokens.name`)
and its room name from `device_tokens.room_name`, not from the report.

`state.slides` is in every `RemoteDesktop`, whatever `shares_room` says: the
list only reaches the church's own tokens, and the Remote screen shows the
current slide's words to anyone signed in. `shares_room` only governs the
public room.

A desktop is **online** when it reported or polled within the last 45 s
(`ONLINE_SECONDS`).

## Commands

| `action` | Needs | Checked |
| --- | --- | --- |
| `next`, `previous` | nothing | – |
| `blank` | nothing | Toggles the blank screen |
| `show_slide` | `slide_index` | Present, else 400 |
| `project_song` | `song_id` | 400 when missing; 404 when not a live song of the church |
| `project_set_item` | `set_id`, `item_index` | 400 when either is missing; 404 when the set is not a live set of the church. The index is not checked against the set |

Then the target desktop must be in the caller's church and online, else 404
`that desktop is not online`, and must report `accepts_commands`, else 409
`that desktop does not accept remote control`. The command gets an `id`,
`issued_by` (the sender's display name) and `issued_at`.

Limits:

- At most 20 commands are queued per desktop; the oldest is dropped first.
- A queued command older than 30 s (`COMMAND_TTL_SECONDS`) is discarded when
  the desktop collects, not delivered late.
- Commands are delivered once, in order.

## Clients

- **Desktop** (in the client repo, `src-tauri/src/commands/server_remote.rs`):
  while a server library is connected and "Allow remote control through the
  song server" or "Let people follow the projected words in this room" is on;
  both are on by default. It reports state (with the slide words) on change
  and every 15 s, sending `accepts_commands` and `shares_room` from those two
  settings, and long-polls with `wait=25` only while remote control is on. It
  reads its room with `GET /remote/desktop` on connecting and every 60 s.
  Next, previous, blank and show-slide run directly; project-a-song and
  project-a-set-item go through the console's normal projection path.
- **Web client**: the Remote tab, which follows the live push, shows each
  desktop by room name with the computer name underneath, the current slide's
  words, and lets leaders rename the room; and the service view's "Follow the
  desktop" and "Project this on …", which still poll `GET /remote/desktops`
  ([web client](web-client.md#remote)). Viewers can watch a desktop but see
  no steering or rename controls.
