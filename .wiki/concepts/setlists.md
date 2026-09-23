---
type: Concept
title: Setlists
description: Per-PC JSON setlists — the store, the item model, the add-to-setlist menu that fills them and the Setlist view.
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
    title: Add-to-setlist menu, Setlist view, next song
generated: { by: agent, at: 2026-09-23T20:00:00Z }
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
(saves and activates), `add_to_setlist(id, filename)` (appends a song item
unless present), `remove_from_setlist(id, filename)`, `load_setlist(id)`,
`save_setlist(setlist)`, `setlist_advance` / `setlist_previous` (move the
backend cursor), `list_hold_slides` (always empty today), and
`format_short_date` (today in the Windows short date format, for default
names). `SetlistStore::update` loads, changes and saves one file and keeps the
active copy in step.

## UI today

- **Add to setlist** (+) on the song title row adds or removes the selected song and
  creates a setlist named with today's short date
  ([operator console](operator-console.md#favourite-star-and-add-to-setlist)). `date` is stored as
  the local ISO date.
- **Setlist** toolbar button opens the Setlist view: a picker over all
  setlists (name and song count), the items in service order with titles
  from the index, and **Next song**, which projects the item after the song
  on screen (or the first). This is computed in the console; the backend
  cursor (`setlist_advance`) is no longer used.
- The active setlist is per PC (`localStorage`), not stored in the backend.
  Nothing is active until the operator picks a setlist in the view, or adds a
  song while none is active.

Still missing: reordering items, blank/hold items, and stepping back; see
[gaps](gaps.md).

## Related

- [Songs folder](songs-folder.md): where the JSON lives
- [Operator console](operator-console.md)
