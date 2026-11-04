# Psalm150 site

The public site for Psalm150 (psalm150.app): one static page, dark, built
with Vite from the apps' own design tokens (`../shared/psa150-tokens.css`)
and brand (`../shared/brand.ts`, `../shared/brand/icon.svg`), so it changes
with them.

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
  names the visitor's system. Without GitHub every link opens the releases
  page. The words it fills in are the page's own (`data-template`). It also
  plays the film: pressing the splash opens it in a dialog.
- `public/films/`: the 31-second promo film in each language, with its poster
  and captions (`.vtt`), rendered from `video/psalm150-promo`.
- `public/shots/`: screenshots of the real apps showing public-domain hymns
  (Amazing Grace, John Newton). Never show a copyrighted song on the site.

Deploying: a Vercel project with `site/` as its root folder; `vercel.json`
sets the build and skips deploys when neither `site/` nor `shared/` changed.
