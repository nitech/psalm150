# Praise — agent instructions

Church worship projection app: Tauri 2 (Rust core in `src-tauri/`) with a
Lit/TypeScript frontend (`src/`) rendered into three webviews (console,
audience, stage). Package manager is **bun**.

## Wiki

Compiled knowledge lives in `.wiki/` (schema: `.wiki/AGENTS.md`; start at
`.wiki/overview.md`, catalog in `.wiki/index.md`). After any non-trivial
change to architecture, contracts (IPC commands, events, config fields, the
ChordPro dialect, the songs-folder layout) or operator-visible behaviour,
update the touched pages, `index.md` and `log.md` in the same turn. Skip
trivial and no-behaviour diffs. Human docs stay in `docs/` and `CONCEPTS.md`;
the wiki links to them rather than copying.

## Commands

```bash
bun install
bun run tauri dev      # app with hot reload
bun run test           # vitest (tests/*.test.ts)
bun run test:rust      # cargo test in src-tauri
bun x tsc --noEmit -p .
```

## Rules that are easy to break

- Never build a webview from a synchronous Tauri command on Windows; the
  projection windows are created hidden at startup and only shown/hidden.
- Never `emit` or `eval` while holding the `AppState` mutex.
- Only ChordPro files are written to the songs folder.
- The chorus2 alternation and blank-line stanza rule exist in both Rust
  (`projection/mod.rs`, `library/chordpro.rs`) and TypeScript
  (`performance-sections.ts`, `stanza-markers.ts`); change them together.
- Components render into light DOM; all styling lives in `src/styles.css`.
- Docs and wiki describe behaviour, not models. Say "the agent".
