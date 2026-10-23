---
type: Principle
title: Works without a server
description: The desktop must do everything it offers on its own, with no song server; how code both need is shared (mirrored from the server repo's shared/) instead of moved to the server.
tags: [principle, architecture, server, shared]
status: stable
sources:
  - id: sync
    resource: /scripts/sync-shared.mjs
    title: Mirrors the server's shared/ folder (tokens, icons, the lyrics crate)
  - id: workflow
    resource: /.github/workflows/shared.yml
    title: Fails when a mirror drifts
generated: { by: agent, at: 2026-10-23T09:30:00Z }
---

# Works without a server

**The desktop must be able to work stand-alone.** The song server is
optional and many churches never set one up. Everything the desktop offers
must work with a local songs folder and no server: searching, projecting,
editing, setlists, importing, and [finding songs online](web-search.md).

A server library adds sharing and sync ([server library](server-library.md)).
It must never become the only way the desktop can do something.

## Sharing code instead of moving it

When the desktop and the server (or its web client) need the same logic,
share the code. Do not make the desktop call the server for it.

- The server repo's `shared/` is canonical. `bun run sync:shared` mirrors it:
  `psa150-tokens.css` and `icons.ts` into `src/shared/`
  ([design tokens](design-tokens.md)), and the `shared/lyrics` crate into
  `src-tauri/crates/psa150-lyrics/`, a Cargo path dependency.
- Never edit a mirror. Change the server repo, then sync.
  `bun run check:shared` and the "Shared files" workflow fail on drift.
- Shared Rust code must build in both places. It must not depend on Tauri,
  the database or the server's Axum stack, and it must use an async HTTP
  client so it runs off the desktop's main thread.

## When designing a feature

Ask first: does it work without a server? If it needs the network (like
online search), the desktop does the request itself. The server may offer
the same thing to clients that cannot do it, such as the web client, using
the shared code.
