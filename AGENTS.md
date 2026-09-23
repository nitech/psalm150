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
```

## Rules that are easy to break

- Every church-owned query filters on the caller's `church_id`.
- Desktop (`psa_d_`) tokens may read, import, create, edit and delete songs
  (`require_song_editor`); `require_editor` must keep rejecting them for token
  management and anything else that is not song content. Device writes record
  the device (`created_by_device`, `deleted_by_device`).
- Store tokens only as SHA-256 hashes; never log a raw token.
- Revisions are immutable. Song updates go through the `base_revision_id`
  check under the `FOR UPDATE` lock; a stale base is `409`, never last-write-wins.
- Import dedup hashes the exact ChordPro bytes. Changing the hash input changes
  sync behaviour for every connected desktop; coordinate with the client.
- The web client has no private contract. New handlers and schemas go in the
  `ApiDoc` `paths(...)` / `components(...)` lists, and `web/src/types.ts`
  mirrors `api/src/models.rs` by hand.
- Migrations in `api/migrations/` are append-only; they run at startup.
- Docs and wiki describe behaviour, not models. Say "the agent".
