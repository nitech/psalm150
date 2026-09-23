---
type: Contract
title: API contract
description: Every /api/v1 endpoint with its auth requirement, limits and status codes, the error body, OpenAPI generation, and which endpoints the web client and the desktop call.
tags: [api, http, openapi, contract]
status: stable
sources:
  - id: api
    resource: /api/src/api.rs
    title: Router, handlers, ApiDoc
  - id: models
    resource: /api/src/models.rs
    title: Request and response schemas
  - id: error
    resource: /api/src/error.rs
    title: AppError to HTTP status mapping
  - id: doc
    resource: /docs/api.md
    title: Human API notes
  - id: webapi
    resource: /web/src/api.ts
    title: Web client wrapper
generated: { by: agent, at: 2026-09-23T19:00:00Z }
---

# API contract

All routes are nested under `/api/v1` (`api::router()`). The generated OpenAPI
JSON is at `/api/openapi.json`. Responses are gzip-compressed when the client
accepts it (`CompressionLayer`). Human notes live in [/docs/api.md](../../docs/api.md).

## Endpoints

"Editor" means a person session whose role is `owner` or `leader`
(`AuthContext::require_editor`). "Any token" includes desktop `psa_d_` tokens
and viewer sessions ([auth and roles](auth-and-roles.md)).

| Method | Path | Auth | Success | Notes | Web | Desktop |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/health` | none | 200 `{status, database, version}` | Runs `SELECT 1`; a database failure gives 500 | – | – |
| GET | `/setup` | none | 200 `{initialized}` | | yes | – |
| POST | `/setup` | none | 201 `SessionResponse` | 409 once done; password at least 10 characters | yes | – |
| POST | `/session` | none | 200 `SessionResponse` | 401 `username or password is incorrect` | yes | – |
| POST | `/device-tokens` | editor | 201 `{id, name, token, created_at}` | Name 1–120 characters after trimming | yes | – |
| GET | `/device-tokens` | editor | 200 list | Active tokens only, sorted by name | yes | – |
| DELETE | `/device-tokens/{id}` | editor | 204 | 404 if unknown or already revoked | yes | – |
| GET | `/songs?q=&limit=` | any token | 200 `SongSummary[]` | `limit` defaults to 100, clamped to 1–200 | yes (no `limit`) | – |
| POST | `/songs` | editor or desktop | 201 `SongSummary` | | yes | – |
| GET | `/songs/{id}` | any token | 200 `SongDetail` | 404 when missing or in another church | yes | – |
| PUT | `/songs/{id}` | editor or desktop | 200 `SongDetail` | Body `{base_revision_id, chordpro}`; 409 when the base is stale | yes | yes (VSB sync) |
| DELETE | `/songs/{id}?base_revision_id=` | editor or desktop | 204 | Soft delete (`deleted_at`, `deleted_by`, `deleted_by_device`); 409 when the optional base is stale; 404 when missing | **no** | yes (VSB sync) |
| GET | `/songs/{id}/revisions` | any token | 200 `RevisionSummary[]` | Newest first | **no** | – |
| POST | `/songs/import` | editor or desktop | 201 `{songs, skipped_existing}` | 1–500 songs; 64 MB body limit | yes | yes |
| GET | `/songs/export` | any token | 200 `application/zip` | `psa150-library.zip`, with `psa150-manifest.json` | yes | yes |

## Validation and limits

- ChordPro source must not be blank and must be at most 1,000,000 bytes
  (`validate_chordpro`). Otherwise the server returns 400.
- Import accepts 1–500 songs per request (400 otherwise). The route raises the
  body limit to 64 MB (`DefaultBodyLimit::max`). All other routes keep Axum's
  2 MB default.
- Search `q` is trimmed and matched with `ILIKE '%q%'`
  ([songs and revisions](songs-and-revisions.md#search)).

## Errors

Every error is JSON `{"error": "<message>"}` (`ErrorBody`).

| Variant | Status |
| --- | --- |
| `BadRequest` | 400 |
| `Unauthorized` | 401 (missing, unknown, expired or revoked token) |
| `Forbidden` | 403 (desktop token or viewer calling an editor route) |
| `NotFound` | 404 |
| `Conflict` | 409 (setup already done; stale `base_revision_id`) |
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
