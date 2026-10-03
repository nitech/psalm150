# API

The PSA150 Song Server API is versioned under `/api/v1`. Its generated OpenAPI
document is served at `/api/openapi.json`. The bundled web interface uses these
same endpoints and has no private server contract.

## Authentication

Authenticated requests send `Authorization: Bearer <token>`.

- Person sessions begin with `psa_s_`, expire, and carry the person's church
  membership and role.
- Desktop credentials begin with `psa_d_` and are scoped to one church. They
  may read the library, import, create, edit and delete songs and sets, and
  use the remote-control desktop endpoints. They cannot manage credentials,
  approve other desktops or send remote commands.
- Only a hash of either token is stored by the server.

A desktop normally gets its `psa_d_` credential through browser sign-in: it
opens the web interface at
`/?desktop_redirect=<loopback URL>&state=<opaque>&code_challenge=<S256 challenge>&device_name=<name>`,
a leader signs in and approves, and the browser returns to the loopback URL
with a one-time `psa_c_` code (valid five minutes). The desktop exchanges that
code and its PKCE verifier at `POST /api/v1/desktop-auth/token`.

An owner may make the church's library public (`PUT /api/v1/church`). Anyone
may then search and read its songs through `/api/v1/public/songs` without a
bearer token. Sets, revisions, export and every write still need a token.

The first owner is created through `POST /api/v1/setup`, which becomes
unavailable after successful initialization. Passwords are hashed with Argon2.

## Resources

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Check API and PostgreSQL availability |
| `GET` | `/api/v1/info` | Public ping: service name, version, `initialized`, `desktop_sign_in`, `public_library`, `public_library_name` |
| `GET` | `/api/v1/church` | The signed-in church and its settings (`public_library`) |
| `PUT` | `/api/v1/church` | Owner opens the library to everyone, read only, or closes it (`{public_library}`) |
| `GET` | `/api/v1/public/songs?q=&limit=&offset=&sort=&direction=` | Search public libraries without signing in (same paging as `/songs`) |
| `GET` | `/api/v1/public/songs/{id}` | Read a song in a public library without signing in |
| `GET` | `/api/v1/setup` | Determine whether first-run setup is available |
| `POST` | `/api/v1/setup` | Create the first church, owner, and session |
| `POST` | `/api/v1/session` | Sign in and issue a person session |
| `POST` | `/api/v1/device-tokens` | Create a scoped desktop sync credential |
| `GET` | `/api/v1/device-tokens` | List active desktop credentials |
| `DELETE` | `/api/v1/device-tokens/{id}` | Revoke a desktop credential |
| `POST` | `/api/v1/desktop-auth/codes` | Leader approves a desktop: one-time sign-in code for a PKCE challenge |
| `POST` | `/api/v1/desktop-auth/token` | Desktop exchanges code and verifier for a desktop credential (no bearer) |
| `GET` | `/api/v1/songs?q=&limit=&offset=&sort=&direction=` | List or search current song revisions; `sort` `title` (default) or `number` (numeric, songs without a number last), `direction` `asc` or `desc`; page with `limit` (1–200, default 100) and `offset` |
| `POST` | `/api/v1/songs` | Create a song and its first revision |
| `GET` | `/api/v1/songs/{id}` | Read the current ChordPro source and metadata |
| `PUT` | `/api/v1/songs/{id}` | Create a revision from an expected base revision |
| `DELETE` | `/api/v1/songs/{id}?base_revision_id=` | Delete a song (soft); a stale base revision is `409` |
| `GET` | `/api/v1/songs/{id}/revisions` | List immutable revision metadata |
| `POST` | `/api/v1/songs/import` | Import up to 500 ChordPro songs, skipping exact content matches |
| `GET` | `/api/v1/songs/export` | Download current songs as a ZIP of `.pro` files plus `psa150-manifest.json` |
| `GET` | `/api/v1/sets?from=&limit=` | List the church's sets (newest service date first) |
| `GET` | `/api/v1/sets/snapshot` | Every set with its items, for desktops to keep offline |
| `POST` | `/api/v1/sets` | Create a set, optionally with a client-chosen id |
| `GET` | `/api/v1/sets/{id}` | Read a set and its items |
| `PUT` | `/api/v1/sets/{id}` | Replace a set's name, date and items from an expected base version |
| `DELETE` | `/api/v1/sets/{id}?base_version=` | Delete a set (soft); a stale base version is `409` |
| `PUT` | `/api/v1/remote/desktop` | Desktop reports its projection state |
| `DELETE` | `/api/v1/remote/desktop` | Desktop leaves remote control |
| `GET` | `/api/v1/remote/desktop/commands?wait=` | Desktop collects queued commands, waiting up to 30 seconds |
| `GET` | `/api/v1/remote/desktops` | List the church's desktops and what they show |
| `POST` | `/api/v1/remote/desktops/{device_id}/commands` | Leader sends a command to a desktop |

## Conflict contract

Song updates include `base_revision_id`. The server locks the song while
checking that base. A stale base returns HTTP `409 Conflict` and does not create
or replace a revision. This is the initial contract required for future offline
outbox synchronization and deliberate conflict review.

Person leaders and desktop sync credentials may call the import endpoint.
Desktop credentials have append-only import access: the server compares SHA-256
content hashes, skips exact matches, and returns `skipped_existing`. A song with
different content is added as a separate song; automatic title-based merging
would risk destroying legitimate translations or arrangements.

## Sets

A set is an ordered list of items for one service, shared by the whole church.
Every signed-in person and desktop may read sets; owners, leaders and desktop
credentials may change them. An item is a `song` (a song of the same church,
with `transpose` from −11 to 11) or a `blank` screen, each with an optional
note of up to 500 characters. A set holds at most 200 items and its name 1–200
characters. Reads include each song's current title and revision; a song
deleted after it was added appears with `song: null`.

A client may choose a new set's `id`, so a desktop can create a set offline and
upload it later without creating it twice. `POST` with an id that already
exists returns `409 Conflict`.

### Set conflict contract

Every set has a `version`, starting at 1 and increased by each change.
`PUT /sets/{id}` requires `base_version`, and `DELETE /sets/{id}` accepts it.
The server locks the set while checking that base. A stale base returns HTTP
`409 Conflict` and changes nothing; the client must reload the set and apply
its change again. `PUT` replaces all items, so a client sends the full list,
keeping item `id`s to preserve their identity. The server keeps no history of
earlier versions. The Psalm150 desktop keeps its losing edit as a separate
copy of the set.

## Remote relay

A desktop that allows remote control reports its projection state with
`PUT /remote/desktop` and long-polls `GET /remote/desktop/commands?wait=`
(0–30 seconds). Anyone signed in to the church may list desktops; a desktop is
`online` when heard from within 45 seconds. Owners and leaders (person sessions
only) send `next`, `previous`, `blank`, `show_slide`, `project_song` or
`project_set_item`. The server answers `202 Accepted`, `404` when the desktop
is not online, and `409` when it does not accept commands.

The relay keeps everything in memory. Commands expire after 30 seconds, at most
20 wait per desktop, and a restart forgets all desktops until they report
again. It works with a single server process. The desktop remains in charge of
projection and keeps running without the server.
