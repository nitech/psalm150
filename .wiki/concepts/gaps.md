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
  - id: rooms
    resource: /api/src/rooms.rs
    title: Public rooms
  - id: access
    resource: /api/src/access.rs
    title: Sessions, API tokens, members
generated: { by: agent, at: 2026-10-23T09:30:00Z }
---

# Gaps and backlog

## TODO.md, open items grouped

| Area | Open | Where it stands |
| --- | --- | --- |
| Domain | Song conflict preservation, provenance links, search languages and alternate titles | Songs and sets have soft delete and restore, nothing purges them. Plans are built as [sets](sets.md), shared read-only with viewers. The rest has no schema |
| Policy | Visibility (private/unlisted/public), publication policy, attribution and licensing | Only an all-or-nothing switch: an owner can make the whole library public, read only ([auth and roles](auth-and-roles.md#public-library)). No per-song visibility, unlisted songs, publication policy or licensing |
| Sync | Offline outbox, conflicts kept for review, cross-server import, portable metadata export, migration and offline-edit upload | Phase 1 merge-then-pull only ([desktop sync](desktop-sync.md)) |
| API | Rules for compatibility and deprecation between versions; guidance for outside integrations | Only `v1`. Everything the server does is in it, and API tokens give integrations a person's access ([auth and roles](auth-and-roles.md#api-tokens)) |
| People | Sign-in limits that survive restarts and span server instances; invitations and self-service password reset | Owners manage people under More → People or through `/members`; wrong passwords are limited in memory |
| Operations | TLS and reverse-proxy docs, upgrade behaviour, backup, restore and disaster recovery, release and image signing | Only what a proxy must not buffer for the event streams is written down ([deployment](deployment.md#behind-a-reverse-proxy)) |
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
- **Owner vs leader**: owners alone manage people, the church's settings and
  everyone's API tokens; for songs, sets and desktops they are the same as
  leaders. Owner recovery when no owner can sign in is not built
  ([auth and roles](auth-and-roles.md)).
- **Multi-architecture images** are promised. CI builds one architecture and
  publishes nothing ([build and CI](build-and-ci.md)).
- **Name**: the client and the repo folder are Psalm150, but the crate, image,
  env vars, token prefixes, the session storage key and README still say PSA150.
  The README calls the client repo `PSA150-client`.

## Behaviour gaps seen in the code

- **No session cleanup**: expired sessions, and expired or revoked API
  tokens, stay in the database.
- **Roles in the web client** are read again at boot and when the app comes
  back into view, at most once a minute; until then an open app shows the
  old role's buttons. The server applies the new role at once.
- **Session in localStorage**: the web client keeps the session token where
  page scripts can read it, so it lasts across app launches. An httpOnly cookie
  would keep it out of reach of scripts, but needs server support
  ([web client](web-client.md)).
- **Offline is read-only**: the installed web client shows saved songs and
  sets offline, but edits need a connection; there is no outbox.
- **Remote relay is in memory and single-instance**: a restart forgets every
  desktop and queued command until desktops report again (rooms show
  `offline` meanwhile), and running more than one server process would split
  desktops, their live streams and their rooms between them
  ([remote control](remote-control.md)).
- **Rooms are not limited**: the token-free `GET /public/rooms/{room_name}`
  and its event stream have no rate limit, and the number of people following
  a room (open streams, each holding a connection) is not capped or counted.
  Room names are short guessable flowers, unique per server, with no code or
  PIN; an owner's switch, the operator's checkbox and renaming are the only
  controls ([rooms](rooms.md)).
- **Online search is not limited per church**: `GET /songs/online` runs
  at most 2 searches at once and keeps answers for 6 h, but has no
  per-church or per-person rate limit ([online search](online-search.md)).
- **Shared set links are not limited**: the token-free `/public/sets/{key}`
  endpoints have no rate limit, an editable link records no one for its
  changes, and links do not expire by themselves; stopping the share is the
  only control ([shared sets](shared-sets.md)).
- **Event streams need an unbuffered proxy**: a reverse proxy that buffers
  `text/event-stream` delays the Remote screens and rooms until it flushes
  ([deployment](deployment.md#behind-a-reverse-proxy)). The service view
  still polls `GET /remote/desktops` and `GET /sets/{id}/live` instead of
  following a stream.
- **Leading a set is in memory and single-instance**, like the relay: a
  restart forgets who leads and who watches until the leader's phone reports
  and the pages reconnect (seconds), and the number of watching pages is not
  capped ([shared sets](shared-sets.md#leading-live)).
- **Song language**: songs carry no language, so the web client marks
  lyrics as English like its interface and a screen reader may read them
  with the wrong voice (WCAG 3.1.2; [accessibility](accessibility.md)).
- **Sets** keep no history. The web client shows only the newest 100 and has
  no screen for deleted sets ([sets](sets.md)).
- **No invitations or self-service reset**: owners set a person's first
  password and hand it over, and only an owner can reset a forgotten one.
- **Several churches**: sign-in can name the church (`church_id`), but no
  endpoint creates a second church or adds an account to one.
- **Search** is unranked `ILIKE` over the full source (chords and directives
  match). `%` and `_` are not escaped.
- **Import dedup** is by exact bytes against current revisions only.
  `filename` is ignored.
- **Export** holds the whole ZIP in memory; beyond the id manifest it carries no metadata.
- **Deleted songs** can be listed and restored through the API, but the web
  client can neither delete nor restore songs.
- **Revision history**, including any revision's source, can be read through
  the API but not in the web client, and revisions do not say who saved them.
- **Limits on wrong passwords are in memory** and per process, like the
  relay: a restart forgets them, and several instances would each count
  alone. Behind a proxy without `PSA150_CLIENT_IP_HEADER`, all clients share
  one per-client count ([auth and roles](auth-and-roles.md#limits-on-wrong-passwords)).
- **OpenAPI** lists are maintained by hand. A test checks that every
  documented operation is routed and marked public or `bearer` correctly, but
  not that every route is documented ([API contract](api-contract.md#openapi)).
- **Deleting a user** that created a device token would be blocked by a
  foreign key with no cascade; no endpoint deletes users (removing a member
  disables an account left in no church) ([data model](data-model.md)).

## Stored or served but unused

- `song_sets` audit columns (`created_by`, `updated_by` and the device
  twins): written, never returned.
- `churches.slug`: written at setup, never read.
- `sessions_expiry_idx`: no query uses it.
- No caller in the web client or the desktop: `GET /songs/{id}/revisions`
  and `/revisions/{revision_id}`, `GET /songs/deleted` and
  `POST /songs/{id}/restore`, `GET /sets/deleted` and
  `POST /sets/{id}/restore`, renaming the church and choosing a church at
  sign-in. They are there for API clients.
- Song recordings and videos are not in the ZIP export, not shown in the
  public library, on shared set pages or in the service view, and the
  desktop does not show or sync them yet. Recording needs HTTPS (or
  localhost) for the microphone.
