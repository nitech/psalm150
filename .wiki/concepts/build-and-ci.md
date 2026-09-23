---
type: Concept
title: Build and CI
description: The commands that build and test each half, the single integration test and what it covers, and the three GitHub Actions jobs.
tags: [build, test, ci, github-actions]
status: stable
sources:
  - id: ci
    resource: /.github/workflows/ci.yml
    title: CI workflow
  - id: test
    resource: /api/tests/api_flow.rs
    title: private_library_flow
  - id: cargo
    resource: /api/Cargo.toml
    title: Crate and dependencies
  - id: pkg
    resource: /web/package.json
    title: Web scripts
generated: { by: agent, at: 2026-09-23T19:00:00Z }
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
- **`chordpro.rs` unit tests**: metadata extraction and hash stability.
- There are no web tests. Nothing covers export content, the revisions list,
  sign-in failure, viewer sessions, limits, or cross-church isolation.

## CI (`.github/workflows/ci.yml`, on every push and PR)

| Job | Does |
| --- | --- |
| `api` | Postgres 17 service; `cargo fmt --check`, `clippy -D warnings`, `cargo test` |
| `web` | Bun 1.3.4; `bun install --frozen-lockfile`, `bun run build` |
| `container` | Buildx builds the image as `psa150/song-server:test` with `push: false` |

Missing: release tagging, image publishing and signing, and a multi-arch
build. These are in the TODO under deployment and operation ([gaps](gaps.md)).
