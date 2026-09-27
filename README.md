# Psalm150

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
2. Choose a library source in **Settings**:
   - **Use Local Songs Folder** for a directory containing only `.pro` / `.cho` files (for example, a Dropbox folder), or
   - **Church song server** for a read-only offline replica using a desktop token created by PSA150 Server.
3. **Import MDB** converts a legacy Visual Song Book `.mdb` songbook into a local ChordPro folder.
4. Search, project to the audience window, and manage setlists (kept on this PC for a local folder; shared with the church's sets on the song server for a server library).

A server-backed library downloads into managed app storage. On first
connection and each explicit synchronization, the client adds ChordPro
documents from the remembered local folder whose exact content is not already
on the server, then downloads the merged server library. Exact matches are
skipped and differing versions are kept separately. The original local folder
remains unchanged and is remembered as a return path.

Synchronization is explicit in Phase 1, and the last complete cache opens
without a network connection. PostgreSQL becomes canonical after connection;
editing existing server-backed songs from the desktop is deferred until the
conflict-aware upload protocol is implemented.

## Architecture

- **Folder-backed library**: ChordPro files are canonical.
- **Server-backed library**: PostgreSQL is canonical; the desktop uses a managed,
  read-only ChordPro cache.
- **Local app data**: SQLite index, server cache, setlists, history, CCLI log,
  theme, and favorites.

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
   - Private key: `%USERPROFILE%\.tauri\psalm150.key` — keep secret, never commit
   - Public key: embedded in `src-tauri/tauri.conf.json`

2. **GitHub repository secrets** (Settings → Secrets → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — paste the full contents of `psalm150.key`
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
