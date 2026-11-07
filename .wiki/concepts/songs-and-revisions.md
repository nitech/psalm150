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
generated: { by: agent, at: 2026-10-23T12:10:00Z }
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
| `song_number` | `number`, `song_number`, then the desktop's `{meta: song_num=N}` | The first `number`/`song_number` wins; `song_num` (key matched ignoring case) only when neither is present. Migration `0006_desktop_song_numbers.sql` filled it in for revisions stored before `song_num` was read. **A song created without one** (`POST /songs`) gets the church's highest number (leading digits, deleted songs included so a restored one keeps its own) plus one, added under `{title}` as `{meta: song_num=N}` (`chordpro::with_song_number`), under the church's row lock so two new songs never share it. Imports (`POST /songs/import`) are stored as they come |
| `language` | `language`, `lang` | The first one wins |
| `song_key` | `key`, then `{meta: key=X}` | The first `key` wins; the `meta` form only when there is none. Kept as written (`G`, `F#m`, `D / E`); the database reads its tonic and major/minor into `key_root` and `key_minor` (migration 0012) |
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

`GET /songs?q=` trims `q` (at most 200 characters, else 400). When `q`,
normalized by `normalize_search` (lowercase, accents dropped so `e` and `é`
match while `å` stays a letter of its own, apostrophes dropped so `It’s`
and `It's` are `its`, other punctuation a space), has a run of at least three
letters or digits, it is matched as a substring of the current revision's
`search_text` (migrations 0017 and 0018): title, authors, number and the lyrics without
chords or directives, normalized the same way by `song_search_text`. So a
line matches across the chords in it, and a chord name or directive does not.
When nothing matches, the search is retried with pg_trgm word similarity
(`search_text %> q`, threshold 0.5 set per transaction) ordered by similarity,
so `alredy done` or `vison` still find the song; an earlier page that matched
as written keeps later pages exact. A shorter search matches `%q%`
case-insensitively against `title`, `authors` and `song_number` only, since
the trigram index cannot look it up and it would match nearly every song's
lyrics; there `%`, `_` and `\` match themselves (`escape_like`). Each shape
is its own statement, so the database plans each separately. Exact results
are unranked.

`sort=title` (default) orders by `lower(title)`; `sort=number` by
the number's leading digits as an integer ("9" before "10", "12a" with 12),
then the number as text, with songs without a number last in both
directions. `sort=key` orders by the key's tonic from C to B (C# and Db
together), major before minor, songs without a readable key last in both
directions. `direction=asc|desc` (default `asc`) flips the chosen column only;
ties go by title A to Z, then newest, then song id, so the order is stable.
An unknown `sort` or `direction` is a 400. `key=G,D` keeps songs whose
tonic is one of those (read by the same `song_key_root` that fills the
column, so `C#` finds `Db`), and `key_mode=major|minor` keeps one mode; both
combine with `q` and any sort. `GET /songs/keys` counts the songs per tonic
and mode, so a client can offer only keys that find songs. `/public/songs`
(and `/public/songs/keys`) take the same parameters. `limit` defaults to 100 and is clamped to 1–200; `offset` (default 0,
negative counts as 0) skips that many rows, so a client pages with
`limit`/`offset`. The web client loads 100 at a time as you scroll
([web client](web-client.md)).

## Not built

Provenance links (translation, arrangement, fork…), alternate titles,
language-aware search, purging deleted songs, and a one-step revert to a past
revision. Revisions do not say who saved them, though `created_by` and
`created_by_device` are stored. See [gaps](gaps.md) and `/TODO.md`.

## History

`GET /songs/{id}/revisions` lists every revision newest first with
`created_by_name` (the person, or the desktop, that saved it; none for an
import). The shared `song-history.ts` (web: ⋮ → History on a song; desktop:
the history button for a server library song) lists them, shows for the one
chosen the lines that differ (`line-diff.ts`) from the current version ("what
restoring would change") or from the version before it ("what this save
changed"), and **Restore this version** saves that text again as a new
revision on top of the current one (`PUT /songs/{id}`), so nothing is lost.
The window keeps one size; the versions are a timeline, each with a short
note made from what changed (`song-changes.ts` `describeChange`: "Chords in
Chorus", "Transposed G → A", "Added Bridge", "Restored 3 days ago" for a text
equal to an older version's) and a graph drawn from `parent_revision_id`
(`revisionGraph`): one lane while versions follow each other, a lane of its
own for a version saved on top of an older one, joining where they share it.

## Favourites

Each person keeps their own favourite songs (`song_favorites`, migration
0020; `api/src/favorites.rs`): `GET /favorites` lists them oldest first,
`PUT /favorites` sets them all in order, `PUT`/`DELETE /favorites/{song_id}`
change one, and `GET /songs?favorites=true` keeps only them. A desktop token
acts for the person who connected the desktop (`device_tokens.created_by`).
A deleted song drops out of the list; purging it removes the row.

## Drafts

Changes are never lost in the web editor: what a leader or owner types is
kept on the server as their draft (`song_drafts`, migration 0021;
`api/src/drafts.rs`), one per song and person, plus one new song not in the
library yet (`/drafts/new`, `song_id` null; `UNIQUE NULLS NOT DISTINCT`).
`GET /drafts` lists them newest first (title, no text); `GET`, `PUT` and
`DELETE /drafts/{song_id}` (or `/drafts/new`) read, keep (replacing) and
discard one. `PUT` takes `{base_revision_id, chordpro}`: the revision being
changed, required for a song in the library. Only people who edit songs
(`require_editor`) have drafts; desktops do not. Saving the song
(`PUT /songs/{id}`) removes the saver's draft of it in the same transaction;
a deleted song's draft is hidden, and purging the song removes it.

The editor (`songEditor` in `web/src/views/songs.ts`) keeps the text every
2 seconds when it changed, and as you leave: the router calls `onLeave`
handlers (`web/src/context.ts`) before loading the next screen, and
`pagehide` / a hidden page send it with `keepalive`. Reading a draft waits for
a keep in flight. Opened again, the editor starts from the draft with a note
(and Discard), and saves against the draft's `base_revision_id`, so a song
saved by someone else since answers 409 instead of being overwritten. The
song page shows the same note with Continue editing and Discard.

## Recordings

A song can carry recordings of how it is played (`api/src/song_media.rs`).
Anyone signed in to the church, desktops included, lists them
(`GET /songs/{id}/recordings`) and plays them
(`GET /songs/{id}/recordings/{recording_id}/audio`, or a six-hour play link
from `POST …/link` for an `<audio>` element); leaders, owners and desktops
(`require_song_editor`) record and remove them. A desktop's recording stores
`created_by_device` (migration `0019_desktop_recordings.sql`) instead of a
person, and `created_by_name` is then the desktop's name.

* A recording is the audio exactly as the browser made it (WebM/Opus in
  Chrome and Firefox, MP4/AAC in Safari), at most 40 MB, kept as a file
  under the media directory (`PSA150_MEDIA_DIR`), with its `Content-Type`
  and size in `song_recordings`. Uploads stream to disk through a `.part`
  file that is renamed when whole; reads stream from disk and answer
  `Range`, so playing starts at once and seeking works. The server never
  decodes or converts the audio. Removing a recording removes its file.
* A song keeps at most 20. They are not revisions: adding or
  removing one does not change the song's revision or content hash, so it
  never touches desktop sync.
* Soft-deleting a song hides its recordings (their audio answers 404) and
  restoring brings them back; purging the song removes them (cascade).
* Not in the ZIP export or the public library ([gaps](gaps.md)).

A song's YouTube video is not a recording but song metadata:
`{meta: youtube <link>}` in its ChordPro, set in the editor's details. It is
part of the revision, so it goes with the song in exports and to desktops.
The server does not read it; the web client shows it only when it is a
YouTube link.
