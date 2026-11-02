/**
 * Just enough ChordPro to show a song on a phone: sections with labels,
 * lyric lines with chords above them, and transposition. It follows the
 * desktop's stanza rules (a blank line starts a new verse unless a section
 * directive follows; `{start_of_*}` starts a labelled section), so the
 * stanzas a musician reads line up with the slides the desktop projects.
 */

import { t } from "./i18n.ts";

export interface ChordSegment {
  chord: string | null;
  text: string;
}

export interface DisplayLine {
  kind: "lyrics" | "comment";
  segments: ChordSegment[];
}

export interface DisplaySection {
  label: string;
  kind: string;
  lines: DisplayLine[];
}

export interface DisplaySong {
  title: string;
  key: string | null;
  sections: DisplaySection[];
}

const SECTION_DEFAULTS: Record<string, () => string> = {
  verse: () => t("Verse"),
  chorus: () => t("Chorus"),
  chorus2: () => t("Chorus 2"),
  bridge: () => t("Bridge"),
  intro: () => t("Intro"),
  pre_chorus: () => t("Pre-Chorus"),
  prechorus: () => t("Pre-Chorus"),
  interlude: () => t("Interlude"),
  outro: () => t("Outro"),
  tab: () => t("Tab"),
  grid: () => t("Grid"),
};

const SHORT_FORMS: Record<string, string> = {
  sov: "start_of_verse",
  eov: "end_of_verse",
  soc: "start_of_chorus",
  eoc: "end_of_chorus",
  sob: "start_of_bridge",
  eob: "end_of_bridge",
  sot: "start_of_tab",
  eot: "end_of_tab",
  sog: "start_of_grid",
  eog: "end_of_grid",
  t: "title",
  st: "subtitle",
  c: "comment",
  ci: "comment_italic",
  cb: "comment_box",
};

const DIRECTIVE = /^\{\s*([A-Za-z_][\w-]*)\s*(?::\s*(.*?))?\s*\}$/;

/** For each section, the source lines (0-based) its words and comments come from. */
const sourceLines = new WeakMap<DisplaySection, number[]>();

export function parseChordPro(source: string): DisplaySong {
  let title = "";
  let key: string | null = null;
  const sections: DisplaySection[] = [];
  let current = null as DisplaySection | null;
  let pendingBlank = false;

  const flush = () => {
    if (current && (current.lines.length || current.kind === "chorus")) sections.push(current);
    current = null;
  };
  const ensure = (): DisplaySection => {
    if (!current) current = { label: "", kind: "verse", lines: [] };
    return current;
  };
  const from = (section: DisplaySection, index: number) => {
    const list = sourceLines.get(section) ?? [];
    list.push(index);
    sourceLines.set(section, list);
  };

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    if (line.startsWith("#")) continue;

    if (!line) {
      pendingBlank = Boolean(current && current.lines.length);
      continue;
    }

    const directive = DIRECTIVE.exec(line);
    if (directive) {
      pendingBlank = false;
      const name = normaliseDirective(directive[1]);
      const value = (directive[2] ?? "").trim();
      if (name === "title") {
        title = value;
      } else if (name === "key") {
        key = value || null;
      } else if (name === "meta") {
        const match = /^key\s*[= ]\s*(.+)$/i.exec(value);
        if (match) key = match[1].trim();
      } else if (name.startsWith("start_of_")) {
        flush();
        const kind = name.slice("start_of_".length);
        current = { label: sectionLabel(value), kind, lines: [] };
      } else if (name.startsWith("end_of_")) {
        flush();
      } else if (name === "comment" || name === "comment_italic" || name === "comment_box") {
        if (value) {
          ensure().lines.push({ kind: "comment", segments: [{ chord: null, text: value }] });
          from(ensure(), index);
        }
      }
      continue;
    }

    if (pendingBlank) {
      // A blank line starts a new verse, unless a section directive follows
      // (then that directive decides).
      pendingBlank = false;
      const previousKind: string = current?.kind ?? "verse";
      flush();
      const keepsKind: boolean = !["chorus", "chorus2", "bridge", "pre_chorus", "prechorus"].includes(previousKind);
      current = { label: "", kind: keepsKind ? previousKind : "verse", lines: [] };
    }
    ensure().lines.push({ kind: "lyrics", segments: splitChords(raw.trimEnd()) });
    from(ensure(), index);
  }
  flush();

  // Unlabelled verses are numbered in order so a leader can call them out.
  let verse = 0;
  for (const section of sections) {
    if (section.kind === "verse" && !section.label) {
      verse += 1;
      section.label = t("Verse {n}", { n: verse });
    } else if (!section.label) {
      section.label = SECTION_DEFAULTS[section.kind]?.() ?? capitalise(section.kind.replace(/_/g, " "));
    }
  }
  return { title, key, sections };
}

/**
 * The section each source line belongs to, as the reader names it
 * ("Verse 2", "Chorus"); "" for lines in none (the title, blank lines).
 */
export function lineSections(source: string): string[] {
  const labels = source.replace(/\r\n?/g, "\n").split("\n").map(() => "");
  for (const section of parseChordPro(source).sections) {
    for (const index of sourceLines.get(section) ?? []) labels[index] = section.label;
  }
  return labels;
}

function normaliseDirective(name: string): string {
  const lower = name.toLowerCase().replace(/-/g, "_");
  return SHORT_FORMS[lower] ?? lower;
}

function sectionLabel(value: string): string {
  const labelled = /^label\s*=\s*"?([^"]*)"?$/i.exec(value);
  if (labelled) return labelled[1].trim();
  return value;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `[G]Amazing [D/F#]grace` → chord/text pairs. */
export function splitChords(line: string): ChordSegment[] {
  const segments: ChordSegment[] = [];
  const pattern = /\[([^\]]*)\]/g;
  let last = 0;
  let chord: string | null = null;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    const text = line.slice(last, match.index);
    if (text || chord !== null) segments.push({ chord, text });
    chord = match[1].trim() || null;
    last = match.index + match[0].length;
  }
  const rest = line.slice(last);
  if (rest || chord !== null || !segments.length) segments.push({ chord, text: rest });
  return segments;
}

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE = /^([A-G])(#|b)?/;

function noteIndex(note: string): number | null {
  const match = NOTE.exec(note);
  if (!match) return null;
  const base = SHARPS.indexOf(match[1]);
  const shift = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return (base + shift + 12) % 12;
}

function transposeNote(note: string, semitones: number, preferFlats: boolean): string {
  const match = NOTE.exec(note);
  if (!match) return note;
  const index = noteIndex(match[0]);
  if (index === null) return note;
  const next = (index + semitones + 120) % 12;
  const names = preferFlats ? FLATS : SHARPS;
  return names[next] + note.slice(match[0].length);
}

/** Transpose one chord symbol, including a slash bass (`D/F#`). */
export function transposeChord(chord: string, semitones: number): string {
  const steps = ((semitones % 12) + 12) % 12;
  if (!steps || !NOTE.test(chord)) return chord;
  const preferFlats = /^[A-G]b/.test(chord) || /\/[A-G]b/.test(chord);
  const [root, bass] = chord.split("/");
  const moved = transposeNote(root, steps, preferFlats);
  return bass !== undefined && NOTE.test(bass)
    ? `${moved}/${transposeNote(bass, steps, preferFlats)}`
    : bass !== undefined
      ? `${moved}/${bass}`
      : moved;
}

export function transposeSong(song: DisplaySong, semitones: number): DisplaySong {
  if (!semitones) return song;
  return {
    title: song.title,
    key: song.key ? transposeChord(song.key, semitones) : null,
    sections: song.sections.map((section) => ({
      ...section,
      lines: section.lines.map((line) => line.kind === "comment" ? line : {
        kind: line.kind,
        segments: line.segments.map((segment) => ({
          chord: segment.chord ? transposeChord(segment.chord, semitones) : null,
          text: segment.text,
        })),
      }),
    })),
  };
}

/** Whether any line carries a chord (hides the chord toggle when not). */
export function hasChords(song: DisplaySong): boolean {
  return song.sections.some((section) => section.lines.some((line) => line.segments.some((segment) => segment.chord)));
}
