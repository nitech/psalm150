---
type: Overview
title: Psalm150 Song Server
description: The way into the Song Server wiki — what the server is for, how its two halves fit, the data flow from desktop folder to PostgreSQL and back, sets, the remote relay and rooms, API tokens and members, and the rules that keep it safe.
tags: [overview, architecture]
status: stable
sources:
  - id: readme
    resource: /README.md
    title: README (mission, principles, library authority)
  - id: arch
    resource: /docs/architecture.md
    title: Architecture (target design, including unbuilt parts)
  - id: phase1
    resource: /docs/phase-1.md
    title: Phase 1 scope and acceptance path
  - id: lib
    resource: /api/src/lib.rs
    title: Router assembly, AppState, static web fallback
  - id: api
    resource: /api/src/api.rs
    title: Every handler and the OpenAPI document
generated: { by: agent, at: 2026-10-23T09:30:00Z }
---

# Psalm150 Song Server

The Song Server is an optional, self-hosted, API-first song library for one
church. It gives a church a shared, revisioned library in PostgreSQL. The
Psalm150 desktop app (the separate `PSA150` client repo) can use it as a
**server-backed library** instead of a local ChordPro folder. The desktop
never needs the server to project: it works from its last downloaded copy.
More generally, **the desktop must work without a server**: many churches
never set one up. Code both need (design tokens, icons, the
[online song search](concepts/online-search.md), laying chords from the web
over a song, `shared/chord-match.ts`) lives in `shared/` here and
the desktop mirrors it; the server never does work the desktop depends on.

The code still says `PSA150` / `psa150` throughout (crate, env vars, image,
token prefixes). The client was renamed to Psalm150 and this repo was not
([gaps](concepts/gaps.md)).

## Two halves, one API

| Half | Where | Role |
| --- | --- | --- |
| API (`api/`) | Rust, Axum 0.8, sqlx on PostgreSQL. Binary `psa150-server` | Owns all state; serves `/api/v1/*`, `/api/openapi.json`, and the built web client as a static fallback |
| Web client (`web/`) | Vite + plain TypeScript, no framework, mobile-first | First-run setup, sign-in, song reader and editor, sets and the service view, remote control, the token-free `/join` room reader, import/export, desktop and API tokens. Uses only the public API |

`AppState` holds the `PgPool`, `session_hours` and the in-memory remote-control
relay (`remote`, [remote control](concepts/remote-control.md)). There is no
other in-process state: every request authenticates against the database
([auth and roles](concepts/auth-and-roles.md)). If `PSA150_WEB_DIST` is not a
directory, the server runs without the web client and logs a warning
([deployment](concepts/deployment.md)).

## Data flow

1. `POST /api/v1/setup` creates the only church and its owner, once
   ([auth and roles](concepts/auth-and-roles.md)).
2. Leaders add songs as raw ChordPro. The server pulls title, number, authors
   and language from directives, hashes the exact bytes, and stores an
   immutable revision ([songs and revisions](concepts/songs-and-revisions.md)).
3. An edit must name the revision it started from. A stale base gets
   `409 Conflict` and nothing is stored.
4. Imports skip any song whose content hash already matches a current song
   ([import and export](concepts/import-export.md)).
5. A desktop with a `psa_d_` token merges its local folder in with that import,
   then downloads the whole library as a ZIP of `.pro` files. It keeps that as
   a read-only offline copy ([desktop sync](concepts/desktop-sync.md)).
6. Leaders (on a phone or a desktop) arrange songs into [sets](concepts/sets.md)
   for a service. Desktops keep every set offline through `GET /sets/snapshot`.
   A leader may share a set on a link that anyone can open without an
   account, and may let people with the link add and remove songs
   ([shared sets](concepts/shared-sets.md)).
7. A leader's phone can steer a projection desktop through the server's
   [remote control](concepts/remote-control.md) relay, if the desktop allows
   it (it does unless its operator turns it off). Each desktop has a
   [room](concepts/rooms.md), a flower name by default: leaders pick the
   desktop by it, and anyone may type it at `/join` to follow the projected
   words live on their own phone, without an account.
8. Owners add people and set their roles under More → People (`/members`).
   Anyone signed in can make an API token (`psa_a_`) that acts as them, so scripts and
   integrations can do through the API whatever that person can
   ([auth and roles](concepts/auth-and-roles.md#api-tokens)).

## Standing rules

- Every church-owned query filters on the caller's `church_id`. Having several
  churches on one server must not weaken that isolation.
- Everything the server does is in the versioned API; nothing is web-only
  or database-only. Operations that need a token say so in the OpenAPI
  document (`bearer`), and a test keeps that honest.
- An API token acts as its person with the lower of its own role and the
  person's current role, and is never made with more than its maker has.
- A desktop token can read, import, create, edit and delete songs and sets
  (`require_song_editor`). It can never manage tokens, people or the church,
  approve desktops or send remote commands: `require_editor`,
  `require_owner` and `require_person` reject it.
- Owners alone manage people. The church always keeps an owner who is not
  disabled, and a person who also belongs to another church keeps their
  account details to themselves.
- Wrong passwords are limited before any password is checked, and unknown
  usernames count and take as long as wrong passwords, so neither the answer
  nor its timing tells which usernames exist.
- Tokens are stored only as SHA-256 hashes. The raw token is returned once.
- Revisions are immutable. A song changes only by adding a revision, and only
  after the base-revision check under a `FOR UPDATE` row lock.
- Import dedup compares the exact bytes. Normalising line endings or whitespace
  would change which songs count as duplicates for every desktop that has
  already synced.
- The web client has no private endpoints. Anything it needs goes into the
  versioned API and the OpenAPI `paths(...)` list.
- Docs and wiki describe behaviour, not models. Say "the agent".

## Where to look

- Contracts: [API contract](concepts/api-contract.md),
  [data model](concepts/data-model.md),
  [auth and roles](concepts/auth-and-roles.md).
- Songs: [songs and revisions](concepts/songs-and-revisions.md),
  [import and export](concepts/import-export.md),
  [sets](concepts/sets.md), [desktop sync](concepts/desktop-sync.md),
  [shared sets](concepts/shared-sets.md),
  [remote control](concepts/remote-control.md), [rooms](concepts/rooms.md).
- Operating it: [web client](concepts/web-client.md),
  [deployment and config](concepts/deployment.md),
  [build and CI](concepts/build-and-ci.md).
- What the design promises but the code does not do yet:
  [gaps and backlog](concepts/gaps.md).
