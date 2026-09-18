# PSA150 Song Server

PSA150 Song Server is an optional, self-hostable, API-first song service for
individual churches. It adds shared libraries, plans, revision history,
publishing, and song provenance without making the PSA150 desktop application
dependent on a server.

The project is implementing its first private-library vertical slice.

## PSA150 mission

PSA150 exists to help song leaders and church members write, prepare, sing, and
share songs. Its practical tools are intended to support worshippers in
glorifying the one Lord, Jesus Christ.

The Song Server is one part of that wider system. It supports shared song work
and publishing; it is not the purpose of PSA150 by itself.

## Product principles

- **Offline first:** the desktop application can always use a local ChordPro
  library and run a complete service without a server or Internet connection.
- **Church independence:** a church normally owns and operates its own server.
  One server may deliberately host several isolated churches, but no church is
  placed in a larger organization by default.
- **Lightweight operation:** the first supported deployment consists of one API
  service and PostgreSQL. Redis, message brokers, object storage, external
  search services, and hosted identity providers are not required.
- **API first:** every first-party interface uses the same versioned API that is
  available to desktop clients, church websites, and other integrations.
- **Portable data:** a church can import and export ordinary ChordPro files and
  retain its data without continuing to operate PSA150 Song Server.
- **Explicit sharing:** importing a published song creates an independent copy.
  Imported songs never receive automatic changes from their source.
- **AI remains a tool:** future AI-assisted features may help with transcription,
  lyric synchronization, comparison, and related audio-to-text work. AI is not
  PSA150's main tool, never replaces human leadership or responsibility, and is
  never required for the core product.

## Library authority

PSA150 supports two independent library modes:

| Library mode | Canonical source | Desktop behavior |
| --- | --- | --- |
| Folder-backed | One ChordPro file per song in a local, network, or synchronized folder | Reads and writes the canonical files directly |
| Server-backed | PostgreSQL on the configured PSA150 Song Server | Maintains an offline-capable local replica and synchronizes when the server is reachable |

The projection computer owns live performance state in both modes. The Song
Server is never required to advance slides, blank a display, or complete an
already prepared service.

## Initial scope

- Church-owned songs stored as ChordPro source text.
- Immutable song revision history and explicit conflict handling.
- Provenance between originals, translations, adaptations, arrangements,
  corrections, and added verses.
- Shared plans that are read-only by default.
- Simple owner, leader, and viewer access.
- Optional public profiles and public, unlisted, or private song sharing.
- Import, export, backup, restore, and database migration tooling.
- A versioned REST/JSON API with an OpenAPI description.
- An optional web interface built entirely on the public API.
- Docker images for `linux/amd64` and `linux/arm64`.

General-purpose social networking, live projection control, and automatic
upstream updates to imported songs are not server responsibilities.

AI-assisted audio and lyric processing is future scope, not part of the initial
server release. The foundational song, planning, projection, and sharing
workflows must remain useful without an AI provider, subscription, or Internet
connection.

## Documentation

- [Architecture](docs/architecture.md)
- [API](docs/api.md)
- [Phase 1](docs/phase-1.md)
- [Implementation plan](TODO.md)

## Repository layout

```text
api/        Rust/Axum API and PostgreSQL migrations
web/        Independent Vite administration client
docs/       Architecture and delivery notes
```

The projects build independently. For the smallest production deployment, the
API container serves the web client's compiled static files. Headless users may
run the API without those files.

## Run with Docker Compose

Copy `.env.example` to `.env`, choose a strong `POSTGRES_PASSWORD`, and run:

```sh
docker compose up --build
```

Open `http://localhost:8080` for first-run setup. PostgreSQL is not exposed on a
host port. API documentation is available at `/api/openapi.json`.

## Develop locally

Run PostgreSQL, set `DATABASE_URL`, and start the projects independently:

```sh
cargo run --manifest-path api/Cargo.toml
cd web && bun install && bun run dev
```

Vite proxies `/api` requests to the Rust API on port 8080.
