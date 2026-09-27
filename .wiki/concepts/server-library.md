---
type: Concept
title: Server library
description: Using a Psalm150 song server as the library — the address check, browser sign-in over a loopback redirect (or a pasted token), the offline copy and manifest, saving edits back to the server, and setlists shared as the server's sets.
tags: [server, sync, sign-in, pkce, offline, library, sets]
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
  - id: server-sets
    resource: /src-tauri/src/commands/server_sets.rs
    title: Sets sync (push dirty setlists, snapshot, fetch missing songs, mirror; unit tests)
  - id: app
    resource: /src/components/app.ts
    title: Settings, Church server (renderServerConnect, signInServerLibrary, shared-sets note)
generated: { by: agent, at: 2026-09-27T12:00:00Z }
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
Last, the [sets](#sets) are synchronised too; a failure there is logged
(`[server] set sync failed: …`) and leaves the song library usable.

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

## Sets

In a server library the [setlists](setlists.md) are the church's sets on the
song server, stored locally with the same ids and a `server: { version, dirty }`
marker. The Church server settings say so: "Setlists are the church's shared
sets: changes here are sent to the server, and sets made on a phone arrive
within a minute."

**When it runs** (`server_sets::sync_sets`): every 60 s in the background
(`POLL_INTERVAL`, spawned in `setup()`), shortly after each local setlist
edit (`request_sync`), at the end of a full library `synchronize`, and on the
`sync_server_sets` command (no button calls it yet). Runs never overlap,
whoever starts them (`SYNC_LOCK`); a background request during a run causes
one more run afterwards. Nothing
happens without a connected server library and a stored token.

**1. Upload.** Each `dirty` setlist, and each setlist without server state
(made before sets were shared), is sent with the device token. A set the
server refuses with an unexpected status stays dirty for the next run while
the others go up:

- never uploaded (`version` null): `POST /api/v1/sets` with the setlist's own
  `id`;
- otherwise: `PUT /api/v1/sets/{id}` with `base_version`.

The body has `name`, `service_date` (only when `date` is an ISO
`YYYY-MM-DD`; a date in another format is sent as none) and `items`. Song
items are sent by server song id from the manifest, with `transpose` clamped
to −11…11 and `note`; **song items whose file is not in the manifest are left
out** and counted as `skipped_items`. Blank and hold items are both sent as
`blank`; `arrangement` is not sent. Item ids that are not UUIDs are sent as
none. On success the setlist takes the returned `version` and is clean.

**Conflicts.** When the server answers 409 (someone changed the set first) or
404 (it was deleted), the server's version wins under the set's id and this
PC's edit is saved as a new, never-uploaded, dirty setlist named
"`<name>` (changes from `<computer>`)" (`COMPUTERNAME`, else `HOSTNAME`,
else "this PC"), with fresh item ids, which is uploaded on the next run.
The console toasts "“<name>” was changed elsewhere; your changes are kept as a
copy". A 403 stops with "The song server does not let this desktop change sets
(update the server)"; a 400 reports the server's message.

**2. Download.** `GET /api/v1/sets/snapshot` returns every set. A server
without sets answers 404 (or 405 through a proxy); the report is marked
`unsupported` and nothing else changes.

**3. Missing songs.** Songs referenced by a set but not in the manifest
(added on a phone since the last library download) are fetched one at a time
with `GET /api/v1/songs/{id}`, written into the offline copy under the file
name the server's export would use (title slug of up to eight parts plus the
first eight hex digits of the id, `.pro`; `export_filename`, tested), indexed
with `upsert_song`, added to `manifest.json`, and announced with
`library-changed`. A failed fetch is logged and that item is dropped from the
local copy of the set.

**4. Mirror.** For each server set: a local setlist that is `dirty` is kept
(it is uploaded next time); otherwise the local file is replaced by the
server's set (`server.version` from the server, items mapped through the
manifest; `blank` items become blank items, unknown kinds are dropped). Local
setlists that were uploaded before, are clean, and are no longer on the
server were deleted elsewhere and are removed. Never-uploaded setlists
(`server` absent or `version` null) are kept.

Each run that changed something emits `setlists-changed` with a
`SetSyncReport { uploaded, downloaded, conflicts[], skipped_items,
fetched_songs, unsupported }`; the console refreshes its setlists and toasts
conflicts and skipped items.

The same fetch-one-song path (`ensure_song`) is used when a leader projects a
song this PC does not have yet through the
[song server remote](remote-control.md#through-the-song-server).

## Related

- [Songs folder and app data](songs-folder.md), [VSB sync](vsb-sync.md)
  (which also writes to the server through `update_song` / `delete_song`),
  [IPC contract](ipc-contract.md), [Operator console](operator-console.md),
  [Setlists](setlists.md), [Remote control](remote-control.md)
