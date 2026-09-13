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
is editable; in the flat view any line is. Click the lyrics to start; the bar
above the song shows "Ad hoc editing" (with Done) or "Unsaved corrections"
(with **Save corrections**). Escape leaves edit mode without discarding.

## Model

`adhocPendingEdits: Map<"section:line", {original, text}>`, keyed by the
**source** coordinates from `lineProvenance`. A corrected chorus line edits the
template, so every performance of that chorus changes. Lines render as
`contenteditable="plaintext-only"`; key events stop propagating so navigation
keys do not fire. Changed lines show a word-level diff (`diffLineSegments`, an
LCS over whitespace-split tokens) with the changed words highlighted.

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
