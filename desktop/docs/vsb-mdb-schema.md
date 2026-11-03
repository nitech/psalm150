# VSB MDB schema (sample: brattvaag-2018-12-28.mdb)

| Table | Purpose |
|-------|---------|
| `Songs` | Primary song data |
| `Categories` | Category ID → name |
| `PageSetup` | Default slide theme |
| `History` | Legacy projection history |
| `Export` | Denormalized print index (reference only) |
| `SongBooks` | Book metadata |
| `Version` | App version info |

## Songs columns

- `SongID`, `SongNum`, `Title`, `Body`, `Modified`, `Search`
- `Copyright`, `Author`, `Key`, `CategoryId`

## Body formats

1. **Lyrics only** — blank-line separated stanzas
2. **Chord chart** — fixed-width chord line above lyric line; section labels (`chorus`, `verse 1`, `bridge`)

Import maps these to ChordPro via `src-tauri/src/import/vsb_to_chordpro.rs`.
