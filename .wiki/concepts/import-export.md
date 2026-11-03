---
type: Concept
title: Import and export
description: Batch ChordPro import with exact-hash dedup and per-church serialisation, append-only desktop import, and the full-library ZIP export and its filenames.
tags: [import, export, zip, dedup, portability]
status: stable
sources:
  - id: api
    resource: /api/src/api.rs
    title: import_songs, export_songs
  - id: chordpro
    resource: /api/src/chordpro.rs
    title: content_hash, export_filename
  - id: test
    resource: /api/tests/api_flow.rs
    title: Device merge (one added, one skipped)
generated: { by: agent, at: 2026-09-23T19:00:00Z }
---

# Import and export

## Import — `POST /api/v1/songs/import`

Body: `{songs: [{filename?, chordpro}]}`, with 1–500 entries and at most 64 MB.
Every entry is checked (not blank, at most 1 MB) **before** anything is
written. One bad entry rejects the whole batch with 400.

Inside one transaction:

1. `SELECT … FROM churches WHERE id = $church FOR UPDATE` serialises imports
   per church. Two desktops merging at once cannot both add the same song.
2. Load the content hashes of every current revision of every song that is not
   deleted.
3. For each entry, in order: if its hash is already in the set, add one to
   `skipped_existing`. Otherwise insert a new song and first revision, then add
   its hash to the set. So duplicates **within one batch** are also added only
   once.

Response `201 {songs: SongSummary[], skipped_existing}` lists only the songs
that were added.

Rules that matter:

- Dedup compares only against **current** revisions. Content matching an older
  revision of an edited song is imported as a new song.
- Content that differs in any byte becomes a **separate** song. There is no
  merging by title, on purpose: two songs with the same title may be different
  translations or arrangements.
- `filename` is accepted and ignored. It is not stored.
- Callers: editors (the revision records `created_by`) and desktop tokens
  (`created_by = null`). A desktop can only add songs this way.

## Export — `GET /api/v1/songs/export`

Any token. The server reads every current song that is not deleted, ordered by
title, and builds a deflate ZIP **in memory**. It returns `application/zip` with
`Content-Disposition: attachment; filename=psa150-library.zip`.

Each entry is the revision's ChordPro exactly as stored, named by
`export_filename(title, id)`. The title becomes a slug: letters and digits are
kept, with ASCII letters lowercased and other Unicode letters left as they are.
Everything else collapses to `-`, the slug keeps at most 8 words, and it falls
back to `song`. Then `-<first 8 hex of song id>.pro`. The id suffix keeps
names unique and stable while the title stays the same. Renaming a song renames
its file.

Besides the ChordPro files the archive holds `psa150-manifest.json`
(`EXPORT_MANIFEST`): `[{filename, id, revision_id, content_hash}]` for every
file, so a desktop can send edits and deletions back with a base revision.
Other metadata and provenance are not exported; the portable identity and
metadata format is still an open decision in
[/docs/architecture.md](../../docs/architecture.md).

## Used by

- The web client's **Import ChordPro** (a multi-file picker for
  `.pro,.cho,.chordpro`) and **Export** buttons ([web client](web-client.md)).
- The desktop's merge-then-pull sync ([desktop sync](desktop-sync.md)).
