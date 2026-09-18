# Phase 1: private library vertical slice

Phase 1 proves that a church can operate a private server-backed library while
the desktop remains capable of projecting from a local replica when the server
is unavailable.

## Included

- First-run creation of one church and its owner.
- Password authentication for people and revocable desktop sync tokens that
  may read the library and add missing songs, but not edit or delete songs.
- ChordPro song creation, search, editing, and batch import.
- Immutable revisions with optimistic conflict detection.
- Full-library export as ordinary ChordPro files in a ZIP archive.
- A merge-then-pull desktop connection that adds exact local-only songs to the
  server and stages the merged export locally.
- Offline desktop startup, browsing, and projection from the last valid cache.
- Versioned REST/JSON endpoints and generated OpenAPI JSON.
- A small Vite web client that uses only the public API.
- PostgreSQL migrations and a two-service Docker Compose deployment.
- AMD64 and ARM64-compatible container build inputs.

The schema scopes content to a church so intentional multi-church hosting can
be added later, but Phase 1 presents a single-church setup.

## Deferred

- Public, unlisted, and cross-server publishing.
- Song provenance relationships and lineage visualization.
- Plans, profiles, invitations, and member administration.
- Offline editing, change batching, and conflict-resolution UI.
- Local-network projection control.
- AI-assisted features.

## Acceptance path

1. Start the Compose deployment.
2. Create the initial church and owner in the web interface.
3. Optionally import a representative folder of ChordPro files in the web UI.
4. Search, inspect, edit, and export songs.
5. Create a desktop sync token.
6. Connect a PSA150 desktop with an existing local library; local-only songs
   are added to the server and the merged library is downloaded.
7. Stop the server and project a complete prepared service from that replica.
8. Restart the server and pull its latest song revisions.

The server implements steps 1–5. The companion `PSA150-client` repository now
implements steps 6–8 as a read-only Phase 1 replica: users connect with a
revocable desktop token, merge exact local-only songs from the remembered local
folder, and explicitly download server changes. Editing existing server songs
from the desktop, offline edit queues, and conflict resolution remain deferred.
