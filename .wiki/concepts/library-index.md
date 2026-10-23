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
  - id: search
    resource: /src-tauri/src/search.rs
    title: Word matching, spelling tolerance and match ranks (unit tested)
generated: { by: agent, at: 2026-10-23T12:10:00Z }
---

# Library index

`index.sqlite` under the library's app-data root. Rebuilt from a full folder
scan (`rebuild_from_songs`: delete all, insert all, refill FTS) and patched by
`upsert_song` / `delete_song` after in-app edits. `song_search` takes its
text from `songs` (external content), so one song leaves it through the FTS5
`'delete'` command with the old values, run before `songs` changes
(`forget_search_entry`). A plain `DELETE` on it, as before 2026-10-23,
reported "database disk image is malformed" for a song it had never indexed,
so saving a new song could fail to update the index. `next_song_num` is the
highest `song_num` plus one, the number a new song gets.

## Schema

| Table | Columns | Notes |
| --- | --- | --- |
| `songs` | `id, filename UNIQUE, title, title_sort, song_num, key, category, tags, ccli, body_plain, modified_at` | `title_sort` = upper-cased title; `body_plain` = every lyric line joined by newlines; `modified_at` = file mtime, RFC 3339 |
| `song_search` | FTS5 over `title, body_plain, tags` (content table `songs`) | **Populated but never queried**: search runs in Rust ([search semantics](#search-semantics)) |
| `history` | `filename, title, accessed_at` | Appended once by `project_song` for each library-song projection session |
| `favorites` | `filename` | Toggled by `toggle_favorite` |

## `SongRow`

`id, filename, title, title_sort, song_num, key, category, tags, ccli,
modified_at, favorite`, plus `match_rank` (0–3) on search hits only: the
shape the song list renders. The console
synthesises rows with null number and key for the History view (and for
setlist items whose file is missing).

## Search semantics

`search_songs(query, favorites_only)`:

- Empty query: `list_all` (every song, `ORDER BY title_sort`).
- Otherwise `search.rs`: the query is split into words, and **every word**
  must appear in the title or in the lyrics and tags (`body_plain` + `tags`).
  Text is lower-cased, common accents are folded (é → e), apostrophes are
  dropped (it's → its); æ, ø and å stay distinct letters.
- A word matches exactly when it occurs anywhere in the field (so a prefix
  being typed matches). Otherwise it may match a word of the field with
  **spelling mistakes**: none for words of up to 3 letters, one for 4–6, two
  for 7 or more. Insertions, deletions, substitutions and swapped neighbours
  each count as one (optimal string alignment); a word still being typed is
  also compared with the start of longer words ("haleluj" finds
  "Hallelujah").
- A number-only query (`227`, `#227`) also matches `song_num` as a substring.
- Each hit gets `match_rank`: 0 every word in the title (or the number), 1
  in the title with a mistake, 2 in title/lyrics/tags, 3 the same with a
  mistake. Results come back by rank, then title.
- `favorites_only` filters to favourites.
- The prepared text of every song is cached on the `Database` after the first
  search and dropped by `rebuild_from_songs`, `upsert_song` and
  `delete_song`. With about 1,000 songs a search takes 10–50 ms in a debug
  build.

`list_by_key(key)` is an exact match; `list_keys` / `list_categories` return
the distinct non-empty values. `list_by_category`, `renumber_songs` and
`compact_library` exist but have no UI ([gaps](gaps.md)).

## History and favourites

`get_history(limit)` returns `(filename, title, accessed_at)` newest first; the
console asks for 50. Favourites are listed in the Favourites view and toggled
with the star on the song title row (`toggle_favorite`, `list_favorites`).

## Ordering in the console

Sorting by Song / No / Key happens client-side over the returned rows
([operator console](operator-console.md)), **within** each `match_rank`, so
title hits stay above lyric hits; the SQL order only matters for the History
and Setlist views. `#Key` in the search field uses `list_by_key`
intersected with the text search.

## Related

- [Songs folder](songs-folder.md): when the index is rebuilt
