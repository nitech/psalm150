# API

The PSA150 Song Server API is versioned under `/api/v1`. Its generated OpenAPI
document is served at `/api/openapi.json`. The bundled web interface uses these
same endpoints and has no private server contract.

## Authentication

Authenticated requests send `Authorization: Bearer <token>`.

- Person sessions begin with `psa_s_`, expire, and carry the person's church
  membership and role.
- Desktop credentials begin with `psa_d_` and are scoped to one church. They
  may read the library and submit imports of exact new content, but cannot edit
  or delete existing songs.
- Only a hash of either token is stored by the server.

The first owner is created through `POST /api/v1/setup`, which becomes
unavailable after successful initialization. Passwords are hashed with Argon2.

## Phase 1 resources

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Check API and PostgreSQL availability |
| `GET` | `/api/v1/setup` | Determine whether first-run setup is available |
| `POST` | `/api/v1/setup` | Create the first church, owner, and session |
| `POST` | `/api/v1/session` | Sign in and issue a person session |
| `POST` | `/api/v1/device-tokens` | Create a scoped desktop sync credential |
| `GET` | `/api/v1/device-tokens` | List active desktop credentials |
| `DELETE` | `/api/v1/device-tokens/{id}` | Revoke a desktop credential |
| `GET` | `/api/v1/songs` | List or search current song revisions |
| `POST` | `/api/v1/songs` | Create a song and its first revision |
| `GET` | `/api/v1/songs/{id}` | Read the current ChordPro source and metadata |
| `PUT` | `/api/v1/songs/{id}` | Create a revision from an expected base revision |
| `DELETE` | `/api/v1/songs/{id}?base_revision_id=` | Delete a song (soft); a stale base revision is `409` |
| `GET` | `/api/v1/songs/{id}/revisions` | List immutable revision metadata |
| `POST` | `/api/v1/songs/import` | Import up to 500 ChordPro songs, skipping exact content matches |
| `GET` | `/api/v1/songs/export` | Download current songs as a ZIP of `.pro` files plus `psa150-manifest.json` |

## Conflict contract

Song updates include `base_revision_id`. The server locks the song while
checking that base. A stale base returns HTTP `409 Conflict` and does not create
or replace a revision. This is the initial contract required for future offline
outbox synchronization and deliberate conflict review.

Person leaders and desktop sync credentials may call the import endpoint.
Desktop credentials have append-only import access: the server compares SHA-256
content hashes, skips exact matches, and returns `skipped_existing`. A song with
different content is added as a separate song; automatic title-based merging
would risk destroying legitimate translations or arrangements.
