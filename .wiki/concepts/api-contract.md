---
type: Contract
title: API contract
description: Every /api/v1 endpoint (songs and their trash and revisions, sets, remote relay and its live stream, rooms, sessions, API tokens, members, auth) with its auth requirement, limits and status codes, the error body, OpenAPI generation with the bearer scheme and its route check, and which endpoints the web client and the desktop call.
tags: [api, http, openapi, contract]
status: stable
sources:
  - id: api
    resource: /api/src/api.rs
    title: Router, handlers, ApiDoc, BearerAuth
  - id: access
    resource: /api/src/access.rs
    title: Session info and sign-out, password, API tokens, members
  - id: models
    resource: /api/src/models.rs
    title: Request and response schemas
  - id: sets
    resource: /api/src/sets.rs
    title: Set handlers
  - id: remote
    resource: /api/src/remote.rs
    title: Remote-control relay handlers, server-sent event streams
  - id: rooms
    resource: /api/src/rooms.rs
    title: Room names, renames and public room reads
  - id: error
    resource: /api/src/error.rs
    title: AppError to HTTP status mapping
  - id: doc
    resource: /docs/api.md
    title: Human API notes
  - id: webapi
    resource: /web/src/api.ts
    title: Web client wrapper
  - id: test
    resource: /api/tests/api_flow.rs
    title: openapi_describes_every_operation (public list, routing check)
generated: { by: agent, at: 2026-10-05T18:00:00Z }
---

# API contract

All routes are nested under `/api/v1` (`api::router()`, which merges
`access::router()`, `sets::router()`, `shared_sets::router()`, `remote::router()` and `rooms::router()`). The generated OpenAPI
JSON is at `/api/openapi.json`. Responses are gzip-compressed when the client
accepts it (`CompressionLayer`). Human notes live in [/docs/api.md](../../docs/api.md).

Everything the server does is reachable here: nothing is web-only or
database-only. A token can do through the API whatever its person's role (or,
for a desktop, the desktop scope) allows, and an API token (`psa_a_`) gives a
script or integration a person's access without their password
([auth and roles](auth-and-roles.md#api-tokens)).

## Endpoints

"Person" means a person's session or API token, any role
(`AuthContext::require_person`); never a desktop. "Owner" means a person
token whose effective role is `owner` (`AuthContext::require_owner`). "Editor"
means a person token whose effective role is `owner` or `leader`
(`AuthContext::require_editor`). "Editor or desktop" adds desktop tokens
(`require_song_editor`). "Desktop" means a `psa_d_` token only. "Any token"
includes desktop tokens and viewer sessions. An API token's effective role is
the lower of its own `role` and its person's
([auth and roles](auth-and-roles.md)).

| Method | Path | Auth | Success | Notes | Web | Desktop |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/health` | none | 200 `{status, database, version}` | Runs `SELECT 1`; a database failure gives 500 | – | – |
| GET | `/info` | none | 200 `{service: "psalm150-song-server", version, initialized, desktop_sign_in: true, public_library, public_library_name, rooms}` | The desktop's "is this a Psalm150 server?" ping. `public_library` is true when any church's library is public; `public_library_name` is that church's name when exactly one is; `rooms` is true when any church has its rooms open | yes (boot) | yes |
| GET | `/church` | any token | 200 `{id, name, public_library, public_rooms}` | The caller's church | yes (owners, More) | – |
| PUT | `/church` | owner | 200 `{id, name, public_library, public_rooms}` | Body `{name?, public_library?, public_rooms?}`; fields left out stay; `name` 1–200 characters after trimming (400 otherwise); 403 for leaders, viewers and desktops. A `public_rooms` change reaches open room streams at once | yes (`public_library`, `public_rooms`) | – |
| GET | `/public/rooms/{room_name}` | none | 200 `RoomView` | `{room_name, status: live\|blank\|idle\|offline, song_title, slide_index, slides}`; the name is matched without regard to case, accents, spaces or punctuation; words only while `live` or `blank`; 404 for a name no desktop has or a church with rooms closed ([rooms](rooms.md)) | yes (`/join`) | – |
| GET | `/public/rooms/{room_name}/events` | none | 200 `text/event-stream` | A `room` event with the `RoomView` on connect and whenever it changes; 404 as above | yes (`/join`, `EventSource`) | – |
| GET | `/public/songs?q=&limit=&offset=&sort=&direction=` | none | 200 `SongSummary[]` | Same search and paging as `/songs`, over every church whose library is public; empty when none is | yes (signed out) | – |
| GET | `/public/songs/{id}` | none | 200 `SongDetail` | 404 when missing, deleted or in a private library | yes (signed out) | – |
| GET | `/setup` | none | 200 `{initialized}` | | yes | – |
| POST | `/setup` | none | 201 `SessionResponse` | 409 once done, before any password is hashed; password at least 10 characters | yes | – |
| POST | `/session` | none | 200 `SessionResponse` | Body `{username, password, church_id?}`; `church_id` picks one of the person's churches (default: the one joined first); 401 `username or password is incorrect`, also for a church they are not in; 429 with `Retry-After` after 5 failures for the username or 30 from the client in 15 minutes ([limits](auth-and-roles.md#limits-on-wrong-passwords)) | yes | – |
| GET | `/session` | any token | 200 `SessionInfo` | `{kind: session\|api\|desktop, church_id, church_name, role, user_id, username, display_name, device_id, device_name, expires_at}`; `role` is the effective one, null for desktops; `expires_at` null for tokens that last until revoked | yes (role refresh) | – |
| DELETE | `/session` | any token | 204 | Signs out: deletes the session, or revokes the API or desktop token that sends it | yes (sign-out) | yes (disconnect) |
| PUT | `/account/password` | person | 204 | Body `{current_password, new_password}`; 403 wrong current password; 429 with `Retry-After` after 5 of them in 15 minutes; 400 under 10 characters; ends the person's other sessions, keeps this one and their API tokens | yes (More, lock) | – |
| GET | `/api-tokens` | person | 200 `ApiTokenSummary[]` | Active (not revoked, not expired) tokens, by name: the caller's own, or the whole church's for an owner, with `user_id` and `user_display_name` | yes (More) | – |
| POST | `/api-tokens` | person | 201 `{id, name, role, token, created_at, expires_at}` | Body `{name, role?, expires_at?}`; name 1–120 characters after trimming; `role` defaults to the caller's effective role, more is 400; `expires_at` must be in the future (400); token `psa_a_…`, shown once | yes (More) | – |
| DELETE | `/api-tokens/{id}` | person | 204 | Own tokens, any of the church's for an owner; 404 otherwise or when already revoked | yes (More) | – |
| GET | `/members` | owner | 200 `Member[]` | `{user_id, username, display_name, role, disabled, created_at}`, by display name | yes (People) | – |
| POST | `/members` | owner | 201 `Member` | Body `{username, display_name, password, role}`; username 1–100 and name 1–120 characters after trimming, password at least 10 (400); 409 username taken (case-insensitive) | yes (People) | – |
| PATCH | `/members/{user_id}` | owner | 200 `Member` | Body `{role?, display_name?, username?, password?, disabled?}`; 404 not in this church; 409 username taken or last active owner; 403 account fields for a person in another church | yes (People) | – |
| DELETE | `/members/{user_id}` | owner | 204 | Removes the membership, its sessions and API tokens; an account left in no church is disabled and loses its username; 404 not in this church; 409 last active owner | yes (People) | – |
| POST | `/device-tokens` | editor | 201 `{id, name, token, created_at, room_name}` | Name 1–120 characters after trimming; the desktop gets a random free flower as its room name | yes | – |
| GET | `/device-tokens` | editor | 200 list | Active tokens only, sorted by name, each with `room_name` (null for a desktop made before rooms that has not been heard from since) | yes | – |
| DELETE | `/device-tokens/{id}` | editor | 204 | 404 if unknown or already revoked; the desktop leaves the remote list and its room at once, and its room name is freed | yes | – |
| PUT | `/device-tokens/{id}/room` | editor | 200 `DesktopRoom` | Body `{room_name}`; null or left out picks a new random flower; 2–30 letters, digits, spaces, hyphens or apostrophes (400 otherwise); 409 when another desktop on the server has the name; 404 for a desktop not in the church or revoked | yes (Remote) | – |
| POST | `/desktop-auth/codes` | editor | 201 `{code, expires_at}` | Body `{device_name, code_challenge}`; name 1–120 characters after trimming; challenge 43–128 of `[A-Za-z0-9_-]`; code `psa_c_…`, valid 5 minutes | yes (consent screen) | – |
| POST | `/desktop-auth/token` | none | 201 `{token, device_id, device_name, church_name, room_name}` | Body `{code, code_verifier}`; single use; every failure is 400 `the sign-in code is invalid or has expired` | – | yes |
| GET | `/songs?q=&limit=&offset=&sort=&direction=` | any token | 200 `SongSummary[]` | `limit` defaults to 100, clamped to 1–200; `offset` skips rows (default 0); `sort` `title` (default) or `number` (songs without one last), `direction` `asc` (default) or `desc`; 400 for other values | yes (pages of 100) | – |
| POST | `/songs` | editor or desktop | 201 `SongSummary` | | yes | – |
| GET | `/songs/{id}` | any token | 200 `SongDetail` | 404 when missing or in another church | yes | yes (songs a set needs that it lacks) |
| PUT | `/songs/{id}` | editor or desktop | 200 `SongDetail` | Body `{base_revision_id, chordpro}`; 409 when the base is stale | yes | yes (VSB sync) |
| DELETE | `/songs/{id}?base_revision_id=` | editor or desktop | 204 | Soft delete (`deleted_at`, `deleted_by`, `deleted_by_device`); 409 when the optional base is stale; 404 when missing | **no** | yes (VSB sync) |
| GET | `/songs/deleted?limit=&offset=` | any token | 200 `DeletedSong[]` | `{id, revision_id, title, song_number, authors, language, deleted_at}`, most recently deleted first; `limit` 1–200, default 100 | **no** | – |
| POST | `/songs/{id}/restore` | editor or desktop | 200 `SongDetail` | Clears `deleted_at` and the deleting person or device; a live song is returned unchanged; 404 when missing | **no** | – |
| GET | `/songs/{id}/revisions` | any token | 200 `RevisionSummary[]` | Newest first | **no** | – |
| GET | `/songs/{id}/revisions/{revision_id}` | any token | 200 `RevisionDetail` | Any revision with its full ChordPro; 404 when the revision is not this song's or the song is deleted or in another church | **no** | – |
| POST | `/songs/import` | editor or desktop | 201 `{songs, skipped_existing}` | 1–500 songs; 64 MB body limit | yes | yes |
| GET | `/songs/export` | any token | 200 `application/zip` | `psa150-library.zip`, with `psa150-manifest.json` | yes | yes |
| GET | `/sets?from=&limit=&offset=` | any token | 200 `SetSummary[]` | `limit` defaults to 100, clamped to 1–500; `offset` skips rows; `from` keeps undated sets | yes (no `from`, no `limit`) | – |
| GET | `/sets/snapshot` | any token | 200 `SetDetail[]` | Every live set with items; no limit | – | yes |
| POST | `/sets` | editor or desktop | 201 `SetDetail` | Optional client `id`; 409 when that id exists; see [sets](sets.md) for item rules | yes | yes |
| GET | `/sets/deleted?limit=&offset=` | any token | 200 `DeletedSet[]` | `{id, name, service_date, version, item_count, deleted_at}`, most recently deleted first; `limit` 1–200, default 100 | – | – |
| GET | `/sets/{id}` | any token | 200 `SetDetail` | 404 when missing, deleted or in another church | yes | – |
| PUT | `/sets/{id}` | editor or desktop | 200 `SetDetail` | Body `{base_version, name, service_date, items}`; items replaced; 409 when the base is stale | yes | yes |
| DELETE | `/sets/{id}?base_version=` | editor or desktop | 204 | Soft delete; 409 when the optional base is stale | yes | – |
| POST | `/sets/{id}/restore` | editor or desktop | 200 `SetDetail` | Clears `deleted_at` and raises `version` by one; a live set is returned unchanged; 404 when missing | – | – |
| GET | `/sets/{id}/share` | editor | 200 `SetShare` | `{key, editable, shared_at}`; 404 when not shared ([shared sets](shared-sets.md)) | yes | – |
| PUT | `/sets/{id}/share` | editor | 200 `SetShare` | Body `{editable}`; shares the set or changes `editable`, keeping the key; 403 for viewers and desktops | yes | – |
| DELETE | `/sets/{id}/share` | editor | 204 | Stops sharing; the link answers 404 from then on | yes | – |
| GET | `/public/sets/{key}` | none | 200 `SharedSet` | `{name, service_date, version, updated_at, church_name, editable, items}`; 404 for an unknown, stopped or deleted set's key | yes (`/shared/{key}`) | – |
| GET | `/public/sets/{key}/songs/{song_id}` | none | 200 `SongDetail` | A song in the set; any song of the church through an editable link; 404 otherwise | yes | – |
| GET | `/public/sets/{key}/songs` | none | 200 `SongSummary[]` | Editable links only (403): searches the church's songs like `GET /songs` | yes | – |
| POST | `/public/sets/{key}/items` | none | 200 `SharedSet` | Editable links only (403). Body `{song_id, position?}`; a song of the church (400), at most 200 items (400); raises `version` | yes | – |
| GET | `/sets/{id}/live` | any token | 200 `SetLive` | `{leading, item_id, leader_name, viewers}`; 404 when missing, deleted or in another church ([shared sets](shared-sets.md#leading-live)) | yes (service view) | – |
| PUT | `/sets/{id}/live` | editor | 200 `SetLive` | Body `{item_id}` (an item of the set, else 400). Leads the set: shared-link pages move to that item. Send on every move and at least every 30 s; leading ends 60 s after the last | yes | – |
| DELETE | `/sets/{id}/live` | editor | 204 | Stops leading; pages stay where they are | yes | – |
| GET | `/public/sets/{key}/live/events` | none | 200 `text/event-stream` | A `live` event `SharedSetLive {item_id, leader_name}` on connect and whenever it changes; the open stream counts as a viewer; ends when the link stops working (checked every 30 s); 404 for an unknown key | yes (`/shared/{key}`, `EventSource`) | – |
| DELETE | `/public/sets/{key}/items/{item_id}` | none | 200 `SharedSet` | Editable links only (403). Song items only (a blank is 403); 404 for an unknown item; raises `version` | yes | – |
| GET | `/remote/desktop` | desktop | 200 `DesktopRoom` | `{device_id, room_name, public_rooms}`: the desktop's room and whether its church has rooms open ([rooms](rooms.md)) | – | yes |
| PUT | `/remote/desktop` | desktop | 204 | Body `DesktopState`; see [remote control](remote-control.md) | – | yes |
| DELETE | `/remote/desktop` | desktop | 204 | The desktop leaves the relay | – | yes |
| PUT | `/remote/desktop/room` | desktop | 200 `DesktopRoom` | The desktop renames its own room; same body and rules as `PUT /device-tokens/{id}/room` | – | yes |
| GET | `/remote/desktop/commands?wait=` | desktop | 200 `RemoteCommand[]` | Long poll, `wait` 0–30 s (default 0) | – | yes |
| GET | `/remote/desktops` | any token | 200 `RemoteDesktop[]` | The church's desktops; `online` = seen within 45 s; online first, then by room name; revoked tokens left out | yes | – |
| GET | `/remote/desktops/events` | any token | 200 `text/event-stream` | A `desktops` event with the same list as `GET /remote/desktops` on connect and whenever it changes; ends when the token stops working. Read it with `fetch`, since `EventSource` cannot send the bearer | yes (Remote; the service view still polls) | – |
| POST | `/remote/desktops/{device_id}/commands` | editor | 202 `RemoteCommand` | 400 missing field, 404 desktop not online (or unknown song or set), 409 desktop does not accept commands | yes | – |

## Validation and limits

- Desktop browser sign-in (`/desktop-auth/*`) is described in
  [auth and roles](auth-and-roles.md#desktop-browser-sign-in).

- ChordPro source must not be blank and must be at most 1,000,000 bytes
  (`validate_chordpro`). Otherwise the server returns 400.
- Import accepts 1–500 songs per request (400 otherwise). The route raises the
  body limit to 64 MB (`DefaultBodyLimit::max`). All other routes keep Axum's
  2 MB default.
- Sets hold at most 200 items; name 1–200 characters; `transpose` −11 to 11;
  note at most 500 characters ([sets](sets.md)).
- Remote commands expire after 30 s, at most 20 are queued per desktop, and
  the relay is in memory ([remote control](remote-control.md)). A desktop's
  report keeps at most 200 slides of 40 lines of 300 characters.
- Room names are 2–30 letters, digits, spaces, hyphens or apostrophes, unique
  on the server ([rooms](rooms.md)).
- The two event streams (`/remote/desktops/events`,
  `/public/rooms/{room_name}/events`) send keep-alive comments and an
  `X-Accel-Buffering: no` header; a reverse proxy must pass them through
  unbuffered ([deployment](deployment.md)). They are not rate-limited and the
  number of open streams is not capped ([gaps](gaps.md)).
- Search `q` is trimmed and matched with `ILIKE '%q%'`
  ([songs and revisions](songs-and-revisions.md#search)).

## Errors

Every error is JSON `{"error": "<message>"}` (`ErrorBody`).

| Variant | Status |
| --- | --- |
| `BadRequest` | 400 |
| `Unauthorized` | 401 (missing, unknown, expired or revoked token; a disabled or removed person's session or API token) |
| `Forbidden` | 403 (desktop token or viewer calling an editor route; anyone but a person owner calling an owner route; a desktop calling a person route; a person token calling a desktop-only `/remote/desktop*` route; a wrong current password; account fields of a person in another church) |
| `NotFound` | 404 |
| `Conflict` | 409 (setup already done; stale `base_revision_id` or `base_version`; set id already taken; desktop does not accept remote control; username taken; room name taken by another desktop; the last active owner would be demoted, disabled or removed) |
| `TooManyRequests` | 429 with `Retry-After` (seconds): too many wrong passwords at sign-in or password change |
| `Database`, `Internal` | 500, logged with `tracing::error!`. The message is generic |

Malformed JSON or a bad UUID in the path is rejected by Axum's extractors
before a handler runs. That response is plain text, not `ErrorBody`.

## OpenAPI

`ApiDoc` is a `utoipa` derive. Its `paths(...)` and `components(schemas(...))`
lists are maintained **by hand**. A new handler or schema that is missing from
those lists works, but does not appear in `/api/openapi.json`.

Every operation has a summary, from its handler's doc comment: the first
paragraph is the `summary`, the rest the `description`. The `Groups` modifier
puts each operation in one section (its only tag), by its path, from the
`GROUPS` table in `api.rs` (Server, Sign-in and account, API tokens, People,
Church, Songs, Sets, Desktops, Remote control, Rooms, Shared sets, Public
library), and
lists those sections with descriptions in the document's `tags`. The web
client's [API reference](web-client.md#api-reference) and tools such as
Swagger group by them.

The `BearerAuth` modifier declares an HTTP `bearer` security scheme, and every
operation that needs a token carries `security(("bearer" = []))`. The test
`openapi_describes_every_operation` reads the served document and fails when
an operation outside its list of sixteen public ones (`/health`, `/info`,
both `/setup`, `POST /session`, the two `/public/songs` reads, the two
`/public/rooms` reads, the six `/public/sets` operations and
`POST /desktop-auth/token`) lacks the scheme, when a public one has it, or
when a documented operation is not routed (the router's bare 404 or a 405),
has no summary, or is in no section.
It cannot see a routed handler that is missing from `paths(...)`.

## Versioning

Only `v1` exists. There are no compatibility or deprecation rules yet
(TODO: "Define compatibility and deprecation rules for API versions").
