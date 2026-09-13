# Songs folder contract

The user-selected **songs folder** (often a shared Dropbox directory) must contain **only ChordPro files**:

- Allowed: `*.pro`, `*.cho`
- Not allowed: SQLite databases, setlists, themes, images, or other sidecar files

The app writes only ChordPro files to this folder. All other state lives in local app data:

- Search index (`index.sqlite`)
- Setlists (`setlists/*.json`)
- History, CCLI log, theme, favorites, hold slides
- Duplicate-review decisions and recoverable copies of edited/deleted songs

## Filename convention

`{song_num:04}-{slug}.pro` — e.g. `1016-worthy-is-the-lamb.pro`

Web saves use the same number/title convention. If that filename is occupied,
`-1`, `-2`, … is appended and the existing file is never overwritten.
Reserved temporary files start with `.praise-tmp-`, end in `.pro`, and are
ignored by library scans. They exist only while a verified replacement is
being installed.

## Safe writes and deletes

- Save commands accept only a single `.pro` or `.cho` filename inside the
  selected folder; path traversal and other extensions are rejected.
- A loaded file carries a content hash. Saving fails if another program has
  changed the file since it was loaded.
- Before replacement or deletion, a verified copy is stored below the
  per-library local app-data directory. Deleted files can be restored; a
  filename suffix is used if the original name is occupied.
- MDB import creates files exclusively and skips filename collisions, including
  a collision that appears while the import is running.

## Dropbox

- Each song edit syncs as a single file
- Conflict copies (Dropbox “conflicted copy”) are detected and shown in the UI
- Setlists are **local per PC**; songs sync via the shared folder
