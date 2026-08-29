---
type: Concept
title: Setlists
description: Per-PC JSON setlists with advance/previous — the store, the item model, and how little of it has UI.
tags: [setlists, console]
status: stable
sources:
  - id: setlist
    resource: /src-tauri/src/setlist.rs
    title: SetlistStore and hold slides
  - id: cmd
    resource: /src-tauri/src/commands/setlist_cmd.rs
    title: Setlist commands
  - id: app
    resource: /src/components/app.ts
    title: Setlist tab (create, advance)
generated: { by: agent, at: 2026-08-29T19:45:00Z }
---

# Setlists

Setlists are **local to the PC**: `libraries/<hash>/setlists/<uuid>.json`.
Songs sync through the folder; setlists do not.

## Model

`Setlist { id (uuid v4), name, date, items[] }` and
`SetlistItem { type: song | blank | hold, file?, transpose?, arrangement?, id? }`.
`SetlistStore` keeps the `active` setlist plus `item_index` / `slide_index`
cursors (`slide_index` is never read by a command).

## Commands

`list_setlists` (sorted by date, newest first), `create_setlist(name, date)`
(saves and activates), `load_setlist(id)`, `save_setlist(setlist)`,
`setlist_advance` / `setlist_previous` (move the cursor and return the item, or
`None` at the ends), `list_hold_slides` (file names under `hold_slides/`,
always empty today).

## UI today

Setlist tab: name and date inputs, **Create** (defaults "Service" / today) and
**Advance** (loads the next song item and projects it). The list shows the
active setlist's song items with titles derived from filenames. There is **no
way to add items, load an existing setlist, step back, or use blank/hold
items from the UI**; see [gaps](gaps.md).

## Related

- [Songs folder](songs-folder.md): where the JSON lives
- [Operator console](operator-console.md)
