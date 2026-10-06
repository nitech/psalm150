---
type: Concept
title: Reports
description: CCLI usage log and CSV export, and the printable songbook HTML — what they contain and how the console exposes them.
tags: [ccli, reports, print]
status: stable
sources:
  - id: ccli
    resource: /src-tauri/src/ccli.rs
    title: CcliLog (SQLite usage table, CSV export)
  - id: print
    resource: /src-tauri/src/print.rs
    title: Songbook and index HTML
  - id: cmds
    resource: /src-tauri/src/commands/ccli_cmd.rs
    title: export_ccli_report
  - id: app
    resource: /src/components/app.ts
    title: printSongbook / exportCcli handlers
generated: { by: agent, at: 2026-09-13T14:00:00Z }
---

# Reports

## CCLI usage log

`libraries/<hash>/ccli_log.sqlite`, table `usage (filename, title, ccli,
used_at)`. `project_song` appends a row once when a library song session starts
(alongside the history row in the index). `export_ccli_report(from, to)`
returns CSV (`filename,title,ccli,used_at`, quotes doubled) for
`used_at` between the two RFC 3339 bounds.

Console: Settings, **Export CCLI CSV** calls it for 2000–2100, prints the CSV
to the devtools console and toasts "CCLI report copied to console". No file or
clipboard yet ([gaps](gaps.md)).

## Songbook HTML

`print_songbook_html(title, include_indexes)`: one `<section>` per indexed
song with title, number, key and category (**no lyrics**), page-break after
each; optional alphabetical and numeric indexes. Every song field and the
title are HTML-escaped. Console: Settings, **Print songbook HTML** opens it
with `window.open`, sets the popup's `opener` to null (so the page cannot
reach the console's Tauri IPC) and `document.write`s it. The popup inherits
the console's CSP, so scripts in it do not run.

## Related

- [Library index](library-index.md): the rows the songbook lists
