# Psalm150 Song Server

Optional, self-hosted, API-first song library for Psalm150: a Rust/Axum API on PostgreSQL with a small Vite web client. Start at [overview](overview.md).

# Contracts

* [API contract](concepts/api-contract.md) - Every `/api/v1` endpoint with auth, limits and status codes (including `/info` and `/desktop-auth/*`); error body; hand-maintained OpenAPI; who calls what
* [Data model](concepts/data-model.md) - PostgreSQL tables (including `desktop_auth_codes`), church scoping, cascades, indexes, migrations at startup, stored-but-unused columns
* [Auth and roles](concepts/auth-and-roles.md) - First-run setup, `psa_s_` sessions and `psa_d_` desktop tokens, desktop browser sign-in (`psa_c_` code with PKCE), hashing, role matrix, missing logout and members

# Songs

* [Songs and revisions](concepts/songs-and-revisions.md) - Raw ChordPro, extracted metadata, exact-bytes content hash, base-revision 409 conflicts, how search matches
* [Import and export](concepts/import-export.md) - 500-song batch import with hash dedup and per-church lock; ZIP export of `.pro` files, their names and the id manifest
* [Desktop sync](concepts/desktop-sync.md) - Connecting via `/info` and browser sign-in; Phase 1 merge-then-pull with the desktop client, offline guarantees, duplicate pitfalls

# Operating

* [Web client](concepts/web-client.md) - Setup, sign-in, desktop consent screen, library, editor, import/export and desktop-token dialog; session storage; what it does not expose
* [Deployment and config](concepts/deployment.md) - Env vars with defaults, Docker Compose, the three-stage image, headless mode, shutdown
* [Build and CI](concepts/build-and-ci.md) - Commands per half, the one integration test and its coverage, the three CI jobs
* [Gaps and backlog](concepts/gaps.md) - TODO status, design-vs-code differences, behaviour gaps, unused schema and endpoints
