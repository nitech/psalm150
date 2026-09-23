---
type: Concept
title: Deployment and config
description: Environment variables and their defaults, the two-service Docker Compose setup, the container image, headless mode, logging and shutdown.
tags: [deployment, docker, compose, config, env]
status: stable
sources:
  - id: config
    resource: /api/src/config.rs
    title: Config::from_env
  - id: main
    resource: /api/src/main.rs
    title: Startup, tracing, graceful shutdown
  - id: lib
    resource: /api/src/lib.rs
    title: Static web fallback / headless warning
  - id: compose
    resource: /compose.yaml
    title: Compose deployment
  - id: docker
    resource: /Dockerfile
    title: Three-stage image
  - id: env
    resource: /.env.example
    title: Example environment
  - id: readme
    resource: /README.md
    title: Run instructions
generated: { by: agent, at: 2026-09-23T00:00:00Z }
---

# Deployment and config

The deployment has two services: the API container and PostgreSQL. It needs no
Redis, message broker, object store or outside identity provider. TLS and
routing are left to a reverse proxy, which is not documented yet
([gaps](gaps.md)).

## Environment

| Variable | Default | Read by | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | **required** | `Config` | PostgreSQL connection string |
| `PSA150_BIND` | `0.0.0.0:8080` | `Config` | Listen address. Startup fails if it cannot be parsed |
| `PSA150_WEB_DIST` | `<crate>/../web/dist` (`/app/web/dist` in the image) | `Config` | Built web client. If it is not a directory, the server runs headless |
| `PSA150_SESSION_HOURS` | `168` | `Config` | Session lifetime. Must be at least 1 |
| `RUST_LOG` | `psa150_server=info,tower_http=info` | `main` | `tracing` filter. `TraceLayer` logs each request |
| `POSTGRES_PASSWORD` | **required** by Compose | `compose.yaml` | Used to build both the DB service and `DATABASE_URL` |
| `PSA150_PORT` | `8080` | `compose.yaml` | Host port mapped to the container's 8080 |

## Startup and shutdown

`main` reads the config, connects (at most 10 connections), runs the migrations
([data model](data-model.md)), binds, and serves. Ctrl+C or SIGTERM stops it
gracefully, with SIGTERM on Unix only. Requests outside `/api` fall through to
`ServeDir` over the web build (`index.html` for directories), so deep links
into the single-page app do not get a history-mode fallback.

## Docker Compose

`docker compose up --build` after copying `.env.example` to `.env` and setting
`POSTGRES_PASSWORD`. The `server` service waits for `database` to report
healthy (`pg_isready`). PostgreSQL has no host port. Its data is in the named
volume `psa150-postgres`. Open `http://localhost:8080` for first-run setup
([auth and roles](auth-and-roles.md)).

## Image

`Dockerfile` has three stages:

1. `oven/bun:1.3.4-alpine` builds `web/dist`.
2. `rust:1.94-bookworm` runs `cargo build --locked --release`.
3. `debian:bookworm-slim` with CA certificates, running as `65532:65532`, entry
   point `psa150-server`, exposing 8080.

The inputs work for both `linux/amd64` and `linux/arm64`. CI builds the image
but does not push it, and does not build more than one architecture
([build and CI](build-and-ci.md)).

## Local development

Run PostgreSQL yourself, export `DATABASE_URL`, then
`cargo run --manifest-path api/Cargo.toml`. Run the Vite dev server alongside
it ([web client](web-client.md)).
