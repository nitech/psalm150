# Directory Update Log

## 2026-08-30
* **Sync**: Remote control is now usable from a phone: Settings gained a "Phone remote" toggle, `setup()` auto-starts the server when `config.remote_enabled` is true, `RemoteServer` binds synchronously (bind errors reach the caller), stops within 250 ms and releases the port, `GET /` is served as HTML, and the page remembers the PIN and reports each tap. Integration test in `src-tauri/tests/remote.rs`.

## 2026-08-29
* **Creation**: Bundle initialised from a full read of the repo: overview, 19 concept pages, index, this log. Sources are cited per page; `/docs/` and `/CONCEPTS.md` stay where they are and are linked, not copied.
* **Sync**: Audience display — lyric lines no longer wrap mid-line. `.audience-content` is laid out at natural width (`white-space: pre`) and `fit()` scales the block to the screen; only a line wider than 1/0.7 of the available width falls back to balanced wrapping (`src/audience-fit.ts`, tested). The old `max-width` subtracted the theme margins a second time, which is why the 960 px simulated display wrapped so early.
* **Sync**: Operator console — the song list gained Song / No / Key column headers that sort (default Song ascending; persisted as `localStorage["praise-song-sort"]`; History and Setlist tabs keep their own order) and a Settings toggle for the number column (`config.show_song_numbers`, default on; new command `set_show_song_numbers`). The list is one CSS grid with subgrid rows, so No and Key are as narrow as their widest value and the title gets the rest; the sticky header lives inside `praise-song-list` and emits `praise-sort`.
