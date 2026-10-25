---
type: Concept
title: Ad hoc editing
description: Correct a lyric while projecting — per-line contenteditable, pending edits keyed by parsed source coordinates, and safe Rust-side line replacement.
tags: [console, editing, chordpro]
status: stable
sources:
  - id: adhoc
    resource: /src/adhoc-edit.ts
    title: Pending-edit collection and word diff helpers
  - id: song-save
    resource: /src-tauri/src/commands/song_v2.rs
    title: Source-mapped line edits and guarded saves
  - id: app
    resource: /src/components/app.ts
    title: enterAdhocEdit / saveAdhocEdits / renderInteractiveLyricLine
  - id: test
    resource: /tests/adhoc-edit.test.ts
    title: Patch and diff tests
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Ad hoc editing

## When

`canAdhocEdit()`: not read-only, a real file is loaded (not a web result), and
the song has a filename. In **projecting** stanza view only the active stanza
is editable; in the flat view any line is. Editable lines are always
`contenteditable="plaintext-only"`, so a click puts a blinking caret where it
lands and nothing else changes: no border, background or colour. While a line
has focus, or corrections are unsaved, buttons sit on the song's title row:
**Done** while nothing has changed, else **Discard** and **Save
corrections**. In a line, Enter saves (and leaves the line), Esc leaves it
without discarding, Up/Down move to the line above or below at about the same
column, and no other key reaches the console's shortcuts.

## Model

`adhocPendingEdits: Map<"section:line", {original, text}>`, keyed by the
**source** coordinates from `lineProvenance`. A corrected chorus line edits the
template, so every performance of that chorus changes. A line's text is bound
with Lit's `live` directive, so a re-render leaves it alone while it matches
what was typed and the caret never jumps (it used to jump to the start of the
line after the first Backspace). Changed words are not highlighted;
`diffLineSegments` stays in `adhoc-edit.ts`, tested, but unused.

## Saving

The parser records `LyricLine.source_line` for every raw lyric or stanza-break
line. The console sends only `{ sectionIndex, lineIndex, text }` plus the
content hash from load. `save_song_lines` resolves each edit through that
mapping, so comments, blank lines, short directive aliases, Unicode and
repeated section templates do not shift edits. Chords are reinserted at their
original character positions, capped at the new text end; all untouched raw
lines and CRLF/LF endings remain unchanged.

The hash rejects an outside edit and keeps pending console text available for
retry after reload. A successful save updates the index. If the file is the
active projection, slides publish immediately while the current stanza/part
and blank state are preserved where valid. Saving a merely selected preview
does not affect what is being shown.

## Related

- [Operator console](operator-console.md), [Performance sections](performance-sections.md)
- [ChordPro dialect](chordpro-dialect.md): what the patcher must respect
