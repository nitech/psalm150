# ChordPro metadata

Praise reads and writes a **worship-projection dialect** of [ChordPro](https://www.chordpro.org/chordpro/chordpro-introduction/) — not the full specification. Unsupported directives are ignored on parse but preserved when saving raw file content from the editor.

## Metadata directives

| Directive | Example | Purpose |
|-----------|---------|---------|
| `{title: ...}` | `{title: Worthy is the Lamb}` | Display title |
| `{key: ...}` | `{key: G}` | Primary key |
| `{artist: ...}` | Author name | |
| `{copyright: ...}` | Copyright line | Audience overlay + print |
| `{meta: song_num=N}` | `{meta: song_num=1016}` | Numeric index |
| `{meta: category=X}` | `{meta: category=General}` | Category filter |
| `{meta: alt_keys=X}` | `{meta: alt_keys=E}` | Alternate keys |
| `{meta: ccli=N}` | `{meta: ccli=1234567}` | CCLI reporting |
| `{meta: tags=a,b}` | `{meta: tags=communion,easter}` | Search/filter |
| `{meta: arrangement=X}` | `congregation`, `stage`, `full` | Arrangement variant |
| `{meta: base_song=file.pro}` | Links arrangement to primary file | |

## Section directives

**Verse, chorus, bridge (read + write):**

- `{start_of_verse}` / `{end_of_verse}`
- `{start_of_chorus}` / `{end_of_chorus}`
- `{start_of_bridge}` / `{end_of_bridge}`
- `{start_of_chorus2}` / `{end_of_chorus2}` — Praise extension for alternate chorus templates

**Additional sections (read + write):**

- `{start_of_intro}` / `{end_of_intro}` — parsed but **not projected**
- `{start_of_prechorus}` / `{end_of_prechorus}` — projected like a verse
- `{start_of_interlude}` / `{end_of_interlude}` — parsed but **not projected**

**Short forms accepted when reading:** `{eov}`, `{eoc}`, `{eob}`, `{sov}`, `{soc}`, `{sob}`

**Section labels:** `{start_of_verse: Verse 2}` or `{start_of_verse label="Verse 2"}`

## Inline chords

`[Am]word` format — chords appear on the stage window only; audience slides show lyrics.

## Ignored on parse (not projected, not in lyrics)

| Input | Example |
|-------|---------|
| `#` comment lines | `# maintainer note` |
| Comment directives | `{comment: ...}`, `{c: ...}`, `{ci: ...}`, `{cb: ...}` |
| Subtitle | `{subtitle: ...}`, `{st: ...}` |

## Short metadata aliases (read only)

| Alias | Equivalent |
|-------|------------|
| `{t: ...}` | `{title: ...}` |
| `{st: ...}` | `{subtitle: ...}` (recognized, not stored) |

## Out of scope

Tab/grid environments, chord diagrams (`{define}`), print/page directives, Pango markup, and delegated environments (Lilypond, ABC, SVG) are not supported.
