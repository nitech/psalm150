---
type: Concept
title: Setlists
description: Setlists as JSON per library — local to the PC in a folder library, mirrors of the church's sets in a server library — the item model, the add-to-setlist menu, the Setlist view and Next song.
tags: [setlists, console, server, sync]
status: stable
sources:
  - id: setlist
    resource: /src-tauri/src/setlist.rs
    title: SetlistStore, Setlist.server, SetlistItem.note, hold slides
  - id: cmd
    resource: /src-tauri/src/commands/setlist_cmd.rs
    title: Setlist commands, dirty marking in a server library, set_active_setlist
  - id: server-sets
    resource: /src-tauri/src/commands/server_sets.rs
    title: Sets sync with the song server
  - id: app
    resource: /src/components/app.ts
    title: Add-to-setlist menu, Setlist view, next song, setlists-changed
generated: { by: agent, at: 2026-09-27T12:00:00Z }
---

# Setlists

Setlists are JSON files under the library's app data:
`libraries/<hash>/setlists/<id>.json`. They never go in the songs folder.

- In a **folder library** they are **local to the PC**. Songs sync through
  the folder; setlists do not.
- In a **server library** they **mirror the church's sets** on the song
  server, with the same ids. Changes made here are uploaded, and sets made on
  a phone or another desktop arrive within a minute
  ([server library, sets](server-library.md#sets)).

Each library has its own setlist folder (keyed by the library's hash), so the
setlists of a local folder are not visible, and not uploaded, after switching
to a server library.

## Model

`Setlist { id (uuid v4), name, date, items[], server? }` and
`SetlistItem { type: song | blank | hold, file?, transpose?, arrangement?, id?, note? }`.

- `server: { version, dirty }` exists only in a server library. `version` is
  the server version this copy is based on (`null` until first uploaded);
  `dirty` means changed on this PC and not yet accepted by the server.
- `note` is free text for the team, carried from a song server set.
- The id names the file, so `SetlistStore` refuses ids that are not 1–64 of
  `[A-Za-z0-9_-]` (`setlist::valid_id`); mirroring skips server sets with
  such ids.
- `date` is the local ISO date for setlists made here; a set from the server
  carries its `service_date` (empty when the server has none).

`SetlistStore` keeps the `active` setlist plus `item_index` / `slide_index`
cursors (`slide_index` is never read by a command). `get(id)` reads one
setlist without activating it; `remove(id)` deletes the file and clears the
active copy when it matches (used only by sets sync).

## Commands

`list_setlists` (sorted by date, newest first), `create_setlist(name, date)`
(saves and activates), `add_to_setlist(id, filename)` (appends a song item
unless present), `remove_from_setlist(id, filename)`, `load_setlist(id)`,
`save_setlist(setlist)`, `setlist_advance` / `setlist_previous` (move the
backend cursor), `list_hold_slides` (always empty today), and
`format_short_date` (today in the Windows short date format, for default
names). `SetlistStore::update` loads, changes and saves one file and keeps the
active copy in step.

In a server library, `create_setlist`, `add_to_setlist`,
`remove_from_setlist` and `save_setlist` mark the setlist `dirty` (keeping
its `version`) and start a background upload (`server_sets::request_sync`);
the command returns without waiting for the server.

`set_active_setlist(id?)` tells the backend which setlist the console works
from (`RuntimeState.current_setlist_id`). Only the song server's
[remote control](remote-control.md#through-the-song-server) reads it; the
backend `active` setlist and cursors are separate and unused by the console.

There is no command to delete or rename a setlist.

## UI today

- **Add to setlist** (+) on the song title row adds or removes the selected song and
  creates a setlist named with today's short date
  ([operator console](operator-console.md#favourite-star-and-add-to-setlist)).
- **Setlist** view (activity bar): a picker over all setlists (name and song
  count), the items in service order with titles from the index, and
  **Next song**, which projects the song item after the song on screen (or
  the first) and then applies that item's `transpose`, so a key a leader
  chose on the server is used. This is computed in the console; the backend
  cursor (`setlist_advance`) is not used.
- The chosen setlist is remembered per PC (`localStorage`) and reported to
  the backend with `set_active_setlist` whenever it changes or the list is
  refreshed. Nothing is active until the operator picks a setlist in the
  view, or adds a song while none is active.
- On `setlists-changed` (a sets sync changed something) the console reloads
  the setlists and the Setlist view, and toasts each conflict ("… was changed
  elsewhere; your changes are kept as a copy") and any song items left out
  because the song is not on the server.

Still missing: reordering items, blank/hold items from the UI, stepping back,
deleting a setlist; see [gaps](gaps.md).

## Related

- [Server library](server-library.md#sets): upload, conflicts, mirroring
- [Songs folder](songs-folder.md): where the JSON lives
- [Operator console](operator-console.md)
