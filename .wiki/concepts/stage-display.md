---
type: Concept
title: Stage display
description: Musician-facing window — chord rows above lyrics, section and next-section labels, song key.
tags: [projection, stage, chords]
status: stable
sources:
  - id: stage
    resource: /src/components/stage.ts
    title: praise-stage component
  - id: modes
    resource: /src-tauri/src/projection/modes.rs
    title: StageSlide payload
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Stage display

`stage.html` mounts `<praise-stage>`. It shows the same slide as the audience,
plus the chords the audience never sees.

## Payload (`StageSlide`)

`index`, `section_label`, `next_section_label` (label of `slides[index + 1]`,
if any), `lines[{text, chords[]}]` (chord names already transposed; positions
are not carried, so chords are printed as one row above the lyric, joined by
two spaces), `overlay`, `nashville` (flag only), `key` (song key from meta).

## Behaviour

- Subscribes to `projection-updated`, then fetches `get_projection_snapshot`;
  older revisions are ignored. Audience blanking keeps the last stage payload.
- Header row: section label (lime), "Next · label", "Key · X" (or "—").
- Escape closes both projection windows. No slide navigation keys here.
- No fit-to-screen logic: the stage is a normal window, 900x640 by default,
  that wraps like ordinary text.

Chords with character positions live in `ParsedSong` on the console side; the
stage intentionally shows chord names only.

## Related

- [Projection windows](projection-windows.md): opened only when `project_to_stage` is on
- [Slide pipeline](slide-pipeline.md): `stage_slide`
