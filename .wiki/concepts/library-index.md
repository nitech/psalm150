---
type: Concept
title: Library index
description: The per-library SQLite index — schema, what search actually matches, history and favourites.
tags: [library, sqlite, search]
status: stable
sources:
  - id: db
    resource: /src-tauri/src/db.rs
    title: Database schema and queries
  - id: library-cmd
    resource: /src-tauri/src/commands/library.rs
    title: search_songs, list_by_key, get_history, toggle_favorite commands
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Library index

`index.sqlite` under the library's app-data root. Rebuilt from a full folder
scan (`rebuild_from_songs`: delete all, insert all, refill FTS) and patched by
`upsert_song` / `delete_song` after in-app edits.

## Schema

| Table | Columns | Notes |
| --- | --- | --- |
| `songs` | `id, filename UNIQUE, title, title_sort, song_num, key, category, tags, ccli, body_plain, modified_at` | `title_sort` = upper-cased title; `body_plain` = every lyric line joined by newlines; `modified_at` = file mtime, RFC 3339 |
| `song_search` | FTS5 over `title, body_plain, tags` (content table `songs`) | **Populated but never queried**: search uses `LIKE` |
| `history` | `filename, title, accessed_at` | Appended once by `project_song` for each library-song projection session |
| `favorites` | `filename` | Toggled by `toggle_favorite` |

## `SongRow`

`id, filename, title, title_sort, song_num, key, category, tags, ccli,
modified_at, favorite`: the shape the song list renders. The console
synthesises rows with null number and key for the History and Setlist tabs.

## Search semantics

`search_songs(query, favorites_only)`:

- Empty query: `list_all` (every song, `ORDER BY title_sort`).
- Otherwise `LIKE %q%` on `title`, `body_plain` and `tags`, plus `song_num`
  cast to text `LIKE %q%` with a leading `#` stripped (so `#227` and `227`
  both hit). No ranking; results come back alphabetical by `title_sort`.
- `favorites_only` becomes an `INNER JOIN favorites`.

`list_by_key(key)` is an exact match; `list_keys` / `list_categories` return
the distinct non-empty values. `list_by_category`, `renumber_songs` and
`compact_library` exist but have no UI ([gaps](gaps.md)).

## History and favourites

`get_history(limit)` returns `(filename, title, accessed_at)` newest first; the
console asks for 50. Favourites can be listed (Favourites tab) but **nothing in
the UI toggles them** yet; `toggle_favorite` is only reachable over IPC.

## Ordering in the console

Sorting by Song / No / Key happens client-side over the returned rows
([operator console](operator-console.md)); the SQL order only matters for the
History and Setlist tabs.

## Related

- [Songs folder](songs-folder.md): when the index is rebuilt
