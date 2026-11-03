/**
 * A song as it reads: chords over the words (each chord a button that shows
 * how to play it, chord-viewer.ts), the key and transposing.
 *
 * Both the web client and the desktop use this folder as it is.
 */
import { hasChords, parseChordPro, transposeSong, type DisplaySong } from "./chordpro.ts";
import { guessKey } from "../chord-match.ts";
import { escapeHtml, readPreference, transposeLabel, writePreference } from "./format.ts";
import { t } from "./i18n.ts";

export { guessKey };

/** Reader settings shared by the song page and the service view. */
export interface ReaderOptions {
  chords: boolean;
}

export function readReaderOptions(): ReaderOptions {
  return { chords: readPreference("chords") !== "off" };
}

export function saveReaderOptions(options: ReaderOptions): void {
  writePreference("chords", options.chords ? null : "off");
}

export function prepareSong(chordpro: string, transpose: number): DisplaySong {
  return transposeSong(parseChordPro(chordpro), transpose);
}

/**
 * The lyrics, with chords above the words when `chords` is on. Each chord is
 * a button: `installChordViewer` shows how to play it.
 */
export function renderSongBody(song: DisplaySong, options: ReaderOptions): string {
  if (!song.sections.length) return `<p class="muted">${t("This song has no lyrics yet.")}</p>`;
  const withChords = options.chords && hasChords(song);
  return `<div class="reader${withChords ? " with-chords" : ""}">
    ${song.sections.map((section) => `<section class="reader-section">
      <h2>${escapeHtml(section.label)}</h2>
      ${section.lines.map((line) => {
        if (line.kind === "comment") return `<p class="reader-comment">${escapeHtml(line.segments[0]?.text ?? "")}</p>`;
        if (!withChords) {
          const text = line.segments.map((segment) => segment.text).join("");
          return `<p class="reader-line">${escapeHtml(text) || "&nbsp;"}</p>`;
        }
        return `<p class="reader-line">${line.segments.map((segment) => `<span class="seg">${segment.chord ? `<button type="button" class="ch" data-chord="${escapeHtml(segment.chord)}" aria-label="${escapeHtml(t("{chord}, how to play it", { chord: segment.chord }))}">${escapeHtml(segment.chord)}</button>` : `<span class="ch"></span>`}<span class="ly">${escapeHtml(segment.text) || (segment.chord ? "&nbsp;" : "")}</span></span>`).join("")}</p>`;
      }).join("")}
    </section>`).join("")}
  </div>`;
}

/**
 * The words alone, for copying: no section labels, chords or comments, and a
 * blank line between sections.
 */
export function songText(song: DisplaySong): string {
  return song.sections
    .map((section) => section.lines
      .filter((line) => line.kind === "lyrics")
      .map((line) => line.segments.map((segment) => segment.text).join("").trimEnd())
      .filter((line) => line.trim())
      .join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Copying a selection inside a song copies only the words, the same way as
 * `songText`. Labels and chords are also unselectable in the CSS, but not
 * every browser leaves unselectable text out of the clipboard.
 */
export function installLyricsCopy(): void {
  document.addEventListener("copy", (event) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !event.clipboardData) return;
    const range = selection.getRangeAt(0);
    const start = range.commonAncestorContainer;
    const element = start instanceof Element ? start : start.parentElement;
    if (!element?.closest(".reader")) return;
    const text = lyricsIn(range.cloneContents());
    if (!text) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  });
}

/** Lyrics in a copied piece of `renderSongBody` output, which may be partial. */
export function lyricsIn(fragment: DocumentFragment): string {
  fragment.querySelectorAll(".reader-section > h2, .ch, .reader-comment").forEach((node) => node.remove());
  const lineText = (node: Node) => (node.textContent ?? "").replace(/ /g, " ").trimEnd();
  if (!fragment.querySelector(".reader-line")) return lineText(fragment).trim();
  const sections = fragment.querySelectorAll(".reader-section");
  const groups: ParentNode[] = sections.length ? Array.from(sections) : [fragment];
  return groups
    .map((group) => Array.from(group.querySelectorAll(".reader-line")).map(lineText).filter((line) => line.trim()).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

/** "Key G +2", or "" when no key is known or guessed and it is not transposed. */
export function keyLabel(song: DisplaySong, transpose: number): string {
  const key = songKey(song);
  if (!key && !transpose) return "";
  const steps = transposeLabel(transpose);
  if (key) return transpose ? t("Key {key} {steps}", { key, steps }) : t("Key {key}", { key });
  return t("Transposed {steps}", { steps });
}

/** Keeps a transpose value in -11..11 after a step. */
export function stepTranspose(value: number, step: number): number {
  let next = value + step;
  if (next > 11) next -= 12;
  if (next < -11) next += 12;
  return next;
}

/**
 * The song's key as the transposer shows it: its `{key}`, else a guess
 * from its chords, e.g. `G` or `Em`. Pass the transposed song for the key it
 * is in now.
 */
export function songKey(song: DisplaySong): string | null {
  if (song.key) return song.key;
  const chords = song.sections.flatMap((section) =>
    section.lines.flatMap((line) => line.segments.flatMap((segment) => (segment.chord ? [segment.chord] : []))),
  );
  return guessKey(chords);
}
