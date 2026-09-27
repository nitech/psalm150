---
type: Concept
title: Build and CI
description: The commands that build and test each half, the API integration tests and the web unit tests and what they cover, and the three GitHub Actions jobs.
tags: [build, test, ci, github-actions]
status: stable
sources:
  - id: ci
    resource: /.github/workflows/ci.yml
    title: CI workflow
  - id: test
    resource: /api/tests/api_flow.rs
    title: private_library_flow, desktop_browser_sign_in_flow, sets_flow, remote_control_flow
  - id: webtest
    resource: /web/tests/chordpro.test.ts
    title: ChordPro display and transpose tests
  - id: cargo
    resource: /api/Cargo.toml
    title: Crate and dependencies
  - id: pkg
    resource: /web/package.json
    title: Web scripts
generated: { by: agent, at: 2026-09-27T12:00:00Z }
---

# Build and CI

`api/` and `web/` build separately. There is no root workspace or package.

## Commands

```bash
# API (Rust 2024 edition; needs DATABASE_URL for tests)
cargo fmt --manifest-path api/Cargo.toml --all -- --check
cargo clippy --manifest-path api/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path api/Cargo.toml --all-features

# Web
cd web && bun install && bun run build     # tsc --noEmit + vite build
cd web && bun run typecheck
cd web && bun run test                     # vitest run (web/tests/)

# Everything, as deployed
docker compose up --build
```

## Tests

- **`api/tests/api_flow.rs` → `private_library_flow`**: `#[sqlx::test]` creates
  a throwaway database from `DATABASE_URL` and applies `./migrations`. It
  drives the router in memory (`tower::ServiceExt::oneshot`) through setup,
  create, update, stale-base 409, search, device token creation, device read,
  device token management denied (403), device create, update, stale delete
  (409) and delete (204, then 404), device import (1 added, 1 skipped),
  revoke, and 401 after revoke.
- **`desktop_browser_sign_in_flow`**: the desktop sign-in code exchange
  ([auth and roles](auth-and-roles.md#desktop-browser-sign-in)).
- **`sets_flow`**: a desktop creates a set with its own id (201) and again
  (409); a leader reorders it keeping item ids (version 2); the desktop's
  edit on version 1 is 409; a viewer lists sets but cannot create (403);
  unknown songs, a song item without `song_id` and an out-of-range transpose
  are 400; a deleted song shows `song: null` in the snapshot; a stale delete is
  409, a current one 204, then 404 ([sets](sets.md)).
- **`remote_control_flow`**: empty list; a person session cannot report
  (403); a desktop reports and shows online with its slide labels; a command
  to a desktop that does not accept commands is 409; commands are 202 with
  `issued_by`; a missing field is 400; a viewer lists but cannot send (403);
  the desktop receives queued commands in order, once; a long poll wakes when
  a command arrives; after leaving, commands are 404
  ([remote control](remote-control.md)).
- **`chordpro.rs` unit tests**: metadata extraction and hash stability.
- **`web/tests/chordpro.test.ts`** (vitest): chord splitting, section and
  verse parsing, comments and `meta` key, and transposition (slash basses,
  flats, non-chords, the song key). `tsconfig.json` includes only `src/`, so
  `tsc --noEmit` does not type-check the tests.
- Nothing covers export content, the revisions list, sign-in failure, most
  limits, cross-church isolation, or the web views.

## CI (`.github/workflows/ci.yml`, on every push and PR)

| Job | Does |
| --- | --- |
| `api` | Postgres 17 service; `cargo fmt --check`, `clippy -D warnings`, `cargo test` |
| `web` | Bun 1.3.4; `bun install --frozen-lockfile`, `bun run build`, `bun run test` |
| `container` | Buildx builds the image as `psa150/song-server:test` with `push: false` |

Missing: release tagging, image publishing and signing, and a multi-arch
build. These are in the TODO under deployment and operation ([gaps](gaps.md)).
