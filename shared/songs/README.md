# Song modules shared by both apps

Everything a person does with one song, the same in the song server's web
client and in the Psalm150 desktop app: the song editor (Visual, Chords and
ChordPro with its preview), the song as it reads with chords to tap, how to
play a chord (diagrams and sound), recordings of how the song is played and
its YouTube video.

Both apps import these files from here, so they cannot drift apart. The
instrument sounds for playing chords are in `../sounds/`; `../vite-sounds.mjs`
serves them at `/sounds/` in each app.

- `host.ts`: what each app provides (toasts, confirming, keeping the screen
  on). Call `setSongHost` once at start.
- `song-media.ts`: recordings go through a `Recordings` object the app gives
  (the web client with its session, the desktop through its device token).
- `song-controls.css` loads before the app's own stylesheet, `songs.css`
  after it. Both use the tokens in `../psa150-tokens.css`.
- No imports from outside this folder except `../icons.ts` and
  `../chord-match.ts`.
