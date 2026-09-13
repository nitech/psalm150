---
type: Concept
title: Slide pipeline
description: How a parsed song becomes ProjectionState slides — chorus2 expansion, stanza blocks, word-wrap and height budgets, transposition, overlays.
tags: [projection, slides, rust]
status: stable
sources:
  - id: projection
    resource: /src-tauri/src/projection/mod.rs
    title: build_slides, expand_chorus_sections, transpose_chord
  - id: split
    resource: /src-tauri/src/projection/split.rs
    title: Stanza and slide splitting budgets
  - id: modes
    resource: /src-tauri/src/projection/modes.rs
    title: Audience vs stage payloads
  - id: song-cmd
    resource: /src-tauri/src/commands/song_v2.rs
    title: Preview, active project, save and transpose inputs
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Slide pipeline

`build_slides(&ParsedSong, &SlideTheme, transpose) -> Vec<SlidePayload>` builds
read-only previews and the active session created by `project_song`. Active
save and transpose rebuild the same session. The result is stored in
`RuntimeState.projection.slides`; the current slide is only an index.

## Steps

1. **Expand choruses** (`expand_chorus_sections`). If the song has a `chorus2`
   section, the first `chorus` before it is a template too. Every later `chorus`
   slot alternates main, alt, main…; a slot with its own lyrics keeps them. The
   template sections themselves produce no slides.
2. **Drop non-projectable kinds**: `Intro` and `Interlude` never become slides
   (`is_projectable_section`). `PreChorus` projects like a verse.
3. **Split each section into stanzas**: blank lines (`text.is_empty()`) mark
   stanza boundaries. Each stanza gets its own `stanza_index` (global counter).
4. **Wrap long lines at words** to `max_chars_per_row(theme)`; chords stay on
   the first wrapped row.
5. **Split a stanza by height**: a stanza over `max_visual_units` becomes several
   slides that share the same `stanza_index`.
6. **Emit `SlidePayload`**: `index` (global), `section_index` (position in the
   expanded section list), `stanza_index`, `section_label`, `lines` (text plus
   transposed chord names; positions dropped), `overlay`.

## Budget constants (`split.rs`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `CHAR_WIDTH_RATIO` | 0.52 | Assumed average glyph width as a fraction of font size |
| `LINE_HEIGHT_RATIO` | 1.28 | Mirrors `--psa150-line-height` in the audience CSS |
| `LINE_GAP_RATIO` | 0.35 | Mirrors the `0.35em` gap between `.audience-line`s |
| `SCREEN_PADDING` | 64 | Per side; mirrors the audience padding clamp |
| `OVERLAY_RESERVE` | 88 | Reserved when any overlay flag is on |
| `STANZA_COUNTER_RESERVE` | 56 | Always reserved |

`max_chars_per_row = floor((projection_width - margins - 2*64) / (font * 0.52))`, minimum 8.
`max_visual_units = floor(available_height / (font * (1.28 + 0.35)))`, clamped to 2..24.
`projection_width/height` default to 1920x1080 in `SlideTheme`. The budget is in
CSS pixels of the theme font and is not DPI-aware; windows narrower than that
(the simulated display is 960x540) rely on the
[audience fit scaler](audience-display.md).

## Overlays

Per slide, from `SlideTheme` flags: title (`show_title_overlay`), key
(`show_key_overlay`), `song_num` (rides on the title flag), copyright
(`show_copyright_overlay`), CCLI (`show_ccli_overlay`, default off).

## Transposition

`transpose_chord` rewrites the root of every chord name by semitones over a
sharps-only table. `Db` and `Eb` are mapped; other flats are not recognised and
land on `C` ([gaps](gaps.md)). `set_transpose` rebuilds from
`RuntimeState.active_song`, so saved and unsaved web projections behave alike.
`set_nashville` only stores a flag; nothing renders Nashville numbers yet.

## Modes

- `audience_slide`: same slide with every `chords` list emptied. Tests assert
  no `[` reaches the audience.
- `stage_slide`: keeps chords, adds `next_section_label`, the song `key`, and
  the `nashville` flag.

## ProjectionState

`filename`, `title`, `key`, `ccli`, `nashville`, `slides`, `current_index`,
`blank`, `transpose_semitones`, `hold_slide_id` (unused). `blank_payload()` is
the empty slide sent when `blank` is true or there are no slides.

## Related

- [Projection windows](projection-windows.md): how a frame reaches the screens
- [Performance sections](performance-sections.md): the console-side mirror of steps 1 and 3
- [ChordPro dialect](chordpro-dialect.md): where sections and blank lines come from
