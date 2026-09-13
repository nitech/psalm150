# Psalm150 wiki — agent schema

Compiled knowledge for the Psalm150 repo. Agents write it; people read it.
Follow the global `llm-wiki` skill (OKF core). This file is the
producer-defined extra for *this* repo.

## Where it lives

`.wiki/` is the bundle. `overview.md` is the way in, `index.md` the catalog,
`log.md` the chronology. Older prose lives in `/docs/` and `/CONCEPTS.md` —
cite those as `sources`; do not copy them in.

## When to update

After any non-trivial change to architecture, contracts (IPC commands, events,
config fields, the ChordPro dialect, the songs-folder layout), failure modes,
or operator-visible behaviour: update the touched pages **in the same turn**.
Skip formatting-only and tests-only diffs.

## How to write

- One concept per file under `concepts/`, kebab-case filenames. `index.md`
  and `log.md` are reserved names at every level.
- YAML frontmatter with `type` required. Cite code through `sources` with
  bundle-relative paths (`/src-tauri/src/...`, `/src/...`, `/docs/...`).
- Describe behaviour and contracts, not implementation trivia. Name the
  constants and commands that matter so they can be grepped.
- Say what is **not** wired up (commands with no UI, config that is stored but
  unused). Those gaps mislead the next reader most; `concepts/gaps.md` is the
  roll-up.
- Cross-link with relative markdown paths: `[Slide pipeline](slide-pipeline.md)`.
- After edits: bump `generated.at` on touched pages, refresh `index.md`, and
  append a date-grouped line to `log.md` (newest date first, `YYYY-MM-DD`).

## Do not

- Rewrite the whole bundle for a one-file change.
- Put a model name into a page; say "the agent".
- Duplicate `/docs/` content; link it.
