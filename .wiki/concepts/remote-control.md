---
type: Concept
title: Remote control
description: A PIN-guarded HTTP server for next/prev/blank from a phone — how it works and why it is effectively dormant.
tags: [remote, http, lan]
status: stable
sources:
  - id: remote
    resource: /src-tauri/src/remote.rs
    title: tiny_http server and RemoteAction channel
  - id: cmd
    resource: /src-tauri/src/commands/remote_cmd.rs
    title: start/stop/status commands
  - id: page
    resource: /src-tauri/assets/remote.html
    title: Embedded remote page
  - id: lib
    resource: /src-tauri/src/lib.rs
    title: Action polling in the 1 s thread
generated: { by: agent, at: 2026-08-29T19:45:00Z }
---

# Remote control

`start_remote(port?)` starts a `tiny_http` server on `0.0.0.0:<port>` (default
`config.remote_port` = 8757) with PIN `config.remote_pin` (default `"1234"`
when unset), saves `remote_enabled = true`, and hands the action receiver to
`AppState.remote_actions`.

## Protocol

| Request | Auth | Effect |
| --- | --- | --- |
| `GET /` | none | serves the embedded `remote.html` (three buttons; prompts for the PIN) |
| `POST /next`, `/prev`, `/blank` | header `X-Praise-PIN` must equal the PIN | queues `RemoteAction`; responds `{"action": "..."}` |
| anything else | | `{"error":"not found"}`; non-GET without a PIN gets 401 |

The thread in `lib.rs` drains queued actions once a second and calls
`next_slide_inner` / `previous_slide_inner` / `blank_screen_inner`, so a tap
lands within a second.

## Status today

- No Settings UI calls `start_remote`, and it is **not** auto-started from
  `remote_enabled` on launch. The feature is reachable only over IPC.
- `stop_remote` sets a flag that the server thread checks only after the
  *next* request; until then the port stays bound.
- Binding `0.0.0.0` exposes it on the LAN; the PIN is the only guard and the
  page sends it in clear over HTTP.

## Related

- [Config](config.md): `remote_*` fields
- [Projection windows](projection-windows.md): the navigation it triggers
