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

- `index.html`: the page. `<!-- brand-mark -->` becomes the Wind mark.
- `src/main.ts`: the only script. It reads the latest release from GitHub and
  points each download button at its file, with its size; the hero's button
  names the visitor's system. Without GitHub every link opens the releases
  page.
- `public/shots/`: screenshots of the real apps showing public-domain hymns
  (Amazing Grace, John Newton). Never show a copyrighted song on the site.

Deploying: a Vercel project with `site/` as its root folder; `vercel.json`
sets the build and skips deploys when neither `site/` nor `shared/` changed.
