---
type: Concept
title: Songs and revisions
description: Songs as raw ChordPro with immutable revisions, what metadata the server extracts, the exact-bytes content hash, optimistic conflict detection with 409, reading any revision, deleting and restoring songs, and how search matches.
tags: [songs, revisions, chordpro, conflicts, search]
status: stable
sources:
  - id: chordpro
    resource: /api/src/chordpro.rs
    title: metadata(), content_hash(), export_filename()
  - id: api
    resource: /api/src/api.rs
    title: create_song, update_song, lock_song, insert_revision, list_songs, get_revision, list_deleted_songs, restore_song
  - id: test
    resource: /api/tests/api_flow.rs
    title: private_library_flow (create, update, stale 409, search), deleted_songs_and_sets_come_back
  - id: arch
    resource: /docs/architecture.md
    title: Revision history vs provenance (design)
generated: { by: agent, at: 2026-10-05T10:00:00Z }
---

# Songs and revisions

A **song** is a stable id owned by one church. It points at its current
**revision**. A revision is an immutable snapshot of the full ChordPro source,
plus metadata pulled from it and a content hash. The server stores the source
exactly as sent and never rewrites it.

## Extracted metadata

`chordpro::metadata` scans the **first 100 lines** for `{name: value}`
directives. A line must be only the directive once trimmed. Names are
case-insensitive.

| Field | Directives | Rule |
| --- | --- | --- |
| `title` | `title`, `t` | The first one wins. Blank or missing becomes `Untitled song` |
| `song_number` | `number`, `song_number`, then the desktop's `{meta: song_num=N}` | The first `number`/`song_number` wins; `song_num` (key matched ignoring case) only when neither is present. Migration `0006_desktop_song_numbers.sql` filled it in for revisions stored before `song_num` was read |
| `language` | `language`, `lang` | The first one wins |
| `authors` | `artist`, `composer`, `lyricist`, `author` | All distinct values, joined with `", "` |

The server does not parse sections, chords or lyrics. That is the desktop's
ChordPro dialect (the client wiki's ChordPro dialect page). The web client's
lyric preview strips directive lines and `[chords]` itself
([web client](web-client.md)).

## Content hash

`content_hash` is the SHA-256 of the exact UTF-8 bytes, as hex. CRLF and LF, a
trailing newline, or a changed case all give a different hash. That is on
purpose: import dedup counts a song as "already there" only when it is
byte-for-byte identical ([import and export](import-export.md)).

## Creating and editing

- `POST /songs` (editor or desktop) inserts a song and its first revision
  (`parent_revision_id = null`) in one transaction.
- `PUT /songs/{id}` (editor or desktop) takes `{base_revision_id, chordpro}`. In one
  transaction it locks the song row (`SELECT … FOR UPDATE`, scoped to the
  church and to songs that are not deleted). It compares `current_revision_id`
  with the base:
  - They match: insert a revision whose parent is the old current revision,
    then move the pointer. Returns the new `SongDetail`.
  - They differ: `409` with the message `song changed since revision X; current
    revision is Y`. **Nothing is stored.** The client must reload and reapply
    its edit.
- `DELETE /songs/{id}` (editor or desktop) locks the song the same way and,
  when `?base_revision_id=` is given and stale, answers 409. Otherwise it sets
  `deleted_at` and the deleting person or device. Deleted songs disappear from
  lists, reads, revision reads and the export, but nothing is removed.
- `GET /songs/deleted?limit=&offset=` (any token) lists deleted songs as they
  were (`{id, revision_id, title, song_number, authors, language,
  deleted_at}`), most recently deleted first. `POST /songs/{id}/restore`
  (editor or desktop) clears `deleted_at`, `deleted_by` and
  `deleted_by_device` and returns the `SongDetail`; the song comes back with
  its whole history. Restoring a live song changes nothing and returns it; an
  unknown id is 404. Restoring does not check for duplicates, so a restored
  song can match the content of a live one.
- The revision history is linear. `GET /songs/{id}/revisions` returns
  `{id, parent_revision_id, title, content_hash, created_at}` newest first,
  without the source. `GET /songs/{id}/revisions/{revision_id}` returns one
  revision in full (`RevisionDetail`: the extracted metadata, `chordpro`,
  `content_hash`, `created_at`, `song_id`); 404 when it belongs to another
  song. Going back to an old revision is an ordinary `PUT` of its source,
  based on the current revision.

The design in [/docs/architecture.md](../../docs/architecture.md) says a stale
offline edit should **keep both versions** for review, not reject one. That
conflict store does not exist yet. Today's 409 is the groundwork for it
([gaps](gaps.md)).

## Search

`GET /songs?q=` trims `q` and matches `%q%` case-insensitively against the
current revision's `title`, `authors`, `song_number` and the **full ChordPro
source**. So a lyric line matches, but so does a chord name or a directive.
`%` and `_` in the query are not escaped and act as wildcards. Results are
unranked. `sort=title` (default) orders by `lower(title)`; `sort=number` by
the number's leading digits as an integer ("9" before "10", "12a" with 12),
then the number as text, with songs without a number last in both
directions. `direction=asc|desc` (default `asc`) flips the chosen column only;
ties go by title A to Z, then newest, then song id, so the order is stable.
An unknown `sort` or `direction` is a 400. `/public/songs` takes the same
parameters. `limit` defaults to 100 and is clamped to 1–200; `offset` (default 0,
negative counts as 0) skips that many rows, so a client pages with
`limit`/`offset`. The web client loads 100 at a time as you scroll
([web client](web-client.md)).

## Not built

Provenance links (translation, arrangement, fork…), alternate titles,
language-aware search, purging deleted songs, and a one-step revert to a past
revision. Revisions do not say who saved them, though `created_by` and
`created_by_device` are stored. See [gaps](gaps.md) and `/TODO.md`.
