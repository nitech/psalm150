# Praise

Cross-platform church worship projection app built with Tauri 2 (Rust + TypeScript).

## Requirements

- [Bun](https://bun.sh) 1.2+
- Rust stable (`rustup`)
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload (for linking)

## Development

```bash
bun install
bun run tauri dev
bun run tauri
```

## Usage

1. Launch the app
2. **Open Songs Folder** — select a directory that will contain only `.pro` / `.cho` files (e.g. a Dropbox folder)
3. **Import MDB** — convert a legacy Visual Song Book `.mdb` songbook into ChordPro files in that folder
4. Search, project to the audience window, manage setlists locally

## Architecture

- **Songs folder** (synced): ChordPro files only
- **Local app data**: SQLite index, setlists, history, CCLI log, theme, favorites

See [docs/songs-folder-contract.md](docs/songs-folder-contract.md).

`docs/solutions/` — documented fixes and patterns (bugs, Tauri gotchas, workflow), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Check here before debugging projection or desktop window issues.

`CONCEPTS.md` — shared domain vocabulary (audience window, songs folder, projection terms).

## Wiki

Compiled knowledge for agents (and curious humans) lives in [`.wiki/`](.wiki/index.md): start at [`.wiki/overview.md`](.wiki/overview.md). Every concept page cites the source files it describes; [`.wiki/concepts/gaps.md`](.wiki/concepts/gaps.md) lists what is half-built. After a non-trivial code change the agent updates it in the same turn (see [`AGENTS.md`](AGENTS.md)).

## Tests

```bash
bun run test:rust
```

## Releasing & auto-updates

Installed copies check for updates on startup via [Tauri updater](https://v2.tauri.app/plugin/updater/), using `latest.json` from GitHub Releases.

### One-time setup

1. **Signing keys** (already generated for this project):
   - Private key: `%USERPROFILE%\.tauri\praise.key` — keep secret, never commit
   - Public key: embedded in `src-tauri/tauri.conf.json`

2. **GitHub repository secrets** (Settings → Secrets → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — paste the full contents of `praise.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — leave empty if the key has no password

### Publish a new version

1. Bump `version` in `package.json` and `src-tauri/tauri.conf.json` (and `src-tauri/Cargo.toml`)
2. Commit, tag, and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. GitHub Actions builds installers for Windows, macOS, and Linux and creates a **draft** release with `latest.json`
4. Review the draft release on GitHub and publish it — installed apps will pick up the update on next launch

First-time users still download an installer from the GitHub release; the updater handles subsequent versions.
