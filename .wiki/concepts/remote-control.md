---
type: Concept
title: Remote control
description: A PIN-guarded HTTP server so a phone on Wi-Fi or Tailscale can change slides — auto-started from config, toggled in Settings, with a phone-sized page.
tags: [remote, http, lan, tailscale, phone]
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
  - id: app
    resource: /src/components/app.ts
    title: Settings "Phone remote" section
generated: { by: agent, at: 2026-08-30T00:00:00Z }
---

# Remote control

A phone on the same network opens `http://<this PC>:<port>/` and gets three
buttons: Next, Previous, Blank. On a Tailscale network "this PC" is its
tailnet address (e.g. `100.64.229.79`), so the phone works from anywhere.

## Lifecycle

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

## Protocol

| Request | Auth | Response |
| --- | --- | --- |
| `GET /` | none | `text/html` remote page |
| `POST /next`, `/prev`, `/blank` | header `X-PSA150-PIN` equal to the PIN | `200 {"action": "..."}`; queues a `RemoteAction` |
| `POST` with a wrong or missing PIN | | `401 {"error":"unauthorized"}` |
| anything else | | `404 {"error":"not found"}` |

Actions travel over an `mpsc` channel that the thread in `lib.rs` drains once
a second, calling `next_slide_inner` / `previous_slide_inner` /
`blank_screen_inner`; a tap lands within a second.

## The page

Plain HTML embedded with `include_str!` (rebuild to change it). Dark, large
buttons, safe-area padding, `apple-mobile-web-app-capable` so it can be added
to the iOS Home Screen. The PIN field is remembered in the phone's
`localStorage` (`psa150-remote-pin`); each tap reports "Sent next", "Wrong
PIN" or "Psalm150 is not reachable".

## Caveats

- Binding `0.0.0.0` exposes it on every interface; the PIN is the only guard
  and travels in clear over HTTP. Fine on a tailnet or church Wi-Fi, not on a
  public network.
- Windows Firewall may prompt the first time a build listens; allow it or the
  phone gets "not reachable".
- The page cannot pick songs; that still needs the console.

## Related

- [Config](config.md): `remote_enabled`, `remote_port`, `remote_pin`
- [Projection windows](projection-windows.md): the navigation it triggers
- [Operator console](operator-console.md): the Settings toggle
