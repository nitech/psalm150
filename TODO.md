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
- [x] Specify plans and read-only-by-default sharing.
- [x] Implement church sets (service song lists) with version-checked edits.
- [x] Design the initial PostgreSQL migration, indexes, and transactional boundaries.
- [ ] Define search behavior, including languages and alternate titles.

## Authentication and policy

- [x] Choose password authentication and initial-owner provisioning for people.
- [x] Define revocable, scoped desktop credentials that read, import, edit and delete songs and sets.
- [x] Let people make revocable API tokens that act as them, with their role or a lower one.
- [x] Let owners add people, change roles, reset passwords, and disable or remove people through the API.
- [x] Let people sign out and change their own password.
- [x] Manage people from the web interface.
- [x] Limit wrong passwords at sign-in and password change.
- [ ] Keep sign-in limits across server restarts and several server instances.
- [ ] Define private, unlisted, and public content visibility.
- [ ] Define instance-level publication and contribution policies.
- [ ] Define attribution, authorship, and licensing requirements.

## Synchronization and portability

- [ ] Define the offline outbox and revision-based synchronization protocol.
- [ ] Define explicit conflict preservation and review behavior.
- [ ] Define snapshot import and provenance recording between servers.
- [ ] Define a complete ChordPro-based export and portable metadata format.
- [x] Implement exact-content folder merge to the server and a read-only desktop replica.
- [x] Synchronize sets with desktops, including sets created offline.
- [ ] Define the later migration and offline-edit upload workflows.

## API and interfaces

- [x] Specify the Phase 1 versioned REST/JSON resources.
- [x] Publish generated OpenAPI JSON.
- [x] Make everything the server does available through the API to anyone with a suitable token,
      with bearer authentication described in the OpenAPI document.
- [x] Restore deleted songs and sets, and read any earlier song revision, through the API.
- [ ] Define compatibility and deprecation rules for API versions.
- [x] Build the initial web interface as an ordinary API consumer.
- [x] Rebuild the web interface mobile-first for reading and leading from a phone.
- [x] Relay remote control from leaders' phones to desktops that allow it.
- [x] Push desktop changes to leaders' phones as they happen instead of polling.
- [x] Give every desktop a room name and let anyone follow the projected words in large text on their own phone.
- [ ] Keep remote control working across server restarts and several server instances.
- [ ] Limit how often rooms are read and how many people may follow one at a time.
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
