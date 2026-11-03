/**
 * What the chord bubble offers (chord-editor.ts), apart from drawing it:
 * the twelve roots spelled for the key, the forms of a root, a name typed
 * loosely ("fiss moll", "f#m", "H7") read as a chord, and suggestions from
 * the song itself: its chords, and the one to suggest at a place (from the
 * same place in an earlier verse or chorus, else what usually follows the
 * chord before).
 */
import {
  CHORD_PATTERN,
  NOTE_INDEX,
  autoLabel,
  chordsInKey,
  isMinorKey,
  keyUsesFlats,
  mod12,
  noteName,
  parseChordName,
  type SongDoc,
} from "./chord-doc.ts";

/** The twelve roots from C, spelled for the key, and whether each is in its scale. */
export function rootsFor(key: string): Array<{ name: string; inKey: boolean }> {
  const tonic = NOTE_INDEX[parseChordName(key)?.root ?? "C"] ?? 0;
  const flat = keyUsesFlats(key) ?? false;
  const scale = (isMinorKey(key) ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((step) => mod12(tonic + step));
  return Array.from({ length: 12 }, (_, index) => ({ name: noteName(index, flat), inKey: scale.includes(index) }));
}

/** The forms the bubble offers for a root, the commonest first. */
export const QUALITIES = ["", "m", "7", "maj7", "m7", "sus2", "sus4", "add9", "6", "dim", "aug"];

/* ── A chord typed loosely ────────────────────────────────────────────── */

// Norwegian and German names first (longest first), then a letter; H is B.
const ROOT_WORDS: Array<[string, string]> = [
  ["ciss", "C#"], ["diss", "D#"], ["fiss", "F#"], ["giss", "G#"], ["aiss", "A#"],
  ["dess", "Db"], ["gess", "Gb"], ["bess", "Bb"],
  ["cis", "C#"], ["dis", "D#"], ["fis", "F#"], ["gis", "G#"], ["ais", "A#"],
  ["des", "Db"], ["ges", "Gb"], ["ess", "Eb"], ["ass", "Ab"], ["es", "Eb"], ["as", "Ab"],
];
// Words for a form, read in this order, longest first.
const QUALITY_WORDS: Array<[RegExp, string]> = [
  [/^(major|dur|maj|Δ)(?=7|9|11|13)/, "maj"],
  [/^(major|dur)/, ""],
  [/^(minor|moll|min|mi|-)/, "m"],
  [/^(diminished|dim|°|o)(?![a-z])/, "dim"],
  [/^(augmented|aug|\+)/, "aug"],
  [/^ø/, "m7b5"],
];

/**
 * A chord typed any common way as the app writes it: "fiss moll" and "f#m"
 * are F#m, "h7" B7, "e flat" Eb, "c / e" C/E. Null when it cannot be read.
 */
export function readChord(typed: string): string | null {
  const text = typed.trim().toLowerCase().replace(/♯/g, "#").replace(/♭/g, "b").replace(/\s+/g, " ")
    // "Fiss-moll": a dash between words joins them; a dash at the end or before a number is minor.
    .replace(/-(?=[a-z])/g, "");
  if (!text) return null;
  const [main, bassText, ...rest] = text.split("/");
  if (rest.length) return null;
  const head = readRoot(main.replace(/ /g, ""));
  if (!head) return null;
  let quality = "";
  let left = head.rest;
  while (left) {
    const word = QUALITY_WORDS.find(([pattern]) => pattern.test(left));
    if (word) {
      quality += word[1];
      left = left.replace(word[0], "");
    } else {
      const match = /^(maj|sus|add|m|\d+|#|b|\(|\))/.exec(left);
      if (!match) return null;
      quality += match[1];
      left = left.slice(match[1].length);
    }
  }
  if (quality === "sus") quality = "sus4";
  let bass = "";
  if (bassText !== undefined) {
    const read = readRoot(bassText.replace(/ /g, ""));
    if (!read || read.rest) return null;
    bass = `/${read.root}`;
  }
  const chord = head.root + quality + bass;
  return CHORD_PATTERN.test(chord) ? chord : null;
}

/** A root at the start of the text, and what follows; a "b" just after the letter is a flat (eb, bb). */
function readRoot(text: string): { root: string; rest: string } | null {
  const word = ROOT_WORDS.find(([name]) => text.startsWith(name));
  if (word) return { root: word[1], rest: text.slice(word[0].length) };
  const match = /^([a-h])(#|sharp|flat|b)?/.exec(text);
  if (!match) return null;
  const letter = match[1] === "h" ? "B" : match[1].toUpperCase();
  const sign = match[2] === "#" || match[2] === "sharp" ? "#" : match[2] ? "b" : "";
  return { root: letter + sign, rest: text.slice(match[0].length) };
}

/* ── Suggestions from the song ────────────────────────────────────────── */

export interface Suggestion {
  chord: string;
  /** Why it is offered: the section it is from ("Verse 1"), or "usually next". */
  why: string;
}

// The chords that usually follow each step of a major key (I ii iii IV V vi), as steps.
const FOLLOWS: Record<number, number[]> = { 0: [5, 7, 9], 2: [7, 5], 4: [9, 5], 5: [7, 0], 7: [0, 9], 9: [5, 2, 7] };

/** The chords that usually come after `previous` in the key, at most two. */
export function nextChords(previous: string, key: string): string[] {
  const chord = parseChordName(previous);
  const keyRoot = parseChordName(key);
  if (!chord || !keyRoot || !(chord.root in NOTE_INDEX)) return [];
  // A minor key goes as its relative major.
  const tonic = mod12(NOTE_INDEX[keyRoot.root] + (isMinorKey(key) ? 3 : 0));
  const step = mod12(NOTE_INDEX[chord.root] - tonic);
  const inKey = chordsInKey(noteName(tonic, keyUsesFlats(key) ?? false));
  return (FOLLOWS[step] ?? []).slice(0, 2).map((next) => inKey.find((name) => mod12(NOTE_INDEX[parseChordName(name)!.root] - tonic) === next && !name.includes("/"))!).filter(Boolean);
}

/** The song's chords, each once, in the order they first come. */
export function songChords(doc: SongDoc): string[] {
  const seen = new Set<string>();
  for (const item of doc.items) {
    if (item.kind !== "section") continue;
    for (const line of item.lines) if (line.kind === "lyric") for (const chord of line.chords) seen.add(chord.name);
  }
  return [...seen];
}

/**
 * Where a chord goes, as the bubble sees it: the chord before it in the
 * song, and the one at the same place (the same line, the same chord in
 * it) in the nearest earlier section of the same kind, with that section's name.
 */
export function placeInSong(doc: SongDoc, lineId: string, pos: number, chordId?: string): { previous: string; earlier: Suggestion | null } {
  let previous = "";
  let earlier: Suggestion | null = null;
  const seen: Array<{ type: string; label: string; lines: string[][] }> = [];
  let verse = 0;
  for (const item of doc.items) {
    if (item.kind !== "section") continue;
    if (item.type === "verse" || item.type === "none") verse++;
    const lyrics = item.lines.filter((line) => line.kind === "lyric");
    const index = lyrics.findIndex((line) => line.id === lineId);
    if (index >= 0) {
      const line = lyrics[index];
      const before = line.chords.filter((chord) => chord.id !== chordId && chord.pos < pos);
      previous = before.at(-1)?.name ?? previous;
      const nth = before.length;
      const like = seen.filter((section) => section.type === item.type).reverse().find((section) => section.lines[index]?.[nth]);
      if (like) earlier = { chord: like.lines[index][nth], why: like.label };
      return { previous, earlier };
    }
    for (const line of lyrics) if (line.chords.length) previous = line.chords.at(-1)!.name;
    seen.push({ type: item.type, label: item.label || autoLabel(item, verse), lines: lyrics.map((line) => line.chords.map((chord) => chord.name)) });
  }
  return { previous, earlier };
}

/**
 * The bubble's row: the song's chords in the order they come, then the rest
 * of the key's, each once; and the one to suggest here, from an earlier
 * section or, failing that, what usually follows the chord before.
 */
export function bubbleRow(options: { key: string; used: string[]; previous: string; earlier: Suggestion | null }): { chords: string[]; hint: Suggestion | null } {
  const next = options.previous ? nextChords(options.previous, options.key || "C")[0] : undefined;
  const hint = options.earlier ?? (next ? { chord: next, why: "usually next" } : null);
  const chords = [...new Set([...options.used, ...chordsInKey(options.key || "C")])];
  if (hint && !chords.includes(hint.chord)) chords.unshift(hint.chord);
  return { chords, hint };
}
