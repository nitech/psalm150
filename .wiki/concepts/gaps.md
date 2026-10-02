---
type: Overview
title: Gaps and backlog
description: The TODO list with status, behaviour the docs promise but the code lacks, stored-but-unused schema, and endpoints without UI — the honest map of what is half-built.
tags: [backlog, gaps, todo]
status: stable
stale_after: 2026-12-23
sources:
  - id: todo
    resource: /TODO.md
    title: Implementation plan
  - id: arch
    resource: /docs/architecture.md
    title: Target design and open decisions
  - id: phase1
    resource: /docs/phase-1.md
    title: Phase 1 deferred list
  - id: api
    resource: /api/src/api.rs
    title: What exists
  - id: remote
    resource: /api/src/remote.rs
    title: In-memory remote relay
generated: { by: agent, at: 2026-10-02T12:00:00Z }
---

# Gaps and backlog

## TODO.md, open items grouped

| Area | Open | Where it stands |
| --- | --- | --- |
| Domain | Song conflict preservation, provenance links, search languages and alternate titles | Songs have soft delete (`DELETE /songs/{id}`) but no undelete. Plans are built as [sets](sets.md), shared read-only with viewers. The rest has no schema |
| Policy | Visibility (private/unlisted/public), publication policy, attribution and licensing | Only an all-or-nothing switch: an owner can make the whole library public, read only ([auth and roles](auth-and-roles.md#public-library)). No per-song visibility, unlisted songs, publication policy or licensing |
| Sync | Offline outbox, conflicts kept for review, cross-server import, portable metadata export, migration and offline-edit upload | Phase 1 merge-then-pull only ([desktop sync](desktop-sync.md)) |
| API | Rules for compatibility and deprecation between versions; guidance for outside integrations | Only `v1` |
| Operations | TLS and reverse-proxy docs, upgrade behaviour, backup, restore and disaster recovery, release and image signing | None |
| AI | Everything under "Future AI-assisted capabilities" | Out of scope on purpose. The core must work without it |

## Design vs code

- **Conflicts** are designed to keep both versions. The code rejects a stale
  base with 409 and stores nothing
  ([songs and revisions](songs-and-revisions.md)). For sets, keeping both is
  done by the desktop, not the server: it saves its losing edit as a copy
  named "(changes from <computer>)" ([desktop sync](desktop-sync.md#sets)). The
  web client only reports the 409.
- **Live projection control** was listed in the README as not a server
  responsibility. The server now relays remote commands, but only in memory;
  the desktop still owns projection and runs without it
  ([remote control](remote-control.md)).
- **Owner vs leader** differ in the design. In the code they have the same
  powers ([auth and roles](auth-and-roles.md)).
- **Multi-architecture images** are promised. CI builds one architecture and
  publishes nothing ([build and CI](build-and-ci.md)).
- **Name**: the client and the repo folder are Psalm150, but the crate, image,
  env vars, token prefixes, the session storage key and README still say PSA150.
  The README calls the client repo `PSA150-client`.

## Behaviour gaps seen in the code

- **No logout, no session cleanup**: sign-out in the web client leaves the
  token valid, and expired sessions pile up.
- **Session in localStorage**: the web client keeps the session token where
  page scripts can read it, so it lasts across app launches. An httpOnly cookie
  would keep it out of reach of scripts, but needs server support
  ([web client](web-client.md)).
- **Offline is read-only**: the installed web client shows saved songs and
  sets offline, but edits need a connection; there is no outbox.
- **Remote relay is in memory and single-instance**: a restart forgets every
  desktop and queued command until desktops report again, and running more
  than one server process would split desktops between them
  ([remote control](remote-control.md)).
- **Sets** keep no history and cannot be undeleted. `GET /sets` has no paging
  past 500, and the web client shows only the newest 100 ([sets](sets.md)).
- **No member management**: only the setup owner exists. Viewers and extra
  leaders cannot be added, and there is no password change or reset.
- **Sign-in with several churches** always opens the oldest membership.
- **Search** is unranked `ILIKE` over the full source (chords and directives
  match). `%` and `_` are not escaped.
- **Import dedup** is by exact bytes against current revisions only.
  `filename` is ignored.
- **Export** holds the whole ZIP in memory; beyond the id manifest it carries no metadata.
- **Deleted songs** can only be restored in the database; there is no undelete
  endpoint. The web client cannot delete songs.
- **Revision history** can be listed through the API but not viewed in the web
  client, and an old revision's source cannot be fetched.
- **No rate limit** on `/session` or `/setup`.
- **OpenAPI** lists are maintained by hand, and there is no bearer security
  scheme in the document ([API contract](api-contract.md)).
- **Deleting a user** that created a device token is blocked by a foreign key
  with no cascade ([data model](data-model.md)).

## Stored or served but unused

- `users.disabled_at`: read everywhere, never set.
- `song_sets` audit columns (`created_by`, `updated_by` and the device
  twins): written, never returned.
- `churches.slug`: written at setup, never read.
- `sessions_expiry_idx`: no query uses it.
- `GET /songs/{id}/revisions`: no caller in the web client or the desktop.
