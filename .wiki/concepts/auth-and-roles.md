---
type: Concept
title: Auth and roles
description: First-run setup, password sign-in, psa_s_ sessions and psa_d_ desktop tokens, what each role and token may do with songs, sets and remote control, and what is missing (logout, members, multi-church sign-in).
tags: [auth, sessions, tokens, roles, setup, security]
status: stable
sources:
  - id: auth
    resource: /api/src/auth.rs
    title: authenticate, password hashing, session issue, token format
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
  - id: sets
    resource: /api/src/sets.rs
    title: Set handlers (require_song_editor)
  - id: remote
    resource: /api/src/remote.rs
    title: Remote relay (desktop-only routes, require_editor for commands)
  - id: webmain
    resource: /web/src/main.ts
    title: Desktop consent screen
generated: { by: agent, at: 2026-09-27T12:00:00Z }
---

# Auth and roles

Every authenticated request sends `Authorization: Bearer <token>`. The token's
prefix picks the lookup path in `auth::authenticate`. Any other prefix gets
`401 unknown token type`.

## Token format and storage

`new_token(prefix)` produces the prefix followed by two random v4 UUIDs in
simple form: 64 hex characters of entropy after the prefix. Only
`hash_token(token)` is stored, which is the SHA-256 of the whole token in hex
(`CHAR(64)`). The raw token appears once, in the create response. Each
successful use updates `last_used_at` with a best-effort write.

| Prefix | Kind | Lifetime | Scope |
| --- | --- | --- | --- |
| `psa_s_` | Person session | `PSA150_SESSION_HOURS` (default 168 = 7 days) | One user in one church, carrying that membership's role |
| `psa_d_` | Desktop credential | Until revoked | One church, treated as role `viewer` with `is_device = true` |
| `psa_c_` | Desktop sign-in code (not a bearer token) | 5 minutes, single use | Exchanged once at `POST /desktop-auth/token`; stored hashed in `desktop_auth_codes` |

A session is rejected if it has expired, if the user is disabled
(`users.disabled_at`) or if the membership has gone. A desktop token is
rejected once `revoked_at` is set. Revocation is immediate, because every
request reads the database.

## Roles

`Role` is `owner`, `leader` or `viewer` (a `CHECK` on `memberships.role`).
`can_edit()` is true for owner and leader. `require_editor()` also refuses any
desktop token, even though device tokens are role viewer. Church content
(songs and sets) uses `require_song_editor()` instead, which also admits
desktop tokens and returns an `Actor` (person or device) for the audit
columns. The remote relay's desktop routes accept **only** a desktop token
(`require_device` in `remote.rs`), and sending a command uses
`require_editor`.

| Action | Owner / Leader | Viewer session | Desktop token |
| --- | --- | --- | --- |
| List, read, search, export songs; list revisions | yes | yes | yes |
| Create, edit or delete a song | yes | 403 | **yes**, recorded as the device (so a desktop can keep Visual Song Book in step) |
| Import songs | yes | 403 | yes, see [import](import-export.md) |
| Create, list or revoke desktop tokens | yes | 403 | 403 |
| Approve a desktop sign-in (`POST /desktop-auth/codes`) | yes | 403 | 403 |
| List, read sets; sets snapshot | yes | yes | yes |
| Create, edit or delete a set | yes | 403 | **yes**, recorded as the device ([sets](sets.md)) |
| List the church's desktops for remote control | yes | yes | yes |
| Send a remote command to a desktop | yes | 403 | 403 |
| Report state, leave, collect commands (`/remote/desktop*`) | 403 | 403 | yes ([remote control](remote-control.md)) |

Owner and leader behave the same today. Owner-only administration and recovery
are designed in [/docs/architecture.md](../../docs/architecture.md) but not
built.

## First-run setup

`GET /setup` reports `initialized` from the `instance_settings` singleton row
(`id = 1`). `POST /setup` checks the input: church name, owner name and
username must not be blank, and the password needs at least 10 characters. It
then hashes the password with Argon2 (default parameters, on a blocking
thread). In one transaction guarded by `pg_advisory_xact_lock(150)` it:

1. returns 409 if `instance_settings` already has its row;
2. inserts the row, the church (with an ASCII slug, or `church-<8 hex>` if the
   slug would be empty), the user, and an `owner` membership.

Then it issues a session and returns 201. Two browsers racing to set up the
server cannot both succeed.

## Sign-in

`POST /session` matches `lower(username)`, ignores disabled users, and joins
memberships. It returns the same 401 message for an unknown user and a wrong
password. Usernames are unique case-insensitively (`users_username_lower_unique`).

## Desktop tokens

Editors create tokens with a name of 1–120 characters (for example
"Sanctuary PC"). The web client shows the token once with a copy button
([web client](web-client.md)). The list shows only active tokens, with
`last_used_at`. Revoking sets `revoked_at`, and a revoked token cannot be
restored. The desktop pastes the token into Settings, and the client checks
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

- **No logout endpoint.** The web client's sign-out only clears
  `sessionStorage`. The session token stays valid until it expires. Expired
  rows are never deleted (only indexed by `sessions_expiry_idx`).
- **No member management.** Only the setup owner exists. Viewers and extra
  leaders cannot be created, and passwords cannot be changed or reset.
- **Multi-church sign-in** picks the user's oldest membership
  (`ORDER BY c.created_at LIMIT 1`). There is no church switch.
- No rate limiting or lockout on `/session` or `/setup`.
