import { hasChords, parseChordPro, transposeSong, type DisplaySong } from "./chordpro.ts";
import { announce } from "./a11y.ts";
import { reopenMenu, type BarAction } from "./bar-menu.ts";
import { escapeHtml, readPreference, transposeLabel, writePreference } from "./ui.ts";

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

/** The lyrics, with chords above the words when `chords` is on. */
export function renderSongBody(song: DisplaySong, options: ReaderOptions): string {
  if (!song.sections.length) return `<p class="muted">This song has no lyrics yet.</p>`;
  const withChords = options.chords && hasChords(song);
  return `<div class="song-body${withChords ? " with-chords" : ""}">
    ${song.sections.map((section) => `<section class="song-section">
      <h2>${escapeHtml(section.label)}</h2>
      ${section.lines.map((line) => {
        if (line.kind === "comment") return `<p class="song-comment">${escapeHtml(line.segments[0]?.text ?? "")}</p>`;
        if (!withChords) {
          const text = line.segments.map((segment) => segment.text).join("");
          return `<p class="song-line">${escapeHtml(text) || "&nbsp;"}</p>`;
        }
        return `<p class="song-line">${line.segments.map((segment) => `<span class="seg"><span class="ch">${segment.chord ? escapeHtml(segment.chord) : ""}</span><span class="ly">${escapeHtml(segment.text) || (segment.chord ? "&nbsp;" : "")}</span></span>`).join("")}</p>`;
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
    if (!element?.closest(".song-body")) return;
    const text = lyricsIn(range.cloneContents());
    if (!text) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  });
}

/** Lyrics in a copied piece of `renderSongBody` output, which may be partial. */
export function lyricsIn(fragment: DocumentFragment): string {
  fragment.querySelectorAll(".song-section > h2, .ch, .song-comment").forEach((node) => node.remove());
  const lineText = (node: Node) => (node.textContent ?? "").replace(/ /g, " ").trimEnd();
  if (!fragment.querySelector(".song-line")) return lineText(fragment).trim();
  const sections = fragment.querySelectorAll(".song-section");
  const groups: ParentNode[] = sections.length ? Array.from(sections) : [fragment];
  return groups
    .map((group) => Array.from(group.querySelectorAll(".song-line")).map(lineText).filter((line) => line.trim()).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

/** "Key G +2", or "" when no key is known or guessed and it is not transposed. */
export function keyLabel(song: DisplaySong, transpose: number): string {
  const key = songKey(song);
  if (!key && !transpose) return "";
  return `${key ? `Key ${key}` : "Transposed"}${transpose ? ` ${transposeLabel(transpose)}` : ""}`;
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

const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const PITCH: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, H: 11,
};
/** Steps above the tonic of a major key's chords: I ii iii IV V vi. */
const MAJOR = [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]] as const;

/**
 * The key a song's chords fit best: every chord in a key's scale counts,
 * the last chord being its tonic counts most (songs end at home) and the
 * first a little. A major key and its relative minor fit the same chords;
 * the minor wins only when its tonic scores more, so a worship song in G
 * that opens on Em stays in G.
 */
export function guessKey(chords: string[]): string | null {
  const parsed = chords
    .map((chord) => chord.match(/^([A-H][#b]?)(m(?!aj))?/))
    .filter((match): match is RegExpMatchArray => Boolean(match) && match![1] in PITCH)
    .map((match) => ({ root: PITCH[match[1]], minor: Boolean(match[2]) }));
  if (!parsed.length) return null;
  let best: { tonic: number; minor: boolean; score: number } | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      // A minor key uses the chords of the major key a minor third up.
      const major = minor ? (tonic + 3) % 12 : tonic;
      const fits = (c: { root: number; minor: boolean }) =>
        MAJOR.some(([step, isMinor]) => (major + step) % 12 === c.root && isMinor === c.minor);
      const home = (c: { root: number; minor: boolean }) => c.root === tonic && c.minor === minor;
      let score = parsed.filter(fits).length;
      if (home(parsed[parsed.length - 1])) score += 3;
      if (home(parsed[0])) score += 1;
      score += parsed.filter(home).length * 0.5;
      if (!best || score > best.score || (score === best.score && !minor && best.minor)) best = { tonic, minor, score };
    }
  }
  return best ? `${NOTES[best.tonic]}${best.minor ? "m" : ""}` : null;
}

/**
 * The reader's own bar actions, for a song with chords: the chords on/off
 * switch (fixed) and Transpose (− key +), in the ⋮ menu unless
 * `transposeFixed`. Handle them with `onReaderAction`.
 */
export function readerBarActions(
  song: DisplaySong,
  options: ReaderOptions,
  transpose: number,
  transposeFixed = false,
): BarAction[] {
  if (!hasChords(song)) return [];
  const key = songKey(song);
  const steps = transpose ? transposeLabel(transpose) : "";
  return [
    {
      id: "chords",
      label: options.chords ? "Hide chords" : "Show chords",
      icon: "chordChart",
      fixed: true,
      checked: options.chords,
      className: options.chords ? "on" : "",
    },
    {
      id: "transpose",
      label: "Transpose",
      icon: "transpose",
      fixed: transposeFixed,
      stepper: {
        value: key ?? (steps || "±0"),
        spoken: key ? `key ${key}${steps ? `, ${steps}` : ""}` : steps || "not transposed",
      },
    },
  ];
}

/**
 * A click on one of `readerBarActions`: switches chords (and saves that) or
 * steps the transpose through `step`, redraws with `redraw`, then puts
 * focus back where it was (the menu stays open for a step taken in it).
 * False for any other click.
 */
export function onReaderAction(
  root: HTMLElement,
  target: HTMLElement,
  options: ReaderOptions,
  hooks: { step: (by: number) => void; redraw: () => void; key: () => string | null; transpose: () => number },
): boolean {
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action === "chords") {
    options.chords = !options.chords;
    saveReaderOptions(options);
    hooks.redraw();
    root.querySelector<HTMLElement>("[data-action='chords']")?.focus();
    announce(options.chords ? "Chords shown" : "Chords hidden");
    return true;
  }
  if (action === "transpose-down" || action === "transpose-up") {
    const fromMenu = Boolean(target.closest(".bar-menu"));
    hooks.step(action === "transpose-up" ? 1 : -1);
    hooks.redraw();
    if (fromMenu) reopenMenu(root, action);
    else root.querySelector<HTMLElement>(`.bar-stepper [data-action="${action}"]`)?.focus();
    const key = hooks.key();
    const transpose = hooks.transpose();
    announce(key ? `Key ${key}` : transpose ? `Transposed ${transposeLabel(transpose)}` : "Not transposed");
    return true;
  }
  return false;
}
