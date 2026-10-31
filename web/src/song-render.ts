import { announce } from "../../shared/songs/a11y.ts";
import { reopenMenu, type BarAction } from "./bar-menu.ts";
import { hasChords, type DisplaySong } from "../../shared/songs/chordpro.ts";
import { saveReaderOptions, songKey, type ReaderOptions } from "../../shared/songs/song-preview.ts";
import { transposeLabel } from "./ui.ts";

export {
  guessKey,
  installLyricsCopy,
  keyLabel,
  lyricsIn,
  prepareSong,
  readReaderOptions,
  renderSongBody,
  saveReaderOptions,
  songKey,
  songText,
  stepTranspose,
  type ReaderOptions,
} from "../../shared/songs/song-preview.ts";

/**
 * The reader's own bar actions, for a song with chords: the chords on/off
 * switch (fixed) and Transpose (− key +), always in the ⋮ menu: it is too
 * wide for a phone's bar. Handle them with `onReaderAction`.
 */
export function readerBarActions(song: DisplaySong, options: ReaderOptions, transpose: number): BarAction[] {
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
      menuOnly: true,
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
