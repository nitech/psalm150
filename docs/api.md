# API

The PSA150 Song Server API is versioned under `/api/v1`. Its generated OpenAPI
document is served at `/api/openapi.json`, and the web interface shows it as a
readable reference at `/api/docs` (also under More, About), with every
operation's fields and a curl example. Everything the server does is
available through it: the bundled web interface uses these same endpoints and
has no private server contract, so anyone with a token can do through the API
whatever that token's person (or desktop) may do.

## Authentication

Authenticated requests send `Authorization: Bearer <token>`. In the OpenAPI
document they carry the `bearer` security scheme; the few public operations
(`/health`, `/info`, `/setup`, signing in, the public library, following a
room and the desktop code exchange) do not.

- Person sessions begin with `psa_s_`, expire (after `PSA150_SESSION_HOURS`),
  and carry the person's church membership and role. `POST /api/v1/session`
  issues one for a username and password.
- API tokens begin with `psa_a_`. A person makes them for scripts and
  integrations (`POST /api/v1/api-tokens`, or **More → API tokens** in the web
  interface). An API token acts as that person in their church until it is
  revoked or reaches its optional `expires_at`. It may be given a lower role
  than the person's (`viewer` makes a read-only token), never a higher one.
  Each request uses the lower of the token's role and the person's current
  role, so demoting, disabling or removing the person limits or ends their
  tokens too.
- Desktop credentials begin with `psa_d_` and are scoped to one church. They
  may read the library, import, create, edit and delete songs and sets, and
  use the remote-control desktop endpoints, including renaming their own
  room. They cannot manage credentials,
  people or the church, approve other desktops or send remote commands.
- Only a hash of any token is stored by the server. A new token is shown once.

`GET /api/v1/session` says who a token belongs to and what it may do (`kind`
`session`, `api` or `desktop`, the church, the role and the expiry).
`DELETE /api/v1/session` signs out: the token that sends it stops working,
whatever its kind. The Psalm150 desktop sends it with its own token when it
disconnects or replaces its token.

### Limits on wrong passwords

Signing in allows 5 wrong passwords per username and 30 failed sign-ins per
client address within 15 minutes; changing your password allows 5 wrong
current passwords per person. Past a limit the server answers
`429 Too Many Requests` with `Retry-After` (seconds) until the oldest failure
is 15 minutes old, without checking the password; a successful sign-in clears
its username's count. Unknown usernames count like wrong passwords and take as
long to refuse. Behind a reverse proxy, set `PSA150_CLIENT_IP_HEADER` (for
example `X-Forwarded-For`) so each client has its own count instead of all
sharing the proxy's address. The counts are kept in memory by one server
process and start again after a restart.

For example, to sign in once and then work with an API token:

```sh
curl -s -X POST https://songs.example/api/v1/session \
  -H 'Content-Type: application/json' \
  -d '{"username": "pat", "password": "…"}'                # → {"token": "psa_s_…", …}
curl -s -X POST https://songs.example/api/v1/api-tokens \
  -H 'Authorization: Bearer psa_s_…' -H 'Content-Type: application/json' \
  -d '{"name": "Church website", "role": "viewer"}'       # → {"token": "psa_a_…", …}
curl -s 'https://songs.example/api/v1/songs?q=grace' \
  -H 'Authorization: Bearer psa_a_…'
```

A desktop normally gets its `psa_d_` credential through browser sign-in: it
opens the web interface at
`/?desktop_redirect=<loopback URL>&state=<opaque>&code_challenge=<S256 challenge>&device_name=<name>`,
a leader signs in and approves, and the browser returns to the loopback URL
with a one-time `psa_c_` code (valid five minutes). The desktop exchanges that
code and its PKCE verifier at `POST /api/v1/desktop-auth/token`.

An owner may make the church's library public (`PUT /api/v1/church`). Anyone
may then search and read its songs through `/api/v1/public/songs` without a
bearer token. Sets, revisions, export and every write still need a token,
except a set a leader shares on a link (see Shared sets).

Anyone may also follow a desktop's room by its name through
`/api/v1/public/rooms/{room_name}` without a token, unless the church's owner
has closed its rooms (see [Rooms](#rooms)).

The first owner is created through `POST /api/v1/setup`, which becomes
unavailable after successful initialization. Passwords are hashed with Argon2.

## Resources

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Check API and PostgreSQL availability |
| `GET` | `/api/v1/info` | Public ping: service name, version, `initialized`, `desktop_sign_in`, `public_library`, `public_library_name`, `rooms` |
| `GET` | `/api/v1/church` | The signed-in church and its settings (`public_library`, `public_rooms`) |
| `PUT` | `/api/v1/church` | Owner renames the church (`name`), opens the library to everyone, read only, or closes it (`public_library`), or opens or closes its rooms (`public_rooms`); fields left out stay |
| `GET` | `/api/v1/public/songs?q=&limit=&offset=&sort=&direction=` | Search public libraries without signing in (same paging as `/songs`) |
| `GET` | `/api/v1/public/songs/{id}` | Read a song in a public library without signing in |
| `GET` | `/api/v1/public/rooms/{room_name}` | What a desktop's room shows now, without signing in |
| `GET` | `/api/v1/public/rooms/{room_name}/events` | The same as server-sent events, whenever it changes |
| `GET` | `/api/v1/setup` | Determine whether first-run setup is available |
| `POST` | `/api/v1/setup` | Create the first church, owner, and session |
| `POST` | `/api/v1/session` | Sign in and issue a person session; `church_id` picks the church for a person in several |
| `GET` | `/api/v1/session` | Who the token belongs to, its kind, role and expiry |
| `DELETE` | `/api/v1/session` | Sign out: the token that sends it stops working |
| `PUT` | `/api/v1/account/password` | Change your own password (`{current_password, new_password}`); your other sessions end |
| `GET` | `/api/v1/api-tokens` | Your active API tokens; an owner sees everyone's |
| `POST` | `/api/v1/api-tokens` | Make an API token that acts as you (`{name, role?, expires_at?}`) |
| `DELETE` | `/api/v1/api-tokens/{id}` | Revoke one of your API tokens; an owner may revoke anyone's |
| `GET` | `/api/v1/members` | Owner lists the church's people with their roles |
| `POST` | `/api/v1/members` | Owner adds a person with a new account (`{username, display_name, password, role}`) |
| `PATCH` | `/api/v1/members/{user_id}` | Owner changes a person's role, name, username or password, or disables them |
| `DELETE` | `/api/v1/members/{user_id}` | Owner removes a person from the church |
| `POST` | `/api/v1/device-tokens` | Create a scoped desktop sync credential; the answer names its room |
| `GET` | `/api/v1/device-tokens` | List active desktop credentials with their room names |
| `DELETE` | `/api/v1/device-tokens/{id}` | Revoke a desktop credential; its room name is freed |
| `PUT` | `/api/v1/device-tokens/{id}/room` | Leader renames a desktop's room (`{room_name}`; null picks a new flower) |
| `POST` | `/api/v1/desktop-auth/codes` | Leader approves a desktop: one-time sign-in code for a PKCE challenge |
| `POST` | `/api/v1/desktop-auth/token` | Desktop exchanges code and verifier for a desktop credential (no bearer) |
| `GET` | `/api/v1/songs?q=&limit=&offset=&sort=&direction=` | List or search current song revisions; `sort` `title` (default) or `number` (numeric, songs without a number last), `direction` `asc` or `desc`; page with `limit` (1–200, default 100) and `offset` |
| `POST` | `/api/v1/songs` | Create a song and its first revision |
| `GET` | `/api/v1/songs/{id}` | Read the current ChordPro source and metadata |
| `PUT` | `/api/v1/songs/{id}` | Create a revision from an expected base revision |
| `DELETE` | `/api/v1/songs/{id}?base_revision_id=` | Delete a song (soft); a stale base revision is `409` |
| `GET` | `/api/v1/songs/deleted?limit=&offset=` | List deleted songs, most recently deleted first |
| `POST` | `/api/v1/songs/{id}/restore` | Bring a deleted song back with its history |
| `GET` | `/api/v1/songs/{id}/revisions` | List immutable revision metadata |
| `GET` | `/api/v1/songs/{id}/revisions/{revision_id}` | Read any revision, current or earlier, with its ChordPro source |
| `POST` | `/api/v1/songs/import` | Import up to 500 ChordPro songs, skipping exact content matches |
| `GET` | `/api/v1/songs/export` | Download current songs as a ZIP of `.pro` files plus `psa150-manifest.json` |
| `GET` | `/api/v1/sets?from=&limit=&offset=` | List the church's sets (newest service date first) |
| `GET` | `/api/v1/sets/snapshot` | Every set with its items, for desktops to keep offline |
| `POST` | `/api/v1/sets` | Create a set, optionally with a client-chosen id |
| `GET` | `/api/v1/sets/deleted?limit=&offset=` | List deleted sets, most recently deleted first |
| `GET` | `/api/v1/sets/{id}` | Read a set and its items |
| `PUT` | `/api/v1/sets/{id}` | Replace a set's name, date and items from an expected base version |
| `DELETE` | `/api/v1/sets/{id}?base_version=` | Delete a set (soft); a stale base version is `409` |
| `POST` | `/api/v1/sets/{id}/restore` | Bring a deleted set back with its items, as a new version |
| `GET` | `/api/v1/sets/{id}/share` | Read a set's share link (leaders and owners) |
| `PUT` | `/api/v1/sets/{id}/share` | Share a set on a link, or choose whether the link may add and remove songs |
| `DELETE` | `/api/v1/sets/{id}/share` | Stop sharing a set; its link stops working |
| `GET` | `/api/v1/public/sets/{key}` | Anyone with the link: read the shared set |
| `GET` | `/api/v1/public/sets/{key}/songs/{song_id}` | Anyone with the link: read a song of the set |
| `GET` | `/api/v1/public/sets/{key}/songs?q=` | Anyone with an editable link: search the church's songs |
| `POST` | `/api/v1/public/sets/{key}/items` | Anyone with an editable link: add a song |
| `DELETE` | `/api/v1/public/sets/{key}/items/{item_id}` | Anyone with an editable link: remove a song |
| `GET` | `/api/v1/remote/desktop` | Desktop reads its room name and whether its church shares rooms |
| `PUT` | `/api/v1/remote/desktop` | Desktop reports its projection state |
| `DELETE` | `/api/v1/remote/desktop` | Desktop leaves remote control |
| `PUT` | `/api/v1/remote/desktop/room` | Desktop renames its own room (`{room_name}`; null picks a new flower) |
| `GET` | `/api/v1/remote/desktop/commands?wait=` | Desktop collects queued commands, waiting up to 30 seconds |
| `GET` | `/api/v1/remote/desktops` | List the church's desktops and what they show |
| `GET` | `/api/v1/remote/desktops/events` | The same list as server-sent events, whenever it changes |
| `POST` | `/api/v1/remote/desktops/{device_id}/commands` | Leader sends a command to a desktop |

## People

Owners run the church through `/api/v1/members`. They add people with a new
account and a role, change roles, reset passwords, disable people and remove
them. Owners, leaders and viewers have the powers described in
[Architecture](architecture.md); only owners manage people, the church's
settings and everyone's API tokens.

- The church always keeps at least one owner who is not disabled: demoting,
  disabling or removing the last one is `409 Conflict`.
- Usernames are unique on the server regardless of case (`409` when taken).
  Passwords need at least 10 characters.
- A new role takes effect on the person's next request, for their sessions
  and API tokens alike.
- A password reset ends the person's sessions; their API tokens keep working.
  Owners change their own password with `PUT /api/v1/account/password`, not
  here (403).
  Disabling ends their sessions and revokes their API tokens; enabling them
  again lets them sign in but does not bring old tokens back.
- Removing a person ends their sessions and revokes their API tokens in this
  church. An account that then belongs to no church is kept, disabled and
  without its username, so the revisions and sets they saved still record who
  saved them and the username can be given to someone new.
- A person's name, username, password and disabled state belong to their
  account. When they also belong to another church on the same server, an
  owner may change only their role here or remove them (`403` otherwise).

## Conflict contract

Song updates include `base_revision_id`. The server locks the song while
checking that base. A stale base returns HTTP `409 Conflict` and does not create
or replace a revision. This is the initial contract required for future offline
outbox synchronization and deliberate conflict review.

Deleting a song keeps it and its revisions. `GET /songs/deleted` lists
deleted songs and `POST /songs/{id}/restore` brings one back unchanged; anyone
who may delete songs may restore them. Any revision's source can be read at
`GET /songs/{id}/revisions/{revision_id}`; to go back to it, send that source
as a new revision based on the current one.

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

A deleted set keeps its items. `GET /sets/deleted` lists deleted sets and
`POST /sets/{id}/restore` brings one back as a new `version`, so desktops pick
it up at their next sync.

### Shared sets

A leader or owner may share a set on a link with `PUT /sets/{id}/share`
`{"editable": false}`. The answer's `key` makes the link
`<server>/shared/{key}`, which the web interface opens for anyone, signed in
or not. Without a token, `GET /public/sets/{key}` reads the set and
`GET /public/sets/{key}/songs/{song_id}` its songs. People with the link
cannot steer a desktop or change a song.

With `editable: true`, people with the link may also search the church's
songs (`GET /public/sets/{key}/songs?q=`), add one
(`POST /public/sets/{key}/items` `{song_id, position?}`) and remove song
items (`DELETE /public/sets/{key}/items/{item_id}`). Each change raises the
set's `version` like any other edit. Nothing else about the set changes
through the link. `DELETE /sets/{id}/share` stops sharing at once; sharing
again makes a new link.

## Remote relay

A desktop that allows remote control reports its projection state with
`PUT /remote/desktop` and long-polls `GET /remote/desktop/commands?wait=`
(0–30 seconds). Anyone signed in to the church may list desktops, or follow
the list with `GET /remote/desktops/events`: a `desktops` event with the same
list at once and whenever it changes, until the token stops working. Browsers
read it with `fetch`, since `EventSource` cannot send the bearer token. A
desktop is `online` when heard from within 45 seconds. Each desktop has a
`name` (the computer's) and a `room_name` (see [Rooms](#rooms)). Owners and leaders (person sessions
only) send `next`, `previous`, `blank`, `show_slide`, `project_song` or
`project_set_item`. The server answers `202 Accepted`, `404` when the desktop
is not online, and `409` when it does not accept commands.

The relay keeps everything in memory. Commands expire after 30 seconds, at most
20 wait per desktop, and a restart forgets all desktops until they report
again. It works with a single server process. The desktop remains in charge of
projection and keeps running without the server. Revoking a desktop's
credential takes it off the list at once.

## Rooms

Every desktop has a room: a short name, a flower such as `Lily` unless someone
renames it. Leaders pick desktops by it, and anyone may type it in the web
interface at `/join` to follow the words the desktop projects on their own
phone, live and in large text.

- A desktop gets a free flower when its credential is made (`room_name` in the
  answer); one made earlier gets one the next time it talks to the server. It
  keeps the name until renamed.
- Names are unique on the server, because a room is joined without naming a
  church, and matched without regard to case, accents, spaces or punctuation.
  Revoking a desktop frees its name.
- The desktop renames its own room with `PUT /remote/desktop/room`; owners and
  leaders rename any of the church's with `PUT /device-tokens/{id}/room`. Send
  `{"room_name": "Main Hall"}`, or `null` for a new random flower. A name has
  2–30 letters, digits, spaces, hyphens or apostrophes (`400` otherwise); a
  name another desktop has is `409 Conflict`.
- `GET /public/rooms/{room_name}` answers `{room_name, status, song_title,
  slide_index, slides}`. `status` is `live`, `blank`, `idle` or `offline`;
  the words (`slides`, each `{label, lines}`, no chords) are included only
  while `live` or `blank`. `/events` sends the same as a `room` server-sent
  event at once and whenever it changes.
- Words are shared only while the desktop projects, its operator lets people
  follow (`shares_room` in its report, on by default) and the church's owner
  has rooms open (`public_rooms`, on by default). A church with rooms closed
  answers `404`, like a name no one has.

The event streams stay open for as long as someone watches. A reverse proxy in
front of the server must not buffer `text/event-stream` responses; the server
sends `X-Accel-Buffering: no` and keep-alive comments every 15 seconds. Like
the relay, rooms live in memory and work with a single server process.
