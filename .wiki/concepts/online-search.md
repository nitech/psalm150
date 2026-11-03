---
type: Concept
title: Online song search
description: Finding a song that is not in the library: the shared psa150-lyrics crate (search engine, chart sites, page text to ChordPro), why the desktop runs it itself, GET /songs/online with its memory and limits, and the web client's offer, search and check-before-saving flow.
tags: [search, online, chordpro, shared, web-client]
status: stable
sources:
  - id: crate
    resource: /shared/lyrics/src/lib.rs
    title: search, Candidate, timeouts and limits
  - id: discover
    resource: /shared/lyrics/src/discover.rs
    title: DuckDuckGo results, trusted and skipped sites
  - id: page
    resource: /shared/lyrics/src/page.rs
    title: Page text blocks, Ultimate Guitar store, title and artist
  - id: lrclib
    resource: /shared/lyrics/src/lrclib.rs
    title: LRCLIB lyrics database (words only)
  - id: chart
    resource: /shared/lyrics/src/chart.rs
    title: Text to sections, chords and ChordPro; scoring and duplicates
  - id: online
    resource: /api/src/online.rs
    title: GET /songs/online, memory and turns
  - id: songs-view
    resource: /web/src/views/songs.ts
    title: The offer, the search and the editor draft
generated: { by: agent, at: 2026-11-03T08:30:00Z }
---

# Online song search

When a search finds nothing in the library, both the desktop and the web
client **offer** to look online. Neither looks by itself: it takes seconds,
and searching on every pause in typing made the desktop lag.

## One lookup, two homes

The lookup is the Rust crate `psa150-lyrics` in `shared/lyrics/`. The API and
the desktop both use it as a Cargo path dependency, the same way both apps use
the design tokens.

**The desktop must work without a song server.** Many churches never set one
up. So the desktop runs the crate in its own process; it never asks the
server to search for it. The server runs the same crate for clients that
cannot, such as the web client. Fix and improve it here, then sync the
desktop.

## How a search works (`psa150_lyrics::search`)

1. **Find pages**: `"<query> chords lyrics"` on DuckDuckGo's HTML results,
   up to 10 links. Chart sites known to be clean come first (`TRUSTED`:
   worshipchords, Ultimate Guitar, Worship Together, hymnary, cifraclub,
   e-chords, genius); video, social, shops, stores and paywalled or
   script-only chart sites are dropped (`SKIPPED`). A failed or blocked
   search engine is an error ("The search engine did not answer…").
   At the same time the **LRCLIB** lyrics database (`lrclib.net`, open, no
   key) is asked: words only, no chords or sections, so a chart of the same
   song ranks above it. Its loose matches are filtered: the track's title
   (without "(…)") must be the search, or its lyrics must contain a searched
   line of 4+ words. A search fails only when both sources fail.
2. **Fetch** the first 6 at once. Each request has 6 s (`REQUEST_TIMEOUT`),
   so a search takes at most about 12 s; in practice 1–2 s. Pages over 2 MB
   are cut off.
3. **Read each page** (`page::read`): Ultimate Guitar's chart from the JSON
   in `div.js-store`; the song data a page gives search engines (schema.org
   JSON-LD `MusicComposition`/`MusicRecording`: name, artist or composer,
   lyrics), which wins for title and artist; otherwise every `<pre>` (spacing kept, so chords stay
   over their words) and every likely container (`[class*=lyric]`,
   `[class*=chord]`, Genius's `data-lyrics-container`, `article`, …) as a
   text block. `<br>` and block elements break lines, `<p>` ends a stanza,
   non-breaking spaces are kept, chord spans become inline `[G]`, and
   scripts, navigation, adverts and comments are skipped. Title and artist
   come from `og:title`, `<h1>` or `<title>` with the site name and words
   like "Chords" and "Lyrics" taken off.
4. **Make a song** of every block (`chart::parse_block`) and keep the
   page's best. Headers in many styles become sections (`[Verse 1]`,
   `Chorus:`, `Pre Chorus`, `Vers 2`, `Refreng`, `Bro`, `Tag`, …); intros,
   interludes and solos without words are dropped; a chord line over a lyric
   line becomes inline chords at their columns (a chord one letter into a
   word moves to its start: charts drawn a column off); "Repeat chorus" and an empty
   `Chorus` header write the chorus out again; key, CCLI number and
   copyright are kept; site clutter, player notes (capo, tuning) and credit
   lines are dropped; the title and artist repeated above the song are
   dropped; text above the first header without chords goes when the rest
   has chords. Shouts from recordings ("(hey)", "(oh)") are dropped, echoes
   like "(I surrender)" kept. Lyrics with no headers at all get their
   repeated stanza named Chorus. Fewer than 4 lyric lines, or prose (long
   lines), is not a song. The chord-over-words conversion is checked against
   the Ultimate Guitar fixture of ChordSheetJS, the reference library for
   chord sheets.
5. **Rank and dedupe**: score by how well the title or lyrics match the
   query, labelled sections, chords and length, plus the site's trust; a
   song with most of the same words as a better one is left out. At most 3
   come back (`MAX_CANDIDATES`).

The ChordPro it writes is the desktop's dialect: `{title}`, `{artist}`,
`{key}`, `{copyright}`, `{meta: ccli=…}`, then `{start_of_verse: Verse 1}` …
`{end_of_verse}` per section with no blank lines inside one.

**Tried on 10 random worship songs (2026-10-23)**: the right song came
first every time, in 1.1–2.5 s. Remaining faults come from the sites'
charts: chords a few letters off ("ocea[A]ns"), syllable hyphens ("wel -
come"), a second verse labelled "Verse 1", and a title shared by different
songs (both are offered).

No model is involved. A local language model was considered (the server
aims to run on a Raspberry Pi 5); it would add minutes per song there, so the
cleanup stays rule-based.

## `GET /api/v1/songs/online?q=…`

Song editors (`require_song_editor`: leaders, owners and desktops). `q` of at
least 3 characters, else 400. Returns up to 3 `OnlineSong {title, artist,
source_name, source_url, chordpro}`, best first; nothing is saved (add one
with `POST /songs`). The search engine failing is **503** with its message.

- **Memory**: answers are kept in memory for 6 hours, up to 200 searches
  (oldest out first), keyed by the lower-cased query and shared across
  churches. A second search for the same song is instant. The memory does
  not survive a restart.
- **Turns**: at most 2 searches run at once (`AT_ONCE`); the rest wait. This
  keeps a small server responsive and the search engine from blocking it.
  There is no per-church rate limit yet ([gaps](gaps.md)).

## Web client

On **Songs**, when a search of at least 3 characters finds nothing, no key
filter is on and the person can edit: "No songs match "…"" with **Search
online** (or Enter in the field). While it runs: a spinner and **Cancel**
(aborts the request). Then **Found online** lists title and artist · site,
or "Nothing found online" with a hint; a failure shows a toast and keeps the
offer. Typing again drops it all. Picking a result opens the **New song**
editor filled with its ChordPro ("Add song"), with a "Found on <site>" link;
saving adds it to the library like any new song. Viewers get the plain "No
songs found".

## Related

- [API contract](api-contract.md), [Web client](web-client.md)
- The desktop's own page on this, `concepts/web-search.md` in the client repo
