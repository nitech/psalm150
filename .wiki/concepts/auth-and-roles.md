---
type: Concept
title: Auth and roles
description: First-run setup, password sign-in (with a church choice) and its limits on wrong passwords, psa_s_ sessions, psa_a_ API tokens that act as a person with at most their role, psa_d_ desktop tokens, sign-out and password changes, owners managing members, public library and public rooms, what each role and token may do, and what is still missing (session cleanup, shared limits).
tags: [auth, sessions, tokens, api-tokens, members, roles, setup, security]
status: stable
sources:
  - id: auth
    resource: /api/src/auth.rs
    title: authenticate, require_*, password hashing and rule, session issue, token format
  - id: access
    resource: /api/src/access.rs
    title: Session info and sign-out, password change, API tokens, members
  - id: throttle
    resource: /api/src/throttle.rs
    title: Limits on wrong passwords, client address
  - id: mig8
    resource: /api/migrations/0008_reusable_usernames.sql
    title: users.username may be null
  - id: api
    resource: /api/src/api.rs
    title: setup, login, device-token handlers
  - id: models
    resource: /api/src/models.rs
    title: Role and can_edit
  - id: mig
    resource: /api/migrations/0001_initial.sql
    title: users, memberships, sessions, device_tokens
  - id: mig3
    resource: /api/migrations/0003_desktop_auth_codes.sql
    title: desktop_auth_codes
  - id: mig7
    resource: /api/migrations/0007_api_tokens.sql
    title: api_tokens
  - id: sets
    resource: /api/src/sets.rs
    title: Set handlers (require_song_editor)
  - id: remote
    resource: /api/src/remote.rs
    title: Remote relay (desktop-only routes, require_editor for commands)
  - id: rooms
    resource: /api/src/rooms.rs
    title: Room renames (desktop or editor) and public room reads
  - id: webmain
    resource: /web/src/main.ts
    title: Desktop consent screen
generated: { by: agent, at: 2026-10-05T18:00:00Z }
---

# Auth and roles

Every authenticated request sends `Authorization: Bearer <token>`. The token's
prefix picks the lookup path in `auth::authenticate`. Any other prefix gets
`401 unknown token type`. Whatever the kind, `GET /session` says whose token
it is and what it may do, and `DELETE /session` revokes it.

## Token format and storage

`new_token(prefix)` produces the prefix followed by two random v4 UUIDs in
simple form: 64 hex characters of entropy after the prefix. Only
`hash_token(token)` is stored, which is the SHA-256 of the whole token in hex
(`CHAR(64)`). The raw token appears once, in the create response. Each
successful use updates `last_used_at` with a best-effort write.

| Prefix | Kind | Lifetime | Scope |
| --- | --- | --- | --- |
| `psa_s_` | Person session | `PSA150_SESSION_HOURS` (default 168 = 7 days) | One user in one church, carrying that membership's role |
| `psa_a_` | API token | Until revoked, or its own optional `expires_at` | One user in one church, with the lower of the token's `role` and the membership's role ([API tokens](#api-tokens)) |
| `psa_d_` | Desktop credential | Until revoked | One church, treated as role `viewer` with kind `desktop` |
| `psa_c_` | Desktop sign-in code (not a bearer token) | 5 minutes, single use | Exchanged once at `POST /desktop-auth/token`; stored hashed in `desktop_auth_codes` |

A session or API token is rejected if it has expired, if the user is disabled
(`users.disabled_at`) or if the membership has gone; an API token also once
`revoked_at` is set. A desktop token is rejected once `revoked_at` is set.
Revocation is immediate, because every request reads the database. The
request's `AuthContext` carries the token's `kind` (`session`, `api` or
`desktop`) and its hash, so `DELETE /session` can delete the session or set
`revoked_at` on the API or desktop token that sent it.

## Roles

`Role` is `owner`, `leader` or `viewer` (a `CHECK` on `memberships.role`).
`can_edit()` is true for owner and leader. A person's session and API tokens
pass the same checks: `require_person()` admits either (any role) and refuses
desktops; `require_editor()` needs an effective owner or leader;
`require_owner()` an effective owner. Desktop tokens are role viewer and fail
all three. Church content (songs and sets) uses `require_song_editor()`
instead, which also admits desktop tokens and returns an `Actor` (person or
device) for the audit columns. The remote relay's desktop routes accept
**only** a desktop token (`require_device` in `remote.rs`), and sending a
command uses `require_editor`.

| Action | Owner | Leader | Viewer | Desktop token |
| --- | --- | --- | --- | --- |
| List, read, search, export songs; list revisions and read any revision; list deleted songs and sets | yes | yes | yes | yes |
| Create, edit, delete or restore a song | yes | yes | 403 | **yes**, recorded as the device (so a desktop can keep Visual Song Book in step) |
| Import songs | yes | yes | 403 | yes, see [import](import-export.md) |
| Create, list or revoke desktop tokens | yes | yes | 403 | 403 |
| Approve a desktop sign-in (`POST /desktop-auth/codes`) | yes | yes | 403 | 403 |
| List, read sets; sets snapshot | yes | yes | yes | yes |
| Create, edit, delete or restore a set | yes | yes | 403 | **yes**, recorded as the device ([sets](sets.md)) |
| List the church's desktops for remote control, or follow the list live (`/remote/desktops/events`) | yes | yes | yes | yes |
| Follow a room (`/public/rooms/*`; also without any token, see [public rooms](#public-rooms)) | yes | yes | yes | yes |
| Send a remote command to a desktop | yes | yes | 403 | 403 |
| Report state, leave, collect commands, read or rename its own room (`/remote/desktop*`) | 403 | 403 | 403 | yes ([remote control](remote-control.md), [rooms](rooms.md)) |
| Rename any of the church's desktops' rooms (`PUT /device-tokens/{id}/room`) | yes | yes | 403 | 403 |
| Read church settings (`GET /church`) | yes | yes | yes | yes |
| Rename the church, make the library public or private, open or close rooms (`PUT /church`) | yes | 403 | 403 | 403 |
| See who the token is (`GET /session`); sign out (`DELETE /session`) | yes | yes | yes | yes (revokes itself) |
| Change your own password (`PUT /account/password`) | yes | yes | yes | 403 |
| Make, list and revoke your own API tokens | yes | yes | yes (read-only tokens) | 403 |
| List and revoke everyone's API tokens | yes | 403 (own only) | 403 (own only) | 403 |
| Manage people (`/members`) | yes | 403 | 403 | 403 |

An API token stands in its person's column with its effective role: a
leader's `viewer` token is a viewer. Owners and leaders differ only in the
three owner rows: the church's settings, everyone's API tokens and people.
Recovery when no owner can sign in (for example a lost password with nobody
to reset it) is designed in [/docs/architecture.md](../../docs/architecture.md)
but not built.

## API tokens

A person makes API tokens for scripts and integrations with
`POST /api-tokens` `{name, role?, expires_at?}`, through a session or another
of their API tokens. The token (`psa_a_…`) is returned once and stored as a
hash in `api_tokens` with the person, the church, a `role` cap and an
optional `expires_at`.

- `role` defaults to the maker's **effective** role; a higher one is 400
  (`a token cannot have more access than the person making it`), so a
  read-only token stays read-only and a token cannot mint a stronger one.
  `viewer` makes a read-only token, for example for a church website.
- Every request through it takes the lower of the token's `role` and the
  person's **current** membership role (`Role::at_most`). Demoting a person
  limits their tokens at once and promoting them restores what the cap
  allows; disabling or removing them ends the tokens.
- `expires_at` must be in the future (400); after it the token is 401.
- `GET /api-tokens` lists active (unrevoked, unexpired) tokens by name: your
  own, or the whole church's for an owner, with `user_id` and
  `user_display_name`. `DELETE /api-tokens/{id}` revokes your own, or any of
  the church's for an owner (404 otherwise). `DELETE /session` with the token
  revokes it too.
- A token acts as its person everywhere: `issued_by` on remote commands and
  `created_by` on revisions and sets are the person.

The web client lists, makes and revokes them under **More → API tokens**
([web client](web-client.md)).

## Members

Owners manage the church's people through `/members` (`require_owner`).
`GET /members` lists `{user_id, username, display_name, role, disabled,
created_at}`. `POST /members` makes a new account (username 1–100 and display
name 1–120 characters after trimming, password at least 10, unique username
regardless of case or 409) with a membership in the owner's church.

`PATCH /members/{user_id}` changes any of `role`, `display_name`, `username`,
`password` and `disabled`; `DELETE` removes the person from the church. Each
runs in one transaction that first locks the church row (`FOR UPDATE`), so
changes to a church's people happen one at a time, then:

- **Last owner**: demoting, disabling or removing an owner who is not disabled
  needs another owner who is not disabled (`ensure_another_owner`), otherwise
  409 `the church needs at least one owner who is not disabled`. An owner may
  step down or leave once another owner exists.
- **Other churches**: name, username, password and `disabled` live on the
  shared `users` row. When the person also belongs to another church, they are
  refused with 403, so one church's owner cannot take over or lock out an
  account another church relies on. The role here and removal always work.
- A password reset deletes the person's sessions (except the one making the
  request); API tokens stay. Disabling sets `users.disabled_at`, deletes the
  sessions and revokes every API token of the person; enabling clears
  `disabled_at` but revives no token.
- Removing deletes the membership and the person's sessions in this church
  and revokes their API tokens there. An account left without a membership is
  kept, disabled, with its `username` set to null (migration
  `0008_reusable_usernames.sql`): revisions and sets keep their `created_by`
  and its display name, and the username can be given to someone new, who
  gets a new account.

Unknown ids and people of other churches are 404. Desktop tokens the person
approved or made stay: they belong to the church. The web client's
**More → People** screen does all of this for owners
([web client](web-client.md#people)).

The web client reads the role again (`GET /session`) when it opens and when
it comes back into view, so a changed role shows without signing in again.

## Your own account

`PUT /account/password` `{current_password, new_password}` (`require_person`)
applies the 10-character rule (400), checks the
[limit](#limits-on-wrong-passwords) on wrong current passwords (429), checks
the current password with Argon2 (403 when wrong), stores the new hash and
deletes the person's other sessions. The session or API token making the
request keeps working, and so do their API tokens. The web client offers it as
the lock beside your name under More.

## Public library

`churches.public_library` (default false) opens a church's songs to anyone
without a token: `GET /public/songs` and `GET /public/songs/{id}` read the
current revision of every live song in churches with the flag on. Nothing else
is public: sets, revisions, export, the remote relay and every write still
need a token. `GET /info` tells clients whether any library is public
(`public_library`) and, when exactly one is, its church name.

## Public rooms

`churches.public_rooms` (default **true**) lets anyone who knows a desktop's
room name follow the words it projects, without a token:
`GET /public/rooms/{room_name}` and its `/events` stream. They show only the
song title, the slide position and the words (no chords, no set, no song id),
and only while the desktop is online, projecting and sharing its room. A
church with rooms closed, and a name no desktop has, both give 404, so a
closed room cannot be told from an unknown one. Room names are guessable on
purpose (flowers); what protects a service is the owner's switch, the
operator's "Let people follow the projected words in this room" checkbox on
the desktop, and renaming. `GET /info` says whether any church has rooms open
(`rooms`). See [rooms](rooms.md).

## First-run setup

`GET /setup` reports `initialized` from the `instance_settings` singleton row
(`id = 1`). `POST /setup` checks the input: church name, owner name and
username must not be blank, and the password needs at least 10 characters.
Once the server is set up it answers 409 before hashing anything. Otherwise it
hashes the password with Argon2 (default parameters, on a blocking
thread). In one transaction guarded by `pg_advisory_xact_lock(150)` it:

1. returns 409 if `instance_settings` already has its row;
2. inserts the row, the church (with an ASCII slug, or `church-<8 hex>` if the
   slug would be empty), the user, and an `owner` membership.

Then it issues a session and returns 201. Two browsers racing to set up the
server cannot both succeed.

## Sign-in

`POST /session` matches `lower(username)`, ignores disabled users, and joins
memberships. A person in several churches signs in to the one they joined
first, or to the one named by the optional `church_id`. It returns the same
401 message for an unknown user, a wrong password and a church the person is
not in, and an unknown user is checked against a fixed Argon2 hash so the
answer takes as long. Usernames are unique case-insensitively
(`users_username_lower_unique`); an account removed from its last church has
none.

## Limits on wrong passwords

`throttle.rs` keeps failures in memory, like the remote relay: one server
process, empty after a restart. Each key allows a number of failures within a
sliding 15-minute window; at the limit the request is refused with
`429 Too Many Requests`, a `Retry-After` header (seconds until the oldest
failure leaves the window) and a message such as
`too many failed sign-ins; try again in 12 minutes`, before any password is
checked.

| Key | Limit | Counts | Cleared by |
| --- | --- | --- | --- |
| `sign-in:account:<lowercased username>` | 5 | every failed `POST /session` for that username, known or not, from anywhere | a successful sign-in |
| `sign-in:client:<address>` | 30 | every failed `POST /session` from that address, any username | time only |
| `password:<user id>` | 5 | wrong current passwords at `PUT /account/password` | a right one |

The client address is the last entry of the header named by
`PSA150_CLIENT_IP_HEADER` (set by the reverse proxy) when configured and
readable, else the connection's peer; IPv6 addresses count by their /64, and
IPv4-mapped ones as IPv4 ([deployment](deployment.md)). Behind a proxy without
that setting every client shares the proxy's address, so 30 failures from
anyone make everyone wait. Counting unknown usernames too means a 429 does not
reveal which usernames exist. A key with failures older than the window
is swept once 10,000 keys are held.

## Desktop tokens

Editors create tokens with a name of 1–120 characters (for example
"Sanctuary PC"). The web client shows the token once with a copy button
([web client](web-client.md)). The list shows only active tokens, with
`last_used_at` and the desktop's room name. Revoking sets `revoked_at`, takes
the desktop off the remote list and out of its room at once, and frees the
room name; a revoked token cannot be restored. The desktop pastes the token into Settings, and the client checks
that it starts with `psa_d_` ([desktop sync](desktop-sync.md)). Pasting is
the manual fallback; the usual path is the browser sign-in below.

## Desktop browser sign-in

The desktop can connect without anyone pasting a token. It is an
authorization-code exchange with PKCE (S256 only) over a loopback redirect:

1. The desktop makes a random `code_verifier`, computes
   `code_challenge = BASE64URL-NOPAD(SHA256(code_verifier))`, listens on a
   loopback port and opens the default browser at
   `/?desktop_redirect=<loopback URL>&state=<opaque>&code_challenge=<challenge>&device_name=<name>`.
2. The [web client](web-client.md#desktop-sign-in) signs the person in with
   username and password as usual and asks "Connect this desktop?", naming the
   device and the church.
3. **Connect** calls `POST /desktop-auth/codes` (editor session only; viewers
   and desktop tokens get 403). The server stores `hash_token(code)`, the
   church, the approving user, the trimmed device name and the challenge in
   `desktop_auth_codes`, valid 5 minutes, and returns the `psa_c_` code. The
   browser goes to `<loopback URL>?code=<code>&state=<state>`.
   **Cancel** goes to `<loopback URL>?error=access_denied&state=<state>`.
4. The desktop checks `state` and calls `POST /desktop-auth/token` with
   `{code, code_verifier}` and no bearer. The server burns the code first
   (`UPDATE … SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL
   AND expires_at > now() RETURNING …`), so a code is spent even when the
   verifier is wrong. It then compares the verifier's S256 value with the
   stored challenge in constant time, checks that the approving user is still
   enabled and still an owner or leader of that church, and in one transaction
   creates an ordinary `psa_d_` device token (named after the device,
   `created_by` the approver). Response 201
   `{token, device_id, device_name, church_name}`.

Every failure in step 4 (unknown, expired or used code, wrong verifier,
approver disabled or demoted) is the same 400
`the sign-in code is invalid or has expired`. The resulting token appears in
the device list and is revoked like any other. Used and expired rows are never
deleted (only indexed by `desktop_auth_codes_expiry_idx`). The web client only
redirects to `http:` loopback URLs (`127.0.0.1`, `localhost`, `[::1]`) with an
explicit port; anything else shows "This desktop sign-in link is not valid".

## Not built

- **No session cleanup.** Expired session rows, and expired or revoked API
  tokens, are never deleted (only indexed by `sessions_expiry_idx`).
- **Invitations and self-service reset.** Owners set a person's first
  password and hand it over; nobody can reset a forgotten password without an
  owner.
- **Several churches.** No endpoint adds an existing account to another
  church or creates a second church, so accounts in several churches exist
  only when made in the database. A session or API token is for one church;
  there is no church switch inside a session.
- **Shared limits.** The counts of wrong passwords live in one process: a
  restart forgets them, and several server instances would each keep their
  own.
