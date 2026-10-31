# Song modules shared by both apps

Everything a person does with one song, the same in the song server's web
client and in the Psalm150 desktop app: the song editor (Visual, Chords and
ChordPro with its preview), the song as it reads with chords to tap, how to
play a chord (diagrams and sound), recordings of how the song is played and
its YouTube video.

The web client imports these files from here. The desktop repo mirrors this
folder at `src/shared/songs/` (and `web/public/sounds/` at `public/sounds/`)
with `bun run sync:shared`, and its CI fails when the mirror differs, so the
two apps cannot drift apart. Edit here, never in the mirror.

- `host.ts`: what each app provides (toasts, confirming, keeping the screen
  on). Call `setSongHost` once at start.
- `song-media.ts`: recordings go through a `Recordings` object the app gives
  (the web client with its session, the desktop through its device token).
- `song-controls.css` loads before the app's own stylesheet, `songs.css`
  after it. Both use the tokens in `../psa150-tokens.css`.
- No imports from outside this folder except `../icons.ts` and
  `../chord-match.ts`, which are mirrored too.
