# Songs folder contract

The user-selected **songs folder** (often a shared Dropbox directory) must contain **only ChordPro files**:

- Allowed: `*.pro`, `*.cho`
- Not allowed: SQLite databases, setlists, themes, images, or other sidecar files

The app writes only ChordPro files to this folder. All other state lives in local app data:

- Search index (`index.sqlite`)
- Setlists (`setlists/*.json`)
- History, CCLI log, theme, favorites, hold slides

## Filename convention

`{song_num:04}-{slug}.pro` — e.g. `1016-worthy-is-the-lamb.pro`

## Dropbox

- Each song edit syncs as a single file
- Conflict copies (Dropbox “conflicted copy”) are detected and shown in the UI
- Setlists are **local per PC**; songs sync via the shared folder
