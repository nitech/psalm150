---
type: Concept
title: Desktop sync
description: The Phase 1 merge-then-pull protocol between the Psalm150 desktop and the server, set sync through the sets snapshot with offline-created ids and conflict copies, what the desktop token can change, and the offline guarantees.
tags: [sync, desktop, replica, offline, phase-1]
status: stable
sources:
  - id: arch
    resource: /docs/architecture.md
    title: Synchronization outline
  - id: phase1
    resource: /docs/phase-1.md
    title: Phase 1 acceptance path
  - id: api
    resource: /api/src/api.rs
    title: import_songs (device path), export_songs
  - id: sets
    resource: /api/src/sets.rs
    title: sets_snapshot, create_set (client id), update_set (base_version)
generated: { by: agent, at: 2026-11-03T08:30:00Z }
---

# Desktop sync

The server-backed desktop library is a **read-only copy** that the desktop
pulls; the operator does not edit it in the desktop. The protocol is public
calls with a `psa_d_` token ([auth and roles](auth-and-roles.md)); the only
endpoint made mainly for desktops is `GET /sets/snapshot`. A desktop linked to
a Visual Song Book database also writes VSB changes back through the song
endpoints, and every desktop keeps the church's sets in step (below).

## Connecting

The desktop first pings `GET /api/v1/info` (public) to confirm the URL is a
Psalm150 song server (`service = "psalm150-song-server"`,
`desktop_sign_in = true`). It then gets its `psa_d_` token through the
browser sign-in: the person approves the desktop in the web client and the
desktop exchanges a one-time code plus its PKCE verifier at
`POST /desktop-auth/token`
([auth and roles](auth-and-roles.md#desktop-browser-sign-in)). Pasting a token
made in the web client's **Connect desktop** dialog still works as a fallback.

## One sync

1. **Merge.** The desktop reads its remembered local ChordPro folder. It sends
   the songs to `POST /api/v1/songs/import` in batches of at most 500. The
   server adds only songs whose exact bytes are new, and reports
   `skipped_existing` ([import and export](import-export.md)).
2. **Pull.** The desktop downloads `GET /api/v1/songs/export`. It unpacks the
   ZIP into a staging directory and replaces its managed cache only after the
   whole archive has downloaded and checked out. `psa150-manifest.json`
   (`[{filename, id, revision_id, content_hash}]`) is saved beside the cache,
   never inside the songs folder.

## VSB write-back

The desktop's VSB sync turns Visual Song Book changes into server calls with
the device token: new songs through `POST /songs/import`, edits through
`PUT /songs/{id}` and deletions through `DELETE /songs/{id}`, each with the
`revision_id` from the manifest as base. A song edited on the server in the
meantime answers 409 and the server version wins. The desktop then pulls
again and relinks. Details live in the desktop wiki (`concepts/vsb-sync.md`).

Connecting for the first time and pressing sync later both run the same two
steps. The original local folder is never changed. The desktop keeps it as the
path to return to when the server is disconnected.

The client side lives in the desktop app (`desktop/` in this monorepo), in
`desktop/src-tauri/src/commands/server_library.rs`. It checks the URL (http/https, a
host, no credentials), applies a 10 s connect and 120 s request timeout, and
caps the size of the export download. The client's own wiki covers its
settings and cache.

## Sets

In a server library the desktop's setlists mirror the church's sets, with the
same ids ([sets](sets.md)). The client side is
`src-tauri/src/commands/server_sets.rs` in the client repo. It runs after a
library sync, after each local setlist change, and every 60 s while
connected:

1. **Upload.** Each local setlist changed since its last upload (or never
   uploaded) is sent with the device token. One the server has seen goes to
   `PUT /sets/{id}` with its `base_version`. A new one, possibly made offline,
   goes to `POST /sets` with its own `id`, so a retried upload cannot create a
   second set. Song items refer to server song ids from the export manifest;
   items whose song has no server id are left out and counted.
2. **Conflict.** A 409 (someone changed the set first) or 404 (deleted
   elsewhere) does not overwrite anything. The desktop keeps the server's
   version under the set's id and saves its own edit as a new local set named
   "<name> (changes from <computer>)" with fresh item ids, which goes up as a
   new set at the next pass. The server itself stores nothing on a 409.
3. **Download.** `GET /sets/snapshot` returns every live set with items. Song
   ids the desktop does not have yet (added on a phone since the last library
   download) are fetched one by one with `GET /songs/{id}`, written to the
   offline folder, indexed and added to the manifest. Clean local setlists are
   replaced by the server's; ones with unsent edits are kept. A setlist that
   was uploaded before and is no longer in the snapshot was deleted elsewhere
   and is removed.

A server without sets answers 404 (or 405 through a proxy) on the snapshot;
the desktop then reports sets as unsupported and keeps its local setlists.

## Guarantees

- **Offline projection.** The last valid cache opens at startup and projects
  without the server. The server is never needed to advance slides or blank the
  screen.
- **No silent overwrite.** Desktop edits and deletions name their base
  revision; a newer server edit is a 409. Revisions are immutable and deletes
  are soft, so a device change can be traced (`created_by_device`,
  `deleted_by_device`) and undone in the database. A revoked token stops
  immediately.
- **The merge step only adds.** A local song that differs from its server
  version by even one byte is uploaded again as a **separate** song.
- **Sets are never overwritten silently.** A stale set upload is a 409; the
  desktop keeps both versions, the server keeps only its own.
- **PostgreSQL is canonical** once a desktop is connected.

## Known consequences

- Hash dedup is by bytes, so a local file that differs from the server copy
  only in line endings or a trailing newline becomes a duplicate on the server.
  Each later sync then adds any new local edit as yet another song. A church
  that edits on the server should stop editing the local folder.
- Servers before the manifest send no ids; a desktop then cannot send VSB
  edits or deletions and reports them as waiting.

## Later phases (designed, not built)

An offline outbox with base revisions, conflicts kept for review instead of
409s, deletions, and batching. See the synchronisation outline in
[/docs/architecture.md](../../docs/architecture.md) and [gaps](gaps.md).
