# psa150-lyrics

Online song lookup shared by the Psalm150 desktop app and the song server:
search the web for a song, read the best pages, and turn each into ChordPro.

This folder is canonical. The desktop mirrors it into
`src-tauri/crates/psa150-lyrics/` with `bun run sync:shared`; edit here, then
sync. The desktop must keep working without a song server, which is why it
runs this code itself rather than asking the server.

```bash
cargo test --manifest-path shared/lyrics/Cargo.toml
```
