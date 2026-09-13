# PSA150 Song Server

## Purpose

An optional, self-hostable, API-first song service for individual churches.
Psalm150 desktop clients remain fully usable with local ChordPro libraries when
no server is configured.

## Confirmed direction

- Run a separate server per church by default; a host may intentionally serve
  several isolated churches.
- Use PostgreSQL as the only supported production database.
- Ship a small Docker deployment for `linux/amd64` and `linux/arm64`, suitable
  for a VPS, Dokploy, Coolify, Railway, or a Raspberry Pi 5.
- Provide a versioned REST/JSON API and an OpenAPI description. The optional
  web interface is an API consumer; the server remains useful headlessly.
- Keep songs as ChordPro source text. The server adds search, ownership,
  revision history, sharing controls, and backups around that source.
- Keep projections and the desktop client offline-first. The projection
  computer owns live presentation state; a server is never required to run a
  service.
- Importing a public song creates an independently owned local copy. It never
  updates automatically from the source server.
- Retain provenance separately from synchronization: originals, translations,
  forks, arrangements, corrections, and added verses form a navigable song
  lineage graph.
- Keep access simple: owner, leader, and viewer. Shared plans default to
  read-only.

## First design work

- [ ] Define the server repository structure and Rust workspace.
- [ ] Specify the versioned API and publish an OpenAPI document.
- [ ] Model churches, users, roles, devices, songs, revisions, imports, and
      lineage relationships.
- [ ] Specify authentication for people and revocable machine/device tokens.
- [ ] Design offline synchronization and explicit conflict resolution.
- [ ] Define public, unlisted, and private sharing plus attribution and
      licensing fields.
- [ ] Define backups, restore, migrations, and the supported Docker Compose
      deployment.
- [ ] Define the desktop client's local-library and Song Server connection
      modes.
