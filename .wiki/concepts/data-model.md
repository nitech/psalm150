---
type: Contract
title: Data model
description: The PostgreSQL schema from migrations 0001–0006 — tables (including song_sets and song_set_items, and churches.public_library), keys, indexes, cascade rules, church scoping — and how migrations run at startup.
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
  - id: main
    resource: /api/src/main.rs
    title: sqlx::migrate! at startup, pool size
generated: { by: agent, at: 2026-10-03T10:00:00Z }
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
| `churches` | `id` | Name, unique `slug`, `public_library BOOLEAN` (default false; songs readable without a token) |
| `users` | `id` | `display_name`, `username` (unique on `lower()`), Argon2 `password_hash`, `disabled_at` |
| `memberships` | `(user_id, church_id)` | `role` in `owner` / `leader` / `viewer` |
| `sessions` | `token_hash CHAR(64)` | Person sessions: `church_id`, `expires_at`, `last_used_at` |
| `device_tokens` | `id` | `church_id`, `name`, unique `token_hash`, `created_by`, `last_used_at`, `revoked_at` |
| `desktop_auth_codes` | `code_hash CHAR(64)` | One-time desktop sign-in codes: `church_id`, `user_id` (the approver), `device_name`, `code_challenge` (S256), `created_at`, `expires_at` (5 minutes), `used_at` |
| `songs` | `id` | `church_id`, `current_revision_id`, `deleted_at`, `deleted_by`, `deleted_by_device` |
| `song_revisions` | `id` | `song_id`, `parent_revision_id`, the extracted `title` / `song_number` / `authors` / `language`, the full `chordpro`, `content_hash CHAR(64)`, `created_by`, `created_by_device` |
| `song_sets` | `id` (may be client-chosen) | `church_id`, `name` (not blank), `service_date DATE`, `version INTEGER` (starts at 1), `created_by` / `created_by_device`, `updated_by` / `updated_by_device`, `created_at`, `updated_at`, `deleted_at` |
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
([songs and revisions](songs-and-revisions.md)). Remote-control state is not stored in the database
([remote control](remote-control.md)).

`songs.current_revision_id` and `song_revisions.song_id` point at each other.
The foreign key from songs to revisions is added after both tables exist, with
`ON DELETE SET NULL`. A song row is inserted first, then its revision, then the
pointer is updated, all in one transaction.

## Church scoping

Every church-owned row reaches `church_id` directly (`songs`, `song_sets`,
`sessions`, `device_tokens`, `desktop_auth_codes`, `memberships`), through its
song (`song_revisions`) or through its set (`song_set_items`).
`song_set_items.song_id` references `songs(id)` without a church check in the
schema; `sets.rs` checks that every song belongs to the caller's church before
it writes items.
Handlers always filter on `auth.church_id`, so a song id from another church
returns 404, not 403. `songs` also has `UNIQUE (id, church_id)` so that later
tables can reference a church-scoped song.

## Cascades

Deleting a church cascades to memberships, sessions, device tokens, desktop
sign-in codes, songs and sets, from songs to revisions, and from sets to their
items. Deleting a song row sets `song_set_items.song_id` to null (the item
stays). Deleting a user cascades to memberships, sessions and desktop sign-in
codes. It sets `song_revisions.created_by` and the `song_sets` audit columns
to null, but it is **blocked** by `device_tokens.created_by`, which has no
`ON DELETE` rule. Deleting a device token sets the `*_by_device` columns to
null. `DELETE /songs/{id}` and `DELETE /sets/{id}` only set `deleted_at`; no
endpoint removes rows. `PUT /sets/{id}` deletes and re-inserts that set's
items.

## Indexes

- `sessions_expiry_idx (expires_at)`, which nothing uses yet (no cleanup job).
- `desktop_auth_codes_expiry_idx (expires_at)`, likewise waiting for a cleanup
  job; used and expired codes stay in the table.
- `songs_church_idx (church_id) WHERE deleted_at IS NULL`.
- `song_revisions_song_idx (song_id, created_at DESC)`, for revision lists.
- `song_sets_church_date_idx (church_id, service_date DESC NULLS LAST,
  updated_at DESC) WHERE deleted_at IS NULL`, matching the set list order.
- `song_set_items_song_idx (song_id)`, for the `ON DELETE SET NULL` from songs.
- `song_revisions_title_lower_idx (lower(title))`, for sorting. Search uses
  leading-wildcard `ILIKE`, which this index cannot serve
  ([songs and revisions](songs-and-revisions.md#search)).

## Stored but unused

- The `song_sets` audit columns (`created_by`, `updated_by` and their device
  twins) are written but never returned.
- `users.disabled_at` is honoured at sign-in and on every session check, but
  nothing sets it.
- `churches.slug` is written at setup and never read.
