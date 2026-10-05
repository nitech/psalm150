---
type: Concept
title: Accessibility
description: WCAG 2.2 level AA for the operator console and the LAN remote page — the standard, how each area meets it (names and structure, keyboard, focus, contrast, status messages, motion, zoom and reflow, target size, sign-in), how to test it, and the known exceptions (the projection windows, song language, ad hoc editing by pointer).
tags: [accessibility, wcag, keyboard, a11y, console, remote]
status: stable
sources:
  - id: app
    resource: /src/components/app.ts
    title: Console root (landmarks, keyboard model, toasts and live regions, settings)
  - id: modal
    resource: /src/components/modal.ts
    title: Dialog shell (labelled, focus in, Tab trap, focus return)
  - id: select
    resource: /src/components/select.ts
    title: Select-only combobox
  - id: song-list
    resource: /src/components/song-list.ts
    title: Song listbox, roving tab stop, result count
  - id: css
    resource: /src/styles.css
    title: Focus ring, control edges, state cues, reduced motion, narrow layout
  - id: tokens
    resource: /src/shared/psa150-tokens.css
    title: Contrast-checked tokens (--psa-border-control, --psa-focus-ring)
  - id: shortcuts
    resource: /src/shortcuts.ts
    title: Remappable shortcuts
  - id: remote
    resource: /src-tauri/assets/remote.html
    title: LAN remote page
  - id: conf
    resource: /src-tauri/tauri.conf.json
    title: zoomHotkeysEnabled on the main window
generated: { by: agent, at: 2026-10-05T21:30:00Z }
---

# Accessibility

## Standard

The target is **WCAG 2.2 level AA**: every level A and AA success criterion,
including those added in 2.1 and 2.2, read for desktop software the way
WCAG2ICT does (one window is one "page"). It covers:

- the **operator console** (`index.html`, `psa150-app`);
- the **LAN remote page** (`src-tauri/assets/remote.html`,
  [remote control](remote-control.md#lan-remote)).

The audience and stage windows are output for a projector, not an
interface; see [exceptions](#known-exceptions). The console is always dark
(`data-theme="dark"`), so only the dark theme of the
[design tokens](design-tokens.md) is in use.

## How it is met

### Names, roles and structure (1.1.1, 1.3.1, 2.4.2, 2.4.6, 3.1.1, 4.1.2)

- Every HTML file has `lang="en"` and a title; the projection windows are
  titled "Psalm150 audience display" and "Psalm150 stage display".
- Landmarks: the title bar (`header`), the activity bar (`nav` "Song list
  views"), the song list (`aside` "Song list"), the workspace (`main`), the
  song pane (a `section` named by the song title). Headings: the song title is
  the `h1`; song sections, the History/Favourites title and dialog titles are
  `h2`; settings sections `h3`.
- The song list is a `listbox` named after the view, with `option` rows and
  `aria-selected`. Sort headers say ", sorted ascending/descending"; the star
  reads ", favourite". A hidden status line gives the result count ("5
  songs", "No songs found", "Searching the web…"). With no rows the list is a
  plain message, not an empty listbox.
- Icon-only buttons have `aria-label`s (the title is only a tooltip);
  toggles use `aria-pressed` (activity bar views, Blank, favourite star,
  setlists in the add-to-setlist popup, duplicate groups, the shortcut being
  recorded); the active settings category has `aria-current`, the projected
  stanza `aria-current="true"`. Window controls are labelled buttons.
- Fields have labels: the search field ("Search songs"), Find a setting, the
  display selects (by their visible "Congregation"/"Stage" labels), Room
  name, the editor ("ChordPro source"), the duplicate file pickers.
- `psa150-select` follows the ARIA select-only combobox: `aria-controls`,
  `aria-expanded`, `aria-activedescendant` on option ids, named by `label`
  or `labelledby`. The `#` key list does the same for the search field.
- SVG icons are `aria-hidden`.

### Keyboard (2.1.1, 2.1.2, 2.1.4, 2.4.3, 2.5.7)

- **Dialogs** (`psa150-modal`) are `role="dialog"` with `aria-modal` and
  `aria-labelledby` on their heading. Opening moves focus to the first control
  after the header; Tab and Shift+Tab stay inside; the rest of the window is
  `inert`; Esc closes (handled by the console, which knows the top dialog);
  focus returns to what opened it (through a dialog opened from another
  dialog, back to the first opener). The import dialog has no close button and
  ignores Esc; Cancel stops the import.
- **Select**: ↓/↑, Enter or Space open; ↓/↑, Home/End, Page Up/Down move;
  Enter/Space choose; Esc closes without choosing (and does not close the
  dialog around it); Tab closes. Keys it uses never reach the console's
  shortcuts. Options are chosen on click, not on mouse-down (2.5.2).
- **Add-to-setlist popup**: a non-modal dialog (`aria-haspopup="dialog"`).
  Focus moves in on opening; Esc closes it and returns focus to the button;
  tabbing out closes it. Arrow keys do not move the song selection while it
  is open.
- **Splitter** between the song list and the song: focusable `separator`
  with its value; ←/→ change the width by 16 px (Shift: 64), Home/End jump to
  the narrowest/widest. **Double-click** toggles the default and the widest
  width, the pointer alternative to dragging (2.5.7). There is no other
  drag-and-drop; setlists are not reordered in the console.
- **Song list**: one row is in the Tab order (the selected song, else the
  first); arrows move between rows. While projecting, rows leave the Tab order
  because the arrows drive stanzas; Ctrl+F (or Ctrl+E) and ↓ reach the list.
- **Enter projects** unless the focus is on a control that Enter activates
  itself (button, link, summary, combobox, option, the splitter), a text field
  other than search, a dialog or the setlist popup.
- **Single-key shortcuts** (2.1.4) never fire while typing in a field. B
  (blank) is remappable or removable in Settings, Keyboard shortcuts. The
  number keys 1–9 can be turned off there ("Number keys 1–9 jump to a stanza
  while projecting", `localStorage["psa150-stanza-number-keys"] = "off"`);
  ↑/↓ still step stanzas. While a shortcut is being recorded, Tab ends the
  recording and moves on (no keyboard trap); Esc cancels.

### Focus visible and not hidden (2.4.7, 2.4.11)

A global `:focus-visible` outline (2 px, `--focus-color`, the lime of
`--psa-focus-color`) marks every control; text fields, the select and the
song actions use `--focus-ring` (`--psa-focus-ring`); rows and options inside
scroll areas draw it inset so it is not clipped. `outline: none` is used only
where a replacement is drawn. The song body has `scroll-padding-top` while
the correction bar or "On screen" line is pinned, so a focused or active line
is not hidden under it.

### Colour and contrast (1.4.1, 1.4.3, 1.4.11)

- Text uses the token greys, all at least 4.5:1 on the console surfaces.
  The placeholder grey passes on `--bg-elevated`, which fields turn on hover
  and focus. Tertiary text on lime-tinted rows (song number and key of the
  selected song, the room chip label, the setlist count on a hovered item)
  switches to the secondary or primary grey.
- Field, select and search edges use `--border-control` (3:1 or more).
- States are not shown by colour alone: the selected song row and chosen
  select option have a lime edge; pressed toolbar buttons (Project while
  projecting, Blank) a solid lime border; the room chip is dashed when the
  words are not shared; the VSB sync icon gets a dot on error; changed words
  in ad hoc editing are underlined; the keyboard's option in a list has a
  focus outline.
- Dimmed (not projected) stanzas use opacity 0.5, which keeps 4.5:1. The
  window close button's hover red is Windows' `#c42b1c`, so the white × keeps
  3:1.

### Status messages and timing (2.2.1, 3.3.1, 4.1.3)

- Toasts are copied into two hidden live regions at the end of the console
  (`role="status"`, and `role="alert"` for errors), outside the parts that go
  inert under a dialog, so they are announced without moving focus.
- **Errors stay** until dismissed (× button) or replaced. Other toasts stay
  at least 5 s (2 s plus 60 ms per character) and never hide while the
  pointer or keyboard focus is on them. Long messages wrap instead of being
  cut off.
- The server address check is a status line tied to the URL field
  (`aria-describedby`, `aria-invalid` on an error). Server sync announces each
  phase; the byte counter is not live. The import dialog has a
  `progressbar`. Settings search announces the number of matching sections.
  Shortcut conflicts are an alert.

### Motion (2.2.2)

With the system's reduce-motion setting, CSS animations and transitions stop
(spinners, the sliding VSB hairline, pop-ins, dialog and slide fades) and the
active stanza scrolls into view without smooth scrolling. Spinners only run
while a sync is in progress.

### Zoom, reflow and spacing (1.4.4, 1.4.10, 1.4.12)

- The main window allows **Ctrl+= / Ctrl+− / Ctrl+0 and Ctrl+wheel** zoom
  (`zoomHotkeysEnabled`, WebView2's zoom control).
- Below 900 CSS px (a narrow window or zoom) the console stacks into one
  column, the title bar wraps, and the room name, song title and long song
  titles wrap instead of being cut. Checked at 200 % (640 × 450 CSS px) and
  400 % (320 CSS px wide): no page-level horizontal scrolling, all content
  reachable.
- Enlarged line, letter and word spacing does not clip text.

### Targets and pointer (2.5.2, 2.5.3, 2.5.8)

Interactive targets are at least 24 × 24 CSS px (the settings search clear
button and the toast dismiss button were raised to 24 px, sort headers and
checkbox rows have a 24 px minimum height). Visible text is part of every
accessible name (shortcut buttons are named "<action> <keys>").

### Sign-in (3.3.8)

Connecting to a song server signs in on the server's own page in the
browser (password managers work there). The desktop-token field and the LAN
remote PIN accept paste; the phone remembers the PIN.

### LAN remote page

`lang`, a title, a `main` landmark and `h1`; Next, Previous and Blank are
large text buttons; the PIN has a label; results go to a `role="status"` line
that also describes the PIN field, which is marked `aria-invalid` with a hint
where to find the PIN after a 401. The field edge is `#737373` (3:1) and a
lime focus ring shows keyboard focus. No zoom lock; it reflows to 320 px.

## How to test

- **Automated**: run axe-core (tags `wcag2a`, `wcag2aa`, `wcag21a`,
  `wcag21aa`, `wcag22aa`, `best-practice`) in a headless Chromium on a
  `vite build` of the three pages, with a small stub of
  `window.__TAURI_INTERNALS__` whose `invoke` returns sample songs, a
  projection snapshot and config. Visit the console states (empty, song
  selected, key list, setlist popup, Setlist view with the select open,
  projecting, each Settings section with and without a server, duplicates,
  editor, import), the audience and stage pages, and `remote.html` served as a
  static file. axe cannot resolve the console's gradient background, so add a
  script that composites ancestor background colours and opacity and checks
  text at 4.5:1 and field edges at 3:1. The harness is not kept in the repo.
- **Keyboard**: unplug the mouse; Tab through the title bar, activity bar,
  search, list, song actions and splitter; open and leave every dialog, the
  select, the setlist popup and the key list; project with Enter; check
  B/arrows/digits never fire while typing.
- **Screen reader**: NVDA or Narrator: list names and counts, selected song,
  toasts announced, dialog names, settings categories, shortcut buttons.
- **Zoom and spacing**: Ctrl+= to 200 %, a narrow window, a text-spacing
  bookmarklet; Windows "Show animations" off for reduced motion.

## Known exceptions

- **Audience and stage windows** are presentation-only output on a
  projector or stage monitor: nothing in them takes focus, their only keys
  are Esc and arrows (forwarded to the projection), and they are not meant to
  be read with a screen reader, so landmark and heading best practices are
  not applied. The default themes have ample contrast (lyrics `#f4f4f4` on
  `#060606`; the overlay and stanza-counter pills; stage chords in lime;
  the dimmed stanza arrow at 3:1). Theme colours an operator picks or imports
  are not checked.
- **Language of song text** (3.1.2): lyrics may be in another language than
  the English interface, but the library does not record a song's language,
  so it cannot be marked.
- **Ad hoc editing** starts with a click on a lyric line; keyboard users make
  the same correction in the raw editor (Edit button). Clicking a stanza to
  jump has the number keys and ↑/↓ as keyboard equivalents.
- **Native dialogs** (confirmations, folder and file pickers) are the
  operating system's.
- **Settings categories** become a horizontally scrolling strip below
  680 CSS px; the strip scrolls on its own, the page does not.
- The search field's placeholder hint can be cut off with enlarged text
  spacing at the default list width; widening the list shows it, and the `#`
  key tip is also in Settings, Keyboard shortcuts.
- A toast drawn over a dialog sits outside the landmarks (axe best practice
  "region"); it is announced through the live regions.

## Related

- [Operator console](operator-console.md), [Design tokens](design-tokens.md),
  [Remote control](remote-control.md#lan-remote),
  [Projection windows](projection-windows.md)
