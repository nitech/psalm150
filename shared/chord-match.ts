/**
 * Chords from a song found online, laid over a song of ours that has none.
 * Shared by the web client and the desktop (mirrored there by
 * `bun run sync:shared`), so both lay chords the same way. It needs nothing
 * but plain TypeScript.
 *
 * Our words, spelling and verses stay exactly as they are; only chords are
 * added, and `{key}` set or changed. Each of our lines is matched with the
 * online line most like it (in any order, so a different verse order or a
 * chorus written out several times does not matter), and each chord moves to
 * the same word in our line. A line with no line like it online gets no
 * chords rather than a guess. Every line that gets no chords is written back
 * byte for byte, line endings included.
 *
 * The saved `{key}` always fits the saved chords: by default the chords are
 * moved into the song's key; the caller can instead keep the chords and
 * change the song's key to theirs.
 */

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

export interface Chord {
  /** Index into the line's text: the chord sits above this character. */
  pos: number;
  name: string;
}

export interface Lyric {
  text: string;
  chords: Chord[];
}

/* ── ChordPro lines ───────────────────────────────────────────────────── */

const DIRECTIVE = /^\s*\{\s*([A-Za-z_][\w-]*)\s*(?::\s*([\s\S]*?))?\s*\}\s*$/;

/** `[G]Amazing [D]grace` → the words and where each chord sits in them. */
export function parseLyric(source: string): Lyric {
  let text = "";
  const chords: Chord[] = [];
  let index = 0;
  while (index < source.length) {
    const end = source[index] === "[" ? source.indexOf("]", index + 1) : -1;
    if (end > 0) {
      const name = source.slice(index + 1, end).trim();
      if (name) chords.push({ pos: text.length, name });
      index = end + 1;
    } else {
      text += source[index];
      index += 1;
    }
  }
  return { text, chords };
}

/** A lyric line written back with its chords. */
export function lyricSource(line: Lyric): string {
  let out = "";
  let at = 0;
  for (const chord of [...line.chords].sort((a, b) => a.pos - b.pos)) {
    const pos = Math.min(chord.pos, line.text.length);
    out += `${line.text.slice(at, pos)}[${chord.name}]`;
    at = pos;
  }
  return out + line.text.slice(at);
}

interface SourceLine {
  /** The line without its `\r`. */
  body: string;
  /** `\r` when the line ended in CRLF. */
  ending: string;
  /** A lyric line (not a directive, comment, blank or tab/grid line). */
  lyric: boolean;
}

function readLines(source: string): SourceLine[] {
  let inTab = false;
  return source.split("\n").map((raw) => {
    const ending = raw.endsWith("\r") ? "\r" : "";
    const body = ending ? raw.slice(0, -1) : raw;
    const directive = DIRECTIVE.exec(body);
    const name = directive?.[1].toLowerCase() ?? "";
    if (/^(start_of_(tab|grid)|sot|sog)$/.test(name)) inTab = true;
    if (/^(end_of_(tab|grid)|eot|eog)$/.test(name)) inTab = false;
    const lyric = !directive && !inTab && Boolean(body.trim()) && !body.trimStart().startsWith("#");
    return { body, ending, lyric };
  });
}

/** Where a song names `name` (`{key: G}` or `{meta: key=G}`) and the value. */
function findDirective(lines: SourceLine[], name: string): { index: number; value: string; meta: boolean } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const directive = DIRECTIVE.exec(lines[index].body);
    if (!directive) continue;
    const tag = directive[1].toLowerCase();
    const value = (directive[2] ?? "").trim();
    if (tag === name) return { index, value, meta: false };
    const meta = tag === "meta" ? new RegExp(`^${name}\\s*[= ]\\s*(.+)$`, "i").exec(value) : null;
    if (meta) return { index, value: meta[1].trim(), meta: true };
  }
  return null;
}

/** Sets `{key}`: in place where the song names it, else after its header. */
function writeKey(lines: SourceLine[], key: string): void {
  const found = findDirective(lines, "key");
  const ending = lines.find((line) => line.body)?.ending ?? "";
  if (found) {
    lines[found.index].body = found.meta ? `{meta: key=${key}}` : `{key: ${key}}`;
    return;
  }
  // After the leading directives (title, meta), before the first section or lyric.
  let at = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const directive = DIRECTIVE.exec(lines[index].body);
    if (!lines[index].body.trim()) continue;
    if (!directive || /^(start_of_|so[cvbtg]$)/i.test(directive[1])) break;
    at = index + 1;
  }
  lines.splice(at, 0, { body: `{key: ${key}}`, ending, lyric: false });
}

/* ── Keys ─────────────────────────────────────────────────────────────── */

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const PITCH: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, H: 11,
};
const mod12 = (value: number) => ((value % 12) + 12) % 12;

function parseChordName(chord: string): { root: string; quality: string; bass: string } | null {
  const match = /^([A-H](?:#|b)?)(.*?)(?:\/([A-H](?:#|b)?))?$/.exec(chord.trim());
  return match && match[1] in PITCH ? { root: match[1], quality: match[2], bass: match[3] ?? "" } : null;
}

const isMinorKey = (key: string) => /^[A-H](?:#|b)?m(?!aj)/.test(key.trim());

/** Whether a key is written with flats (F, Bb, Dm …). */
function keyUsesFlats(key: string): boolean | null {
  const parsed = parseChordName(key);
  if (!parsed) return null;
  if (parsed.root.includes("b")) return true;
  if (parsed.root.includes("#")) return false;
  return isMinorKey(key) ? ["D", "G", "C", "F"].includes(parsed.root) : parsed.root === "F";
}

/** Moves a chord by semitones, spelled with flats or sharps (or as written, when `flat` is null). */
export function moveChord(chord: string, semitones: number, flat: boolean | null): string {
  const parsed = parseChordName(chord);
  if (!parsed || !mod12(semitones)) return chord;
  const names = flat ?? parsed.root.includes("b") ? FLATS : SHARPS;
  const bass = parsed.bass ? `/${names[mod12(PITCH[parsed.bass] + semitones)]}` : "";
  return names[mod12(PITCH[parsed.root] + semitones)] + parsed.quality + bass;
}

/** A key we can work with (`G`, `F#m`), else null. */
function readKey(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  return key && parseChordName(key) ? key : null;
}

/** The pitch of a key's major scale: a minor key shares its chords with the major a minor third up. */
function majorPitch(key: string): number {
  const pitch = PITCH[parseChordName(key)!.root];
  return isMinorKey(key) ? mod12(pitch + 3) : pitch;
}

/**
 * Semitones from one key's chords to another's, between -5 and +6. A major
 * key and its relative minor are 0 apart: Em and G use the same chords.
 */
export function keySteps(from: string, to: string): number | null {
  if (!readKey(from) || !readKey(to)) return null;
  const steps = mod12(majorPitch(to) - majorPitch(from));
  return steps > 6 ? steps - 12 : steps;
}

/** Steps above the tonic of a major key's chords: I ii iii IV V vi. */
const MAJOR = [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]] as const;
const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

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
 * The key a song's chords are written in. Its `{key}` when the chords agree
 * with it; else the key the chords fit best, as they are what gets moved.
 * With a `{capo}` the chords are shapes and `{key}` is often the key that
 * sounds, so only the chords count.
 */
export function chordKey(source: string): string | null {
  const lines = readLines(source);
  const guessed = guessKey(lines.filter((line) => line.lyric).flatMap((line) => parseLyric(line.body).chords.map((chord) => chord.name)));
  const written = readKey(findDirective(lines, "key")?.value);
  if (Number(findDirective(lines, "capo")?.value)) return guessed;
  if (written && (!guessed || keySteps(written, guessed) === 0)) return written;
  return guessed ?? written;
}

/* ── Words ────────────────────────────────────────────────────────────── */

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
export function moveChordsTo(from: Lyric, text: string): Chord[] {
  const source = wordsOf(from.text);
  const target = wordsOf(text);
  if (!target.length) return [];
  const pairs = alignWords(source, target);
  const mapped = new Map(pairs);
  const chords: Chord[] = [];
  let last = 0;
  for (const chord of [...from.chords].sort((a, b) => a.pos - b.pos)) {
    // The word the chord sits on, or the next one when it sits in a gap.
    const word = source.findIndex((w) => chord.pos < w.end);
    let pos: number;
    if (word < 0) {
      pos = text.length;
    } else {
      let to = mapped.get(word);
      let offset = Math.max(0, chord.pos - source[word].start);
      if (to === undefined) {
        const before = pairs.filter(([s]) => s < word).pop();
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
        offset = 0;
      }
      const goal = target[to];
      pos = goal.start + Math.min(offset, goal.end - goal.start - 1);
    }
    pos = Math.max(pos, last);
    last = pos;
    chords.push({ pos, name: chord.name });
  }
  return chords;
}

/* ── Matching ─────────────────────────────────────────────────────────── */

/**
 * Lays the chords of `online` (ChordPro found online) over `ours`. Our
 * lines that already have chords are left alone. With `choice` "song" (the
 * default) the chords are moved into the song's key; with "online", or when
 * the song has no key, the song's `{key}` becomes the one the chords are in.
 */
export function matchChords(ours: string, online: string, choice: KeyChoice = "song"): ChordMatch {
  const lines = readLines(ours);
  const candidates = readLines(online)
    .filter((line) => line.lyric)
    .map((line) => parseLyric(line.body))
    .filter((line) => line.text.trim() && line.chords.length);
  const songKey = readKey(findDirective(lines, "key")?.value);
  const onlineKey = chordKey(online);
  const takeOnline = Boolean(onlineKey) && (choice === "online" || !songKey);
  const transposed = !takeOnline && songKey && onlineKey ? keySteps(onlineKey, songKey) ?? 0 : 0;
  const flat = keyUsesFlats((takeOnline ? onlineKey : songKey) ?? "");

  let count = 0;
  let matched = 0;
  // Where the last match was online: of equally good lines, the next one wins.
  let near = 0;
  for (const line of lines) {
    if (!line.lyric || line.body.includes("[")) continue;
    count += 1;
    let best: { index: number; score: number } | null = null;
    candidates.forEach((candidate, index) => {
      const score = lineLikeness(line.body, candidate.text);
      const closer = best && score === best.score && Math.abs(index - near) < Math.abs(best.index - near);
      if (score >= LINE_MATCH && (!best || score > best.score || closer)) best = { index, score };
    });
    if (!best) continue;
    const { index } = best;
    near = index + 1;
    const chords = moveChordsTo(candidates[index], line.body).map((chord) => ({
      pos: chord.pos,
      name: transposed ? moveChord(chord.name, transposed, flat) : chord.name,
    }));
    line.body = lyricSource({ text: line.body, chords });
    matched += 1;
  }

  let key = songKey;
  if (takeOnline && matched) {
    writeKey(lines, onlineKey!);
    key = onlineKey;
  }
  return {
    chordpro: lines.map((line) => line.body + line.ending).join("\n"),
    lines: count,
    matched,
    songKey,
    onlineKey,
    key,
    transposed,
    choice: takeOnline ? "online" : "song",
  };
}
