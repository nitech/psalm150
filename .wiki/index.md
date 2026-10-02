# Psalm150 Song Server

Optional, self-hosted, API-first song library for Psalm150: a Rust/Axum API on PostgreSQL with a mobile-first Vite web client. Start at [overview](overview.md).

# Contracts

* [API contract](concepts/api-contract.md) - Every `/api/v1` endpoint with auth, limits and status codes (including `/info`, `/church`, `/public/songs*`, `/desktop-auth/*`, `/sets*` and `/remote/*`); error body; hand-maintained OpenAPI; who calls what
* [Data model](concepts/data-model.md) - PostgreSQL tables (including `desktop_auth_codes`, `song_sets`, `song_set_items`), church scoping, cascades, indexes, `churches.public_library`, migrations 0001–0005 at startup, stored-but-unused columns
* [Auth and roles](concepts/auth-and-roles.md) - First-run setup, `psa_s_` sessions and `psa_d_` desktop tokens, desktop browser sign-in (`psa_c_` code with PKCE), hashing, role matrix for songs, sets and remote control, the owner-only public library switch, missing logout and members

# Songs

* [Songs and revisions](concepts/songs-and-revisions.md) - Raw ChordPro, extracted metadata, exact-bytes content hash, base-revision 409 conflicts, how search matches
* [Import and export](concepts/import-export.md) - 500-song batch import with hash dedup and per-church lock; ZIP export of `.pro` files, their names and the id manifest
* [Sets](concepts/sets.md) - Ordered song lists for a service shared by the church; item rules and limits, client-chosen ids, `base_version` 409s, soft delete, deleted songs as `song: null`
* [Desktop sync](concepts/desktop-sync.md) - Connecting via `/info` and browser sign-in; Phase 1 merge-then-pull; set sync through `/sets/snapshot` with conflict copies on the desktop; offline guarantees, duplicate pitfalls
* [Remote control](concepts/remote-control.md) - In-memory relay: desktops report state and long-poll for commands, leaders' phones send next/previous/blank/slide/project; 45 s online, 30 s command expiry, 20 queued, single instance

# Operating

* [Web client](concepts/web-client.md) - Mobile-first hash-routed app: public-library visitor shell, song Share link, sticky bars, the current set with one-tap adding and Undo, paged song list, song reader with chords and transpose, set editor with drag to reorder, service view with swipe and Follow, remote screen, More (install, theme, import/export, desktops); installable app with offline copies; role handling; storage; shared design tokens; desktop consent screen
* [Deployment and config](concepts/deployment.md) - Env vars with defaults, Docker Compose, the three-stage image, headless mode, shutdown
* [Build and CI](concepts/build-and-ci.md) - Commands per half, the API integration tests and web vitest tests and their coverage, the three CI jobs
* [Gaps and backlog](concepts/gaps.md) - TODO status, design-vs-code differences, behaviour gaps, unused schema and endpoints
