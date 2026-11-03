---
type: Concept
title: Design tokens
description: The shared Psalm150 design tokens (gold accent, sky as second colour) — one CSS file in the monorepo's shared/ folder (next to the shared icons) used by both apps, dark and light themes, how styles.css aliases them, and designsystem.json as a reference only.
tags: [design, css, tokens, theme, server]
status: stable
sources:
  - id: tokens
    resource: /../shared/psa150-tokens.css
    title: The --psa-* tokens both apps use, dark and light themes
  - id: css
    resource: /src/styles.css
    title: Imports the tokens; console aliases in :root
  - id: html
    resource: /index.html
    title: data-theme="dark" (also audience.html, stage.html)
  - id: reference
    resource: /designsystem.json
    title: PSA150 Design System reference (not loaded by the app)
generated: { by: agent, at: 2026-11-03T14:00:00Z }
---

# Design tokens

Psalm150 and the song server's web client share one look: a near-black
canvas (or warm off-white in the light theme) with a gold accent (`#E6B860`)
for what you press, active and selected state, the focus ring and the brand
mark, and sky (`#8EC3EA`) as the second colour, for chords and the
favourite star. Warnings are orange so they are never mistaken for the
accent. The brand mark is Wind (`shared/brand.ts`, icons in `shared/brand/`).

## One file, two apps

`shared/psa150-tokens.css` at the monorepo's root holds the tokens, next to
`shared/icons.ts` (icon paths). The desktop and the song server's web client
both use them as they are, with no copies. `src/icons.ts` wraps the shared
paths in Lit.

It defines only `--psa-*` custom properties:

- theme-independent: fonts (`--psa-font-ui`, `-display`, `-mono`,
  `-lyrics`), radii (`--psa-radius-xs` … `-full`), a 4 px spacing scale
  (`--psa-space-1` … `-8`), `--psa-touch-target` (44 px), motion
  (`--psa-ease-*`, `--psa-dur-*`) and the gold and sky scales
  (`--psa-gold-300` … `-800`, `--psa-sky-300` … `-800`);
- per theme: surfaces (`--psa-bg-*`), borders, text, accent
  (`--psa-accent`, `-hover`, `-pressed`, `-deep`, `-rgb`, `-soft`, `-medium`,
  `-glow`, `-text`, `--psa-on-accent`), the second colour (`--psa-secondary`,
  `-soft`, `-text`), `--psa-chord`, `--psa-favorite`, status colours
  (`--psa-positive`, `--psa-warning`, `--psa-danger` and soft variants),
  shadows and `--psa-focus-ring`.

## Themes

A page picks a theme with `<html data-theme="dark|light">`. Dark is the
default (`:root`, `:root[data-theme="dark"]`); `data-theme="light"` selects
the light theme; a page without the attribute follows
`prefers-color-scheme`. The light theme keeps the hues but uses deeper
shades for text, for contrast: `--psa-gold-800` for accent text,
`--psa-sky-800` for chords.

`index.html`, `audience.html` and `stage.html` all set `data-theme="dark"`,
so the console and both projection windows are always dark whatever the
system setting. The light theme is used by the server's web client.

## Trying other colours

The palettes (`--psa-gold-*`, `--psa-sky-*`, each with `-rgb` and
`-rgb-deep` triplets for tints) are only used by a few lines at the top of
the file that say which palette plays which part: `--psa-brand-*` (the
accent) and `--psa-second-*` (chords and favourites). Every theme token
follows them, so pointing those lines at another palette changes both apps.
`<html data-accent="sky">` makes sky the brand colour without editing
anything, which is how the gold and sky screenshots were compared.

## How the console uses them

`styles.css` starts with `@import "../../shared/psa150-tokens.css"` and keeps its own
variable names (`--bg-surface`, `--text-secondary`, `--accent-gold`,
`--radius-md`, `--font-ui`, …) as aliases of the `--psa-*` tokens, so
component CSS did not change. A few values are still local to `styles.css`
(`--shadow-xl`, `--glow-danger`, `--radius-2xl`, `--blur-glass`,
`--pane-head-height`). For [accessibility](accessibility.md) it adds
`--border-control`, `--focus-color` and `--focus-ring` (aliases of
`--psa-border-control`, `--psa-focus-color`, `--psa-focus-ring`) for field
edges and the keyboard focus indicator,. The audience slide colours and font come from the
library's `SlideTheme`, not from these tokens
([audience display](audience-display.md)).

## designsystem.json

Named "PSA150 Design System" (version 1.1.0). It is a reference for people
and agents, never loaded by the app, and its metadata names
`psa150-tokens.css` as the runtime source of truth: where they differ, the
stylesheet wins. Its component specs still describe the dashboard it was
first derived from ([gaps](gaps.md)).

## Related

- [Operator console](operator-console.md), [Audience display](audience-display.md),
  [Stage display](stage-display.md)
- [Server library](server-library.md): the song server the web client belongs to
