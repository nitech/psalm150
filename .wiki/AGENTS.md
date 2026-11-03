# Psalm150 Song Server wiki — agent schema

Compiled knowledge for the Song Server repo. Agents write it; people read it.
Follow the global `llm-wiki` skill (OKF core). This file is the
producer-defined extra for *this* repo. It mirrors the schema of the desktop
client's wiki (`.wiki/` in the `PSA150` client repo) so the two bundles read
alike.

## Where it lives

`.wiki/` is the bundle. `overview.md` is the way in, `index.md` the catalog,
`log.md` the chronology. Older prose lives in `/docs/song-server.md`, `/TODO.md` and
`/docs/` — cite those as `sources`; do not copy them in.

## When to update

After any non-trivial change to architecture, contracts (HTTP endpoints,
request/response schemas, token formats, roles, environment variables, the
PostgreSQL schema, the import/export format, the desktop sync protocol),
failure modes, or operator-visible behaviour: update the touched pages **in
the same turn**. Skip formatting-only and tests-only diffs.

## How to write

- One concept per file under `concepts/`, kebab-case filenames. `index.md`
  and `log.md` are reserved names at every level.
- YAML frontmatter with `type` required. Cite code through `sources` with
  bundle-relative paths (`/api/src/...`, `/api/migrations/...`, `/web/src/...`,
  `/docs/...`).
- Describe behaviour and contracts, not implementation trivia. Name the
  endpoints, tables, env vars and error statuses that matter so they can be
  grepped.
- Say what is **not** wired up (schema columns with no endpoint, endpoints the
  web client does not call, designed-but-unbuilt behaviour in `/docs/`). Those
  gaps mislead the next reader most; `concepts/gaps.md` is the roll-up.
- Code in the desktop client repo cannot be cited by bundle path. Name the
  file in prose (for example `src-tauri/src/commands/server_library.rs` in the
  client repo) and link to its wiki page by name.
- Cross-link with relative markdown paths: `[API contract](api-contract.md)`.
- After edits: bump `generated.at` on touched pages, refresh `index.md`, and
  append a date-grouped line to `log.md` (newest date first, `YYYY-MM-DD`).

## Do not

- Rewrite the whole bundle for a one-file change.
- Put a model name into a page; say "the agent".
- Duplicate `/docs/` content; link it.
