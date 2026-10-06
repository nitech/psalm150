---
type: Concept
title: Remote control
description: Two ways to steer the PC from a phone — a PIN-guarded LAN HTTP server with a phone page for next/prev/blank, and a relay through the connected song server (on by default) that also projects songs and set items — plus the PC's room on the song server, where anyone may follow the projected words on their phone.
tags: [remote, http, lan, tailscale, phone, server, long-poll, rooms]
status: stable
sources:
  - id: remote
    resource: /src-tauri/src/remote.rs
    title: RemoteServer (bind, worker loop, stop, request handling)
  - id: cmd
    resource: /src-tauri/src/commands/remote_cmd.rs
    title: start_remote_inner / stop_remote_inner and the commands
  - id: page
    resource: /src-tauri/assets/remote.html
    title: Embedded phone page
  - id: lib
    resource: /src-tauri/src/lib.rs
    title: Auto-start in setup() and action polling in the 1 s thread
  - id: test
    resource: /src-tauri/tests/remote.rs
    title: Integration test (page, PIN, 404, port release)
  - id: server-remote
    resource: /src-tauri/src/commands/server_remote.rs
    title: Song server remote and room (state reports with slide words, command long poll, room fetch and rename, set_server_remote_enabled, set_server_room_sharing)
  - id: config
    resource: /src-tauri/src/config.rs
    title: server_remote (server_remote_enabled) and server_room_sharing, both default on
  - id: app
    resource: /src/components/app.ts
    title: Settings "Phone remote" section, Church server checkboxes and room settings, room chip, remote-project handler
generated: { by: agent, at: 2026-10-05T21:30:00Z }
---

# Remote control

There are two independent remotes:

- the **LAN remote** (below): a small HTTP server on this PC with a PIN and
  a three-button page;
- the **song server remote** ([below](#through-the-song-server)): leaders
  signed in to the connected song server steer the PC from the server's web
  client, from anywhere, without opening a port on the PC.

Through the same connection the PC also has a [room](#room) on the song
server: anyone who types its name at `<server>/join` can follow the projected
words on their own phone.

## LAN remote

A phone on the same network opens `http://<this PC>:<port>/` and gets three
buttons: Next, Previous, Blank. On a Tailscale network "this PC" is its
tailnet address (e.g. `100.64.229.79`), so the phone works from anywhere.

### Lifecycle

- **Settings, Phone remote** toggles it. On: `start_remote` binds, saves
  `remote_enabled = true`, `remote_port` and `remote_pin` (six random digits
  when unset, or when it is `1234`, the fixed default of older versions) and
  shows the port and PIN. Off: `stop_remote`.
- **Auto-start**: `setup()` calls `start_remote_inner` when
  `config.remote_enabled` is true, so the remote survives restarts. A failed
  bind is logged as `[remote] not started: …` and the app continues.
- `RemoteServer::start` binds **synchronously** on `0.0.0.0:<port>` (port `0`
  picks a free one; `status().port` reports the real one). A bind error (port
  in use, blocked) is returned to the caller instead of a phantom "running".
- The worker loops on `recv_timeout(250 ms)` and checks a stop flag.
  `stop()` joins it, drops the server, then **connects to `127.0.0.1:port`**:
  tiny_http wakes its accept thread by connecting to the listen address, which
  is `0.0.0.0` and refused on Windows, so without the loopback poke the port
  stayed bound until the app exited. The integration test asserts release.

### Protocol

| Request | Auth | Response |
| --- | --- | --- |
| `GET /` | none | `text/html` remote page |
| `POST /next`, `/prev`, `/blank` | header `X-PSA150-PIN` equal to the PIN | `200 {"action": "..."}`; queues a `RemoteAction` |
| `POST` with a wrong or missing PIN | | `401 {"error":"unauthorized"}` |
| `POST` within 60 s of the fifth wrong PIN in a row | | `429 {"error":"too many wrong PINs"}`, even with the right PIN |
| any request whose `Host` is not an IP literal, `localhost`, a bare machine name, `*.local` or `*.ts.net` | | `403 {"error":"forbidden host"}` (DNS rebinding guard) |
| anything else | | `404 {"error":"not found"}` |

Actions travel over an `mpsc` channel that the thread in `lib.rs` drains once
a second, calling `next_slide_inner` / `previous_slide_inner` /
`blank_screen_inner`; a tap lands within a second.

### The page

Plain HTML embedded with `include_str!` (rebuild to change it). Dark, large
buttons, safe-area padding, `apple-mobile-web-app-capable` so it can be added
to the iOS Home Screen. The PIN field is remembered in the phone's
`localStorage` (`psa150-remote-pin`); each tap reports "Sent next", "Wrong
PIN. Type the PIN shown in Psalm150 under Settings, Phone remote." (and marks
the PIN field invalid) or "Too many wrong PINs. Wait a minute, then try again." (429) or
"Psalm150 is not reachable" in a `role="status"`
line. The page aims at WCAG 2.2 AA ([accessibility](accessibility.md#lan-remote-page)):
labelled PIN field with a 3:1 edge, focus ring, `main` landmark.

### Caveats

- Binding `0.0.0.0` exposes it on every interface; the PIN (with the lockout
  and Host check) is the only guard and travels in clear over HTTP. Someone
  sending wrong PINs keeps the phone locked out. tiny_http has no read
  timeout. Fine on a tailnet or church Wi-Fi, not on a
  public network.
- Windows Firewall may prompt the first time a build listens; allow it or the
  phone gets "not reachable".
- The page cannot pick songs; the song server remote can.

## Through the song server

Only in a [server library](server-library.md), and **on by default**:
Settings, Church server, **Allow remote control through the song server**
(`set_server_remote_enabled`, saved under the config key `server_remote`;
the Rust field is still `server_remote_enabled`). The old key
`server_remote_enabled` was off by default and is now ignored, so existing
installs have remote control on until the operator turns it off. The hint
says leaders signed in to the song server can change slides, blank the screen
and project songs from their phones, and that everything also works without
the server. The desktop only makes outgoing requests with its device token;
the phone side lives in the server repo.

Two background tasks are spawned in `setup()`:

- **State report.** Runs while a server library is connected, a token is
  stored, and remote control **or** [room sharing](#room) is on. About every
  0.7 s the desktop builds its state: `accepts_commands` (the remote control
  setting), `shares_room` (the room sharing setting), `projecting` (audience
  or stage window visible and slides loaded), `blanked`, `song_id` (the
  projected file's server id from the manifest), `song_title`,
  `slide_index`, `slide_labels` (section labels), `slides` (every slide's
  label and lines, words only, no chords), and `set_id` / `set_item_index`
  for the console's active setlist (`set_active_setlist`) when that setlist
  has been uploaded to the server and contains the projected file. It sends
  `PUT /api/v1/remote/desktop` when the state changed, and at least every
  15 s as a heartbeat (`HEARTBEAT`). When both settings are turned off it
  sends `DELETE /api/v1/remote/desktop` once. Disconnecting the server
  library deletes the token before that goodbye could go out; the token is
  revoked on the server instead
  ([server library](server-library.md#disconnecting)), which takes the
  desktop off the phones' list and out of its room. A failed report is
  retried after 5 s. The same loop reads the [room](#room).
- **Commands.** Only while remote control is on.
  `GET /api/v1/remote/desktop/commands?wait=25` (`LONG_POLL_SECONDS`) is held
  open by the server and returns a list of commands. A 404 (server without
  remote control) waits 5 minutes before asking again; other errors retry
  after 5 s. Commands that arrive after the setting was turned off are
  ignored. With remote control off but room sharing on, the PC still reports
  (with `accepts_commands: false`), so leaders see what it shows but cannot
  steer it.

| Action | Runs | Effect |
| --- | --- | --- |
| `next`, `previous` | Rust | `next_slide_inner` / `previous_slide_inner` |
| `blank` | Rust | toggles: shows the current slide again when blank, blanks otherwise |
| `show_slide` `slide_index` | Rust | `show_slide_inner` |
| `project_song` `song_id` | console | the song file (fetched from the server first when this PC lacks it, `ensure_song`) is sent in `remote-project` with transpose 0 |
| `project_set_item` `set_id, item_index` | console, or Rust for a blank item | reads the local setlist item (running a [sets sync](server-library.md#sets) first when it is missing); a song item goes to the console in `remote-project` with the item's transpose, any other item blanks the screen |

`remote-project` carries `RemoteProject { filename, transpose, set_id,
item_index, issued_by }`. The console chooses that setlist when `set_id` is
given, selects the song, projects it through its normal path (so the
projection windows are only shown, never built from the command) and applies
`transpose` with `set_transpose`, then toasts "Projected from <issued_by>'s
phone". Errors are toasted.

### Room

The song server gives every connected PC a room name, a flower such as
"Lily" unless someone renamed it, unique on that server. Leaders pick the PC
by it in the server's remote, and anyone may type it at `<server>/join` to
follow the words this PC projects on their own phone, in large text. The rules
on the server side (who may rename, the church owner's switch, what a room
shows) are in the server repo's wiki, page "Rooms".

- **Reading it.** The report loop asks `GET /api/v1/remote/desktop` on
  connecting and then every 60 s (`ROOM_REFRESH`), so a name a leader changed
  on the web shows here within a minute. `get_server_room` asks on demand
  (the console calls it at startup and when Settings opens) and falls back to
  the last known room when the server cannot be reached. The room is cached
  and every change is emitted as `server-room` with
  `ServerRoom { room_name, public_rooms, join_url }`, or null when the server
  library is disconnected. `public_rooms` is the church owner's setting;
  `join_url` is `<server>/join/<room>`.
- **Renaming.** `rename_server_room(room_name)` sends
  `PUT /api/v1/remote/desktop/room`; null picks another random flower. The
  server refuses a name another desktop has (409) or one outside 2–30
  letters, digits, spaces, hyphens and apostrophes (400), and its message is
  shown. A server too old to have rooms answers 404, shown as "this song
  server does not have rooms yet; update it".
- **Sharing.** Settings, Church server, **Let people follow the projected
  words in this room** (`set_server_room_sharing`, `config.server_room_sharing`,
  **on by default**) sets `shares_room` in the report. Off, the room stays
  (leaders still pick the PC by it) but shows no words. The words are only
  shown in the room while something is projected, and never the chords.

The console shows the room as a chip in its header and under Settings, Church
server ([operator console](operator-console.md#room)).

## Related

- [Config](config.md): `remote_enabled`, `remote_port`, `remote_pin`,
  `server_remote` (`server_remote_enabled`), `server_room_sharing`
- [Server library](server-library.md): the connection and sets it relies on
- [Projection windows](projection-windows.md): the navigation it triggers
- [Operator console](operator-console.md): the Settings toggles
