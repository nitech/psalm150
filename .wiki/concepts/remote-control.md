---
type: Concept
title: Remote control
description: Two ways to steer the PC from a phone — a PIN-guarded LAN HTTP server with a phone page for next/prev/blank, and an opt-in relay through the connected song server that also projects songs and set items.
tags: [remote, http, lan, tailscale, phone, server, long-poll]
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
    title: Song server remote (state reports, command long poll, set_server_remote_enabled)
  - id: app
    resource: /src/components/app.ts
    title: Settings "Phone remote" section, Church server checkbox, remote-project handler
generated: { by: agent, at: 2026-09-27T12:00:00Z }
---

# Remote control

There are two independent remotes:

- the **LAN remote** (below): a small HTTP server on this PC with a PIN and
  a three-button page;
- the **song server remote** ([below](#through-the-song-server)): leaders
  signed in to the connected song server steer the PC from the server's web
  client, from anywhere, without opening a port on the PC.

## LAN remote

A phone on the same network opens `http://<this PC>:<port>/` and gets three
buttons: Next, Previous, Blank. On a Tailscale network "this PC" is its
tailnet address (e.g. `100.64.229.79`), so the phone works from anywhere.

### Lifecycle

- **Settings, Phone remote** toggles it. On: `start_remote` binds, saves
  `remote_enabled = true`, `remote_port` and `remote_pin` (default `1234` when
  unset) and shows the port and PIN. Off: `stop_remote`.
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
| anything else | | `404 {"error":"not found"}` |

Actions travel over an `mpsc` channel that the thread in `lib.rs` drains once
a second, calling `next_slide_inner` / `previous_slide_inner` /
`blank_screen_inner`; a tap lands within a second.

### The page

Plain HTML embedded with `include_str!` (rebuild to change it). Dark, large
buttons, safe-area padding, `apple-mobile-web-app-capable` so it can be added
to the iOS Home Screen. The PIN field is remembered in the phone's
`localStorage` (`psa150-remote-pin`); each tap reports "Sent next", "Wrong
PIN" or "Psalm150 is not reachable".

### Caveats

- Binding `0.0.0.0` exposes it on every interface; the PIN is the only guard
  and travels in clear over HTTP. Fine on a tailnet or church Wi-Fi, not on a
  public network.
- Windows Firewall may prompt the first time a build listens; allow it or the
  phone gets "not reachable".
- The page cannot pick songs; the song server remote can.

## Through the song server

Opt-in and only in a [server library](server-library.md): Settings, Church
server, **Allow remote control through the song server**
(`set_server_remote_enabled`, saved as `config.server_remote_enabled`,
default off). The hint says leaders signed in to the song server can change
slides, blank the screen and project songs from their phones, and that
everything also works without the server. The desktop only makes outgoing
requests with its device token; the phone side lives in the server repo.

Two background tasks are spawned in `setup()` and idle while the setting is
off, no server library is connected, or no token is stored:

- **State report.** About every 0.7 s the desktop builds its state:
  `projecting` (audience or stage window visible and slides loaded),
  `blanked`, `song_id` (the projected file's server id from the manifest),
  `song_title`, `slide_index`, `slide_labels` (section labels), and
  `set_id` / `set_item_index` for the console's active setlist
  (`set_active_setlist`) when that setlist has been uploaded to the server
  and contains the projected file. It sends `PUT /api/v1/remote/desktop` when
  the state changed, and at least every 15 s as a heartbeat (`HEARTBEAT`).
  When the setting is turned off or the server library disconnected it sends
  `DELETE /api/v1/remote/desktop` once. A failed report is retried after 5 s.
- **Commands.** `GET /api/v1/remote/desktop/commands?wait=25`
  (`LONG_POLL_SECONDS`) is held open by the server and returns a list of
  commands. A 404 (server without remote control) waits 5 minutes before
  asking again; other errors retry after 5 s. Commands that arrive after the
  setting was turned off are ignored.

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

## Related

- [Config](config.md): `remote_enabled`, `remote_port`, `remote_pin`,
  `server_remote_enabled`
- [Server library](server-library.md): the connection and sets it relies on
- [Projection windows](projection-windows.md): the navigation it triggers
- [Operator console](operator-console.md): the Settings toggles
