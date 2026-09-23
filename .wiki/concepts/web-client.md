---
type: Concept
title: Web client
description: The bundled Vite/TypeScript admin client — screens, session storage, song list and detail, ChordPro editor, import/export, desktop-token dialog, and what it does not expose.
tags: [web, ui, vite, typescript]
status: stable
sources:
  - id: main
    resource: /web/src/main.ts
    title: Screens, rendering, event wiring
  - id: api
    resource: /web/src/api.ts
    title: SongServerApi wrapper
  - id: types
    resource: /web/src/types.ts
    title: Response types (mirrors models.rs by hand)
  - id: styles
    resource: /web/src/styles.css
    title: All styling
  - id: vite
    resource: /web/vite.config.ts
    title: Dev server on 5173 proxying /api to 8080
generated: { by: agent, at: 2026-09-23T00:00:00Z }
---

# Web client

A single-page app in plain TypeScript: no framework, and each screen is
rendered as an `innerHTML` template string. Every user-supplied string goes
through `escapeHtml`. It talks to the server only through `SongServerApi` and
the public `/api/v1` endpoints ([API contract](api-contract.md)). `types.ts`
copies the Rust response models **by hand**, so a change to the API schema
needs a matching change there.

## Screens

- **Boot** calls `GET /setup`. If the server is not initialised, it shows
  **Setup** ("Begin your library"). If it is, it shows **Sign-in** when the
  stored session is missing or expired, and the **Library** otherwise. If the
  server cannot be reached, it shows "The Song Server is not reachable" with a
  retry button.
- **Library** has a side rail and a main pane:
  - The rail's *Songs* entry is active. *Plans* and *People* are disabled and
    marked "Later".
  - The toolbar has search (submitted with Enter), **Import ChordPro**,
    **Export**, **Connect desktop** and **New song**.
  - The song list shows the number (or its position if the song has none), the
    title, authors and language, and a relative "Updated" date.
  - Tapping a row loads `GET /songs/{id}` and opens the detail pane. It shows
    the full lyric text (directive lines removed, `[chords]` stripped), the
    first 8 characters of the revision id, the language, and **Edit ChordPro**.
- **Editor dialog** is a raw ChordPro textarea. New songs start from a
  title/author/language/verse template. Saving an existing song sends its
  current `revision_id` as the base, so a 409 shows up as the form message
  ([songs and revisions](songs-and-revisions.md)).
- **Connect desktop dialog** creates a named token and shows it once with a
  copy button. It lists active tokens with "Last used" and a **Revoke** button
  ([auth and roles](auth-and-roles.md)).

## State

- The session is kept in `sessionStorage["psa150-server-session"]`, so it is
  per tab and gone when the tab closes. A 401 while loading the library clears
  it and shows sign-in.
- One `busy` flag stops overlapping actions. Feedback is a toast that lasts
  3.2 s.
- Sign-out only clears storage. The token stays valid on the server until it
  expires.

## Not exposed

Revision history (`/songs/{id}/revisions`), paging past the first 100 search
results, member management, plans, and anything admin-only. There is no role
check in the UI: a viewer would see the edit buttons and get 403 from the
server.

## Develop

`cd web && bun install && bun run dev` serves on port 5173 and proxies `/api`
to `localhost:8080`. `bun run build` runs `tsc --noEmit` and then outputs
`vite build` to `web/dist`, which the API serves in production
([deployment](deployment.md)).
