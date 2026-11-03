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
    title: Integration tests, from private_library_flow to openapi_describes_every_operation
  - id: webtest
    resource: /web/tests/chordpro.test.ts
    title: ChordPro display and transpose tests
  - id: cargo
    resource: /api/Cargo.toml
    title: Crate and dependencies
  - id: pkg
    resource: /web/package.json
    title: Web scripts
  - id: hook
    resource: /.githooks/pre-commit
    title: Version bump on every commit
generated: { by: agent, at: 2026-10-23T09:30:00Z }
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

# Online song search crate (shared with the desktop)
cargo test --manifest-path shared/lyrics/Cargo.toml
cargo run --manifest-path shared/lyrics/Cargo.toml --example search -- "way maker"

# Everything, as deployed
docker compose up --build
```

## Version

Every commit bumps the patch version (`0.1.4` → `0.1.5`) through
`.githooks/pre-commit`, which needs `git config core.hooksPath .githooks` once
per clone. It writes the same version to `api/Cargo.toml` (`version` in
`/api/v1/health` and `/api/v1/info`), the `psa150-server` entry in
`api/Cargo.lock` (the Docker build runs `cargo build --locked`, which fails if
the two disagree) and `web/package.json` (shown with the build time at the foot
of the web client's menu). If `api/Cargo.toml`'s version was already changed in
the commit, that version is kept and copied to the other two, so a minor or
major bump is made by hand there. `SKIP_VERSION_BUMP=1` skips the hook; an
amend bumps again. `.gitattributes` keeps the hook's line endings LF so it runs
from a Windows checkout.

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
- **`rooms_flow`**: a desktop has a flower room (a person session cannot read
  it, 403) and a second desktop another; renames are tidied, matched loosely
  and unique (409), with a bad name 400; a leader renames, a viewer cannot
  (403); a room is `offline`, then `live` with the words, unknown names 404;
  the room's event stream follows slide changes, blank, stopped sharing
  (`idle`, no words) and back; the desktop list stream pushes, and needs a
  token (401); an owner closes rooms (open stream `idle`, reads 404,
  `/info.rooms` false; a viewer cannot, 403); revoking a desktop frees its
  name for another. **`desktops_made_before_rooms_get_one`**: a desktop
  without a room name gets a flower on its next report ([rooms](rooms.md)).
- **`api_tokens_act_as_their_person`**: `GET /session` for a session and a
  desktop; an API token takes its person's role, renames the church, makes a
  desktop token and a member; a `viewer` token reads but gets 403 on writes,
  owner and leader routes and 400 for a stronger token; desktops make no API
  tokens; people list their own tokens and owners everyone's; revoking, an
  expiry in the past (400) and a passed expiry (401); `DELETE /session` ends
  a session, an API token and a desktop token, and nothing else
  ([auth and roles](auth-and-roles.md#api-tokens)).
- **`owners_manage_members`**: adding people (duplicate username in another
  case 409, short password and blank name 400); only owners list or change
  them; a demotion limits the person's API token at once; a password reset
  signs the person out but keeps API tokens; disabling locks out sessions,
  sign-in and API tokens for good; renames and a taken username (409); the
  last active owner cannot be demoted, disabled or removed (409); account
  fields of someone in another church are 403 while their role and removal
  work; a removed person cannot sign in, keeps a disabled account without a
  username, and the username can be given to someone new
  ([auth and roles](auth-and-roles.md#members)).
- **`wrong_passwords_are_limited`** (with `X-Forwarded-For` as the client
  header): setup once done is 409; a successful sign-in clears the
  username's count; five wrong passwords from five clients close the username
  (429 with `Retry-After`, even for the right password) while others sign in;
  thirty failures from one client for unknown usernames make that client wait
  but not another; five wrong current passwords close the password change
  ([auth and roles](auth-and-roles.md#limits-on-wrong-passwords)).
- **`people_change_passwords_and_choose_a_church`**: wrong current password
  403, short new one 400, desktop 403; after a change this session and API
  tokens work and other sessions are 401; sign-in picks the first church or
  the one in `church_id`, and 401 for a church the person is not in.
- **`deleted_songs_and_sets_come_back`**: reading an earlier revision, and 404
  for another song's; listing deleted songs and restoring (viewer 403,
  desktop 200, again 200, unknown 404) with history kept; the same for sets
  (restored as a new version); paging sets with `offset`.
- **`openapi_describes_every_operation`**: every operation in
  `/api/openapi.json` carries the `bearer` scheme unless it is one of the
  ten public ones, and is routed ([API contract](api-contract.md#openapi)).
- **`songs_page_in_title_order`**, **`songs_sort_by_number`**,
  **`public_library_flow`** and **`song_permalink_page`**: song paging and
  sorting, the public library switch and reads, and the permalink page.
- **`chordpro.rs` unit tests**: metadata extraction and hash stability.
- **`rooms.rs` unit tests**: room keys ignore case, accents and spacing; the
  flowers are distinct, valid and plain ASCII; chosen names are tidied and
  checked; a free flower skips taken names and then numbers them.
- **`throttle.rs` unit tests**: the sliding window and `Retry-After`, clearing,
  the client address (configured header, its last entry, peer fallback, IPv6
  /64, IPv4-mapped) and the wait text.
- **`web/tests/chordpro.test.ts`** (vitest): chord splitting, section and
  verse parsing, comments and `meta` key, and transposition (slash basses,
  flats, non-chords, the song key). `tsconfig.json` includes only `src/`, so
  `tsc --noEmit` does not type-check the tests.
- **`web/tests/a11y.test.ts`** (vitest): screen titles, the radio group's
  arrow keys, matching "the same control" after a redraw, and toast timing
  ([accessibility](accessibility.md)). The axe and keyboard checks run by
  hand against a server (see that page); CI does not run them.
- Nothing covers export content, most limits, isolation between two
  churches beyond members and revisions, or the web views.

## CI (`.github/workflows/ci.yml`, on every push and PR)

| Job | Does |
| --- | --- |
| `api` | Postgres 17 service; `cargo fmt --check`, `clippy -D warnings`, `cargo test` |
| `web` | Bun 1.3.4; `bun install --frozen-lockfile`, `bun run build`, `bun run test` |
| `container` | Buildx builds the image as `psa150/song-server:test` with `push: false` |

Missing: release tagging, image publishing and signing, and a multi-arch
build. These are in the TODO under deployment and operation ([gaps](gaps.md)).
