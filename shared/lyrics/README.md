# psa150-lyrics

Online song lookup shared by the Psalm150 desktop app and the song server:
search the web for a song, read the best pages, and turn each into ChordPro.

Both use this folder as a Cargo path dependency. The desktop must keep
working without a song server, which is why it runs this code itself rather
than asking the server.

```bash
cargo test --manifest-path shared/lyrics/Cargo.toml
```
