---
type: Concept
title: ChordPro dialect
description: The worship-projection subset of ChordPro that Praise parses and writes — data model, section kinds, the blank-line stanza rule, and what survives a rewrite.
tags: [chordpro, parser, contract, library]
status: stable
sources:
  - id: parser
    resource: /src-tauri/src/library/chordpro.rs
    title: parse_chordpro / serialize_chordpro
  - id: meta-doc
    resource: /docs/chordpro-meta.md
    title: Directive reference (human doc)
  - id: golden
    resource: /tests/golden/fall-til-ro-snippet.pro
    title: Golden chord-line snippet
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# ChordPro dialect

The directive list (title/key/artist/copyright, `{meta: k=v}` keys, section
directives and short forms, comments, ignored features) is maintained in
[docs/chordpro-meta.md](../../docs/chordpro-meta.md). This page records the
parser semantics that doc does not spell out.

## Data model

`ParsedSong { meta: SongMeta, raw, sections: Vec<SongSection> }`.
`SongSection { label, kind, lines: Vec<LyricLine> }`,
`LyricLine { text, chords: Vec<ChordPlacement { chord, position }> }` where
`position` is a **character** index into `text` (not bytes): `[Am]Hello` is
`text: "Hello", chords: [{Am, 0}]`.

`SectionKind`: `Verse, Chorus, Chorus2, Bridge, Intro, PreChorus, Interlude,
Other` (serialised snake_case; the `SectionKind` union in `src/api.ts` must
match).

## Section and stanza rules

- A `{start_of_*}` directive flushes the current section and starts a new one
  with the default label (`Verse`, `Chorus`, `Chorus 2`, `Bridge`, `Intro`,
  `Pre-Chorus`, `Interlude`) or the given one (`{start_of_verse: Verse 2}` or
  `label="Verse 2"`).
- `{end_of_*}` flushes and resets to an unlabeled `Verse`; lines after it and
  before another start directive become a verse.
- **Blank line = stanza break.** A blank line whose next non-empty line is not
  a section directive flushes the section and opens a new one labeled `Verse`:
  `Chorus`, `Chorus2`, `Bridge`, `PreChorus` become `Verse`; other kinds keep
  their kind. So a chorus is one stanza and the paragraph after it is a verse.
  Blank lines directly before a directive are kept, then trimmed at flush.
- An **empty chorus is kept** (`flush_section` pushes a `Chorus` even with no
  lines): that is how chorus2 slots are expressed
  ([slide pipeline](slide-pipeline.md)).
- With no sections at all, the whole body becomes one `Other` section labeled
  `Song`.
- Title defaults to the filename when `{title}` is missing.

## What a rewrite preserves

`serialize_chordpro` regenerates a file from `ParsedSong`: title, key, then
`meta` directives, then each section as `{start_of_x}` … lines … `{end_of_x}`
and a blank line. Unknown directives, comment directives and `#` lines are
**dropped**. Paths that rewrite: MDB import, `save_web_song`,
`renumber_songs`. Paths that keep the author's text: `save_song` (writes the
editor's raw text) and [ad hoc editing](adhoc-editing.md) (patches single
lines inside the raw text through the parser's `source_line` mapping).

## Filenames

`is_chordpro_filename`: `.pro` or `.cho`, case-insensitive. Convention
`{song_num:04}-{slug}.pro`.

## Related

- [Songs folder](songs-folder.md), [Library index](library-index.md)
- [MDB import](mdb-import.md) and [web search](web-search.md) both produce this dialect
