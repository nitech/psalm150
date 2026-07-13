# ChordPro metadata

Praise reads and writes these directives in `.pro` files:

| Directive | Example | Purpose |
|-----------|---------|---------|
| `{title: ...}` | `{title: Worthy is the Lamb}` | Display title |
| `{key: ...}` | `{key: G}` | Primary key |
| `{artist: ...}` | Author name | |
| `{copyright: ...}` | Copyright line | On-screen + print |
| `{meta: song_num=N}` | `{meta: song_num=1016}` | Numeric index |
| `{meta: category=X}` | `{meta: category=General}` | Category filter |
| `{meta: alt_keys=X}` | `{meta: alt_keys=E}` | Alternate keys |
| `{meta: ccli=N}` | `{meta: ccli=1234567}` | CCLI reporting |
| `{meta: tags=a,b}` | `{meta: tags=communion,easter}` | Search/filter |
| `{meta: arrangement=X}` | `congregation`, `stage`, `full` | Arrangement variant |
| `{meta: base_song=file.pro}` | Links arrangement to primary file | |

Section directives: `{start_of_verse}`, `{end_of_verse}`, `{start_of_chorus}`, `{end_of_chorus}`, `{start_of_bridge}`, `{end_of_bridge}` (short forms `{eov}`, `{eoc}`, `{eob}` are accepted when reading).

Inline chords: `[Am]word` format.
