import { hasChords, parseChordPro, transposeSong, type DisplaySong } from "./chordpro.ts";
import { icon } from "./icons.ts";
import { escapeHtml, readPreference, transposeLabel, writePreference } from "./ui.ts";

/** Reader settings shared by the song page and the service view. */
export interface ReaderOptions {
  chords: boolean;
  /** Text scale step, -2 to 4. */
  size: number;
}

export function readReaderOptions(): ReaderOptions {
  const size = Number(readPreference("text-size") ?? "0");
  return {
    chords: readPreference("chords") !== "off",
    size: Number.isFinite(size) ? Math.min(4, Math.max(-2, size)) : 0,
  };
}

export function saveReaderOptions(options: ReaderOptions): void {
  writePreference("chords", options.chords ? null : "off");
  writePreference("text-size", options.size ? String(options.size) : null);
}

export function prepareSong(chordpro: string, transpose: number): DisplaySong {
  return transposeSong(parseChordPro(chordpro), transpose);
}

/** The lyrics, with chords above the words when `chords` is on. */
export function renderSongBody(song: DisplaySong, options: ReaderOptions): string {
  if (!song.sections.length) return `<p class="muted">This song has no lyrics yet.</p>`;
  const withChords = options.chords && hasChords(song);
  return `<div class="song-body${withChords ? " with-chords" : ""}" style="--reader-scale:${1 + options.size * 0.12}">
    ${song.sections.map((section) => `<section class="song-section">
      <h3>${escapeHtml(section.label)}</h3>
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

/** Chord, transpose and text size controls. `transpose` is null to hide it. */
export function readerControls(song: DisplaySong, options: ReaderOptions, transpose: number | null): string {
  const chordToggle = hasChords(song)
    ? `<button class="chip${options.chords ? " on" : ""}" data-reader="chords" aria-pressed="${options.chords}">${icon("chords")}Chords</button>`
    : "";
  const transposer = transpose === null || !hasChords(song) ? "" : `<div class="stepper" role="group" aria-label="Transpose">
      <button class="icon-button small" data-reader="down" aria-label="Transpose down">${icon("minus")}</button>
      <span>${song.key ? `Key ${escapeHtml(song.key)}` : "Key"}${transpose ? ` <small>${transposeLabel(transpose)}</small>` : ""}</span>
      <button class="icon-button small" data-reader="up" aria-label="Transpose up">${icon("plus")}</button>
    </div>`;
  return `<div class="reader-controls">
    ${chordToggle}
    ${transposer}
    <div class="stepper" role="group" aria-label="Text size">
      <button class="icon-button small" data-reader="smaller" aria-label="Smaller text">A−</button>
      <button class="icon-button small" data-reader="larger" aria-label="Larger text">A+</button>
    </div>
  </div>`;
}

/**
 * Wires the controls rendered by `readerControls`. `onChange` re-renders;
 * transpose changes are reported as a step so the caller keeps its own value.
 */
export function bindReaderControls(
  root: HTMLElement,
  options: ReaderOptions,
  onChange: (transposeStep: number) => void,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-reader]").forEach((button) => {
    button.addEventListener("click", () => {
      switch (button.dataset.reader) {
        case "chords":
          options.chords = !options.chords;
          break;
        case "smaller":
          options.size = Math.max(-2, options.size - 1);
          break;
        case "larger":
          options.size = Math.min(4, options.size + 1);
          break;
        case "up":
          onChange(1);
          return;
        case "down":
          onChange(-1);
          return;
      }
      saveReaderOptions(options);
      onChange(0);
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
