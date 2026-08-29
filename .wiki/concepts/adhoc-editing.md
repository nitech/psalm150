---
type: Concept
title: Ad hoc editing
description: Correct a lyric while projecting — per-line contenteditable, pending edits keyed by source line, raw-text patching that keeps chords and directives.
tags: [console, editing, chordpro]
status: stable
sources:
  - id: adhoc
    resource: /src/adhoc-edit.ts
    title: patchChordProRaw, diffLineSegments, pending-edit helpers
  - id: app
    resource: /src/components/app.ts
    title: enterAdhocEdit / saveAdhocEdits / renderInteractiveLyricLine
  - id: test
    resource: /tests/adhoc-edit.test.ts
    title: Patch and diff tests
generated: { by: agent, at: 2026-08-29T19:45:00Z }
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

`patchChordProRaw(raw, sections, edits)` walks the file text: `{…}` lines that
start a section bump the section counter; other `{…}` lines and blank lines
pass through untouched; each non-blank lyric line increments the line counter,
and if it has an edit the line is re-rendered from `{text, chords}` with
`formatLyricLineForRaw` (chords re-inserted at their character positions).
Everything else in the file, including unknown directives and spacing, is
preserved. Then `save_song(filename, patched)`; the response replaces
`currentSong` and `projection` (slides rebuilt, index kept). The projected
screen refreshes on the next navigation, not immediately.

## Known edge

`#` comment lines are skipped by the parser but counted as lyric lines by the
patcher, so an edit *after* a `#` line inside a section lands one line off
([gaps](gaps.md)).

## Related

- [Operator console](operator-console.md), [Performance sections](performance-sections.md)
- [ChordPro dialect](chordpro-dialect.md): what the patcher must respect
