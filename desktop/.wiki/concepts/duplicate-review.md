---
type: Concept
title: Duplicate review
description: Exact duplicate candidates are grouped for human comparison; decisions and recoverable deletions remain local to the library.
tags: [library, duplicates, recovery, operator]
status: stable
sources:
  - id: duplicate-engine
    resource: /src-tauri/src/duplicates.rs
    title: Candidate grouping and persisted review pairs
  - id: duplicate-commands
    resource: /src-tauri/src/commands/duplicates_cmd.rs
    title: Review, recovery list and restore commands
  - id: safe-files
    resource: /src-tauri/src/library/files.rs
    title: Verified backup, recoverable delete and collision-free restore
  - id: console
    resource: /src/components/app.ts
    title: Possible duplicates operator view
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Duplicate review

Settings → **Review possible duplicates** opens a local review view. Nothing is
merged or deleted automatically.

## Candidate rules

Songs are linked when at least one exact normalized value matches:

- the same positive song number;
- the same non-empty title after lower-casing and collapsing whitespace;
- identical non-empty lyric text after removing chords, lower-casing and
  collapsing whitespace.

Linked matches are combined transitively into groups. The view gives every
group's reasons plus title, number, key, filename and modification time. Two
files can be selected and compared side by side as lyrics, extracted chords
and raw ChordPro.

## Decisions

**Keep both** records the selected pair's content hashes in
`duplicate-reviews.json` below the per-library app-data directory. It is a
decision about those exact contents: if either file changes, the pair is shown
again. Reviewed groups are hidden by default and can be included with a filter.

**Delete file** requires the operator to confirm title and filename. The
backend refuses the active projection file, any file referenced by a saved
setlist and all deletes in read-only mode. A verified recovery copy must be
created before the source is removed.

## Recovery

The same view lists recovery records below
`app_data_dir/libraries/<hash>/recovery/<id>/`. **Restore** uses the original
filename when available, otherwise the normal `-1`, `-2`, … suffix. Recovery
copies are intentionally retained after restore.

External watcher activity marks an open review stale; the operator refreshes
it. Opening the view, importing, rescanning, deleting and restoring rebuild the
candidate list from disk.
