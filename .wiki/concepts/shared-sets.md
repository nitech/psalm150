---
type: Concept
title: Shared sets
description: A leader shares one set on a link (/shared/{key}) so anyone with it can read the set and go through its songs without an account; the read-only and editable modes, what an editable link may change, the share endpoints and the token-free /public/sets endpoints, how the key is made and stored, what happens on stop, delete and restore, the web client's Share sheet and shared page, and what is not limited yet.
tags: [sets, sharing, public, links, web]
status: stable
sources:
  - id: shared
    resource: /api/src/shared_sets.rs
    title: Share endpoints, public set reads and edits through the link
  - id: models
    resource: /api/src/models.rs
    title: ShareSetRequest, SetShare, SharedSet, AddSharedSetItemRequest, SetSummary.shared, SetDetail.shared
  - id: mig11
    resource: /api/migrations/0011_shared_sets.sql
    title: song_sets.share_key, share_editable, shared_at
  - id: lib
    resource: /api/src/lib.rs
    title: /shared/{share_key} page route
  - id: test
    resource: /api/tests/api_flow.rs
    title: shared_sets_flow
  - id: websets
    resource: /web/src/views/sets.ts
    title: Share sheet on the set page, Shared badge, openSongPicker
  - id: webshared
    resource: /web/src/views/shared-set.ts
    title: The shared page (/shared/{key})
generated: { by: agent, at: 2026-10-10T13:00:00Z }
---

# Shared sets

A leader can share one [set](sets.md) on a link, `<server>/shared/{key}`.
Anyone who has the link reads the set and goes through its songs, with words,
chords, keys and notes, without an account. Nobody with the link can steer a
desktop or change a song. A set stays private to its church until a leader
shares it, whatever the church's `public_library` setting.

The leader also chooses whether the link is **editable**. Then people with it
may add songs from the church's library to the set and remove songs from it.
Nothing else about the set changes through the link: its name, date, blank
screens, the transpose and note of the items already there, and the order
those keep.

## Who shares

Leaders and owners (`require_editor`), through a session or an API token with
that role. Desktop tokens and viewers get 403. Viewers and desktops do see
`shared: true` on the set (`SetSummary` and `SetDetail`), but not the link.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sets/{id}/share` | `SetShare {key, editable, shared_at}`; 404 when the set is not shared (or is missing, deleted or in another church) |
| PUT | `/sets/{id}/share` | Body `{editable}` (default false). Shares the set, or changes `editable` on a set already shared; the key stays. Returns `SetShare` |
| DELETE | `/sets/{id}/share` | Stops sharing: clears the key, so the link answers 404 at once. 204. Sharing again makes a new key |

Sharing does not raise the set's `version`: it changes who can see the set,
not its contents.

## The key

`share_key` is a random v4 UUID in simple form: 32 lowercase hex digits
(122 random bits). It is unique across the server (partial unique index),
because the link names no church. Unlike bearer tokens it is stored as it is,
not hashed, so a leader can copy the link again later; it opens one set and
nothing else. The public endpoints turn away anything that is not 16–64
letters and digits before asking the database. Responses carry
`Referrer-Policy: no-referrer`, so the link does not leak to other sites
through the `Referer` header.

## Reading through the link

No token. Every public endpoint answers 404 ("the link may have been
stopped") for an unknown key, a stopped share or a deleted set.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/sets/{key}` | `SharedSet {name, service_date, version, updated_at, church_name, editable, items}`. Items as in `SetDetail` (id, kind, song_id, transpose, note, `song` ref). No set id |
| GET | `/public/sets/{key}/songs/{song_id}` | `SongDetail` with the ChordPro text. A read-only link opens only songs in the set; an editable link any live song of the church. 404 otherwise |
| GET | `/public/sets/{key}/songs?q=&limit=&offset=&sort=&direction=` | Editable links only (403 otherwise): searches the church's library like `GET /songs`, to find a song to add |

## Changing through an editable link

A read-only link gets 403 ("this link lets you read the set, not change it").
Both changes lock the set row (`FOR UPDATE`) like a church edit, rewrite its
items in order and raise `version` by one, so desktops pick the change up at
their next snapshot and a leader editing from an older version gets the usual
409. Nobody signed in made the change, so `updated_by` and
`updated_by_device` are set to null.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/public/sets/{key}/items` | Body `{song_id, position?}`. Adds a song of the set's church (400 otherwise) with transpose 0 and no note, at `position` (from 0) or the end. 400 at 200 items. Returns the `SharedSet` |
| DELETE | `/public/sets/{key}/items/{item_id}` | Removes a song item. A blank screen is 403; an unknown item 404. Returns the `SharedSet` |

## Stop, delete and restore

- **Stop sharing**: the key is forgotten; the link stops working at once.
- **Delete the set**: the link answers 404 while the set is deleted. The key
  is kept, so restoring the set brings the same link back.
- **Make it read-only**: `PUT {editable: false}` keeps the link; edits
  through it are refused from then on.

## Web client

- **Set page** (leaders): a Share button in the bar opens **Share this set**.
  It explains what people with the link see, has a **Who can add and remove
  songs** choice (**Only leaders** or **Anyone with the link**) and **Create
  the link**. Once shared it shows the link with **Copy the link**, **Share**
  (where the browser can; it sends "<set> · <day>" as the title) and **Stop
  sharing** (with a confirmation). The link's own page carries a preview
  naming the set, its day, church and songs
  ([deployment](deployment.md#shared-set-links)). Changing
  the choice on a shared set saves at once. The Share button then looks
  switched on. The set list shows a **Shared** badge.
- **Shared page** (`/shared/{key}`, served as `index.html` by the API, outside
  the app shell, signed in or not): the church, date and set name, the items
  with their numbers, transpose and notes, and **Go through the songs**.
  `#/item/{itemId}` shows one item like the service view (key, note, words
  and chords, the **Chords and key** panel with view-only transpose,
  Previous/Next, swipe, arrow keys, wake lock) without Follow or Project. The
  list reads the set again every 30 s while visible. A stopped link says the
  leader may have stopped sharing.
- **Editable link**: each song row has a remove button (with **Undo**, which
  adds the song back at its place, without the transpose or note it had), and
  **Add songs** opens the same picker as the set editor, searching through
  the link; each tap adds the song at once.

## Leading live

A leader or owner can go through a shared set on their phone and take
everyone with the link along: whenever they move to an item, every page
that has the set open through the link moves there too. Between moves
people may look elsewhere; the next move brings them back. The leader sees
how many pages have the set open.

The state is in memory (`live_sets.rs`, `AppState.live_sets`), like the
remote relay, and works with one server process only.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sets/{id}/live` | Any token of the church. `SetLive {leading, item_id, leader_name, viewers}` |
| PUT | `/sets/{id}/live` | `require_editor`. Body `{item_id}`, an item of the set (400 otherwise). Leads the set from that item; the last leader to report wins. Send it on every move and at least every 30 s: leading ends 60 s after the last one |
| DELETE | `/sets/{id}/live` | `require_editor`. Stops leading; pages stay where they are |
| GET | `/public/sets/{key}/live/events` | No token. Server-sent `live` events `SharedSetLive {item_id, leader_name}`: at once, and whenever it changes (looked at again every 10 s, so an expired lead shows as `null`). While open, the page counts in `viewers`; closing it stops the count. The stream ends when the link no longer works (checked every 30 s) |

Web client: in the service view leaders have **Lead** in the bar (the
icon that was "Follow the desktop", which is gone). On, it reports the item
shown on every move and every 5 s; off, it reads the count every 5 s. A
pill on the button shows how many pages watch. Leading stays on from item to
item while the app is open. On the shared page an `EventSource` follows
`/live/events`: a new `item_id` opens that item (reading the set again if
the item is new to the page) and "Following <name>" shows above the page
while someone leads.

## Not limited yet

- The public endpoints have no rate limit, like rooms, and the number of
  pages watching a set live is not capped ([gaps](gaps.md)).
- Anyone holding an editable link can add and remove songs; there is no
  record of who did it, and no way to tell link edits from each other.
- A link does not expire by itself; the leader stops it.
