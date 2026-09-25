---
type: Concept
title: Server library
description: Using a Psalm150 song server as the library — the address check, browser sign-in over a loopback redirect (or a pasted token), the offline copy and manifest, and saving edits back to the server.
tags: [server, sync, sign-in, pkce, offline, library]
status: stable
sources:
  - id: sign-in
    resource: /src-tauri/src/commands/server_sign_in.rs
    title: probe_song_server, sign_in_server_library, cancel_server_sign_in (loopback listener tested)
  - id: server-library
    resource: /src-tauri/src/commands/server_library.rs
    title: connect/sync/disconnect, offline cache swap, manifest, save_song, update_song, delete_song
  - id: song-v2
    resource: /src-tauri/src/commands/song_v2.rs
    title: save_content routes saves to the folder or the song server
  - id: app
    resource: /src/components/app.ts
    title: Settings, Church server (renderServerConnect, signInServerLibrary)
generated: { by: agent, at: 2026-09-24T21:10:00Z }
---

# Server library

A console can use a Psalm150 song server
([PSALM150-server](https://github.com/nitech/PSA150-server)) as its library
instead of a local folder. The server's songs are downloaded into an offline
copy under app data (`server-libraries/<hash>/songs`), which is indexed and
projected like any songs folder. Browsing and projecting keep working when the
server is offline.

## Connecting

Settings, Church server (while not connected):

1. **Server URL.** 450 ms after typing stops, `probe_song_server` calls
   `GET <url>/api/v1/info` (4 s timeout). It shows "Psalm150 song server found",
   "has not been set up yet", or "No Psalm150 song server answers at this
   address". Servers without `/info` are recognised through `GET /setup` and
   marked as needing a token.
2. **Sign in with browser** (enabled once the check passes):
   `sign_in_server_library` listens on a random `127.0.0.1` port and opens the
   default browser at
   `<server>/?desktop_redirect=http://127.0.0.1:<port>/callback&state=…&code_challenge=…&device_name=Psalm150 on <COMPUTERNAME>`.
   The person signs in with their server username and password and approves
   the desktop (leaders and owners only). The browser returns to the loopback
   URL with a one-time `code` and the `state`. The desktop answers with a small
   "You can close this tab" page, brings its window to the front and exchanges
   the code plus its PKCE verifier (S256; the challenge is
   `BASE64URL(SHA256(verifier))`) at `POST /api/v1/desktop-auth/token` for an
   ordinary `psa_d_` desktop token. The server side is described in the
   server repo's wiki (auth and roles, desktop browser sign-in).
3. The token is stored in `server-device-token` and the library is
   synchronised as below.

While it waits, the button becomes **Cancel sign-in**
(`cancel_server_sign_in`). Cancel in the browser (`error=access_denied`),
Cancel in the app, and a 5-minute timeout all end the wait; the first two
show "Sign-in cancelled". A callback with the wrong `state` gets an "out of
date" page and the wait continues. The page address is logged
(`[server] browser sign-in: …`); it carries no secret.

**Use a desktop token instead** (a collapsed section, opened automatically for
servers without browser sign-in) keeps the old way: paste a `psa_d_` token
created under Connect desktop on the server (`connect_server_library`).

## Synchronising

`synchronize` (connect and Synchronize library): on the first connection,
songs from the local folder the server does not already have are uploaded
through the import endpoint (exact content matches are skipped; the operator
confirms first). Then the whole library is downloaded as a ZIP export,
unpacked into a staging folder and swapped in for the offline copy; a failed
swap restores the previous copy. The export's `psa150-manifest.json` (file →
server song id and revision) is kept next to the songs as `manifest.json`.

A server library is **read-only as a folder** (`read_only` is forced on and
the Read-only setting is locked), but song edits are not blocked: see below.
Deleting songs, restoring recovery copies and saving web results stay blocked.

## Saving edits

`save_song` and `save_song_lines` are async. In a server library
(`config.server_library` set) they do not write the folder directly:

1. The offline file must still match the editor's content hash
   (`SONG_CHANGED_ON_DISK` otherwise).
2. The file must be in the manifest; otherwise "This song is not on the song
   server yet. Synchronize the server library, then try again."
3. `PUT /api/v1/songs/{id}` with the manifest's `revision_id` as
   `base_revision_id`. If the server has a newer revision it answers 409 and
   nothing changes locally: "Not saved: this song was changed on the song
   server in the meantime. Synchronize the library … then edit again."
4. On success the offline file is replaced (with a recovery copy, as for local
   saves), the manifest entry takes the new `revision_id` from the response
   so the next edit builds on it, and the index and an active projection are
   refreshed like a local save.

The toast says "Song saved to the song server" / "Corrections saved to the
song server". Ad hoc line corrections are allowed in a server library for the
same reason.

## Related

- [Songs folder and app data](songs-folder.md), [VSB sync](vsb-sync.md)
  (which also writes to the server through `update_song` / `delete_song`),
  [IPC contract](ipc-contract.md), [Operator console](operator-console.md)
