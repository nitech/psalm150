# Psalm150 site

The public site for Psalm150 (psalm150.app): one static page, nearly black and
nearly monochrome (its look follows herdr.dev), built with Vite from the apps'
own design tokens (`../shared/psa150-tokens.css`) and brand
(`../shared/brand.ts`, `../shared/brand/icon.svg`), so it changes with them.

```sh
bun install
bun run dev       # http://localhost:5180
bun run build     # dist/
```

- `src/page.html`: the page, with a `{{key}}` for every piece of text.
  `<!-- brand-mark -->` becomes the Wind mark.
- `src/text.ts`: the words, in English and Norwegian. `vite.config.ts` writes
  the page once per language: English at `/` (`index.html`) and Norwegian at
  `/no/` (`no/index.html`); both entry files are only a comment. A key
  without words stops the build. A Norwegian browser on its first visit to `/`
  goes to `/no/`; a language chosen with the link in the header stays chosen.
- `src/main.ts`: the only script. It reads the latest release from GitHub and
  points each download button at its file, with its size; the hero's button
  names the visitor's system and the download opens on its tab. Without
  GitHub every link opens the releases page. The words it fills in are the
  page's own (`data-template`). It also runs the tabs (the views from every
  seat, a download for each system), marks the part being read in the
  contents, copies the server's commands, and plays the film: the wall of
  windows, the hero's link and the footer open it in a dialog.
- The motion follows herdr.dev too: the wall drifts (a column stops under the
  pointer, and a window comes forward), pills lift, arrows nudge, a tab's view
  fades up, the server's commands are typed in, and the live windows play the
  real apps frame by frame (`LIVE` in `src/main.ts`, frames in
  `public/live/`, from the captures in `video/`). With reduced motion
  everything stays still.
- `public/shots/`: screenshots of the real apps, and `wall/` the small ones
  the hero's wall is made of. `public/live/<name>/`: each live window's frames.
- `public/films/`: the 31-second promo film in each language, with its poster
  and captions (`.vtt`), rendered from `video/psalm150-promo`.
- `public/shots/`: screenshots of the real apps showing public-domain hymns
  (Amazing Grace, John Newton). Never show a copyrighted song on the site.

Deploying: a Vercel project with `site/` as its root folder; `vercel.json`
sets the build and skips deploys when neither `site/` nor `shared/` changed.
