---
type: Concept
title: Performance sections and stanza markers
description: The console's client-side mirror of chorus filling and blank-line stanzas, and the markers that map slides back to stanzas.
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

A port of `expand_chorus_sections`: sections stay as written, as the song
server's web client shows them (a `chorus2` is a chorus of its own in its
place); an empty chorus repeats the last chorus of its kind with words. Each output section carries `lineProvenance[i] = {sectionIndex,
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

## Sung order

`suggested_order` (Rust, `projection/mod.rs`, tested) gives
`ProjectionState.order`, the stanza indices in the order they are sung, and
`order_position` says which step is on screen. A song whose only chorus is
written once gets it after every later stanza: verse 1, chorus, verse 2,
chorus, verse 3, chorus (a chorus written first comes back after each verse);
a pre-chorus written just before it comes along. Songs that write their
choruses out (more than one chorus stanza, or chorus2 slots) or have none are
sung as written.

Next/previous slide (→/←, the audience keys, the phone remote) step through
the slides of a stanza, then on through `order`; Up/Down (`step_stanza`) go to
the first slide of the next or previous step. A stanza picked by number or
click (`show_slide`) takes its first place at or after the current step, so
the chorus picked after verse 2 is the one after verse 2. Saving a correction
keeps the step. The console shows the order beside the song
([operator console](operator-console.md#projecting-mode)).

## The alignment assumption

Stanza view pairs the *i*-th projected preview block with marker *i*: blocks
of `Intro` and `Interlude` sections are skipped (they have no slides and no
number key). Blank-line detection also differs slightly: Rust splits on
`text.is_empty()`, the console additionally requires no chords.

## Related

- [Operator console](operator-console.md): stanza view
- [Audience display](audience-display.md): stanza counter
