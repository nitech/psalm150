---
type: Concept
title: Audience display
description: The congregation window — theme CSS variables, fit-to-screen that never breaks a lyric line, overlay pill, stanza counter, keyboard.
tags: [projection, audience, css, layout]
status: stable
sources:
  - id: audience
    resource: /src/components/audience.ts
    title: praise-audience component (fit, theme, overlay, counter)
  - id: fit
    resource: /src/audience-fit.ts
    title: planFit — pure fit planning with the wrap threshold
  - id: css
    resource: /src/styles.css
    title: body.audience-projection and .audience-* rules
  - id: html
    resource: /audience.html
    title: Page shell and web font links
  - id: fit-test
    resource: /tests/audience-fit.test.ts
    title: planFit unit tests
generated: { by: agent, at: 2026-08-29T19:45:00Z }
---

# Audience display

`audience.html` mounts `<praise-audience>` (light DOM, shared `styles.css`).
On connect it subscribes to `audience-slide`, loads the theme, and renders the
current `ProjectionState` so a reopened window is never blank.

## Theme to CSS

`get_theme` returns the library's `SlideTheme`; `applyTheme` writes
`--praise-font-family / -size / -weight / -style / -fg / -bg / -margin-*` on
`<html>`. With no library open the call fails silently and the CSS defaults
apply (Geist 48 px, weight 500, `#f4f4f4` on `#060606`). Screen padding per
side is `max(theme margin, clamp(32px, 6vw, 72px))`.

## Fit: scale, never break a line

Goal: a lyric line the author wrote as one line is shown as one line.

- `.audience-content` is `width: max-content`; `.audience-line` is
  `white-space: pre`. The block keeps its natural width even when that is
  wider than the window.
- `fit()` runs after every render (`requestAnimationFrame`), on `resize`, and
  once `document.fonts.ready` resolves (web fonts change widths). It resets the
  transform, measures `scrollWidth/scrollHeight` against the screen minus
  padding, minus the overlay pill (+24 px) and stanza counter (+24 px), and
  applies `transform: scale(s)` with `s <= 1` (`planFit` in `audience-fit.ts`).
- If the **width** ratio alone is below `MIN_UNWRAPPED_WIDTH_SCALE = 0.7`, the
  line is judged too long to shrink legibly: `.wrap` is added (`pre-wrap`,
  `text-wrap: balance`, `max-width: 100%`) and the block is measured again.
  Height overflow never triggers wrapping; wrapping would only make it taller.

Why it was wrong before 2026-08-29: lines were `pre-wrap` inside
`max-width: min(92vw, 100% - 2 * margin)`. The browser wrapped at that width
before `fit()` could see any overflow, so the scaler never ran. And because the
screen padding already applied the theme margins, they were subtracted twice,
which is why the 960 px simulated window wrapped "Your great love will lead me
/ through" with room to spare.

Relation to the Rust budget: the [slide pipeline](slide-pipeline.md) pre-wraps
at `max_chars_per_row` assuming `projection_width` (1920) and the theme font in
CSS px. The font is **not** scaled with the window, so a narrower window (the
simulated display, or a DPI-scaled projector) shows the same px size and leans
on the scaler more often. That is a fidelity gap, not a wrapping bug; see
[gaps](gaps.md).

## Overlay pill (bottom-left)

Parts joined with ` - `: title (unless `show_title_overlay` is false), key
(unless `show_key_overlay` is false), song number (whenever present),
copyright (unless `show_copyright_overlay` is false), `CCLI n` (only if
`show_ccli_overlay`). No theme loaded means everything but CCLI is shown.

## Stanza counter (bottom-right)

`n / total` with arrows that dim at the ends. Built from
[stanza markers](performance-sections.md) over `ProjectionState.slides`; shown
only when there is more than one stanza. The component keeps the last
`ProjectionState` and refetches it when an incoming slide does not match.

## Keys and blank

Escape closes both projection windows; Down/Right `next_slide`; Up/Left
`previous_slide` (direct `invoke`). A slide with no lines renders
`.audience-blank` (vignette only). Slides are keyed by `index:stanza:text`, so
a changed slide remounts and replays the `audience-in` animation.

## Related

- [Projection windows](projection-windows.md): how slides arrive (twice)
- [Stage display](stage-display.md)
