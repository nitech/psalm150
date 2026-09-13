---
type: Concept
title: Web search
description: When the library has no match, the console asks the web — DuckDuckGo discovery, per-site scrapers, chord-chart to ChordPro, preview or save.
tags: [search, web, scraping, chordpro]
status: stable
sources:
  - id: web
    resource: /src-tauri/src/web_search/mod.rs
    title: search_songs orchestration and limits
  - id: search
    resource: /src-tauri/src/web_search/search.rs
    title: DuckDuckGo HTML discovery
  - id: scrape
    resource: /src-tauri/src/web_search/scrape.rs
    title: Site extractors
  - id: to-chordpro
    resource: /src-tauri/src/web_search/to_chordpro.rs
    title: Scraped text to ChordPro
  - id: app
    resource: /src/components/app.ts
    title: Debounce, generation guards, save-to-library
  - id: ids
    resource: /src/components/song-list-ids.ts
    title: __web__N row ids
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Web search

## Trigger (console)

Only on the Search tab, only when `web_search_enabled` (Settings, "Search the
web when no local songs match"), only when the query has at least 3
characters **and the local search returned zero rows**. After a 650 ms
debounce (`WEB_SEARCH_DEBOUNCE_MS`) the console calls `search_web_songs`. Two
generation counters (`songsRefreshGeneration`, `webSearchGeneration`) discard
results from a query the user has already moved past. The first candidate is
auto-selected and previewed; rows use ids `__web__<index>` and show the source
host in the key column. A failed search toasts "Web search failed".

## Backend

`search_songs(query)`:

1. **Discover**: GET `https://html.duckduckgo.com/html/?q=<query> lyrics chordpro`,
   take up to 8 `a.result__a` hrefs (`uddg=` redirects decoded), skipping
   duckduckgo, youtube and facebook.
2. **Fetch** each with a 10 s timeout and UA `Praise/0.1 (church worship
   projection; +https://github.com/nitech/praise)`. Extractors in order:
   worshipchords `<pre>` containing Verse/Chorus; an ultimate-guitar-style
   `div.js-store, pre, code`; `div.lyrics / div.song-lyrics / article.lyrics /
   div.entry-content`; then generic (longest `<pre>`, or any `[class*=lyric]`).
3. **Convert**: `extract_title` takes the first non-empty line (max 80 chars),
   which is often the first *lyric* line rather than the song title
   ([gaps](gaps.md)); `raw_to_chordpro` runs `parse_scraped_body` (section
   headers incl. `first verse` and `pre-chorus`; `intro` / `instrumental` /
   `outro` blocks skipped; chord line + lyric line paired, lone chord lines
   dropped; blank line = new stanza) and serialises with `serialize_chordpro`.
4. Keep at most 3 candidates with at least 3 lines of ChordPro.

`WebSearchCandidate { title, source_name, source_url, chordpro_content }`.

## Preview vs save

- Selecting a web row calls `preview_web_song`; it parses preview slides but
  does not change the active projection and writes nothing.
- Project calls `project_song(content=...)`, starts an in-memory active session
  and supports navigation and transpose without a file.
- **Save to library** calls `save_web_song` after confirmation. It serialises
  to the normal `{song_num:04}-{title-slug}.pro` convention and uses exclusive
  creation with `-1`, `-2`, … suffixes, so no existing song can be overwritten.

## Related

- [Operator console](operator-console.md): where results appear
- [ChordPro dialect](chordpro-dialect.md)
