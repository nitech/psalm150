---
type: Concept
title: Performance sections and stanza markers
description: The console's client-side mirror of chorus2 expansion and blank-line stanzas, and the markers that map slides back to stanzas.
tags: [console, projection, stanzas, sync]
status: stable
sources:
  - id: perf
    resource: /src/performance-sections.ts
    title: buildPerformanceSections
  - id: markers
    resource: /src/stanza-markers.ts
    title: Preview blocks and stanza markers
  - id: rust
    resource: /src-tauri/src/projection/mod.rs
    title: expand_chorus_sections (the Rust original)
  - id: test
    resource: /tests/adhoc-edit.test.ts
    title: Tests pinning the mirror
generated: { by: agent, at: 2026-08-29T19:45:00Z }
---

# Performance sections and stanza markers

The console shows the song in **performance order**, the order the
congregation sees it, so it recomputes what the Rust
[slide pipeline](slide-pipeline.md) did, starting from `parsed.sections`.

## `buildPerformanceSections(sections)`

A port of `expand_chorus_sections`: chorus2 templates are removed, later
chorus slots alternate main/alt content, and slots with their own lyrics keep
them. Each output section carries `lineProvenance[i] = {sectionIndex,
lineIndex}` pointing back into `parsed.sections`, so a displayed chorus line
can be traced to the template it came from; that is what
[ad hoc editing](adhoc-editing.md) writes through. **Change both
implementations together.**

## `buildPreviewStanzaBlocksFromSections`

Splits every performance section on blank lines (`!text && chords.length ===
0`) into `PreviewStanzaBlock { sectionIndex, stanzaIndexInSection, lines,
lineProvenance }`. Keys are `stanzaBlockKey(section, stanza)` = `"s:n"`.

## `buildStanzaMarkers(slides)`

Groups `ProjectionState.slides` by `stanza_index` (falling back to
`section_index`, then `index`) into `StanzaMarker { stanzaIndex,
slideIndices[], sectionIndex, fullText, lines }`. `activeStanzaIndex(markers,
current_index)` finds the marker containing the current slide;
`stanzaStepSlideIndex` gives the first slide of the next or previous marker
(Up/Down while projecting, and the audience counter).

## The alignment assumption

Stanza view pairs preview block *i* with marker *i*. Blocks come from **all**
performance sections, markers only from **projected** slides, so a song with an
`Intro` or `Interlude` section shifts the highlight by one block; recorded in
[gaps](gaps.md). Blank-line detection also differs slightly: Rust splits on
`text.is_empty()`, the console additionally requires no chords.

## Related

- [Operator console](operator-console.md): stanza view
- [Audience display](audience-display.md): stanza counter
