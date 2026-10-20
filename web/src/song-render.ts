import { hasChords, parseChordPro, transposeSong, type DisplaySong } from "./chordpro.ts";
import { announce, refocus } from "./a11y.ts";
import { icon } from "./icons.ts";
import { escapeHtml, readPreference, transposeLabel, writePreference } from "./ui.ts";

/** Reader settings shared by the song page and the service view. */
export interface ReaderOptions {
  chords: boolean;
  /** Whether the settings panel under the bar is open; not saved. */
  panelOpen?: boolean;
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

/**
 * Chord and transpose controls. `transpose` is null to hide it. There is no
 * text size control and the page does not zoom: bigger words come from the
 * browser's or phone's text size.
 */
export function readerControls(song: DisplaySong, options: ReaderOptions, transpose: number | null): string {
  const chordToggle = hasChords(song)
    ? `<button class="chip${options.chords ? " on" : ""}" data-reader="chords" aria-pressed="${options.chords}">${icon("chords")}Chords</button>`
    : "";
  const transposer = transpose === null || !hasChords(song) ? "" : `<div class="stepper" role="group" aria-label="Transpose">
      <button class="icon-button small" data-reader="down" aria-label="Transpose down">${icon("minus")}</button>
      <span data-reader-key>${song.key ? `Key ${escapeHtml(song.key)}` : "Key"}${transpose ? ` <small>${transposeLabel(transpose)}</small>` : ""}</span>
      <button class="icon-button small" data-reader="up" aria-label="Transpose up">${icon("plus")}</button>
    </div>`;
  return `<div class="reader-controls">
    ${chordToggle}
    ${transposer}
  </div>`;
}

/** The bar button that opens the reader settings panel; none for a song without chords. */
export function readerToggle(song: DisplaySong, options: ReaderOptions): string {
  if (!hasChords(song)) return "";
  return `<button class="icon-button ghost${options.panelOpen ? " on" : ""}" data-reader="panel" aria-controls="reader-panel" aria-expanded="${Boolean(options.panelOpen)}" aria-label="Chords and key" title="Chords and key">${icon("chords")}</button>`;
}

/** The reader settings, dropping down from the sticky bar; none for a song without chords. */
export function readerPanel(song: DisplaySong, options: ReaderOptions, transpose: number | null): string {
  if (!hasChords(song)) return "";
  return `<div class="reader-panel" id="reader-panel"${options.panelOpen ? "" : " hidden"}>${readerControls(song, options, transpose)}</div>`;
}

/** "Key G +2", or "" when the song has no key and is not transposed. */
export function keyLabel(song: DisplaySong, transpose: number): string {
  if (!song.key && !transpose) return "";
  return `${song.key ? `Key ${song.key}` : "Transposed"}${transpose ? ` ${transposeLabel(transpose)}` : ""}`;
}

/**
 * Wires the controls rendered by `readerControls`. `onChange` re-renders;
 * transpose changes are reported as a step so the caller keeps its own value.
 * The button pressed keeps focus through the re-render, and a screen reader
 * hears the new key.
 */
export function bindReaderControls(
  root: HTMLElement,
  options: ReaderOptions,
  onChange: (transposeStep: number) => void,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-reader]").forEach((button) => {
    button.addEventListener("click", () => {
      const control = button.dataset.reader;
      const after = (said: () => string) => {
        if (!button.isConnected) refocus(root, `[data-reader="${control}"]`);
        announce(said());
      };
      switch (control) {
        case "panel": {
          options.panelOpen = !options.panelOpen;
          root.querySelector("#reader-panel")?.toggleAttribute("hidden", !options.panelOpen);
          button.classList.toggle("on", options.panelOpen);
          button.setAttribute("aria-expanded", String(options.panelOpen));
          return;
        }
        case "chords":
          options.chords = !options.chords;
          break;
        case "up":
        case "down":
          onChange(control === "up" ? 1 : -1);
          after(() => root.querySelector("[data-reader-key]")?.textContent?.replace(/\s+/g, " ").trim() ?? "");
          return;
      }
      saveReaderOptions(options);
      onChange(0);
      after(() => "");
    });
  });
}

/** Keeps a transpose value in -11..11 after a step. */
export function stepTranspose(value: number, step: number): number {
  let next = value + step;
  if (next > 11) next -= 12;
  if (next < -11) next += 12;
  return next;
}
