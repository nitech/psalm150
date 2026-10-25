# Psalm150 Song Server — agent instructions

Optional, self-hosted song library for the Psalm150 desktop app: a Rust/Axum
API on PostgreSQL (`api/`) and an independent Vite/TypeScript web client
(`web/`) that uses only the public API. Package manager for `web/` is **bun**.

## Wiki

Compiled knowledge lives in `.wiki/` (schema: `.wiki/AGENTS.md`; start at
`.wiki/overview.md`, catalog in `.wiki/index.md`). After any non-trivial
change to architecture, contracts (HTTP endpoints, request/response schemas,
token formats, roles, env vars, the PostgreSQL schema, the import/export format,
the desktop sync protocol) or operator-visible behaviour, update the touched
pages, `index.md` and `log.md` in the same turn. Skip trivial and no-behaviour
diffs. Human docs stay in `docs/`, `README.md` and `TODO.md`; the wiki links
to them rather than copying.

## Commands

```bash
docker compose up --build                                  # full stack (needs .env)
cargo run --manifest-path api/Cargo.toml                   # API (needs DATABASE_URL)
cargo test --manifest-path api/Cargo.toml --all-features   # needs DATABASE_URL
cargo clippy --manifest-path api/Cargo.toml --all-targets --all-features -- -D warnings
cargo fmt --manifest-path api/Cargo.toml --all -- --check
cd web && bun install && bun run dev                       # proxies /api to :8080
cd web && bun run build                                    # tsc --noEmit + vite build
cd web && bun run test                                     # vitest
git config core.hooksPath .githooks                        # once per clone: bump the version on every commit
```

## Rules that are easy to break

- Every church-owned query filters on the caller's `church_id`.
- Everything the server does is reachable through `/api/v1` with a token; no
  operation is web-only or database-only. Authenticated operations carry
  `security(("bearer" = []))`, and `openapi_describes_every_operation` lists
  the public ones and checks that every documented operation is routed, has
  a summary (the handler's doc comment) and is in one section (`GROUPS` in
  `api.rs`, matched by path; a new top-level path needs an entry).
- API (`psa_a_`) tokens act as their person in one church. `authenticate`
  gives them the lower of the token's `role` and the person's current
  membership role, so `require_editor` and `require_owner` treat them like
  sessions. A token is never made with more than its maker's effective role.
- Desktop (`psa_d_`) tokens may read, import, create, edit and delete songs
  and sets (`require_song_editor`); `require_editor` must keep rejecting them
  for token management, desktop approval, sending remote commands and anything
  else that is not church content, and `require_person` for passwords and API
  tokens. Device writes record the device
  (`created_by_device`, `updated_by_device`, `deleted_by_device`).
- Only owners manage people (`/members`). Changes to a church's people run
  under its row lock and keep at least one owner who is not disabled
  (`ensure_another_owner`). Account fields (name, username, password,
  disabled) change only for a person in no other church; their role here
  always can.
- Remote steering (`POST /remote/desktops/{id}/commands`) is `require_editor`:
  person owners and leaders only. The `/remote/desktop*` routes accept only
  desktop tokens. The relay is in memory; do not assume it survives a restart.
- Rooms (`rooms.rs`) are public: `/public/rooms/{room_name}` and its events
  show words only while the desktop projects with `shares_room` and its
  church has `public_rooms`; a church with rooms closed answers 404 like an
  unknown name. Room names are unique across the server (not per church),
  matched by `room_key`, and freed when the desktop is revoked.
- Shared sets (`shared_sets.rs`) are public through their link:
  `/public/sets/{key}` reads one set and its songs, and an editable link may
  only add song items and remove song items (never blanks, other items'
  fields, the name or date). Sharing is `require_editor`, so desktops cannot
  share. Every public lookup filters on `share_key` and `deleted_at IS NULL`,
  and songs on the set's own `church_id`.
- Leading a set live (`live_sets.rs`) is in memory like the relay. `PUT`
  and `DELETE /sets/{id}/live` are `require_editor`; the public
  `/public/sets/{key}/live/events` stream holds a `Viewer` guard that
  counts it and ends when the link stops working.
- Store tokens only as SHA-256 hashes; never log a raw token. A set's
  `share_key` is the one exception: it is a link leaders copy again, and it
  opens only that set.
- Wrong passwords are counted in memory (`throttle.rs`). Check the limit
  before any Argon2 work, and count unknown usernames like wrong passwords,
  so neither a 429 nor the timing tells which usernames exist.
- Revisions are immutable. Song updates go through the `base_revision_id`
  check under the `FOR UPDATE` lock; a stale base is `409`, never last-write-wins.
  Set updates and deletes do the same with `base_version`.
- Import dedup hashes the exact ChordPro bytes. Changing the hash input changes
  sync behaviour for every connected desktop; coordinate with the client.
- The web client has no private contract. New handlers and schemas go in the
  `ApiDoc` `paths(...)` / `components(...)` lists, and `web/src/types.ts`
  mirrors `api/src/models.rs` by hand.
- Migrations in `api/migrations/` are append-only; they run at startup.
- `shared/` (design tokens, icons, `chord-match.ts` for chords from the
  web, and the `shared/lyrics` online song lookup crate) is canonical for
  both apps. The desktop mirrors it with
  `bun run sync:shared`; edit here, then sync the desktop.
- The desktop must work without a song server. Never move something the
  desktop needs into the server only; share the code instead (as
  `shared/lyrics` is shared).
- Docs and wiki describe behaviour, not models. Say "the agent".
