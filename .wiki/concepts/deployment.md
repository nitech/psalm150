---
type: Concept
title: Deployment and config
description: Environment variables and their defaults (including the client-address header for sign-in limits behind a proxy), what a reverse proxy must not buffer (server-sent events), the /join and song permalink pages, the security headers on every response, the two-service Docker Compose setup, the container image, headless mode, logging and shutdown.
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
    title: Static web fallback / headless warning, permalink and /join routes
  - id: pages
    resource: /api/src/pages.rs
    title: Song permalink page with link-preview tags, app_page for /join
  - id: remote
    resource: /api/src/remote.rs
    title: event_stream (keep-alive, X-Accel-Buffering)
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
generated: { by: agent, at: 2026-10-05T18:00:00Z }
---

# Deployment and config

The deployment has two services: the API container and PostgreSQL. It needs no
Redis, message broker, object store or outside identity provider. TLS and
routing are left to a reverse proxy, which is not documented yet
([gaps](gaps.md)).

## Behind a reverse proxy

Two endpoints are long-lived `text/event-stream` responses:
`/api/v1/remote/desktops/events` (leaders' Remote screens) and
`/api/v1/public/rooms/{room_name}/events` (people following a room). The proxy
must pass them on as they come, not buffer them, and must allow connections
that stay open for the length of a service. The server sends keep-alive
comments and `X-Accel-Buffering: no`, which nginx honours; for other proxies
turn response buffering off for these paths (or for `text/event-stream`) and
raise any idle or read timeout above the keep-alive interval (15 s). Gzip must
not hold events back either; the server's own compression leaves
`text/event-stream` alone. The desktop's command long poll
(`/remote/desktop/commands?wait=25`) needs a read timeout above 30 s.

Each open stream holds a connection for as long as someone follows a room, so
a large congregation following on their phones means as many open
connections ([gaps](gaps.md)).

## Security headers

Every response, the web files included, carries `Content-Security-Policy`
(only this origin for scripts, styles, images, fonts and requests; inline
`style` attributes allowed; no frames, objects or `<base>`; never framed),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
`Referrer-Policy: no-referrer` (`security_headers` in `lib.rs`). A header a
handler sets itself wins. A proxy may add HSTS; the server does not, since it
may be reached over plain HTTP on a LAN.

## Environment

| Variable | Default | Read by | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | **required** | `Config` | PostgreSQL connection string |
| `PSA150_BIND` | `0.0.0.0:8080` | `Config` | Listen address. Startup fails if it cannot be parsed |
| `PSA150_WEB_DIST` | `<crate>/../web/dist` (`/app/web/dist` in the image) | `Config` | Built web client. If it is not a directory, the server runs headless |
| `PSA150_SESSION_HOURS` | `168` | `Config` | Session lifetime. Must be at least 1 |
| `PSA150_CLIENT_IP_HEADER` | unset | `Config` | A header the reverse proxy sets to the client's address, such as `X-Forwarded-For` (its last entry counts) or `CF-Connecting-IP`. Failed sign-ins are limited per client by this address; unset, by the connection's peer, which behind a proxy is the proxy for everyone ([auth and roles](auth-and-roles.md#limits-on-wrong-passwords)). Startup fails if it is not a valid header name. Set it only behind a proxy that sets the header, since clients can send it themselves |
| `RUST_LOG` | `psa150_server=info,tower_http=info` | `main` | `tracing` filter. `TraceLayer` logs each request |
| `POSTGRES_PASSWORD` | **required** by Compose | `compose.yaml` | Used to build both the DB service and `DATABASE_URL` |
| `PSA150_PORT` | `8080` | `compose.yaml` | Host port mapped to the container's 8080 |

## Startup and shutdown

`main` reads the config, connects (at most 10 connections), runs the migrations
([data model](data-model.md)), binds, and serves with the peer address of
each connection available to handlers (`ConnectInfo`). Ctrl+C or SIGTERM stops it
gracefully, with SIGTERM on Unix only. Requests outside `/api` fall through to
`ServeDir` over the web build (`index.html` for directories), so deep links
into the single-page app do not get a history-mode fallback. The exceptions
are `/join` and `/join/{room_name}`, the token-free [room](rooms.md) reader:
with a web build present they serve `index.html` (read from disk on each
request, `Cache-Control: no-cache`, `pages::app_page`), and the app reads the
path. Headless servers have no such routes.

## Song permalinks

With a web build present, `GET /songs/{id}` (outside `/api`, `pages.rs`)
serves the web client's `index.html`, read from disk on each request, with
`Cache-Control: no-cache`, plus a descriptive `<title>`, `description`,
`og:type`, `og:title`, `og:description` and `og:site_name`, so chat apps can
show a preview:

- a song in a public library: "<song> · <church>", described by its
  authors and church;
- a private song: "A song from <church>", described "Sign in to read it.";
  its title and authors are never sent without a sign-in.

A deleted, unknown or malformed id gets the page unchanged (200). Headless
servers have no such route.

## Shared set links

`GET /shared/{key}` (`pages::shared_set_page`) serves the app the same way.
For a key that opens a live shared set, the preview names the set and its
day, "Kvelds · Sunday 18 October 2026", with "<church> · 3 songs: A, B, C"
(the first five titles, then "and N more"); whoever has the link may read
the set anyway ([shared sets](shared-sets.md)). Any other key gets the page
unchanged, and the app says the link is gone.

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
