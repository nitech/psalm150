---
type: Concept
title: Build and release
description: Bun + Vite multi-entry frontend, the Tauri CLI shim, the two test suites, and the tag-driven GitHub release with signed auto-updates.
tags: [build, bun, vite, tauri, ci, updater, tests]
status: stable
sources:
  - id: package
    resource: /package.json
    title: Scripts and dependencies
  - id: vite
    resource: /vite.config.ts
    title: Multi-entry build
  - id: shim
    resource: /scripts/tauri.mjs
    title: Tauri CLI shim
  - id: conf
    resource: /src-tauri/tauri.conf.json
    title: Windows, bundle, updater endpoint
  - id: caps
    resource: /src-tauri/capabilities/default.json
    title: Capabilities for main/audience/stage
  - id: workflow
    resource: /.github/workflows/release.yml
    title: Release workflow
  - id: readme
    resource: /README.md
    title: Requirements and release steps
  - id: skill
    resource: /.agents/skills/tauri-v2/SKILL.md
    title: Vendored Tauri v2 skill (pinned in skills-lock.json)
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Build and release

## Toolchain

Bun 1.2+, Rust stable, MSVC build tools on Windows. `bun install`, then
`bun run tauri dev`. `scripts/tauri.mjs` is the CLI shim: it prepends
`~/.cargo/bin` to `PATH` and finds `tauri.exe` (bun) or `tauri.cmd` (npm) in
`node_modules/.bin`, running through a shell only for `.cmd`. `src-tauri/2`
is a stray npm log, not a source file.

## Frontend

Vite with three entries (`index.html`, `audience.html`, `stage.html`; see
[projection windows](projection-windows.md)). Build target `chrome105` on
Windows, `safari13` elsewhere; `TAURI_ENV_DEBUG` disables minify and enables
sourcemaps. Fonts (Geist, Geist Mono, Inter) come from Google Fonts at runtime
with a system fallback stack, so an offline machine renders a fallback font.
`csp` is `null`. `tsc` runs before `vite build` with `strict`,
`noUnusedLocals` and `noUnusedParameters`.

## Backend

Tauri 2 with plugins `process`, `updater`, `dialog`, `fs`, `global-shortcut`.
Capabilities: `default` (main, audience, stage: core window/event/webview,
global-shortcut, dialog, fs) and `desktop` (main: updater, process:restart).
Notable crates: `rusqlite` (bundled), `jetdb` (Access reader), `notify`,
`tiny_http`, `reqwest` (rustls, blocking), `scraper`.

## Tests

| Command | What runs |
| --- | --- |
| `bun run test` | Vitest over `tests/*.test.ts`: ad hoc editing and performance sections, audience fit planning, song sorting, sample-fixture presence |
| `bun run test:rust` | `cargo test`: parser, safe song files and source-mapped edits, duplicate grouping, slide splitting, chorus2, import/body conversion, plus the repository MDB fixture in a temporary output folder |

There is no UI or end-to-end test; window behaviour is verified by running
the app with a simulated display.

## Release

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`.
2. Tag `vX.Y.Z` and push. `release.yml` builds on Windows, macOS (arm64 and
   x86_64) and Ubuntu 22.04 with `tauri-action`, signing with
   `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`, and creates a **draft** release
   with `latest.json`.
3. Publish the draft. Installed apps call `checkForUpdates()` on startup in
   production (`src/updater.ts`): `check()`, ask, `downloadAndInstall()`,
   `relaunch()`. The updater endpoint is the GitHub `releases/latest` URL and
   the public key is embedded in `tauri.conf.json`; the private key lives in
   `%USERPROFILE%\.tauri\praise.key`.

## Related

- [Config](config.md): where runtime settings live once installed
