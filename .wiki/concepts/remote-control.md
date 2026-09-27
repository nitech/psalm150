---
type: Concept
title: Remote control
description: The in-memory relay that lets a leader's phone steer a projection desktop through the server — desktop state reports, the command long poll, actions, timeouts and limits, who may do what, and what a restart forgets.
tags: [remote, desktop, projection, long-poll, in-memory]
status: stable
sources:
  - id: remote
    resource: /api/src/remote.rs
    title: RemoteHub, handlers, timeouts
  - id: models
    resource: /api/src/models.rs
    title: DesktopState, RemoteDesktop, RemoteAction, RemoteCommandRequest, RemoteCommand, CommandsQuery
  - id: lib
    resource: /api/src/lib.rs
    title: AppState.remote
  - id: test
    resource: /api/tests/api_flow.rs
    title: remote_control_flow
  - id: webremote
    resource: /web/src/views/remote.ts
    title: Remote screens
generated: { by: agent, at: 2026-09-27T12:00:00Z }
---

# Remote control

A desktop that allows it reports what it projects to the server and waits for
commands. A leader's phone lists the church's desktops and sends commands:
next, previous, blank, jump to a slide, or project a song or a set item. The
server only relays. The desktop stays in charge: it may ignore a command, and
a service keeps running when the server is gone.

## State lives in memory

`AppState.remote` is an `Arc<RemoteHub>` created in `AppState::new`. It holds
one entry per desktop (church, name, last seen, last reported state, queued
commands). Nothing is written to PostgreSQL. So:

- A restart forgets every desktop and every queued command. Desktops appear
  again when they next report (the desktop sends its state at least every
  15 s).
- The relay works only with **one** server process. Two instances behind a
  load balancer would each see only some desktops ([gaps](gaps.md)).

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| PUT | `/remote/desktop` | desktop token only | Body `DesktopState`. 204. Marks the desktop seen, stores the state, and forgets desktops silent for 24 h. `accepts_commands: false` drops any queued commands |
| DELETE | `/remote/desktop` | desktop token only | 204. Removes the desktop and wakes its pending long poll |
| GET | `/remote/desktop/commands?wait=` | desktop token only | Returns and removes the queued commands, oldest first. With none queued it waits up to `wait` seconds (0–30, default 0) for one. Also counts as "seen" |
| GET | `/remote/desktops` | any token | `RemoteDesktop[]` for the caller's church: `{device_id, name, online, last_seen, state}`. Online first, then by name. Desktops whose token was revoked are left out |
| POST | `/remote/desktops/{device_id}/commands` | editor (person owner or leader) | Body `RemoteCommandRequest`. 202 with the queued `RemoteCommand` |

A person session on a desktop-only route gets 403 `a desktop token is
required`. A desktop token or viewer sending a command gets 403
`leader access is required` (`require_editor`).

## Desktop state

`DesktopState` is `{accepts_commands, projecting, blanked, song_id,
song_title, slide_index, slide_labels, set_id, set_item_index}`. The server
trims it: at most 200 slide labels of at most 60 characters each, and a song
title of at most 200 characters. The desktop's name comes from its token row
(`device_tokens.name`), not from the report.

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
  only while "Allow remote control through the song server" is on and a
  server library is connected. It reports state on change and every 15 s, and
  long-polls with `wait=25`. Next, previous, blank and show-slide run
  directly; project-a-song and project-a-set-item go through the console's
  normal projection path.
- **Web client**: the Remote tab and the service view's "Follow the desktop"
  and "Project this on …" ([web client](web-client.md#remote)). Viewers can
  watch a desktop but see no steering controls.
