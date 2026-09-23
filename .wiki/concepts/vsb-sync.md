---
type: Concept
title: VSB sync
description: Two-way synchronisation between the active library (local folder or song-server replica) and a linked Visual Song Book .mdb — change detection, pairing, conflict rule, safety rails, triggers and the Access driver requirement.
tags: [vsb, mdb, sync, access, odbc, legacy]
status: stable
sources:
  - id: sync
    resource: /src-tauri/src/vsb_sync/mod.rs
    title: Run loop, state file, report, backups, fingerprint
  - id: plan
    resource: /src-tauri/src/vsb_sync/plan.rs
    title: Three-way planner and first-contact pairing (unit tested)
  - id: fields
    resource: /src-tauri/src/vsb_sync/fields.rs
    title: ChordPro to VSB row fields, Search column, row hash
  - id: writer
    resource: /src-tauri/src/vsb_sync/writer.rs
    title: Access ODBC writer (Windows)
  - id: cmd
    resource: /src-tauri/src/commands/vsb_sync_cmd.rs
    title: set_vsb_database, sync_vsb_database, background thread
  - id: test
    resource: /src-tauri/tests/vsb_sync.rs
    title: ODBC round trip on a copy of the sample database
generated: { by: agent, at: 2026-09-23T19:00:00Z }
---

# VSB sync

Settings, **Visual Song Book**, **Link VSB database…** remembers one `.mdb`
(`config.vsb_sync`) and keeps it in step with whatever library is active,
local folder or [song server](songs-folder.md) replica. It complements the
one-shot [MDB import](mdb-import.md).

## Reading and writing

Rows are read with `jetdb` (pure Rust, read-only). Writes go through the
**Microsoft Access ODBC driver** (`odbc-api`, Windows only), so they need the
64-bit Access Database Engine that ships with Office or as Microsoft's free
redistributable. Without it the connection fails with `IM002`; the run still
applies VSB-side changes to Psalm150 and lists the rest as waiting.

Driver quirks the writer handles: optional text columns are written as `""`
(VSB marks `Copyright` required), and text over 255 UTF-16 units is bound as
`SQL_WLONGVARCHAR` (the driver rejects long `WVARCHAR` with "Invalid precision
value"). `Modified = Now()` on every write; `Search` is rebuilt the way VSB
fills it (upper-cased title plus the first line of each stanza). A new row
takes `SongNum` from the song, or `MAX(SongNum) + 1`.

`fields_from_song` is the reverse of `vsb_to_chordpro`: stanzas separated by
blank lines, `chorus` / `chorus 2` / `bridge` / `intro` / `verse N` header
lines, chords on a row above the lyric at their column. Round trips are
unit tested. Tags, CCLI, base song and arrangement survive a VSB-side edit
because they are copied from the existing file.

## Change detection

`libraries/<hash>/vsb-sync.json` holds `{ mdb_path, links[] }`, one link per
paired song: `song_id`, `filename`, and the row and file hashes after the
last run. The row hash covers title, number, key, author, copyright,
category and body with line endings and trailing spaces normalised. After
writing rows the database is re-read, so the hash is what the driver stored.

| Row vs link | File vs link | Action |
| --- | --- | --- |
| same | same | nothing |
| changed | same | rewrite the file (`replace_song`, recovery copy kept) |
| same | changed | update the row |
| changed | changed | **Psalm150 wins**: update the row, count a conflict (skipped if the converted row already equals the file) |
| gone | same | delete the file (recoverable) |
| gone | changed | insert the row again |
| same | gone | delete the row |
| changed | gone | create the file again |

A link follows a renamed file by the server's stable `-xxxxxxxx.pro` id
suffix, then by `{meta: vsb_song_id}`.

**First contact** (no link): rows and files pair by `vsb_song_id`, then by
title plus song number when that pair is unique on both sides. Identical
pairs (converted row equals the file) link quietly; differing pairs link
**without changing either side** and are counted as `differing`. Unpaired
rows become files; unpaired files become rows.

## Safety rails

- The database is copied to `app_data_dir/vsb-backups/<name>-<timestamp>.mdb`
  before the first write of a run; the newest 10 are kept.
- A run aborts without changes when the database or folder is empty while
  links exist, or when it would delete more than 10 songs and more than half
  of the links.
- One run at a time (`RUNNING` flag); skipped while an MDB import runs.
- Read-only libraries do not receive file writes; those changes wait.

## With a song server

The replica is read-only for the operator, but the desktop token may create,
edit and delete songs on the server (server migration 0002 and later). The
export's `psa150-manifest.json`, saved as `server-libraries/<hash>/manifest.json`
beside the cache, maps each replica file to its server song and revision.
Library-side changes become `ServerOp`s:

| VSB change | Server call |
| --- | --- |
| new song | `POST /songs/import` (exact duplicates skipped) |
| edited song | `PUT /songs/{id}` with the manifest revision as base |
| deleted song | `DELETE /songs/{id}?base_revision_id=` |

Their links stay as they were until the replica has been downloaded again and
a second pass relinks, so a failed request is retried on the next run. A 409
(edited on the server meanwhile) is reported and the server version then wins
as a Psalm150-side change. A file missing from the manifest (older server)
waits. Because re-downloading reopens the library and closes projection
windows, a server-library sync is skipped while a projection session is
active and retried a minute later.

## Triggers and UI

- A background thread runs a full comparison 5 s after launch, then every
  60 s compares a cheap fingerprint (size and mtime of the `.mdb` and every
  song file) and only runs when it changed.
- The sync icon in the right toolbar group (shown when linked) and
  **Synchronize now** in Settings force a run.
- Work runs on blocking threads; the state lock is held only to read the
  context and to reindex. Events: `vsb-sync-progress { label, current, total }`
  drives a 2 px bar along the bottom of the app bar and a spinning icon;
  `vsb-sync-finished { report, error }` updates `config.vsb_sync.last_*` and
  toasts only when something moved or failed.

## Related

- [MDB import](mdb-import.md), [ChordPro dialect](chordpro-dialect.md)
- [Operator console](operator-console.md), [IPC contract](ipc-contract.md)
