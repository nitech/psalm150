/**
 * Chords from a song found online, laid over a song of ours that has none.
 *
 * Our words, spelling and verses stay exactly as they are; only chords are
 * added. Each of our lines is matched with the online line most like it (in
 * any order, so a different verse order or a chorus written out several
 * times does not matter), and each chord moves to the same word in our line.
 * A line with no line like it online gets no chords rather than a guess.
 */
import {
  findMeta,
  isMinorKey,
  keyDistance,
  keyUsesFlats,
  moveChord,
  parseChordName,
  newId,
  parseDoc,
  serializeDoc,
  setMeta,
  type Chord,
  type LyricLine,
  type SongDoc,
} from "./chord-doc.ts";
import { guessKey } from "./song-render.ts";

/** How alike two lines must be (0–1, by their words) to share chords. */
export const LINE_MATCH = 0.6;

/**
 * Which key the chords and the song agree on: the song's own `{key}` (the
 * chords are moved into it) or the key the online chords are in (the
 * song's `{key}` changes to it). A song without a key always takes the
 * online one.
 */
export type KeyChoice = "song" | "online";

export interface ChordMatch {
  /** Our song with the chords added, ready to save. */
  chordpro: string;
  /** Our lines that had words and no chords. */
  lines: number;
  /** Of those, the lines that got chords. */
  matched: number;
  /** The song's `{key}` before, or null when it has none (or none we can read). */
  songKey: string | null;
  /** The key the online chords are written in, or null when it cannot be told. */
  onlineKey: string | null;
  /** The key the saved song is in: its `{key}` always matches its chords. */
  key: string | null;
  /** Semitones the online chords were moved into the song's key. */
  transposed: number;
  /** The key that was kept (`online` when the song had none). */
  choice: KeyChoice;
}

interface Word {
  norm: string;
  start: number;
  end: number;
}

/** The words of a line, compared without case, accents or punctuation. */
export function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const norm = match[0].normalize("NFD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    if (norm) words.push({ norm, start: match.index!, end: match.index! + match[0].length });
  }
  return words;
}

/** The longest run of equal words in both lines, as index pairs. */
function alignWords(a: Word[], b: Word[]): Array<[number, number]> {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i].norm === b[j].norm ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i].norm === b[j].norm) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

/** How alike two lines are: shared words in order, 0 (none) to 1 (the same words). */
export function lineLikeness(a: string, b: string): number {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (!wa.length || !wb.length) return 0;
  return (2 * alignWords(wa, wb).length) / (wa.length + wb.length);
}

/**
 * The chords of `from` moved onto `text`: a chord on a word goes to the same
 * word in `text` (as far into it as it was), a chord on a word `text` does
 * not have goes the same share of the way between the matching words around
 * it, and a chord after the last word stays at the end.
 */
export function moveChordsTo(from: LyricLine, text: string): Chord[] {
  const source = wordsOf(from.text);
  const target = wordsOf(text);
  if (!target.length) return [];
  const pairs = alignWords(source, target);
  const mapped = new Map(pairs);
  const chords: Chord[] = [];
  let last = 0;
  for (const chord of [...from.chords].sort((a, b) => a.pos - b.pos)) {
    // The word the chord sits on, or the next one when it sits in a gap.
    let word = source.findIndex((w) => chord.pos < w.end);
    let pos: number;
    if (word < 0) {
      pos = text.length;
    } else {
      const offset = Math.max(0, chord.pos - source[word].start);
      let to = mapped.get(word);
      if (to === undefined) {
        const before = pairs.filter(([s]) => s < word).at(-1);
        const after = pairs.find(([s]) => s > word);
        if (before && after) {
          to = before[1] + Math.round(((word - before[0]) / (after[0] - before[0])) * (after[1] - before[1]));
        } else if (before) {
          to = Math.min(target.length - 1, before[1] + (word - before[0]));
        } else if (after) {
          to = Math.max(0, after[1] - (after[0] - word));
        } else {
          to = Math.min(target.length - 1, Math.round((word / Math.max(1, source.length - 1)) * (target.length - 1)));
        }
        word = -1;
      }
      const goal = target[to];
      pos = goal.start + Math.min(word < 0 ? 0 : offset, goal.end - goal.start - 1);
    }
    pos = Math.max(pos, last);
    last = pos;
    chords.push({ id: newId(), pos, name: chord.name });
  }
  return chords;
}

function lyricLines(doc: SongDoc): LyricLine[] {
  return doc.items.flatMap((item) =>
    item.kind === "section" ? item.lines.filter((line): line is LyricLine => line.kind === "lyric") : [],
  );
}

/** A key we can work with (`G`, `F#m`), else null. */
function readKey(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  return key && parseChordName(key) ? key : null;
}

/** A key's major root: a minor key shares its chords with the major a minor third up (Em → G). */
function majorRoot(key: string): string {
  const root = parseChordName(key)!.root;
  return isMinorKey(key) ? moveChord(root, 3, keyUsesFlats(key)) : root;
}

/**
 * Semitones from one key's chords to another's, between -5 and +6. A major
 * key and its relative minor are 0 apart: Em and G use the same chords.
 */
export function keySteps(from: string, to: string): number | null {
  if (!readKey(from) || !readKey(to)) return null;
  return keyDistance(majorRoot(from), majorRoot(to));
}

/**
 * The key a song's chords are written in. Its `{key}` when the chords agree
 * with it; else the key the chords fit best, as they are what gets moved.
 * With a `{capo}` the chords are shapes and `{key}` is often the key that
 * sounds, so only the chords count.
 */
export function chordKey(doc: SongDoc): string | null {
  const guessed = guessKey(lyricLines(doc).flatMap((line) => line.chords.map((chord) => chord.name)));
  const written = readKey(findMeta(doc, "key")?.value);
  if (Number(findMeta(doc, "capo")?.value)) return guessed;
  if (written && (!guessed || keySteps(written, guessed) === 0)) return written;
  return guessed ?? written;
}

/**
 * Lays the chords of `online` (ChordPro found online) over `ours`. Our
 * lines that already have chords are left alone. The saved song's `{key}`
 * always fits its chords: with `choice` "song" (the default) the chords are
 * moved into the song's key; with "online", or when the song has no key,
 * the song's `{key}` becomes the one the chords are in.
 */
export function matchChords(ours: string, online: string, choice: KeyChoice = "song"): ChordMatch {
  const { doc } = parseDoc(ours);
  const found = parseDoc(online).doc;
  const candidates = lyricLines(found).filter((line) => line.text.trim());
  const songKey = readKey(findMeta(doc, "key")?.value);
  const onlineKey = chordKey(found);
  const takeOnline = Boolean(onlineKey) && (choice === "online" || !songKey);
  const transposed = !takeOnline && songKey && onlineKey ? keySteps(onlineKey, songKey) ?? 0 : 0;
  const flat = keyUsesFlats((takeOnline ? onlineKey : songKey) ?? "");

  let lines = 0;
  let matched = 0;
  // Where the last match was online: of equally good lines, the next one wins.
  let near = 0;
  for (const line of lyricLines(doc)) {
    if (!line.text.trim() || line.chords.length) continue;
    lines += 1;
    let best: { index: number; score: number } | null = null;
    candidates.forEach((candidate, index) => {
      if (!candidate.chords.length) return;
      const score = lineLikeness(line.text, candidate.text);
      const closer = best && score === best.score && Math.abs(index - near) < Math.abs(best.index - near);
      if (score >= LINE_MATCH && (!best || score > best.score || closer)) best = { index, score };
    });
    if (!best) continue;
    const { index } = best;
    near = index + 1;
    line.chords = moveChordsTo(candidates[index], line.text).map((chord) => ({
      ...chord,
      name: transposed ? moveChord(chord.name, transposed, flat) : chord.name,
    }));
    matched += 1;
  }

  let key = songKey;
  if (takeOnline && matched) {
    setMeta(doc, "key", onlineKey!);
    key = onlineKey;
  }
  return {
    chordpro: serializeDoc(doc).text,
    lines,
    matched,
    songKey,
    onlineKey,
    key,
    transposed,
    choice: takeOnline ? "online" : "song",
  };
}
