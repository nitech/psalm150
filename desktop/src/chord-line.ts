import type { LyricLine } from "./api";
import { transposeChord } from "./shared/songs/chordpro.ts";

/** A piece of a line: the chord played at its start (if any) and its words. */
export interface ChordSegment {
  chord: string | null;
  text: string;
}

/**
 * A lyric line cut where its chords are played, the way the song server's
 * reader shows it (src/shared/songs/song-preview.ts): each chord over the
 * words from its place to the next chord. Positions count characters, as
 * the parser stores them; a chord past the end sits over nothing.
 */
export function chordSegments(line: LyricLine, transpose = 0): ChordSegment[] {
  const chars = Array.from(line.text);
  const chords = [...line.chords].sort((a, b) => a.position - b.position);
  if (!chords.length) return [{ chord: null, text: line.text }];
  const segments: ChordSegment[] = [];
  const first = Math.min(chords[0].position, chars.length);
  if (first > 0) segments.push({ chord: null, text: chars.slice(0, first).join("") });
  chords.forEach((placement, index) => {
    const start = Math.min(placement.position, chars.length);
    const end = index + 1 < chords.length ? Math.min(chords[index + 1].position, chars.length) : chars.length;
    segments.push({ chord: transposeChord(placement.chord, transpose), text: chars.slice(start, end).join("") });
  });
  return segments;
}

export function lineHasChords(line: LyricLine): boolean {
  return line.chords.length > 0;
}
