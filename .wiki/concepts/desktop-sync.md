---
type: Concept
title: Desktop sync
description: The Phase 1 merge-then-pull protocol between the Psalm150 desktop and the server — what each side does, what the desktop token can change, and the offline guarantees.
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
generated: { by: agent, at: 2026-09-23T19:00:00Z }
---

# Desktop sync

The server-backed desktop library is a **read-only copy** that the desktop
pulls; the operator does not edit it in the desktop. The server has no
sync-specific endpoint. The protocol is public calls with a `psa_d_` token
([auth and roles](auth-and-roles.md)). A desktop linked to a Visual Song Book
database also writes VSB changes back through the song endpoints (below).

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

The client side lives in the `PSA150` desktop repo, in
`src-tauri/src/commands/server_library.rs`. It checks the URL (http/https, a
host, no credentials), applies a 10 s connect and 120 s request timeout, and
caps the size of the export download. The client's own wiki covers its
settings and cache.

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
