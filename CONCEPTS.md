# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as learnings are documented; direct edits are fine. Glossary only, not a spec or catch-all.

## Projection

### Audience window
The fullscreen display shown to the congregation. Renders lyric slides, overlays, and blank states. Pre-created at app startup and shown/hidden by the operator; not created on demand during projection.

### Stage window
The musician-facing display showing chords, section labels, and the next section. Pre-created hidden at startup like the audience window.

### Operator console
The main Tauri window where the worship leader searches the library, builds setlists, and controls what appears on audience and stage displays.

### Slide
One unit of projected content derived from a ChordPro song — typically a verse, chorus, or bridge section split for display.

## Library

### Songs folder
The user-chosen directory that holds only ChordPro (`.pro` / `.cho`) files, often synced via Dropbox. The app indexes it locally but never writes non-ChordPro files there.

### ChordPro
The text format used for song files in the songs folder. Contains metadata (title, key, CCLI) and sectioned lyrics with optional chord notation.

### MDB import
One-time conversion of a legacy Visual Song Book Access database into ChordPro files written into the songs folder.
