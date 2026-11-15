import type { RoomSlide } from "./types.ts";

/**
 * Which of a song's lines the projector shows, for marking them in the song
 * as it reads (follow-song.ts). `lines` are the words of each line on the
 * song's page, in order, without chords; empty lines may be "". Returns the
 * indexes of the lines of the slide at `index`, or none when they are not
 * found (the song has changed since, or the slide is not a song's).
 *
 * The slides are walked in the order they are shown, each found after the
 * one before, so a verse found again finds its own place; a chorus sung again
 * but written once is found where it is written.
 */
export function projectedLines(lines: string[], slides: RoomSlide[], index: number): number[] {
  const text = lines.map(plain);
  let from = 0;
  for (let slide = 0; slide <= index && slide < slides.length; slide += 1) {
    const wanted = slides[slide].lines.map(plain).filter(Boolean);
    const found = wanted.length ? findRun(text, wanted, from) ?? findRun(text, wanted, 0) : null;
    if (slide === index) return found ?? [];
    if (found) from = found[found.length - 1] + 1;
  }
  return [];
}

/** The words as they compare: one space between words, any case. */
function plain(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/**
 * The first place from `from` on where the wanted lines follow one another
 * (empty lines between them do not count). Failing that, the first line
 * alone, so a slide whose other lines differ is still found.
 */
function findRun(text: string[], wanted: string[], from: number): number[] | null {
  for (let start = from; start < text.length; start += 1) {
    if (text[start] !== wanted[0]) continue;
    const run = [start];
    let at = start + 1;
    while (run.length < wanted.length && at < text.length) {
      if (text[at]) {
        if (text[at] !== wanted[run.length]) break;
        run.push(at);
      }
      at += 1;
    }
    if (run.length === wanted.length) return run;
  }
  const first = text.indexOf(wanted[0], from);
  return wanted.length > 1 && first >= 0 ? [first] : null;
}
