# Brand

The Psalm150 mark is **Wind**: one breath that comes in low and curls upward.
"Let every thing that hath breath praise the LORD" (Psalm 150:6); in Hebrew
*ruach* is breath, wind and Spirit in one word.

- `icon.svg`: the app icon, a gold mark (`--psa-gold-400`, `#e6b860`) on the
  dark tile with rounded corners.
- `icon-square.svg`: the same without rounded corners, for icons the system
  rounds itself (the iPhone home screen, Android's maskable icon).
- `../brand.ts`: the mark alone, drawn in `currentColor`, for both apps'
  headers.

Colours: gold is the accent and sky (`--psa-sky-400`, `#8ec3ea`) the second
colour; see `../psa150-tokens.css`.

The PNG and ICO files are rendered from these SVGs: the desktop's set with
`bun run tauri icon <1024 px PNG of icon.svg>` in `desktop/`, and the web
client's `favicon.svg` (a copy of `icon.svg`), `favicon.ico` (the desktop's
`icon.ico`), `icon-192.png` and `icon-512.png` (from `icon.svg`),
`apple-touch-icon.png` (180 px) and `icon-maskable-512.png` (from
`icon-square.svg`) in `web/public/`. Render again after changing the mark.
