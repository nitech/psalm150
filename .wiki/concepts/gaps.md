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
generated: { by: agent, at: 2026-09-23T19:00:00Z }
---

# Gaps and backlog

## TODO.md, open items grouped

| Area | Open | Where it stands |
| --- | --- | --- |
| Domain | Song deletion semantics, provenance links, plans, search languages and alternate titles | `songs.deleted_at` exists but has no endpoint. The rest has no schema |
| Policy | Visibility (private/unlisted/public), publication policy, attribution and licensing | Nothing built. Every song is private to its church |
| Sync | Offline outbox, conflicts kept for review, cross-server import, portable metadata export, migration and offline-edit upload | Phase 1 merge-then-pull only ([desktop sync](desktop-sync.md)) |
| API | Rules for compatibility and deprecation between versions; guidance for outside integrations | Only `v1` |
| Operations | TLS and reverse-proxy docs, upgrade behaviour, backup, restore and disaster recovery, release and image signing | None |
| AI | Everything under "Future AI-assisted capabilities" | Out of scope on purpose. The core must work without it |

## Design vs code

- **Conflicts** are designed to keep both versions. The code rejects a stale
  base with 409 and stores nothing
  ([songs and revisions](songs-and-revisions.md)).
- **Owner vs leader** differ in the design. In the code they have the same
  powers ([auth and roles](auth-and-roles.md)).
- **Multi-architecture images** are promised. CI builds one architecture and
  publishes nothing ([build and CI](build-and-ci.md)).
- **Name**: the client and the repo folder are Psalm150, but the crate, image,
  env vars, token prefixes, `sessionStorage` key and README still say PSA150.
  The README calls the client repo `PSA150-client`.

## Behaviour gaps seen in the code

- **No logout, no session cleanup**: sign-out in the web client leaves the
  token valid, and expired sessions pile up.
- **No member management**: only the setup owner exists. Viewers and extra
  leaders cannot be added, and there is no password change or reset.
- **Sign-in with several churches** always opens the oldest membership.
- **Search** is unranked `ILIKE` over the full source (chords and directives
  match). `%` and `_` are not escaped. The web client shows only the first 100
  results with no paging.
- **Import dedup** is by exact bytes against current revisions only.
  `filename` is ignored.
- **Export** holds the whole ZIP in memory; beyond the id manifest it carries no metadata.
- **Deleted songs** can only be restored in the database; there is no undelete endpoint.
- **Revision history** can be listed through the API but not viewed in the web
  client, and an old revision's source cannot be fetched.
- **No rate limit** on `/session` or `/setup`.
- **OpenAPI** lists are maintained by hand, and there is no bearer security
  scheme in the document ([API contract](api-contract.md)).
- **Deleting a user** that created a device token is blocked by a foreign key
  with no cascade ([data model](data-model.md)).

## Stored or served but unused

- `songs.deleted_at`, `users.disabled_at`: read everywhere, never set.
- `churches.slug`: written at setup, never read.
- `sessions_expiry_idx`: no query uses it.
- `GET /songs/{id}/revisions`: no caller in the web client or the desktop.
