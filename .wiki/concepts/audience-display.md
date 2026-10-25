---
type: Concept
title: Audience display
description: The congregation window — white on black, one font size per song as large as every stanza fits, lines never broken, overlay pill with a large song number, stanza counter, keyboard.
tags: [projection, audience, css, layout]
status: stable
sources:
  - id: audience
    resource: /src/components/audience.ts
    title: psa150-audience component (fit, theme, overlay, counter)
  - id: fit
    resource: /src/audience-fit.ts
    title: planSongFit — one font for the song, the wrap threshold and the maximum
  - id: css
    resource: /src/styles.css
    title: body.audience-projection and .audience-* rules
  - id: html
    resource: /audience.html
    title: Page shell and web font links
  - id: fit-test
    resource: /tests/audience-fit.test.ts
    title: planSongFit unit tests
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Audience display

`audience.html` mounts `<psa150-audience>` (light DOM, shared `styles.css`).
On connect it subscribes to `projection-updated` before fetching the current
`ProjectionSnapshot`, so a reopened window cannot miss or roll back a frame.

## Theme to CSS

The snapshot carries the active session's `SlideTheme`; `applyTheme` writes
`--psa150-font-family / -size / -weight / -style / -margin-*` on `<html>`.
Colours ignore the theme: the words are always pure white (`#ffffff`) on pure
black (`#000000`), for the most contrast a projector gives, and there is no
vignette or tint behind them. With no library open the call fails silently
and the CSS defaults apply (Geist, weight 500, white on black). Screen padding
per side is `max(theme margin, clamp(32px, 6vw, 72px))`; the bottom adds
`--audience-reserve`, the height of the corner overlays plus 24 px, so the
words never run under them.

## Fit: one size for the song, as large as it fits

Goals: a lyric line the author wrote as one line is shown as one line, the
words are as large as the screen allows, and the size does not jump from
stanza to stanza.

- `.audience-content` is `width: max-content`; `.audience-line` is
  `white-space: pre` with `font-size: var(--psa150-fit-font)`.
- `fit()` runs after every render (`requestAnimationFrame`), on `resize`, and
  once `document.fonts.ready` resolves (web fonts change widths; the measured
  song is dropped then). For each song (its `projection.slides`, one entry per
  different set of words, plus the slide on screen) it lays every stanza out
  in a hidden `.audience-measure` block at 100 px and hands the sizes to
  `planSongFit` (`audience-fit.ts`). The result is cached by screen size,
  font and words, so moving between stanzas measures nothing.
- `planSongFit` gives the song one font: the largest at which every stanza
  fits the screen minus padding, at most `MAX_FONT_SCREEN_SHARE = 0.1` of the
  window height (108 px at 1080p). The theme's font size no longer sets the
  size.
- A stanza whose width alone would hold it below `MIN_UNWRAPPED_WIDTH_SCALE =
  0.7` of the size it could otherwise have is judged too long to keep whole:
  it wraps (`.wrap`: `pre-wrap`, `text-wrap: balance`, the screen's width),
  and a binary search on the hidden block finds the largest font at which it
  still fits wrapped, which may lower the song's size. A stanza only wraps
  when the song's font is larger than the one at which it fits whole
  (`needsWrap`); the class is set while rendering from the cached song, so a
  new stanza shows right at once.
- Should the stanza on screen still overflow (a measurement off), it is
  scaled down with `transform`, so words are never cut off.

Why it was wrong before 2026-08-29: lines were `pre-wrap` inside
`max-width: min(92vw, 100% - 2 * margin)`. The browser wrapped at that width
before `fit()` could see any overflow, so the scaler never ran. And because the
screen padding already applied the theme margins, they were subtracted twice,
which is why the 960 px simulated window wrapped "Your great love will lead me
/ through" with room to spare. Until 2026-10-25 the block was only ever scaled
down from the theme's font size, slide by slide, so short stanzas stayed small
and the size changed between stanzas.

Relation to the Rust budget: the [slide pipeline](slide-pipeline.md) pre-wraps
at `max_chars_per_row` assuming `projection_width` (1920) and the theme font in
CSS px. The audience window now sizes the words itself, so those splits are
only where long sections break into slides; see [gaps](gaps.md).

## Overlay pill (bottom-left)

Black with a white edge and white text, `clamp(1rem, 1.7vw, 1.9rem)`. The
song number comes first, at 1.6 times that and bold
(`.audience-song-number`). Then the other parts joined with ` - `, cut with an
ellipsis when too long: title (unless `show_title_overlay` is false), key
(unless `show_key_overlay` is false), copyright (unless
`show_copyright_overlay` is false), `CCLI n` (only if `show_ccli_overlay`). No
theme loaded means everything but CCLI is shown.

## Stanza counter (bottom-right)

Black with a white edge, bold white `n / total` at
`clamp(1.4rem, 2.8vw, 3.2rem)` (about 51 px at 1080p), with arrows that dim
at the ends: the step of the
[sung order](performance-sections.md#sung-order) on screen
(`order_position + 1` of `order.length`, so a repeated chorus counts each
time), or [stanza markers](performance-sections.md) when there is no order.
Shown only when there is more than one step. The component receives the projection,
theme and audience payload together in a revisioned `ProjectionSnapshot`.

## Keys and blank

Escape closes both projection windows; Down/Right `next_slide`; Up/Left
`previous_slide` (direct `invoke`), which follow the sung order. A slide with
no lines renders `.audience-blank` (plain black). Slides are keyed by
`session:index:stanza`, not by their words: a new slide remounts and plays the
`audience-in` fade, while a correction saved while the slide is on screen
replaces the words in place with no animation.

## Related

- [Projection windows](projection-windows.md): single revisioned delivery
- [Stage display](stage-display.md)
