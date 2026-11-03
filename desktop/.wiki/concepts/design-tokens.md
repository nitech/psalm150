---
type: Concept
title: Design tokens
description: The shared PSA150 design tokens — one CSS file in the monorepo's shared/ folder (next to the shared icons) used by both apps, dark and light themes, how styles.css aliases them, and designsystem.json as a reference only.
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
generated: { by: agent, at: 2026-11-03T08:30:00Z }
---

# Design tokens

Psalm150 and the PSA150 Song Server web client share one look: a near-black
canvas (or warm off-white in the light theme) with one lime accent
(`#C6D88C`) for active and selected state.

## One file, two apps

`shared/psa150-tokens.css` at the monorepo's root holds the tokens, next to
`shared/icons.ts` (icon paths). The desktop and the song server's web client
both use them as they are, with no copies. `src/icons.ts` wraps the shared
paths in Lit.

It defines only `--psa-*` custom properties:

- theme-independent: fonts (`--psa-font-ui`, `-display`, `-mono`,
  `-lyrics`), radii (`--psa-radius-xs` … `-full`), a 4 px spacing scale
  (`--psa-space-1` … `-8`), `--psa-touch-target` (44 px), motion
  (`--psa-ease-*`, `--psa-dur-*`) and the lime scale (`--psa-lime-300` …
  `-800`);
- per theme: surfaces (`--psa-bg-*`), borders, text, accent
  (`--psa-accent`, `-hover`, `-pressed`, `-soft`, `-medium`, `-glow`,
  `-text`, `--psa-on-accent`), `--psa-chord`, status colours
  (`--psa-positive`, `--psa-warning`, `--psa-danger` and soft variants),
  shadows and `--psa-focus-ring`.

## Themes

A page picks a theme with `<html data-theme="dark|light">`. Dark is the
default (`:root`, `:root[data-theme="dark"]`); `data-theme="light"` selects
the light theme; a page without the attribute follows
`prefers-color-scheme`. The light theme keeps the accent hue but uses deeper
lime (`--psa-lime-800`) for accent text and chords, for contrast.

`index.html`, `audience.html` and `stage.html` all set `data-theme="dark"`,
so the console and both projection windows are always dark whatever the
system setting. The light theme is used by the server's web client.

## How the console uses them

`styles.css` starts with `@import "../../shared/psa150-tokens.css"` and keeps its own
variable names (`--bg-surface`, `--text-secondary`, `--accent-lime`,
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
