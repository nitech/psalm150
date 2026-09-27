---
type: Concept
title: Sets
description: Church sets (ordered song lists for one service) — the endpoints, item rules and limits, the version check with 409, soft delete, deleted songs inside a set, and who may change them.
tags: [sets, services, conflicts, desktop]
status: stable
sources:
  - id: sets
    resource: /api/src/sets.rs
    title: Set handlers, validation, version check
  - id: models
    resource: /api/src/models.rs
    title: SetItemKind, SetItemInput, CreateSetRequest, UpdateSetRequest, SetSummary, SetItem, SetDetail
  - id: mig4
    resource: /api/migrations/0004_song_sets.sql
    title: song_sets, song_set_items
  - id: test
    resource: /api/tests/api_flow.rs
    title: sets_flow
  - id: websets
    resource: /web/src/views/sets.ts
    title: Set list, editor and service view
generated: { by: agent, at: 2026-09-27T12:00:00Z }
---

# Sets

A **set** is an ordered list of items for one service, shared by the whole
church. It has a `name` (1–200 characters after trimming), an optional
`service_date` (`YYYY-MM-DD`), a `version` and its items. Everyone signed in
to the church reads sets, including viewers and desktops. Owners, leaders and
desktop tokens change them (`require_song_editor`,
[auth and roles](auth-and-roles.md)). The design called these "plans"; the
code and the UI say "sets".

## Items

| Field | Rule |
| --- | --- |
| `id` | Optional on input. Keeps an item's identity across edits; the server assigns one when absent. Ids must be unique within the request and across all sets (a clash is 400 `set item ids must be unique`) |
| `kind` | `song` or `blank` (an empty screen for prayer, a reading or announcements) |
| `song_id` | Required for `song`, forbidden for `blank`. Every song must belong to the caller's church and not be deleted, otherwise 400 `a set can only contain songs from this library` |
| `transpose` | Semitones, −11 to 11. Default 0 |
| `note` | Free text for the team, at most 500 characters, trimmed on save. Default empty |

A set holds at most 200 items (`MAX_SET_ITEMS`). Items are stored in request
order (`position` 0, 1, 2 …).

On read, each item carries `song: {revision_id, title, song_number, authors}`
from the song's **current** revision. A song deleted after it was added stays
in the set with its `song_id`, but `song` is `null`. The web client shows it
as "Deleted song". A set does not pin a revision: an edited song shows its new
text.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sets?from=&limit=` | `SetSummary[]` (`item_count`, no items). `from` keeps sets on or after that day plus every set without a date. `limit` defaults to 100, clamped to 1–500. Sorted by `service_date` descending (no date last), then `updated_at` descending |
| GET | `/sets/snapshot` | Every set of the church with its items (`SetDetail[]`), same order, no limit. What a desktop keeps offline |
| POST | `/sets` | Body `{id?, name, service_date?, items?}`. 201 `SetDetail` at `version` 1. A client-chosen `id` lets a desktop create a set offline and upload it once; an id that already exists (in any church, deleted or not) is 409 `a set with this id already exists` |
| GET | `/sets/{id}` | `SetDetail`. 404 when missing, deleted or in another church |
| PUT | `/sets/{id}` | Body `{base_version, name, service_date, items}`. Replaces name, date and **all** items; `version` goes up by one |
| DELETE | `/sets/{id}?base_version=` | Soft delete (`deleted_at`). `base_version` is optional; when given and stale, 409. 204 on success |

## Conflicts

`PUT` and `DELETE` lock the set row (`SELECT version … FOR UPDATE`, scoped to
the church and to sets that are not deleted) before comparing versions. A
stale `base_version` is 409
`set changed since version X; current version is Y` and nothing is stored.
This is the same rule as song revisions
([songs and revisions](songs-and-revisions.md)), but sets keep no history: the
server keeps only the current items.

What each client does with a 409:

- **Web client**: the set editor keeps the form and says "Someone else saved
  this set while you were editing", with a link to the current version.
  "Add to a set" on a song page asks the user to try again. Deleting asks for
  a reload.
- **Desktop**: keeps the server's version under the set's id and saves its own
  edit as a new local set named "<name> (changes from <computer>)", with new
  item ids, uploaded at the next sync. A 404 (deleted elsewhere) is handled
  the same way ([desktop sync](desktop-sync.md#sets)).

## Audit

`created_by` / `created_by_device` and `updated_by` / `updated_by_device`
record the person or desktop that made the change (both are set on create).
They are stored but not returned by any endpoint.

## Not built

- No history or restore of earlier versions, and no undelete endpoint.
- No per-set sharing or visibility: every set is visible to the whole church.
- No paging past `limit` in `GET /sets`; the web client never sends `from` or
  `limit`, so it shows the newest 100.
