/**
 * How to play a chord: what its name means (`parseChord`), and the ways to
 * play it on each instrument, easiest first (`guitarShapes`, `pianoShapes`).
 * Pure functions, no DOM; `chord-viewer.ts` draws and plays them.
 */
import { t } from "./i18n.ts";

/** A chord tone: semitones above the root and its scale degree (1, 3, 5, 7, 9…). */
export interface Tone {
  semitones: number;
  degree: number;
  /** A shape may leave it out (the fifth, or a ninth under an eleventh). */
  optional?: boolean;
}

export interface Chord {
  name: string;
  /** The root as a pitch class, C = 0. */
  root: number;
  /** The root as written, e.g. `Bb` or `F#`. */
  rootName: string;
  /** A slash chord's bass as a pitch class (`D/F#` → 6), else null. */
  bass: number | null;
  bassName: string | null;
  tones: Tone[];
  /** "major", "minor seventh", …, for the sheet's subtitle. */
  quality: string;
}

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PITCH = [0, 2, 4, 5, 7, 9, 11];

function readNote(text: string): { pitch: number; letter: number; length: number } | null {
  const match = /^([A-Ha-h])([#♯b♭]?)/.exec(text);
  if (!match) return null;
  const upper = match[1].toUpperCase();
  // H is the German and Nordic B.
  const letter = LETTERS.indexOf(upper === "H" ? "B" : upper);
  const shift = match[2] === "#" || match[2] === "♯" ? 1 : match[2] ? -1 : 0;
  return { pitch: (LETTER_PITCH[letter] + shift + 12) % 12, letter, length: match[0].length };
}

/**
 * What a chord name means, e.g. `G`, `F#m7`, `Bbmaj7`, `Dsus4`, `Cadd9`,
 * `D/F#` or `Asus2/C#`. Null when it does not start with a note.
 */
export function parseChord(name: string): Chord | null {
  const trimmed = name.trim();
  const slash = trimmed.lastIndexOf("/");
  // `6/9` is a chord, not a bass.
  const hasBass = slash > 0 && readNote(trimmed.slice(slash + 1)) !== null && !/6\/9$/.test(trimmed);
  const body = hasBass ? trimmed.slice(0, slash) : trimmed;
  const root = readNote(body);
  if (!root) return null;
  const bass = hasBass ? readNote(trimmed.slice(slash + 1)) : null;
  const rootName = body.slice(0, root.length).replace(/^h/i, "B").replace(/^./, (c) => c.toUpperCase());
  const quality = readQuality(body.slice(root.length).replace(/[()\s]/g, ""));
  return {
    name: trimmed,
    root: root.pitch,
    rootName,
    bass: bass ? bass.pitch : null,
    bassName: bass ? trimmed.slice(slash + 1, slash + 1 + bass.length).replace(/^./, (c) => c.toUpperCase()) : null,
    tones: quality.tones,
    quality: quality.name,
  };
}

/** The tones and the spoken name of a chord suffix such as `m7`, `sus4` or `maj9`. */
function readQuality(suffix: string): { tones: Tone[]; name: string } {
  let rest = suffix;
  const take = (pattern: RegExp) => {
    const match = pattern.exec(rest);
    if (!match) return null;
    rest = rest.slice(match[0].length);
    return match;
  };
  let third: number | null = 4;
  let fifth = 7;
  let seventh: number | null = null;
  const extra: Tone[] = [];
  const words: string[] = [];
  let kind = "major";

  if (take(/^(dim|°|o)(?=$|7|[^a-z])/)) {
    third = 3;
    fifth = 6;
    kind = "diminished";
    if (take(/^7/)) {
      seventh = 9;
      kind = "diminished seventh";
    }
  } else if (take(/^(m7b5|m7-5|ø7?)/)) {
    third = 3;
    fifth = 6;
    seventh = 10;
    kind = "half-diminished";
  } else if (take(/^(aug|\+)(?!\d)/)) {
    fifth = 8;
    kind = "augmented";
  } else if (take(/^(min|mi|m|-)(?!aj)/)) {
    third = 3;
    kind = "minor";
  }

  // The seventh and what it extends to: 7, maj7, 9, maj9, 11, 13, 6, 6/9, 5.
  const major7 = take(/^(maj|ma|M|Δ|j)(?=\d|$)/);
  const number = take(/^(6\/9|69|13|11|9|7|6|5)/)?.[0];
  if (major7) seventh = 11;
  if (number === "5") {
    third = null;
    kind = "power chord";
  } else if (number === "6" || number === "6/9" || number === "69") {
    extra.push({ semitones: 9, degree: 6 });
    if (number !== "6") extra.push({ semitones: 14, degree: 9 });
    words.push(number === "6" ? "sixth" : "six-nine");
  } else if (number) {
    seventh ??= 10;
    if (number === "9" || number === "11" || number === "13") extra.push({ semitones: 14, degree: 9, optional: number !== "9" });
    if (number === "11") extra.push({ semitones: 17, degree: 11 });
    if (number === "13") extra.push({ semitones: 21, degree: 13 });
    words.push(number === "7" ? "seventh" : `${number}th`.replace("9th", "ninth").replace("11th", "eleventh").replace("13th", "thirteenth"));
  } else if (major7) {
    seventh = 11;
    words.push("seventh");
  }
  if (major7 && kind === "major") kind = "major";
  const majorSeventh = seventh === 11 && kind !== "diminished seventh";

  // Changes after it: sus, add, altered fifths and ninths. Anything else is skipped.
  while (rest) {
    if (take(/^sus2/)) {
      third = 2;
      words.push("sus2");
    } else if (take(/^sus4?/)) {
      third = 5;
      words.push("sus4");
    } else if (take(/^(add9|add2|2)/)) {
      extra.push({ semitones: 14, degree: 9 });
      words.push("add9");
    } else if (take(/^(add11|add4|4)/)) {
      extra.push({ semitones: 17, degree: 11 });
      words.push("add4");
    } else if (take(/^(b5|-5)/)) {
      fifth = 6;
      words.push("flat five");
    } else if (take(/^(#5|\+5)/)) {
      fifth = 8;
      words.push("sharp five");
    } else if (take(/^(b9|-9)/)) {
      extra.push({ semitones: 13, degree: 9 });
      words.push("flat nine");
    } else if (take(/^(#9|\+9)/)) {
      extra.push({ semitones: 15, degree: 9 });
      words.push("sharp nine");
    } else if (take(/^#11/)) {
      extra.push({ semitones: 18, degree: 11 });
      words.push("sharp eleven");
    } else if (take(/^b13/)) {
      extra.push({ semitones: 20, degree: 13 });
      words.push("flat thirteen");
    } else {
      rest = rest.slice(1);
    }
  }

  const tones: Tone[] = [{ semitones: 0, degree: 1 }];
  if (third !== null) tones.push({ semitones: third, degree: third === 2 ? 2 : third === 5 ? 4 : 3 });
  // A plain fifth may be left out of a shape; an altered one, or a power chord's, may not.
  tones.push({ semitones: fifth, degree: 5, optional: fifth === 7 && third !== null });
  if (seventh !== null) tones.push({ semitones: seventh, degree: 7 });
  for (const tone of extra) {
    if (!tones.some((t) => t.semitones % 12 === tone.semitones % 12)) tones.push(tone);
  }
  const name = [majorSeventh && kind === "major" ? "major" : kind, ...words]
    .join(" ")
    .replace("major seventh", majorSeventh ? "major seventh" : "dominant seventh")
    .replace(/^major (?=ninth|eleventh|thirteenth)/, majorSeventh ? "major " : "dominant ")
    .replace(/^minor (\w+)/, "minor $1");
  return { tones, name };
}

/** The notes of a chord, spelled for its root: `G B D`, `Bb D F`, `F# A# C#`. */
export function chordNotes(chord: Chord): string[] {
  const root = readNote(chord.rootName)!;
  const names = chord.tones.map((tone) => spell(root.letter, chord.root, tone));
  if (chord.bass !== null && chord.bassName && !chord.tones.some((t) => (chord.root + t.semitones) % 12 === chord.bass)) {
    names.unshift(chord.bassName);
  }
  return names;
}

function spell(rootLetter: number, rootPitch: number, tone: Tone): string {
  const letter = (rootLetter + tone.degree - 1) % 7;
  const pitch = (rootPitch + tone.semitones) % 12;
  let shift = (pitch - LETTER_PITCH[letter] + 12) % 12;
  if (shift > 6) shift -= 12;
  if (Math.abs(shift) > 2) return noteName(pitch, false);
  return LETTERS[letter] + (shift > 0 ? "#".repeat(shift) : "b".repeat(-shift));
}

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function noteName(pitch: number, flats: boolean): string {
  return (flats ? FLATS : SHARPS)[((pitch % 12) + 12) % 12];
}

/* ── Guitar ───────────────────────────────────────────────────────────── */

/**
 * Standard tuning, EADGBE, low E to high E, as MIDI notes. Shapes, drawings
 * and sounds all read it, so another tuning is a change here.
 */
export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64];

export interface GuitarShape {
  /** A fret per string, low E first; 0 is open and -1 is not played. */
  frets: number[];
  /** Which finger presses each string (1 index … 4 little), 0 for none. */
  fingers: number[];
  /** One finger across several strings: its fret and the strings it covers. */
  barre: { fret: number; from: number; to: number } | null;
  /** "Open", "Barre, fret 3", "Fret 5". */
  label: string;
}

interface Candidate {
  frets: number[];
  barre: { fret: number; from: number; to: number } | null;
  score: number;
}

/**
 * Ways to play the chord on a guitar in standard tuning, the most common and
 * easiest first, then barre chords and shapes higher up the neck. Every shape
 * has the chord's bass lowest, every tone it needs, at least four strings,
 * fits four fingers (one may lie across as a barre) and spans four frets.
 */
export function guitarShapes(chord: Chord, limit = 6): GuitarShape[] {
  const pitches = new Set(chord.tones.map((tone) => (chord.root + tone.semitones) % 12));
  const bass = chord.bass ?? chord.root;
  pitches.add(bass);
  const needed = chord.tones.filter((tone) => !tone.optional).map((tone) => (chord.root + tone.semitones) % 12);
  const found = new Map<string, Candidate>();
  const power = chord.tones.length <= 2;

  for (let low = 0; low <= 12; low++) {
    const options = GUITAR_TUNING.map((open) => {
      const choices = [-1];
      for (let fret = low === 0 ? 0 : low; fret <= low + 3; fret++) {
        if (pitches.has((open + fret) % 12)) choices.push(fret);
      }
      // Open strings ring under shapes low on the neck too.
      if (low > 0 && low <= 3 && pitches.has(open % 12)) choices.push(0);
      return choices;
    });
    const frets = new Array<number>(6).fill(-1);
    const walk = (string: number) => {
      if (string === 6) {
        const candidate = judge(frets, bass, needed, power);
        if (candidate) {
          const key = candidate.frets.join(",");
          if (!found.has(key)) found.set(key, candidate);
        }
        return;
      }
      for (const fret of options[string]) {
        frets[string] = fret;
        walk(string + 1);
      }
    };
    walk(0);
  }

  const sorted = [...found.values()].sort((a, b) => a.score - b.score);
  const chosen: Candidate[] = [];
  for (const candidate of sorted) {
    // Leave out a shape that is a better one with strings left out.
    const within = chosen.some((better) =>
      candidate.frets.every((fret, string) => fret === -1 || fret === better.frets[string]),
    );
    if (within) continue;
    chosen.push(candidate);
    if (chosen.length === limit) break;
  }
  return chosen.map((candidate) => ({
    frets: candidate.frets,
    fingers: fingersFor(candidate.frets, candidate.barre),
    barre: candidate.barre,
    label: shapeLabel(candidate),
  }));
}

/** A playable shape and how hard it is (lower is easier), or null. */
function judge(frets: number[], bass: number, needed: number[], power: boolean): Candidate | null {
  const sounding = frets.flatMap((fret, string) => (fret >= 0 ? [string] : []));
  // A power chord is two or three strings; everything else at least four.
  if (sounding.length < (power ? 2 : 4)) return null;
  const lowest = sounding[0];
  const highest = sounding[sounding.length - 1];
  if ((GUITAR_TUNING[lowest] + frets[lowest]) % 12 !== bass) return null;
  const pitches = new Set(sounding.map((string) => (GUITAR_TUNING[string] + frets[string]) % 12));
  if (!needed.every((pitch) => pitches.has(pitch))) return null;
  // Strings left out between played ones are hard to mute. The one exception
  // is the A string under a bass on the low E, which that finger mutes, as in
  // D/F# (2x0232).
  const gaps = frets.slice(lowest, highest).filter((fret) => fret === -1).length;
  if (gaps > 1 || (gaps === 1 && !(lowest === 0 && frets[1] === -1))) return null;

  const pressed = sounding.filter((string) => frets[string] > 0);
  const pressedFrets = pressed.map((string) => frets[string]);
  const minFret = pressedFrets.length ? Math.min(...pressedFrets) : 0;
  const maxFret = pressedFrets.length ? Math.max(...pressedFrets) : 0;
  if (maxFret - minFret > 3) return null;
  // Open strings go with shapes in the first three frets, as open chords.
  const open = sounding.filter((string) => frets[string] === 0).length;
  if (open && maxFret > 3) return null;

  let barre: Candidate["barre"] = null;
  if (pressed.length > 4) {
    const at = pressed.filter((string) => frets[string] === minFret);
    const from = at[0];
    const to = at[at.length - 1];
    if (at.length < 2) return null;
    // Everything under the barre is pressed at its fret or higher.
    for (let string = from; string <= to; string++) if (frets[string] < minFret) return null;
    const above = pressed.filter((string) => frets[string] > minFret).length;
    if (above > 3) return null;
    // A barre to the top string is the usual one; a shorter one is harder.
    barre = { fret: minFret, from, to };
  }

  const position = open ? 0 : minFret;
  let score = position * 1.5;
  if (barre) score += 2 + (barre.to < 5 ? 1 : 0);
  score += pressed.length * 0.6;
  score += (maxFret - minFret) * 0.4;
  score += gaps * 3;
  score -= sounding.length * 1.2;
  score -= open * 0.5;
  // Shapes up the neck are read from a bass on one of the two low strings.
  if (!open && lowest > 1) score += 2;
  // Muted top strings sound thin, except over a power chord.
  if (!power) score += (5 - highest) * 1.2;
  // An open A string over a pressed low E is an odd stretch (F as 10321x).
  if (frets[0] > 0 && frets[1] === 0) score += 3.5;
  // Four fingers over four frets without a barre is a stretch.
  if (!barre && maxFret - minFret === 3) score += 1.5;
  // Strings over a power chord stay muted.
  if (power) score += sounding.length * 2.4;
  // Every chord tone doubled sounds full; a missing fifth sounds thin.
  if (pitches.size < needed.length + 1) score += 0.5;
  return { frets: [...frets], barre, score };
}

function fingersFor(frets: number[], barre: GuitarShape["barre"]): number[] {
  const fingers = frets.map(() => 0);
  const pressed = frets
    .map((fret, string) => ({ fret, string }))
    .filter(({ fret, string }) => fret > 0 && !(barre && fret === barre.fret && string >= barre.from && string <= barre.to));
  pressed.sort((a, b) => a.fret - b.fret || a.string - b.string);
  let next = barre ? 2 : 1;
  for (const { string } of pressed) fingers[string] = Math.min(next++, 4);
  if (barre) for (let string = barre.from; string <= barre.to; string++) if (frets[string] === barre.fret) fingers[string] = 1;
  return fingers;
}

function shapeLabel(candidate: Candidate): string {
  const pressed = candidate.frets.filter((fret) => fret > 0);
  const lowest = pressed.length ? Math.min(...pressed) : 0;
  if (candidate.barre) return t("Barre, fret {fret}", { fret: candidate.barre.fret });
  if (candidate.frets.includes(0)) return t("Open");
  return t("Fret {fret}", { fret: lowest });
}

/** The MIDI notes a guitar shape sounds, low to high. */
export function guitarNotes(shape: GuitarShape): number[] {
  return shape.frets.flatMap((fret, string) => (fret >= 0 ? [GUITAR_TUNING[string] + fret] : []));
}

/* ── Piano ────────────────────────────────────────────────────────────── */

export interface PianoShape {
  /** MIDI notes, low to high. */
  notes: number[];
  /** A slash chord's bass for the left hand, else null. */
  bass: number | null;
  label: string;
}

const INVERSIONS = [
  () => t("Root position"),
  () => t("1st inversion"),
  () => t("2nd inversion"),
  () => t("3rd inversion"),
  () => t("4th inversion"),
];

/**
 * The chord on a piano: in root position first, then its inversions, each
 * with the lowest note as near middle C as it goes. A slash chord's bass is
 * a left-hand note just below (at least a minor third under the hand).
 */
export function pianoShapes(chord: Chord): PianoShape[] {
  // Ninths and above stay above the root; the rest fit in one octave.
  const steps = chord.tones.map((tone) => (tone.semitones >= 12 && chord.tones.length > 4 ? tone.semitones : tone.semitones % 12));
  const base = [...new Set(steps)].sort((a, b) => a - b);
  const rootMidi = 60 + chord.root - (chord.root > 6 ? 12 : 0);
  const shapes: PianoShape[] = [];
  let notes = base.map((step) => rootMidi + step);
  for (let inversion = 0; inversion < Math.min(base.length, INVERSIONS.length); inversion++) {
    // Keep the hand around middle C.
    while (notes[0] > 66) notes = notes.map((note) => note - 12);
    while (notes[0] < 54) notes = notes.map((note) => note + 12);
    // The bass is the nearest note under the hand, so both fit one keyboard.
    let bass = chord.bass === null ? null : notes[0] - 1 - ((notes[0] - 1 - chord.bass + 1200) % 12);
    if (bass !== null && notes[0] - bass < 3) bass -= 12;
    shapes.push({ notes: [...notes], bass, label: INVERSIONS[inversion]() });
    const [first, ...rest] = notes;
    let moved = first + 12;
    while (moved <= rest[rest.length - 1]) moved += 12;
    notes = [...rest, moved];
  }
  return shapes;
}
