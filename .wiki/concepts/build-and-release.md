---
type: Concept
title: Build and release
description: Bun + Vite multi-entry frontend, the Tauri CLI shim, the two test suites, and the GitHub release on every push to main with signed background updates.
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
    title: Capabilities for main
  - id: updater
    resource: /src-tauri/src/updater.rs
    title: Background check, download and install on quit
  - id: caps-projection
    resource: /src-tauri/capabilities/projection.json
    title: Capabilities for audience/stage
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
The CSP (`csp`, and `devCsp` which also allows the Vite HMR socket
`ws://localhost:1420`) allows scripts from the app only, styles from the app,
inline styles and Google Fonts, fonts from Google Fonts and `data:`, images
from the app, `data:` and `blob:`, and connections to the app and Tauri IPC
(`ipc:`, `http://ipc.localhost`). `dangerousDisableAssetCspModification:
["style-src"]` stops Tauri adding hashes to `style-src`, which would disable
`'unsafe-inline'` and break inline style attributes. `tsc` runs before `vite build` with `strict`,
`noUnusedLocals` and `noUnusedParameters`.

## Backend

Tauri 2 with plugins `updater`, `dialog`, `opener`, `global-shortcut`
(`updater`, `opener` and `global-shortcut` used from Rust only). Capabilities:
`default` (main: core window/event/webview, dialog) and `projection`
(audience, stage: `core:default`, enough for app commands and events).
Closing the main window exits the app (the hidden projection windows would
otherwise keep it running). The `devtools` feature is off, so only debug
builds (`bun run tauri dev`) have devtools.
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

`release.yml` runs on every push to `main` (not for changes to Markdown,
`docs/` or `.wiki/` only) and on manual dispatch, one run at a time.

1. `create` works out the version: `<major>.<minor>` from
   `tauri.conf.json` plus `github.run_number`, so it always goes up. It
   creates a draft release `v<version>` with the commit message as notes.
2. `build` stamps that version into `tauri.conf.json` and builds on Windows,
   macOS (arm64 and x86_64) and Ubuntu 22.04 with `tauri-action`, signing
   with `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` and uploading to the draft
   with `latest.json` (NSIS preferred on Windows).
3. `publish` makes the release public and latest once every platform is up,
   so `latest.json` is never partial; `cleanup` deletes the draft if a build
   fails.

The repository is public so installed apps can read
`releases/latest/download/latest.json` without a token. The public key is in
`tauri.conf.json`; the private key lives in `%USERPROFILE%\.tauri\psalm150.key`.

## Updates in the installed app

`src-tauri/src/updater.rs`, release builds only. 30 s after start and then
hourly it calls `check()`; a newer version is downloaded (the plugin
verifies the signature) and held in `UpdateState`, and `update-ready`
(`UpdateInfo { version, current_version, notes }`) is emitted. A newer push
replaces a held download. The console shows an **Update ready** chip in the
header ([operator console](operator-console.md)); clicking it asks to
restart (warning when projecting) and calls `restart_to_update`, which
installs and restarts. Otherwise the update installs when the main window is
destroyed: on Windows the verified NSIS installer is started with `/P /UPDATE`
and without `/R`, so the app does not reopen; macOS and Linux replace the app
in place. Nothing installs or restarts during a service unless the operator
asks.

## Related

- [Config](config.md): where runtime settings live once installed
