---
type: Principle
title: Works without a server
description: The desktop must do everything it offers on its own, with no song server; how code both need is shared (the monorepo's shared/ folder, used by both apps) instead of moved to the server.
tags: [principle, architecture, server, shared]
status: stable
sources:
  - id: shared
    resource: /../shared/
    title: Code both apps use as it is (tokens, icons, song modules, sounds, the lyrics crate)
  - id: workflow
    resource: /../.github/workflows/desktop.yml
    title: Builds and tests the desktop frontend on every change to it or to shared/
generated: { by: agent, at: 2026-11-03T08:30:00Z }
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

- The desktop and the song server live in one repository (the desktop in
  `desktop/`), and both use the root `shared/` folder as it is, with no copies:
  `psa150-tokens.css` and `icons.ts` ([design tokens](design-tokens.md)),
  `shared/songs/` (the song editor, chord sheet and sound, recordings, sheets
  and their CSS; set up by `src/song-host.ts`), the chord sounds in
  `shared/sounds/` (served at `/sounds/` by `shared/vite-sounds.mjs`, a Vite
  plugin both apps load), and the `shared/lyrics` crate, a Cargo path
  dependency (`../../shared/lyrics`).
- A change in `shared/` reaches both apps at once. The "Desktop" workflow
  builds and tests the desktop frontend on every change to `desktop/` or
  `shared/`, so a change made for the web client cannot quietly break it, and
  a push to main that touches either publishes a desktop release.
- Shared Rust code must build in both places. It must not depend on Tauri,
  the database or the server's Axum stack, and it must use an async HTTP
  client so it runs off the desktop's main thread.

## When designing a feature

Ask first: does it work without a server? If it needs the network (like
online search), the desktop does the request itself. The server may offer
the same thing to clients that cannot do it, such as the web client, using
the shared code.
