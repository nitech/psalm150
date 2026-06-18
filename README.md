# Visual Song Book

Cross-platform rewrite of Visual Song Book using Tauri 2 (Rust + TypeScript).

## Requirements

- Node.js 20+
- Rust stable (`rustup`)
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload (for linking)

## Development

```bash
npm install
npm run tauri dev
```

## Usage

1. Launch the app
2. **Open Songs Folder** — select a directory that will contain only `.pro` / `.cho` files (e.g. a Dropbox folder)
3. **Import MDB** — convert a legacy VSB `.mdb` songbook into ChordPro files in that folder
4. Search, project to the audience window, manage setlists locally

## Architecture

- **Songs folder** (synced): ChordPro files only
- **Local app data**: SQLite index, setlists, history, CCLI log, theme, favorites

See [docs/songs-folder-contract.md](docs/songs-folder-contract.md).

`docs/solutions/` — documented fixes and patterns (bugs, Tauri gotchas, workflow), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Check here before debugging projection or desktop window issues.

`CONCEPTS.md` — shared domain vocabulary (audience window, songs folder, projection terms).

## Tests

```bash
npm run test:rust
```
