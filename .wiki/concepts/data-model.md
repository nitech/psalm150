---
type: Contract
title: Data model
description: The PostgreSQL schema from migrations 0001–0011 — tables (including song_sets and song_set_items with their share links, churches.public_library and public_rooms, api_tokens, desktop room names), keys, indexes, cascade rules, church scoping — and how migrations run at startup.
tags: [postgres, schema, migrations, sqlx]
status: stable
sources:
  - id: mig
    resource: /api/migrations/0001_initial.sql
    title: Initial migration
  - id: mig3
    resource: /api/migrations/0003_desktop_auth_codes.sql
    title: Desktop sign-in codes
  - id: mig4
    resource: /api/migrations/0004_song_sets.sql
    title: Sets
  - id: mig5
    resource: /api/migrations/0005_public_library.sql
    title: Public library flag
  - id: mig7
    resource: /api/migrations/0007_api_tokens.sql
    title: API tokens
  - id: mig8
    resource: /api/migrations/0008_reusable_usernames.sql
    title: Usernames may be null
  - id: mig9
    resource: /api/migrations/0009_desktop_rooms.sql
    title: Desktop room names, churches.public_rooms
  - id: mig10
    resource: /api/migrations/0010_song_search_trigrams.sql
    title: Trigram indexes for song search
  - id: main
    resource: /api/src/main.rs
    title: sqlx::migrate! at startup, pool size
generated: { by: agent, at: 2026-10-05T18:00:00Z }
---

# Data model

PostgreSQL is the only supported database (the Compose file uses
`postgres:17-alpine`). `main.rs` opens a pool with at most 10 connections and
runs `sqlx::migrate!()`, embedded from `api/migrations/`, before it binds the
port. A failed migration stops startup. Migrations only move forward. The
design leaves rollback to a documented backup and restore, which does not
exist yet ([gaps](gaps.md)).

## Tables

| Table | Key | Purpose |
| --- | --- | --- |
| `instance_settings` | `id SMALLINT = 1` | Singleton row. Its presence means setup is done |
| `churches` | `id` | Name, unique `slug`, `public_library BOOLEAN` (default false; songs readable without a token), `public_rooms BOOLEAN` (default true; anyone may follow the church's desktops' rooms) |
| `users` | `id` | `display_name`, `username` (unique on `lower()`; null for an account removed from its last church), Argon2 `password_hash`, `disabled_at` |
| `memberships` | `(user_id, church_id)` | `role` in `owner` / `leader` / `viewer` |
| `sessions` | `token_hash CHAR(64)` | Person sessions: `church_id`, `expires_at`, `last_used_at` |
| `device_tokens` | `id` | `church_id`, `name`, unique `token_hash`, `created_by`, `last_used_at`, `revoked_at`, `room_name` (the desktop's room, null until assigned) and `room_key` (the name folded for matching) |
| `api_tokens` | `id` | A person's API tokens: `user_id`, `church_id`, `name`, `role` cap in `owner` / `leader` / `viewer`, unique `token_hash`, `created_at`, `expires_at` (null: until revoked), `last_used_at`, `revoked_at` |
| `account_links` | `id` | One-time invite and password reset links: `kind` in `invite` / `reset`, `church_id`, unique `token_hash`, `role` and `display_name` (invites), `user_id` (resets), `created_by`, `created_at`, `expires_at`, `used_at`, `revoked_at` |
| `desktop_auth_codes` | `code_hash CHAR(64)` | One-time desktop sign-in codes: `church_id`, `user_id` (the approver), `device_name`, `code_challenge` (S256), `created_at`, `expires_at` (5 minutes), `used_at` |
| `songs` | `id` | `church_id`, `current_revision_id`, `deleted_at`, `deleted_by`, `deleted_by_device` |
| `song_revisions` | `id` | `song_id`, `parent_revision_id`, the extracted `title` / `song_number` / `authors` / `language` / `song_key`, the generated `key_root SMALLINT` and `key_minor BOOLEAN`, the full `chordpro`, `content_hash CHAR(64)`, `created_by`, `created_by_device` |
| `song_recordings` | `id` | Recordings of how a song is played: `church_id`, `song_id` (with `church_id`, a foreign key to `songs(id, church_id)`, cascading), `title`, `content_type` as recorded, `duration_ms`, `byte_size`, the `audio BYTEA` itself, `created_by`, `created_at` |
| `song_videos` | `id` | YouTube videos of a song: `church_id`, `song_id` (as above), `title` (may be empty), `video_id` (11 characters), `start_seconds`, `created_by`, `created_at` |
| `song_sets` | `id` (may be client-chosen) | `church_id`, `name` (not blank), `service_date DATE`, `version INTEGER` (starts at 1), `created_by` / `created_by_device`, `updated_by` / `updated_by_device`, `created_at`, `updated_at`, `deleted_at`, `share_key` (null unless shared; unique server-wide), `share_editable BOOLEAN` (default false), `shared_at` |
| `song_set_items` | `id` | `set_id`, `position` (≥ 0, `UNIQUE (set_id, position)`), `kind` in `song` / `blank`, `song_id`, `transpose SMALLINT` (−11 to 11), `note` (at most 500 characters) |

Migration `0002_device_song_edits.sql` added the three audit columns; the
device ones reference `device_tokens(id)` with `ON DELETE SET NULL`.
Migration `0003_desktop_auth_codes.sql` added `desktop_auth_codes`
([auth and roles](auth-and-roles.md#desktop-browser-sign-in)).
Migration `0004_song_sets.sql` added `song_sets` and `song_set_items`
([sets](sets.md)). Migration `0005_public_library.sql` added
`churches.public_library` ([auth and roles](auth-and-roles.md#public-library)).
Migration `0006_desktop_song_numbers.sql` filled `song_revisions.song_number`
from the desktop's `{meta: song_num=N}` where it was empty; it changes only
the extracted column, never the ChordPro source
([songs and revisions](songs-and-revisions.md)). Migration `0007_api_tokens.sql`
added `api_tokens` ([auth and roles](auth-and-roles.md#api-tokens)).
Migration `0014_song_media.sql` added `song_recordings` and `song_videos`
([songs and revisions](songs-and-revisions.md#recordings-and-videos)). The
audio lives in PostgreSQL so the server needs nothing else and a database
backup holds it; the ZIP export does not include it.
Migration `0013_account_links.sql` added `account_links`
([auth and roles](auth-and-roles.md#invite-and-reset-links)).
Migration `0012_song_keys.sql` added `song_revisions.song_key`, filled it from
`{key: X}` (else `{meta: key=X}`) for existing revisions, and added the
immutable SQL functions `song_key_root(text)` (tonic as a pitch class, C = 0,
H read as B, a compound "D / E" by its first key, NULL when the text does not
start with a note) and `song_key_minor(text)` ("Am", "F#m7", "a-moll", "C
minor"; not "Amaj7" or "A-dur"), which fill the stored generated columns
`key_root` and `key_minor` ([songs and revisions](songs-and-revisions.md)).
Migration `0008_reusable_usernames.sql` lets `users.username` be null, so a
person removed from their last church keeps their account (disabled) while
their username is freed ([auth and roles](auth-and-roles.md#members)).
Migration `0009_desktop_rooms.sql` added `device_tokens.room_name` and
`room_key` and `churches.public_rooms`; desktops made before it get a room
name the next time they talk to the server ([rooms](rooms.md)).
Counts of wrong passwords are not stored in the database
([auth and roles](auth-and-roles.md#limits-on-wrong-passwords)).
Remote-control state, and so what a room shows, is not stored in the
database ([remote control](remote-control.md)).

`songs.current_revision_id` and `song_revisions.song_id` point at each other.
The foreign key from songs to revisions is added after both tables exist, with
`ON DELETE SET NULL`. A song row is inserted first, then its revision, then the
pointer is updated, all in one transaction.

## Church scoping

Every church-owned row reaches `church_id` directly (`songs`, `song_sets`,
`sessions`, `api_tokens`, `device_tokens`, `desktop_auth_codes`,
`memberships`), through its
song (`song_revisions`) or through its set (`song_set_items`).
`song_set_items.song_id` references `songs(id)` without a church check in the
schema; `sets.rs` checks that every song belongs to the caller's church before
it writes items.
Handlers always filter on `auth.church_id`, so a song id from another church
returns 404, not 403. `songs` also has `UNIQUE (id, church_id)` so that later
tables can reference a church-scoped song.

## Cascades

Deleting a church cascades to memberships, sessions, API tokens, device
tokens, desktop sign-in codes, songs and sets, from songs to revisions, and
from sets to their items. Deleting a song row sets `song_set_items.song_id` to
null (the item stays). Deleting a user cascades to memberships, sessions, API
tokens and desktop sign-in codes. It sets `song_revisions.created_by` and the
`song_sets` audit columns to null, but it is **blocked** by
`device_tokens.created_by`, which has no `ON DELETE` rule. No endpoint deletes
a user: `DELETE /members/{id}` deletes the membership and disables an account
left in no church. Deleting a device token sets the `*_by_device` columns to
null. `DELETE /songs/{id}` and `DELETE /sets/{id}` only set `deleted_at`, and
`POST …/restore` clears it again; no endpoint removes song or set rows.
`PUT /sets/{id}` deletes and re-inserts that set's items.

## Indexes

- `sessions_expiry_idx (expires_at)`, which nothing uses yet (no cleanup job).
- `api_tokens_church_user_idx (church_id, user_id) WHERE revoked_at IS NULL`,
  for the token list and for revoking a person's tokens.
- `device_tokens_room_key_unique (room_key) WHERE revoked_at IS NULL`: a room
  name is unique across the whole server, not per church, because a room is
  joined without naming a church; revoking a desktop frees its name.
- `desktop_auth_codes_expiry_idx (expires_at)`, likewise waiting for a cleanup
  job; used and expired codes stay in the table.
- `songs_church_idx (church_id) WHERE deleted_at IS NULL`.
- `song_revisions_song_idx (song_id, created_at DESC)`, for revision lists.
- `song_sets_church_date_idx (church_id, service_date DESC NULLS LAST,
  updated_at DESC) WHERE deleted_at IS NULL`, matching the set list order.
- `song_set_items_song_idx (song_id)`, for the `ON DELETE SET NULL` from songs.
- `song_revisions_title_lower_idx (lower(title))`, for sorting.
- Migration `0011_shared_sets.sql` adds the share columns to `song_sets` and
  the partial unique index `song_sets_share_key_unique` on `share_key`
  ([shared sets](shared-sets.md)). The key is stored as it is, not hashed.
- Migration `0010_song_search_trigrams.sql` turns on `pg_trgm` and adds GIN
  trigram indexes on `song_revisions` `title`, `authors`, `song_number` and
  `chordpro` (`*_trgm_idx`), which serve search's `%q%` `ILIKE`, plus
  `songs_current_revision_idx (current_revision_id)` to join the matching
  revisions back to their songs ([songs and revisions](songs-and-revisions.md#search)).
  They cover every revision, not only current ones; the ChordPro index is
  roughly 1.5 times the text it indexes. The database user needs to be allowed
  to create the extension (`pg_trgm` is a trusted extension, so the database
  owner may).

## Stored but unused

- The `song_sets` audit columns (`created_by`, `updated_by` and their device
  twins) are written but never returned.
- `churches.slug` is written at setup and never read.
