---
type: Concept
title: Auth and roles
description: First-run setup, password sign-in, psa_s_ sessions and psa_d_ desktop tokens, what each role and token may do, and what is missing (logout, members, multi-church sign-in).
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
generated: { by: agent, at: 2026-09-23T19:00:00Z }
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

A session is rejected if it has expired, if the user is disabled
(`users.disabled_at`) or if the membership has gone. A desktop token is
rejected once `revoked_at` is set. Revocation is immediate, because every
request reads the database.

## Roles

`Role` is `owner`, `leader` or `viewer` (a `CHECK` on `memberships.role`).
`can_edit()` is true for owner and leader. `require_editor()` also refuses any
desktop token, even though device tokens are role viewer. Song content uses
`require_song_editor()` instead, which also admits desktop tokens and returns
an `Actor` (person or device) for the audit columns.

| Action | Owner / Leader | Viewer session | Desktop token |
| --- | --- | --- | --- |
| List, read, search, export songs; list revisions | yes | yes | yes |
| Create, edit or delete a song | yes | 403 | **yes**, recorded as the device (so a desktop can keep Visual Song Book in step) |
| Import songs | yes | 403 | yes, see [import](import-export.md) |
| Create, list or revoke desktop tokens | yes | 403 | 403 |

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
that it starts with `psa_d_` ([desktop sync](desktop-sync.md)).

## Not built

- **No logout endpoint.** The web client's sign-out only clears
  `sessionStorage`. The session token stays valid until it expires. Expired
  rows are never deleted (only indexed by `sessions_expiry_idx`).
- **No member management.** Only the setup owner exists. Viewers and extra
  leaders cannot be created, and passwords cannot be changed or reset.
- **Multi-church sign-in** picks the user's oldest membership
  (`ORDER BY c.created_at LIMIT 1`). There is no church switch.
- No rate limiting or lockout on `/session` or `/setup`.
