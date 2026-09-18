# PSA150 Song Server implementation plan

Confirmed product and architecture decisions are documented in [README.md](README.md)
and [docs/architecture.md](docs/architecture.md). This file tracks work that is
not yet complete.

## Foundation

- [x] Establish the offline-first and self-hostable product principles.
- [x] Define folder-backed and server-backed library authority.
- [x] Separate local revision history from cross-song provenance.
- [x] Confirm PostgreSQL as the only supported production database.
- [x] Record the Christ-centered PSA150 mission and the subordinate role of AI.
- [x] Choose the Rust HTTP framework and repository structure.
- [x] Create the initial Rust project, configuration model, and health check.
- [x] Add automated checks for formatting, tests, and container builds.

## Domain and database

- [x] Specify churches, users, memberships, and simple roles.
- [ ] Specify songs, immutable revisions, conflicts, and deletion semantics.
- [ ] Specify typed provenance relationships and public source references.
- [ ] Specify plans and read-only-by-default sharing.
- [x] Design the initial PostgreSQL migration, indexes, and transactional boundaries.
- [ ] Define search behavior, including languages and alternate titles.

## Authentication and policy

- [x] Choose password authentication and initial-owner provisioning for people.
- [x] Define revocable, scoped desktop credentials with read and append-only import access.
- [ ] Define private, unlisted, and public content visibility.
- [ ] Define instance-level publication and contribution policies.
- [ ] Define attribution, authorship, and licensing requirements.

## Synchronization and portability

- [ ] Define the offline outbox and revision-based synchronization protocol.
- [ ] Define explicit conflict preservation and review behavior.
- [ ] Define snapshot import and provenance recording between servers.
- [ ] Define a complete ChordPro-based export and portable metadata format.
- [x] Implement exact-content folder merge to the server and a read-only desktop replica.
- [ ] Define the later migration and offline-edit upload workflows.

## API and interfaces

- [x] Specify the Phase 1 versioned REST/JSON resources.
- [x] Publish generated OpenAPI JSON.
- [ ] Define compatibility and deprecation rules for API versions.
- [x] Build the initial web interface as an ordinary API consumer.
- [x] Define and implement Phase 1 merge-then-pull PSA150-client synchronization.
- [ ] Define additional integration guidance for external church websites.

## Deployment and operation

- [x] Build the API and web container with multi-architecture-compatible inputs.
- [x] Provide a two-service Docker Compose deployment with PostgreSQL.
- [ ] Document TLS/reverse-proxy configuration and secure defaults.
- [ ] Define database migrations and upgrade behavior.
- [ ] Implement and document backup, restore, and disaster recovery.
- [ ] Establish release, image-signing, and security-update processes.

## Future AI-assisted capabilities

These tasks intentionally follow the dependable non-AI song, synchronization,
and sharing workflows. They are not requirements for the initial server.

- [ ] Define privacy and consent rules for uploading or processing recordings.
- [ ] Define a replaceable provider interface that can support local,
      self-hosted, and optional hosted processing.
- [ ] Prototype audio-to-text lyric transcription with mandatory human review.
- [ ] Prototype time alignment between recordings and lyric lines or words.
- [ ] Explore performed-versus-canonical lyric comparison.
- [ ] Explore section detection and translation-comparison assistance.
- [ ] Record generated suggestions and their provenance without treating them
      as canonical song revisions until a person accepts them.
- [ ] Verify that every core workflow continues to operate when all AI features
      are disabled or unavailable.
