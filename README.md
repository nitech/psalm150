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

Every push to `main` builds and publishes a release (`.github/workflows/release.yml`); pushes that only touch Markdown, `docs/` or `.wiki/` are skipped. The version is `<major>.<minor>` from `src-tauri/tauri.conf.json` plus the workflow run number, so it always goes up; bump major or minor there by hand.

Installed copies check `latest.json` on GitHub Releases ([Tauri updater](https://v2.tauri.app/plugin/updater/)) 30 s after start and then every hour. A new version is downloaded and verified in the background, and an **Update ready** chip appears in the console header. The update installs when the operator closes Psalm150 (it does not reopen), or straight away from the chip's **Restart now**. It never interrupts a service on its own. Debug builds never update.

A copy connected to a song server only takes a release that server can serve. The server reports its contract number as `desktop_api` in `GET /api/v1/info`; each release records the number it needs (`REQUIRED_DESKTOP_API` in `src-tauri/src/updater.rs`) in `latest.json`. When a desktop change depends on something new on the server, raise the server's `DESKTOP_API` and this constant together, and deploy the server first. Until the server catches up, connected copies stay on their current version (and drop a download they were holding); an unreachable server also means "not now".

### One-time setup

1. **Signing keys** (already generated for this project):
   - Private key: `%USERPROFILE%\.tauri\psalm150.key` — keep secret, never commit
   - Public key: embedded in `src-tauri/tauri.conf.json`

2. **GitHub repository secrets** (Settings → Secrets → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — paste the full contents of `psalm150.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — leave unset if the key has no password

3. The repository is public, so installed apps can download releases without a token.

First-time users download an installer from the latest GitHub release; the updater handles subsequent versions.
