---
type: Concept
title: Accessibility
description: The web client's accessibility target (WCAG 2.2 level AA, every Level A and AA criterion, for the app shell and the public /join room reader), how each part is met in code (titles, skip link, landmarks, focus on route change and in sheets, the drawer, radio groups, live announcements, toasts, contrast and state indicators, scroll padding, reflow), how to test it (axe in both themes at phone and desktop size, scripted keyboard paths, manual screen reader passes), and the known exceptions.
tags: [web, accessibility, wcag, a11y, keyboard, screen-reader, contrast]
status: stable
sources:
  - id: a11y
    resource: /web/src/a11y.ts
    title: pageTitle/setTitle, announce, keepFocus/refocus/focusSelector, bindRadioGroup
  - id: main
    resource: /web/src/main.ts
    title: Skip link, announcer, route titles and focus, inert background behind the drawer, auth screen focus
  - id: context
    resource: /web/src/context.ts
    title: pageHead (focusable h1)
  - id: ui
    resource: /web/src/ui.ts
    title: Toast timing, hold and dismiss; showFormError
  - id: songs
    resource: /web/src/views/songs.ts
    title: openSheet (labelled modal dialog, focus return), song list, reader, editor
  - id: render
    resource: /web/src/song-render.ts
    title: Reader controls keep focus and announce the key
  - id: sets
    resource: /web/src/views/sets.ts
    title: Set editor buttons named per item, moves announced; service view announces the item
  - id: remote
    resource: /web/src/views/remote.ts
    title: Live redraws keep focus and announce what is on screen
  - id: room
    resource: /web/src/views/room.ts
    title: /join form errors, room reader settings group, announcements
  - id: styles
    resource: /web/src/styles.css
    title: Focus ring, scroll padding, state indicators, visually hidden titles
  - id: tokens
    resource: /shared/psa150-tokens.css
    title: Contrast-checked colours, --psa-border-control, --psa-focus-ring
  - id: tests
    resource: /web/tests/a11y.test.ts
    title: Titles, radio keys, focus selectors, toast timing
generated: { by: agent, at: 2026-10-05T20:30:00Z }
---

# Accessibility

**Target:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level **AA**: every
Level A and AA success criterion, including those added in 2.1 and 2.2. It
covers the whole [web client](web-client.md): sign-in and setup, the desktop
consent screen, the signed-in shell and the visitor shell of a public library,
and the token-free room reader at `/join` ([rooms](rooms.md)), which is meant
for people with low vision and blind people. The Psalm150 desktop app has its
own work in its repo. The colours come from `shared/psa150-tokens.css`, whose
text colours are checked for 4.5:1 and whose `--psa-border-control` and focus
ring for 3:1.

## How it is met

**Structure and names (1.1.1, 1.3.1, 2.4.2, 2.4.6, 3.1.1, 4.1.2)**
- `<html lang="en">`; the `/songs/{id}` permalink page is the same
  `index.html` ([deployment](deployment.md)).
- Every screen sets a title, most specific first: `pageTitle()` gives
  "Amazing Grace · Songs · PSA150", "Edit Sunday morning · Sets · PSA150",
  "Speedwell · Room · PSA150". The router sets the section ("Sets · PSA150")
  and views refine it.
- Landmarks: `nav#sections`, `main#page`, the dock as
  `<aside aria-label="Current set">`. Every screen has one `h1`; on phones
  the compact and wide-only titles are visually hidden rather than removed.
  Song sections are `h2` under the song's `h1`.
- Lists are lists: songs, sets, desktops and people are `ul`/`ol`.
- Icons are `aria-hidden`; icon-only buttons have `aria-label`. The brand
  mark and initials avatars are hidden; the date tile beside a set is hidden
  because the date is in words beside it.
- Sheets are modal `<dialog>`s named by their heading (`aria-labelledby`).
- Toggles say their state: `aria-pressed` (Chords, Follow, Blank, room
  settings), `aria-expanded`/`aria-controls` (☰, the reader panel),
  `aria-current` (the section, the slide on screen in the remote and room).
  Buttons whose label already says the state ("Remove … from Sunday
  morning") are not also pressed toggles.
- Segmented choices (theme, who can read the songs, rooms) are radio groups
  with one tab stop and arrow keys, Home and End (`bindRadioGroup`).
- Repeated buttons carry what they act on: "Move up: 2, Amazing Grace",
  "Revoke Sanctuary PC".

**Keyboard and focus (2.1.1, 2.1.2, 2.4.1, 2.4.3, 2.4.7, 2.4.11)**
- A **Skip to content** link is the first stop; it moves focus to the
  screen's heading (by script, since the route lives in the hash).
- After a route change, focus goes to the new screen's `h1`, so a screen
  reader says where you are. A redraw of the same screen (a setting saved,
  the next item in the service view, the server pushing a desktop change)
  puts focus back on the same control (`keepFocus`/`refocus`, matched by id
  or by `data-*`/`href` inside the row's `data-key`). On the very first page
  load focus is left alone.
- Sheets: focus moves in on open; Escape closes; focus returns to the
  control that opened it, or the screen's heading if that was redrawn.
- The phone drawer: opening focuses the current section and makes the page,
  dock and skip link `inert`; Escape, the shade or a section closes it and
  focus returns to ☰.
- Every focusable element shows `--psa-focus-ring` on `:focus-visible`;
  list rows draw it inset because their list clips overflow.
- `html` has `scroll-padding` for the sticky bar at the top and the dock,
  toasts, the service view's step bar and the editors' sticky Save at the
  bottom, so focus is never hidden under them; the auto-hiding reader bar
  comes back while a control in it has focus.

**Pointer (2.5.1, 2.5.2, 2.5.3, 2.5.7, 2.5.8)**: every swipe and drag has a
button: ☰ and the shade for the drawer swipes, Previous/Next for the service
view's swipe, Move up/down for drag-to-reorder. Actions fire on release.
Targets are at least 24 × 24 px (most are 36–44). Visible labels are part of
the accessible names.

**Colour and contrast (1.4.1, 1.4.3, 1.4.11)**: token colours as above.
Accent text and the greys keep 4.5:1 on accent tints too (shared tokens). "On" states are not only a
tint: the chosen segment has a `--psa-border-control` edge, pressed buttons
and chips an accent-text border, the current section a bar at its edge, the
slide on screen a 2 px border, room toggles a 2 px border; added songs show ✓
for ＋. Fields, selects and segmented controls use `--psa-border-control`.
Error toasts use `--psa-on-danger` on danger. The room's high-contrast mode
sets a yellow `--psa-focus-color`; the ring follows, because the tokens work
the ring out on each element. Desktops say "online"/"offline" in words; the
dot is decorative. Chords differ from words by position and weight too.

**Text and layout (1.3.4, 1.4.4, 1.4.10, 1.4.12)**: there is no in-app text
size control, and by the owner's choice the page cannot be zoomed: the
viewport sets `maximum-scale=1, user-scalable=no` and `html` has
`touch-action: manipulation` (no double-tap zoom). Bigger text comes only
from the browser's or phone's own text size, which the layout survives to
200 % (the `/join` room keeps its own size buttons as a reading tool for low
vision). This is a known gap against 1.4.4 where the browser's text size
does not reach the page; iOS Safari ignores `user-scalable=no` and still
pinch-zooms. Any orientation (`manifest.webmanifest`). At 320 CSS px every screen
fits without horizontal scrolling, chord lines included (chord and syllable
pairs wrap together). Nothing clips with WCAG's text-spacing overrides.

**Forms and messages (1.3.5, 3.3.1, 3.3.2, 3.3.3, 3.3.7, 3.3.8, 4.1.3)**
- Labels on every field (the set editor's notes have a visible "Note");
  password fields say "At least 10 characters" (`aria-describedby`); the
  room name says "2 to 30 characters".
- Own-data fields have `autocomplete` (`organization`, `name`, `username`,
  `current-password`, `new-password`); fields about someone else are `off`.
  Paste and password managers work; there is no puzzle or code to retype.
- Errors appear in text under the form in a live region that stays in the
  accessibility tree while empty. Where an error belongs to one field (an
  unknown room, ChordPro the server refused, a taken room name)
  `showFormError` sets `aria-invalid`, links the message with
  `aria-describedby` and focuses the field.
- Status messages are spoken without moving focus: the toast (`role=status`)
  and a visually hidden `#announcer` for search result counts, the new key,
  items moved or removed in the set editor, the item reached in
  the service view, what a desktop shows now, offline and back online.

**Timing and motion (2.2.1, 2.2.2, 2.3.1)**: errors in toasts stay until
dismissed (✕ or Escape) or the screen changes; other toasts stay at least
5 s (10 s with Undo), longer for long text, and hold while a mouse is over them or
focus is in them. A touch never holds a toast: a tap leaves it `:hover` on
phones, which once kept toasts on screen for good. Undo is a shortcut: tapping ✓ again (or adding again) does the same
without a time limit. Animations are short and off with
`prefers-reduced-motion`. Nothing flashes.

## How to test

1. `cd web && bun x tsc --noEmit -p . && bun run test && bun run build`
   (`tests/a11y.test.ts` covers titles, radio keys, focus matching and toast
   timing).
2. **axe-core** (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) in a
   browser against a running server with data: every screen (sign-in, join,
   a live room and its high contrast, songs, reader and its panel, the
   add-to-set sheet, editor, sets, set, set editor and its song picker,
   service view, remote list and desktop, More and its password sheet,
   people and a person, the drawer, desktop consent and invalid link, an
   error and an Undo toast, the visitor shell) in **both themes** at
   **390 × 844** and **1280 × 900**. Seed with `POST /api/v1/setup`, songs,
   sets and a desktop token; keep the desktop online with
   `PUT /api/v1/remote/desktop` every 20 s. Set the theme with
   `localStorage['psa150-theme']` and the session with
   `localStorage['psa150-server-session']`.
3. **Keyboard**, scripted or by hand: Tab from the top (skip link first),
   open a screen from a list (focus on its `h1`), open and Escape a sheet
   (focus back on its opener), open the drawer (Tab stays in it), arrow
   through a radio group, move and remove set items, step through the
   service view, let a desktop change while focused on Next, and walk every
   screen forwards and backwards at 390 × 600 checking each stop is visible
   and not under a bar.
4. **Layout**: 320 × 640 with no horizontal scroll, then again with the
   text-spacing overrides (line height 1.5, letter 0.12em, word 0.16em,
   paragraph 2em).
5. **By hand**, which automation cannot do: VoiceOver on iPhone and TalkBack
   on Android through the room page, the service view and adding songs;
   NVDA or VoiceOver on a computer through sign-in, the set editor and the
   remote; zoom to 200 % and 400 %.

## Known exceptions and limits

- **Language of song words (3.1.2)**: songs are in whatever language the
  church sings; ChordPro carries no language and the server stores none, so
  lyrics are marked as English like the interface. A screen reader may read
  them with the wrong voice. A language field on songs would fix this.
- **Live content (2.2.2)**: the room and the remote screen follow a live
  projection; updating as it happens is their purpose. In the room,
  **Follow the screen** turns off the scrolling and announcements are off
  until asked for.
- **Session length (2.2.1)**: a session lasts 7 days (the 20-hour
  exception); an editor whose session ends loses unsaved text on save.
- **Browser-provided UI**: confirmations use `confirm()`, dates the native
  date picker, imports the file picker; their accessibility is the
  browser's.
- **Song content** typed by the church (titles, words, notes) is shown as
  entered.
- No manual screen reader pass is recorded yet; the checks above are
  automated and scripted.
