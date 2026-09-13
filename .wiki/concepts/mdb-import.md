---
type: Concept
title: MDB import
description: Converting a Visual Song Book Access database into ChordPro files — table mapping, body parsing, theme from PageSetup, progress and cancellation.
tags: [import, vsb, mdb, legacy]
status: stable
sources:
  - id: import
    resource: /src-tauri/src/import/mod.rs
    title: Import loop with callbacks
  - id: mdb
    resource: /src-tauri/src/import/mdb.rs
    title: jetdb table readers, PageSetup to SlideTheme
  - id: convert
    resource: /src-tauri/src/import/vsb_to_chordpro.rs
    title: Body parser and filename convention
  - id: import-cmd
    resource: /src-tauri/src/commands/import_cmd.rs
    title: import_mdb_path / cancel_import / check_duplicates
  - id: schema-doc
    resource: /docs/vsb-mdb-schema.md
    title: VSB table reference
  - id: body-doc
    resource: /docs/vsb-body-format.md
    title: VSB body format
  - id: vb
    resource: /vb/VSB_V1.vbp
    title: Original VB6 application source (reference only)
  - id: fixture
    resource: /brattvaag-2018-12-28.mdb
    title: Sample database (963 songs) committed as a test fixture
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# MDB import

Settings, **Import MDB** (frontend file dialog), then `import_mdb_path`. A
songs folder must already be open; the console offers to pick one first.

## Pipeline

1. `read_vsb_categories`: `(id, name)` from `Categories`.
2. `read_vsb_mdb`: `VsbSongRow { song_id, song_num, title, body, key, author,
   copyright, category_id }` from `Songs` via the pure-Rust `jetdb` reader.
   Rows with an empty title are skipped.
3. For each row, `convert_song`:
   - filename `{song_num:04}-{slugify(title)}.pro` (`song` if the slug is empty);
   - `Key` like `D / E` becomes `{key: D}` plus `{meta: alt_keys=E}`;
   - `parse_vsb_body`: header lines `verse`, `verse 2`, `chorus`, `chorus 2`,
     `bridge`, `intro`, `outro` (case-insensitive) start sections; a line that
     matches the chord-token regex and is followed by a non-empty line is paired
     with it, chord positions taken from the chord's column; a blank line
     starts a new stanza section (chorus/bridge become verse after the break);
   - meta: `vsb_song_id`, `category`, `artist`, `copyright`,
     `arrangement=congregation`; then `serialize_chordpro`.
   - Empty bodies are counted as `skipped` with a warning.
4. Existing files with the same name are **skipped unchanged**. Exclusive file
   creation also prevents a race from overwriting a file that appears mid-import.
5. After the loop: `PageSetup` becomes the library's `theme.json` only when
   that library has no theme yet (font name,
   size and bold; BGR colour longs to `#rrggbb`; margins copied as raw
   numbers); the folder is rescanned and the index rebuilt; `import-complete`
   is emitted.

## Progress and cancel

`ImportCallbacks { on_progress, should_cancel, stop_reason }`. Each row emits
`import-progress { current, total, song_title }`; the console shows a modal
with a bar and the current title. **Cancel** sets `AppState.import_cancel`
(atomic); the loop checks it per row and returns `cancelled: true` with the
count written so far. Only one import can run. It is bound to the folder/hash
where it started; a library change or enabling read-only stops later writes.
Completed files remain, and the index is rebuilt after cancellation or stop.

`ImportReport` contains totals for `written`, `skipped` and `failed`, a
file-by-file status/reason list, `cancelled`, and an optional `aborted_reason`.

## Duplicates

The legacy `check_duplicates` remains available without UI. The operator uses
the richer [duplicate review](duplicate-review.md), which also compares exact
normalized lyric text and never merges automatically.

## Caveats

- Margins: the VB6 page-setup form uses `ScaleMode = 1` (twips), so the stored
  `MarginLeft/Right/Top/Bottom` may be twips rather than pixels; they are
  applied as px. Large values shrink the audience area (the
  [audience fit](audience-display.md) copes), but the unit is unverified.
- Import integration tests use the repository fixture and a temporary output
  directory; repeating the import verifies that existing files are skipped.

## Related

- [ChordPro dialect](chordpro-dialect.md): output format
- [Songs folder](songs-folder.md): destination and rescan
