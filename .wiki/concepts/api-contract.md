---
type: Contract
title: API contract
description: Every /api/v1 endpoint (songs, sets, remote relay, auth) with its auth requirement, limits and status codes, the error body, OpenAPI generation, and which endpoints the web client and the desktop call.
tags: [api, http, openapi, contract]
status: stable
sources:
  - id: api
    resource: /api/src/api.rs
    title: Router, handlers, ApiDoc
  - id: models
    resource: /api/src/models.rs
    title: Request and response schemas
  - id: sets
    resource: /api/src/sets.rs
    title: Set handlers
  - id: remote
    resource: /api/src/remote.rs
    title: Remote-control relay handlers
  - id: error
    resource: /api/src/error.rs
    title: AppError to HTTP status mapping
  - id: doc
    resource: /docs/api.md
    title: Human API notes
  - id: webapi
    resource: /web/src/api.ts
    title: Web client wrapper
generated: { by: agent, at: 2026-10-02T12:00:00Z }
---

# API contract

All routes are nested under `/api/v1` (`api::router()`, which merges
`sets::router()` and `remote::router()`). The generated OpenAPI
JSON is at `/api/openapi.json`. Responses are gzip-compressed when the client
accepts it (`CompressionLayer`). Human notes live in [/docs/api.md](../../docs/api.md).

## Endpoints

"Owner" means a person session whose role is `owner`
(`AuthContext::require_owner`). "Editor" means a person session whose role is `owner` or `leader`
(`AuthContext::require_editor`). "Editor or desktop" adds desktop tokens
(`require_song_editor`). "Desktop" means a `psa_d_` token only. "Any token"
includes desktop tokens and viewer sessions
([auth and roles](auth-and-roles.md)).

| Method | Path | Auth | Success | Notes | Web | Desktop |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/health` | none | 200 `{status, database, version}` | Runs `SELECT 1`; a database failure gives 500 | – | – |
| GET | `/info` | none | 200 `{service: "psalm150-song-server", version, initialized, desktop_sign_in: true, public_library, public_library_name}` | The desktop's "is this a Psalm150 server?" ping. `public_library` is true when any church's library is public; `public_library_name` is that church's name when exactly one is | yes (boot) | yes |
| GET | `/church` | any token | 200 `{id, name, public_library}` | The caller's church | yes (owners, More) | – |
| PUT | `/church` | owner | 200 `{id, name, public_library}` | Body `{public_library}`; 403 for leaders, viewers and desktops | yes | – |
| GET | `/public/songs?q=&limit=&offset=` | none | 200 `SongSummary[]` | Same search and paging as `/songs`, over every church whose library is public; empty when none is | yes (signed out) | – |
| GET | `/public/songs/{id}` | none | 200 `SongDetail` | 404 when missing, deleted or in a private library | yes (signed out) | – |
| GET | `/setup` | none | 200 `{initialized}` | | yes | – |
| POST | `/setup` | none | 201 `SessionResponse` | 409 once done; password at least 10 characters | yes | – |
| POST | `/session` | none | 200 `SessionResponse` | 401 `username or password is incorrect` | yes | – |
| POST | `/device-tokens` | editor | 201 `{id, name, token, created_at}` | Name 1–120 characters after trimming | yes | – |
| GET | `/device-tokens` | editor | 200 list | Active tokens only, sorted by name | yes | – |
| DELETE | `/device-tokens/{id}` | editor | 204 | 404 if unknown or already revoked | yes | – |
| POST | `/desktop-auth/codes` | editor | 201 `{code, expires_at}` | Body `{device_name, code_challenge}`; name 1–120 characters after trimming; challenge 43–128 of `[A-Za-z0-9_-]`; code `psa_c_…`, valid 5 minutes | yes (consent screen) | – |
| POST | `/desktop-auth/token` | none | 201 `{token, device_id, device_name, church_name}` | Body `{code, code_verifier}`; single use; every failure is 400 `the sign-in code is invalid or has expired` | – | yes |
| GET | `/songs?q=&limit=&offset=` | any token | 200 `SongSummary[]` | `limit` defaults to 100, clamped to 1–200; `offset` skips rows (default 0) in title order | yes (pages of 100) | – |
| POST | `/songs` | editor or desktop | 201 `SongSummary` | | yes | – |
| GET | `/songs/{id}` | any token | 200 `SongDetail` | 404 when missing or in another church | yes | yes (songs a set needs that it lacks) |
| PUT | `/songs/{id}` | editor or desktop | 200 `SongDetail` | Body `{base_revision_id, chordpro}`; 409 when the base is stale | yes | yes (VSB sync) |
| DELETE | `/songs/{id}?base_revision_id=` | editor or desktop | 204 | Soft delete (`deleted_at`, `deleted_by`, `deleted_by_device`); 409 when the optional base is stale; 404 when missing | **no** | yes (VSB sync) |
| GET | `/songs/{id}/revisions` | any token | 200 `RevisionSummary[]` | Newest first | **no** | – |
| POST | `/songs/import` | editor or desktop | 201 `{songs, skipped_existing}` | 1–500 songs; 64 MB body limit | yes | yes |
| GET | `/songs/export` | any token | 200 `application/zip` | `psa150-library.zip`, with `psa150-manifest.json` | yes | yes |
| GET | `/sets?from=&limit=` | any token | 200 `SetSummary[]` | `limit` defaults to 100, clamped to 1–500; `from` keeps undated sets | yes (no `from`, no `limit`) | – |
| GET | `/sets/snapshot` | any token | 200 `SetDetail[]` | Every live set with items; no limit | – | yes |
| POST | `/sets` | editor or desktop | 201 `SetDetail` | Optional client `id`; 409 when that id exists; see [sets](sets.md) for item rules | yes | yes |
| GET | `/sets/{id}` | any token | 200 `SetDetail` | 404 when missing, deleted or in another church | yes | – |
| PUT | `/sets/{id}` | editor or desktop | 200 `SetDetail` | Body `{base_version, name, service_date, items}`; items replaced; 409 when the base is stale | yes | yes |
| DELETE | `/sets/{id}?base_version=` | editor or desktop | 204 | Soft delete; 409 when the optional base is stale | yes | – |
| PUT | `/remote/desktop` | desktop | 204 | Body `DesktopState`; see [remote control](remote-control.md) | – | yes |
| DELETE | `/remote/desktop` | desktop | 204 | The desktop leaves the relay | – | yes |
| GET | `/remote/desktop/commands?wait=` | desktop | 200 `RemoteCommand[]` | Long poll, `wait` 0–30 s (default 0) | – | yes |
| GET | `/remote/desktops` | any token | 200 `RemoteDesktop[]` | The church's desktops; `online` = seen within 45 s; revoked tokens left out | yes | – |
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
  the relay is in memory ([remote control](remote-control.md)).
- Search `q` is trimmed and matched with `ILIKE '%q%'`
  ([songs and revisions](songs-and-revisions.md#search)).

## Errors

Every error is JSON `{"error": "<message>"}` (`ErrorBody`).

| Variant | Status |
| --- | --- |
| `BadRequest` | 400 |
| `Unauthorized` | 401 (missing, unknown, expired or revoked token) |
| `Forbidden` | 403 (desktop token or viewer calling an editor route; anyone but a person owner calling `PUT /church`; person session calling a desktop-only `/remote/desktop*` route) |
| `NotFound` | 404 |
| `Conflict` | 409 (setup already done; stale `base_revision_id` or `base_version`; set id already taken; desktop does not accept remote control) |
| `Database`, `Internal` | 500, logged with `tracing::error!`. The message is generic |

Malformed JSON or a bad UUID in the path is rejected by Axum's extractors
before a handler runs. That response is plain text, not `ErrorBody`.

## OpenAPI

`ApiDoc` is a `utoipa` derive. Its `paths(...)` and `components(schemas(...))`
lists are maintained **by hand**. A new handler or schema that is missing from
those lists works, but does not appear in `/api/openapi.json`. The document
declares no security scheme, so the bearer requirement is only described here
and in [/docs/api.md](../../docs/api.md).

## Versioning

Only `v1` exists. There are no compatibility or deprecation rules yet
(TODO: "Define compatibility and deprecation rules for API versions").
