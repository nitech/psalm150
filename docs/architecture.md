# Architecture

## System boundary

PSA150 Song Server manages shared and published church content. The desktop
client remains responsible for local projection, audience and stage displays,
and local-network phone control.

The wider PSA150 system serves song leaders and church members as they write,
prepare, sing, and share songs in worship of the one Lord, Jesus Christ. Its
architecture prioritizes dependable practical support for that work over any
particular technology.

```text
PSA150 desktop client
  |-- folder-backed library ------> ChordPro files (canonical)
  `-- server-backed library ------> local offline replica
                                      |
                                      `--> versioned API
                                             |
                                             `--> PostgreSQL (canonical)
```

A server-backed desktop must remain useful while disconnected. Connectivity is
required to exchange changes, not to run a prepared service.

## Deployment shape

The first supported deployment has two required services:

1. The PSA150 API service.
2. PostgreSQL.

The deployment is published as Docker Compose and multi-architecture container
images for `linux/amd64` and `linux/arm64`. A hosting platform or local reverse
proxy provides routing and TLS. Optional web assets may be served by the API
service or deployed as static files; they do not introduce another required
runtime service.

No Redis instance, message broker, object store, separate search engine, or
external authentication provider is required for the initial product.

AI infrastructure is likewise not a required service. Future AI-assisted
features must be attachable capabilities rather than dependencies of the API,
database, desktop client, or performance workflow.

## Authority and storage

In a folder-backed library, the ChordPro files are the source of truth. The
desktop's index is derived and can be rebuilt.

In a server-backed library, PostgreSQL is the source of truth. ChordPro source
text is stored with the song revision it represents. Searchable metadata is
stored and indexed alongside it. Desktop replicas are caches; they do not
replace server authority. Phase 1 replicas are pull-only and read-only. A later
editing phase will add a durable outbox for unsynchronized local work.

Every server-backed song needs a stable globally unique identifier independent
of its title and filename. The portable representation of that identity and
its provenance in ChordPro exports remains an open format decision.

## Core domain

- **Instance:** one deployed PSA150 Song Server.
- **Church:** an isolated content and membership space. A normal instance starts
  with one church; multi-church hosting is an explicit administrator choice.
- **User:** a person with an account on the instance.
- **Membership:** connects a user to a church as owner, leader, or viewer.
- **Device credential:** a revocable, scoped credential for a desktop client or
  API integration. It is not a substitute for a person's account.
- **Song:** the church-owned identity and current state of one independent song
  copy.
- **Song revision:** an immutable snapshot of ChordPro source and associated
  metadata, linked to its parent revision.
- **Provenance link:** a typed relationship between independently owned songs or
  published revisions, such as translation, adaptation, arrangement,
  correction, fork, or added verses.
- **Plan:** an ordered service plan shared read-only unless edit access is
  granted explicitly.
- **Profile:** an optional public identity under which a user exposes songs or
  translations when the church's publication policy permits it.

All church-owned records are scoped to a church. Multi-church hosting must not
weaken that isolation.

## Revision history and provenance

Revision history and provenance answer different questions:

- Revision history records how one church's copy changed over time.
- Provenance records how independently owned songs relate across copies,
  languages, arrangements, and servers.

Revision history is normally linear but must retain both versions when two
offline editors change the same base revision. The server never resolves this
with silent last-write-wins behavior.

Provenance is a directed graph rather than a strict tree because a derived song
may eventually cite more than one source. Interfaces may present the common
single-source case as a tree.

## Public import semantics

Importing a published song is a snapshot operation:

1. Copy the selected ChordPro source and permitted metadata.
2. Create a new song owned by the importing church.
3. Record the source server, published song identifier, exact revision or
   content hash, attribution, license, and import time.
4. Add the appropriate provenance relationship.

The imported song has its own revision history from that point onward. It is
not subscribed or linked for synchronization, and later source changes never
modify it automatically. A future comparison interface may show related source
material, but applying any change is always explicit.

## Synchronization outline

Phase 1 uses an intentionally small merge-then-pull protocol. On first
connection, a revocable desktop credential submits the active local ChordPro
library. The server adds documents whose exact content hash is not already in
the church library, then the client downloads the complete ChordPro ZIP export.
Exact matches are skipped; differing versions are preserved as separate songs
until the later provenance and conflict tools can relate them. The credential
may add songs but cannot change or delete existing server songs.

The client extracts the export into a staging directory and replaces its
managed cache only after the archive has downloaded and validated successfully.
The original local folder is left unchanged and remembered as a return path.
The last valid cache opens at startup and remains usable without the server.
Once connected, the PostgreSQL library is canonical and Phase 1 desktop edits
remain disabled. Each explicit synchronization repeats the exact-content merge
from the remembered local folder and then downloads the newest server snapshot.

Offline editing is a later phase. At that point, each desktop will track the
last server revision it has accepted. Offline edits will be queued locally with
that base revision. When reconnecting:

1. The client sends its change and base revision.
2. The server accepts it when the base is still current and creates an immutable
   revision.
3. When the base is no longer current, the server preserves both versions and
   returns a conflict for deliberate review.
4. Other server changes are downloaded into the local replica.

Protocol details, batching, deletion semantics, and the conflict-review
experience remain design tasks.

## Access and publication

Human access stays intentionally small:

- **Owner:** instance or church administration and recovery.
- **Leader:** full access to the church's songs, plans, publishing, and normal
  content management.
- **Viewer:** read access to material shared with them.

An instance chooses its publication policy: private, public read-only, public
with moderated submissions, or public with contributions by approved leaders.
Individual content may be private, unlisted, or public within that policy.

Local companion access is a separate desktop concern. Its off, open-on-LAN,
and QR-paired modes do not depend on Song Server accounts or availability.

## Future AI assistance

AI is one optional tool within PSA150, not the product's identity or primary
workflow. Possible later capabilities include:

- Transcribing sung lyrics from audio into a reviewable draft.
- Aligning lyric lines or words with positions in a recording.
- Comparing performed words with stored canonical lyrics.
- Suggesting verse, chorus, bridge, and repeated-section boundaries.
- Assisting with translation comparison and other audio-to-text workflows.

AI output is always identified as generated or suggested material and requires
human review before it can change canonical song content. People remain
responsible for theology, lyrics, translations, attribution, licensing, and
publication.

Core PSA150 workflows must operate without AI. Provider integrations should be
replaceable, and the eventual design should consider local or self-hosted
processing alongside optional hosted providers so that privacy and church
independence are preserved.

## API principles

- Versioned REST/JSON resources described by OpenAPI.
- The bundled web interface has no privileged private backend contract.
- Device and integration credentials are scoped and revocable.
- Imports are explicit operations, not cross-server replication.
- API consumers can determine revisions and detect conflicts without relying on
  timestamps alone.
- Public endpoints expose only content deliberately published by the owning
  church and user.

## Portability and recovery

A full export must preserve usable ChordPro songs without requiring the server.
It should also carry portable metadata for provenance, attribution, licensing,
plans, and identities where appropriate. The exact archive and metadata format
is still to be designed.

Backup and restore cover PostgreSQL and any future persistent asset volume.
Database migrations must be automatic, versioned, and reversible through a
documented backup-and-restore procedure.

## Open decisions

- ChordPro-compatible identity and provenance export format.
- Offline outbox, deletion, and conflict-resolution protocol.
- Search behavior and language-aware indexing.
- Public profile and contribution moderation details.
- Backup archive format and upgrade policy.
- Boundaries, privacy requirements, and provider interface for future
  AI-assisted audio processing.
