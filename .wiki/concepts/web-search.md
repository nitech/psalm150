---
type: Concept
title: Online song search
description: When the library has no match, the console offers to look online and only searches when asked — the shared psa150-lyrics crate run in-process (no server needed), the offer/searching/found states, preview, project and save.
tags: [search, web, online, chordpro]
status: stable
sources:
  - id: crate
    resource: /src-tauri/crates/psa150-lyrics/src/lib.rs
    title: Mirrored lookup crate (canonical in the song server's shared/lyrics)
  - id: cmd
    resource: /src-tauri/src/commands/web_search_cmd.rs
    title: Async search_web_songs and its round-trip test
  - id: state
    resource: /src/online-search.ts
    title: OnlineSearch states and onlineSearchAfter
  - id: app
    resource: /src/components/app.ts
    title: updateOnlineSearch, searchOnline, stopOnlineSearch, save-to-library
  - id: list
    resource: /src/components/song-list.ts
    title: renderEmpty (offer, searching, nothing found, failed), Found online rows
  - id: ids
    resource: /src/components/song-list-ids.ts
    title: __web__N row ids
generated: { by: agent, at: 2026-10-23T09:30:00Z }
---

# Online song search

## Works without a server

The lookup runs **inside the desktop**. It never asks a song server, because
the desktop must work for churches that never set one up
([standalone](standalone.md)). The code is the Rust crate `psa150-lyrics`,
shared with the song server: the server repo's `shared/lyrics/` is canonical
and `bun run sync:shared` mirrors it into `src-tauri/crates/psa150-lyrics/`
(a path dependency; `bun run check:shared` and the "Shared files" workflow
catch drift). **Never edit the mirror**: change the server repo, then sync.
The song server's wiki page `concepts/online-search.md` describes how the
search works: sites, parsing, ranking.

## Trigger (console)

The console never searches online by itself. When all of these hold, the
song list shows an **offer** instead of "No songs found":

- the view is Search;
- `web_search_enabled` is on (Settings → Search: "Offer to search online
  when no songs match");
- the query is text (not `#key`) of at least 3 characters
  (`ONLINE_SEARCH_MIN_CHARS`);
- the library found nothing.

The offer reads: "No songs match "…" — It is not in your library. Search
online for chords and lyrics?" with a **Search online** button ("or press
Enter"). Enter in the search field with no local rows does the same.

`OnlineSearch` (`src/online-search.ts`) is `none | offer | searching | found |
failed`, each with its query. `onlineSearchAfter` keeps the state while the
query is unchanged and goes back to the offer for a new one. A new query also
drops the old results and any web row selection.

- **Searching**: a spinner, "Searching online for "…"…" and **Cancel**. Cancel
  goes back to the offer; the late answer is ignored (generation counter
  `webSearchGeneration`).
- **Found**: a "Found online" header and up to 3 rows. A row shows the title,
  with the site in the key column. The first row is selected and previewed.
  With no results: "Nothing found online for "…"".
- **Failed**: the error ("The search engine did not answer. Try again in a
  minute.") with **Try again**.

Screen readers hear each state through the list's status line.

## Backend

`search_web_songs(query)` is an **async** command, so the search runs off the
main thread and projection, navigation and the rest of the UI keep working.
It returns `[]` when `web_search_enabled` is off, and reuses one HTTP client
(`OnceLock`). `psa150_lyrics::search` usually takes 1–2 s; its timeouts cap it
at about 12 s. It returns `Vec<Candidate { title, artist, source_name,
source_url, chordpro_content }>`.

The test `found_songs_parse_and_project` checks that the crate's ChordPro
parses with this repo's [dialect](chordpro-dialect.md) into labelled
sections. It also checks that it projects with chords on the stage and none
for the audience.

## Preview vs save

- Selecting a web row calls `preview_web_song`. It parses preview slides but
  does not change the active projection and writes nothing. The meta line
  under the title reads "artist · site · Found online".
- Project calls `project_song(content=...)`. This starts an in-memory active
  session with navigation and transpose, but no file.
- **Save to library** calls `save_web_song` after a confirmation. It
  serialises to the normal `{song_num:04}-{title-slug}.pro` name and uses
  exclusive creation with `-1`, `-2`, … suffixes, so it never overwrites an
  existing song. Refused ("Library is read-only") only for a read-only local
  folder. In a **server library** it goes to the song server like an edit:
  `server_library::add_song` posts it (`POST /api/v1/songs`) with the device
  token, so the desktop has the rights of the leader who connected it, then
  writes it into the offline copy and the manifest so it can be edited at once.

## Related

- [Operator console](operator-console.md): where results appear
- [ChordPro dialect](chordpro-dialect.md)
- [Works without a server](standalone.md)
