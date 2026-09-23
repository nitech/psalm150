# Directory Update Log

## 2026-09-23
* **Sync**: Desktop tokens may now create, edit and delete songs (`require_song_editor`), so a desktop can keep a Visual Song Book database in step; token management stays leader-only. New `DELETE /songs/{id}?base_revision_id=` (soft, 409 when stale), migration `0002_device_song_edits.sql` (`created_by_device`, `deleted_by`, `deleted_by_device`), and `psa150-manifest.json` in the export mapping files to song and revision ids.
* **Creation**: Bundle initialised from a full read of the repo (`api/`, `web/`, `docs/`, `README.md`, `TODO.md`, CI and container files) at `dd46907`. It has an overview, 10 concept pages, an index and this log, and uses the same schema as the desktop client's wiki. Sources are cited per page. `/docs/`, `/README.md` and `/TODO.md` stay where they are and are linked, not copied.
