/**
 * ChordPro as an editable document: the song editor's model.
 *
 * `parseDoc` turns the source into song details, sections and lines, with
 * every chord kept as a position in its line's text. `serializeDoc` writes
 * it back. Anything the visual editor does not edit (unknown directives,
 * `#` comments, `{meta}` fields it has no field for) is kept as it was, and
 * a line that has not changed is written back exactly as it was read, so
 * opening and saving a song does not change it.
 */

export interface Chord {
  id: string;
  /** Index into the line's text: the chord sits above this character. */
  pos: number;
  name: string;
}

export interface LyricLine {
  id: string;
  kind: "lyric";
  text: string;
  chords: Chord[];
  src?: number;
}

export interface CommentLine {
  id: string;
  kind: "comment";
  /** The directive as written (`c`, `comment`, `ci` …). */
  tag: string;
  text: string;
  /** The text as read, or null for a new comment. */
  orig: string | null;
  raw?: string;
  src?: number;
}

/** A line the visual editor shows but does not edit. */
export interface RawLine {
  id: string;
  kind: "raw";
  text: string;
  src?: number;
  blankBefore?: number;
}

export type Line = LyricLine | CommentLine | RawLine;

export interface Section {
  id: string;
  kind: "section";
  /** `verse`, `chorus` … from `{start_of_*}`; `none` for lines with no section directive. */
  type: string;
  label: string;
  lines: Line[];
  startRaw?: string;
  endRaw?: string;
  origType?: string;
  origLabel?: string;
  src?: number;
  blankBefore?: number;
}

export interface MetaItem {
  id: string;
  kind: "meta";
  key: string;
  value: string;
  orig: string | null;
  tag: string;
  /** `{key: G}` is direct; `{meta: key G}` and `{meta: key=G}` are meta. */
  form: "direct" | "meta";
  sep?: string;
  raw?: string;
  src?: number;
  blankBefore?: number;
}

export type Item = Section | MetaItem | RawLine;

export interface SongDoc {
  items: Item[];
}

export interface Issue {
  line: number;
  message: string;
}

let lastId = 0;
export function newId(): string {
  lastId += 1;
  return `c${lastId}`;
}

const SHORT_FORMS: Record<string, string> = {
  sov: "start_of_verse", eov: "end_of_verse",
  soc: "start_of_chorus", eoc: "end_of_chorus",
  sob: "start_of_bridge", eob: "end_of_bridge",
  sot: "start_of_tab", eot: "end_of_tab",
  sog: "start_of_grid", eog: "end_of_grid",
  t: "title", st: "subtitle",
  c: "comment", ci: "comment_italic", cb: "comment_box",
};
const META_KEYS = new Set(["title", "subtitle", "artist", "author", "composer", "lyricist", "key", "capo", "tempo", "time", "ccli", "copyright", "album", "year", "duration", "number", "song_number", "language", "lang"]);
const COMMENT_KEYS = new Set(["comment", "comment_italic", "comment_box"]);
const DIRECTIVE = /^\{\s*([A-Za-z_][\w-]*)\s*(?::\s*([\s\S]*?))?\s*\}$/;
export const NO_TITLE = "The song has no {title}";

export const SECTION_TYPES: Array<[string, string]> = [
  ["verse", "Verse"],
  ["chorus", "Chorus"],
  ["prechorus", "Pre-chorus"],
  ["bridge", "Bridge"],
  ["intro", "Intro"],
  ["interlude", "Interlude"],
  ["outro", "Outro"],
  ["tag", "Tag"],
  ["none", "Untagged"],
];
const TYPE_NAMES: Record<string, string> = { ...Object.fromEntries(SECTION_TYPES), pre_chorus: "Pre-chorus", chorus2: "Chorus 2" };

export function typeName(type: string): string {
  return TYPE_NAMES[type] ?? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
}

/** The name the reader shows for a section without its own label. */
export function autoLabel(section: Section, verseNumber: number): string {
  return section.type === "verse" || section.type === "none" ? `Verse ${verseNumber}` : typeName(section.type);
}

export function parseLyric(source: string, line: number, issues: Issue[]): LyricLine {
  let text = "";
  const chords: Chord[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "[") {
      const end = source.indexOf("]", index + 1);
      if (end < 0) {
        issues.push({ line, message: "A chord is missing its ]" });
        text += source.slice(index);
        break;
      }
      const name = source.slice(index + 1, end).trim();
      if (name) chords.push({ id: newId(), pos: text.length, name });
      else issues.push({ line, message: "Empty chord []" });
      index = end + 1;
    } else {
      if (char === "]") issues.push({ line, message: "] without [ before it" });
      text += char;
      index += 1;
    }
  }
  return { id: newId(), kind: "lyric", text, chords, src: line };
}

export function parseDoc(source: string): { doc: SongDoc; issues: Issue[] } {
  const issues: Issue[] = [];
  const items: Item[] = [];
  let current: Section | null = null;
  let inSection = false;
  let blank = 0;
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const top = (item: Item) => {
    item.blankBefore = blank;
    blank = 0;
    items.push(item);
  };
  const untagged = (line: number): Section => {
    const section: Section = { id: newId(), kind: "section", type: "none", label: "", lines: [], src: line };
    top(section);
    current = section;
    return section;
  };
  const rawLine = (text: string, line: number) => {
    const item: RawLine = { id: newId(), kind: "raw", text, src: line };
    if (current) current.lines.push(item);
    else top(item);
  };

  lines.forEach((raw, index) => {
    const n = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) {
      if (inSection) current!.lines.push({ id: newId(), kind: "lyric", text: "", chords: [], src: n });
      else {
        current = null;
        blank += 1;
      }
      return;
    }
    if (trimmed.startsWith("#")) return rawLine(raw, n);

    const directive = DIRECTIVE.exec(trimmed);
    if (directive) {
      const tag = directive[1];
      const lower = tag.toLowerCase();
      const name = SHORT_FORMS[lower] ?? lower;
      const value = (directive[2] ?? "").trim();
      const start = /^start_of_(\w+)$/.exec(name);
      if (start) {
        if (inSection) issues.push({ line: current!.src ?? n, message: `{start_of_${current!.type}} is never ended` });
        const labelled = /^label\s*=\s*"(.*)"$/.exec(value);
        const label = labelled ? labelled[1] : value;
        const section: Section = { id: newId(), kind: "section", type: start[1], label, lines: [], startRaw: raw, origType: start[1], origLabel: label, src: n };
        top(section);
        current = section;
        inSection = true;
        return;
      }
      const end = /^end_of_(\w+)$/.exec(name);
      if (end) {
        if (inSection && current!.type === end[1]) {
          current!.endRaw = raw;
        } else if (inSection) {
          issues.push({ line: n, message: `{${tag}} does not match {start_of_${current!.type}} on line ${current!.src}` });
        } else {
          issues.push({ line: n, message: `{${tag}} has no start` });
          return rawLine(raw, n);
        }
        inSection = false;
        current = null;
        return;
      }
      if (COMMENT_KEYS.has(name)) {
        (current ?? untagged(n)).lines.push({ id: newId(), kind: "comment", tag, text: value, orig: value, raw, src: n });
        return;
      }
      if (!current && (META_KEYS.has(name) || name === "meta")) {
        let key = name;
        let val = value;
        let form: MetaItem["form"] = "direct";
        let sep: string | undefined;
        if (name === "meta") {
          const match = /^([^\s=]+)\s*(=|\s)\s*([\s\S]*)$/.exec(value);
          key = (match ? match[1] : value).toLowerCase();
          val = match ? match[3] : "";
          sep = match?.[2] === "=" ? "=" : " ";
          form = "meta";
        }
        top({ id: newId(), kind: "meta", key, value: val, orig: val, tag, form, sep, raw, src: n });
        return;
      }
      return rawLine(raw, n);
    }
    if (trimmed.startsWith("{")) {
      issues.push({ line: n, message: trimmed.includes("}") ? "A directive must be on a line of its own" : "A directive is missing its }" });
      return rawLine(raw, n);
    }
    (current ?? untagged(n)).lines.push(parseLyric(raw, n, issues));
  });

  if (inSection) issues.push({ line: current!.src ?? lines.length, message: `{start_of_${current!.type}} is never ended` });
  if (!items.some((item) => item.kind === "meta" && item.key === "title" && item.value)) issues.push({ line: 1, message: NO_TITLE });
  issues.sort((a, b) => a.line - b.line);
  return { doc: { items }, issues };
}

export function lyricSource(line: LyricLine): string {
  let out = "";
  let at = 0;
  for (const chord of [...line.chords].sort((a, b) => a.pos - b.pos)) {
    const pos = Math.min(chord.pos, line.text.length);
    out += `${line.text.slice(at, pos)}[${chord.name}]`;
    at = pos;
  }
  return out + line.text.slice(at);
}

function lineSource(line: Line): string {
  if (line.kind === "lyric") return lyricSource(line);
  if (line.kind === "comment") return line.raw !== undefined && line.text === line.orig ? line.raw : `{${line.tag}: ${line.text}}`;
  return line.text;
}

export function metaSource(meta: MetaItem): string {
  if (meta.raw !== undefined && meta.value === meta.orig) return meta.raw;
  if (meta.form === "meta") return `{meta: ${meta.key}${meta.sep === "=" ? "=" : " "}${meta.value}}`;
  return `{${meta.tag || meta.key}: ${meta.value}}`;
}

const isEmptyLyric = (line: Line) => line.kind === "lyric" && !line.text.trim() && !line.chords.length;

/**
 * The ChordPro source, and the line number (from 1) each item and line was
 * written to, so the editor can put the cursor in the same place.
 */
export function serializeDoc(doc: SongDoc): { text: string; lines: Record<string, number> } {
  const out: string[] = [];
  const lines: Record<string, number> = {};
  let previous: Item | null = null;
  for (const item of doc.items) {
    // Lines with no section directive are kept apart by a blank line, so
    // an empty one would start a new section; leave it out.
    if (item.kind === "section" && item.type === "none" && item.lines.every(isEmptyLyric)) continue;
    let blank = item.blankBefore ?? (previous ? 1 : 0);
    if (item.kind === "section" && previous?.kind === "section" && (previous.type === "none" || item.type === "none")) blank = Math.max(blank, 1);
    if (!previous) blank = 0;
    for (let i = 0; i < blank; i += 1) out.push("");

    if (item.kind === "meta") {
      out.push(metaSource(item));
      lines[item.id] = out.length;
    } else if (item.kind === "raw") {
      out.push(item.text);
      lines[item.id] = out.length;
    } else {
      const tagged = item.type !== "none";
      if (tagged) {
        const unchanged = item.startRaw !== undefined && item.type === item.origType && item.label === item.origLabel;
        out.push(unchanged ? item.startRaw! : `{start_of_${item.type}${item.label ? `: ${item.label}` : ""}}`);
      }
      lines[item.id] = out.length + (tagged ? 0 : 1);
      for (const line of item.lines) {
        if (!tagged && isEmptyLyric(line)) continue;
        out.push(lineSource(line));
        lines[line.id] = out.length;
      }
      if (tagged) out.push(item.endRaw !== undefined && item.type === item.origType ? item.endRaw : `{end_of_${item.type}}`);
    }
    previous = item;
  }
  return { text: `${out.join("\n")}\n`, lines };
}

/* ── Song details ─────────────────────────────────────────────────────── */

export function findMeta(doc: SongDoc, key: string): MetaItem | undefined {
  return doc.items.find((item): item is MetaItem => item.kind === "meta" && item.key === key);
}

export function metaValue(doc: SongDoc, key: string): string {
  return findMeta(doc, key)?.value ?? "";
}

/** Sets a detail; an empty value removes it (the title stays, even empty). */
export function setMeta(doc: SongDoc, key: string, value: string): void {
  const item = findMeta(doc, key);
  if (item) {
    if (!value && key !== "title") doc.items.splice(doc.items.indexOf(item), 1);
    else item.value = value;
    return;
  }
  if (!value) return;
  let at = 0;
  doc.items.forEach((candidate, index) => { if (candidate.kind === "meta") at = index + 1; });
  doc.items.splice(at, 0, { id: newId(), kind: "meta", key, value, orig: null, tag: key, form: "direct", blankBefore: 0 });
}

/* ── Editing a line ───────────────────────────────────────────────────── */

/**
 * Replaces `text[start, end)` with `insert`. A chord after the edit moves
 * with its text; a chord on removed text moves to where the edit starts.
 */
export function applyEdit(line: LyricLine, start: number, end: number, insert: string): void {
  const shift = insert.length - (end - start);
  for (const chord of line.chords) {
    if (chord.pos < start) continue;
    chord.pos = chord.pos >= end ? chord.pos + shift : start;
  }
  line.text = line.text.slice(0, start) + insert + line.text.slice(end);
}

/** The edit that turns `before` into `after`, found by their common start and end. */
export function diffText(before: string, after: string): { start: number; end: number; insert: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  return { start, end: before.length - tail, insert: after.slice(start, after.length - tail) };
}

export function sortChords(line: LyricLine): void {
  line.chords.sort((a, b) => a.pos - b.pos);
}

/* ── Editing the song as one text ─────────────────────────────────────── */

/** A place in the words: a lyric line and a character boundary in it. */
export interface Point {
  line: string;
  off: number;
}

/** Sections to put in: the first joins the text before the place, the last the text after it. */
export interface Piece {
  type?: string;
  label?: string;
  lines: Line[];
}

export const lyricLine = (text = ""): LyricLine => ({ id: newId(), kind: "lyric", text, chords: [] });

export function findLine(doc: SongDoc, id: string): { section: Section; index: number } | null {
  for (const item of doc.items) {
    if (item.kind !== "section") continue;
    const index = item.lines.findIndex((line) => line.id === id);
    if (index >= 0) return { section: item, index };
  }
  return null;
}

/** The sections in order, without the song details. */
export const sectionsOf = (doc: SongDoc) => doc.items.filter((item): item is Section => item.kind === "section");

const chordCount = (lines: Line[]) => lines.reduce((sum, line) => sum + (line.kind === "lyric" ? line.chords.length : 0), 0);

/** The type a new section gets after `section`: untagged songs stay untagged, others get a verse. */
export const nextType = (section: Section | undefined) => (section?.type === "none" ? "none" : "verse");

/**
 * Replaces the words from `from` to `to` (which may be in different lines
 * and sections) with `pieces`. Within one line, a chord on removed text
 * moves to where the edit starts, as with `applyEdit`; across lines, chords
 * on removed text are lost and counted. Returns the place after the new
 * text, and the number of chords lost.
 */
export function replaceRange(doc: SongDoc, from: Point, to: Point, pieces: Piece[]): { caret: Point; lost: number } {
  const a = findLine(doc, from.line)!;
  const b = findLine(doc, to.line)!;
  const head = a.section.lines[a.index] as LyricLine;
  const last = b.section.lines[b.index] as LyricLine;
  let lost = 0;
  const tailText = last.text.slice(to.off);
  const tailChords = last.chords.filter((chord) => chord.pos >= to.off).map((chord) => ({ ...chord, pos: chord.pos - to.off }));
  let headChords: Chord[];
  if (head === last) {
    headChords = head.chords.filter((chord) => chord.pos < to.off).map((chord) => ({ ...chord, pos: Math.min(chord.pos, from.off) }));
  } else {
    // A chord after the end of the line is on no text, and stays.
    headChords = head.chords.filter((chord) => chord.pos < from.off || (chord.pos === head.text.length && from.off === head.text.length));
    lost += head.chords.length - headChords.length + last.chords.filter((chord) => chord.pos < to.off).length;
  }
  let after: Line[];
  if (a.section === b.section) {
    lost += chordCount(a.section.lines.slice(a.index + 1, b.index));
    after = a.section.lines.slice(b.index + 1);
  } else {
    lost += chordCount(a.section.lines.slice(a.index + 1)) + chordCount(b.section.lines.slice(0, b.index));
    after = b.section.lines.slice(b.index + 1);
    // Sections (and unknown lines) between go; song details between stay.
    const between = new Set<Item>(doc.items.slice(doc.items.indexOf(a.section) + 1, doc.items.indexOf(b.section) + 1).filter((item) => item.kind !== "meta"));
    between.forEach((item) => { if (item.kind === "section" && item !== b.section) lost += chordCount(item.lines); });
    doc.items = doc.items.filter((item) => !between.has(item));
  }
  const before = a.section.lines.slice(0, a.index);
  const parts = (pieces.length ? pieces : [{ lines: [] }]).map((piece) => ({ ...piece, lines: [...piece.lines] }));
  for (const part of parts) {
    if (part.lines[0]?.kind !== "lyric") part.lines.unshift(lyricLine());
    if (part.lines[part.lines.length - 1].kind !== "lyric") part.lines.push(lyricLine());
  }
  // The text before the place joins the first new line, which keeps its line's id.
  const first = parts[0].lines[0] as LyricLine;
  const headText = head.text.slice(0, from.off);
  head.chords = [...headChords, ...first.chords.map((chord) => ({ ...chord, pos: chord.pos + headText.length }))];
  head.text = headText + first.text;
  parts[0].lines[0] = head;
  const end = parts[parts.length - 1].lines;
  const tail = end[end.length - 1] as LyricLine;
  const caret = { line: tail.id, off: tail.text.length };
  tail.chords = [...tail.chords, ...tailChords.map((chord) => ({ ...chord, pos: chord.pos + caret.off }))];
  tail.text += tailText;
  sortChords(head);
  sortChords(tail);

  if (parts.length === 1) {
    a.section.lines = [...before, ...parts[0].lines, ...after];
  } else {
    if (!before.length && !headText && parts[0].type) {
      a.section.type = parts[0].type;
      a.section.label = parts[0].label ?? "";
    }
    a.section.lines = [...before, ...parts[0].lines];
    const added = parts.slice(1).map((part, index): Section => ({
      id: newId(),
      kind: "section",
      type: part.type ?? nextType(a.section),
      label: part.label ?? "",
      lines: index === parts.length - 2 ? [...part.lines, ...after] : part.lines,
      blankBefore: 1,
    }));
    doc.items.splice(doc.items.indexOf(a.section) + 1, 0, ...added);
  }
  return { caret, lost };
}

/** Ends a section at an empty line: the line goes, and the lines after it start a new section. Null at a section's first line. */
export function splitSection(doc: SongDoc, lineId: string): Point | null {
  const found = findLine(doc, lineId);
  if (!found || found.index === 0) return null;
  const { section, index } = found;
  const rest = section.lines.slice(index + 1);
  section.lines = section.lines.slice(0, index);
  if (rest[0]?.kind !== "lyric") rest.unshift(lyricLine());
  const added: Section = { id: newId(), kind: "section", type: nextType(section), label: "", lines: rest, blankBefore: 1 };
  doc.items.splice(doc.items.indexOf(section) + 1, 0, added);
  return { line: rest[0].id, off: 0 };
}

/** Joins a section to the section just before it, its lines as they are. False when no section is just before. */
export function joinSection(doc: SongDoc, sectionId: string): boolean {
  const index = doc.items.findIndex((item) => item.id === sectionId);
  let before = index - 1;
  while (before >= 0 && doc.items[before].kind === "meta") before -= 1;
  const section = doc.items[index];
  const previous = doc.items[before];
  if (section?.kind !== "section" || previous?.kind !== "section") return false;
  previous.lines.push(...section.lines);
  doc.items.splice(index, 1);
  return true;
}

/** After sections move, keeps a blank line between a section and its neighbours. */
export function spaceSections(doc: SongDoc): void {
  let previous: Item | null = null;
  for (const item of doc.items) {
    if (previous && item.kind !== "meta" && (item.kind === "section" || previous.kind === "section")) item.blankBefore = Math.max(item.blankBefore ?? 1, 1);
    previous = item;
  }
}

/** A copy of lines with new ids, for putting them in again. */
export function copyLines(lines: Line[]): Line[] {
  return lines.map((line): Line => line.kind === "lyric"
    ? { id: newId(), kind: "lyric", text: line.text, chords: line.chords.map((chord) => ({ ...chord, id: newId() })) }
    : { ...line, id: newId(), src: undefined });
}

/** The words and chords from `from` to `to`, as pieces to put in again. */
export function copyPieces(doc: SongDoc, from: Point, to: Point): Piece[] {
  const sections = sectionsOf(doc);
  const a = findLine(doc, from.line)!;
  const b = findLine(doc, to.line)!;
  const clip = (line: Line, lo: number, hi: number) => {
    if (line.kind !== "lyric") return;
    line.chords = line.chords.filter((chord) => chord.pos >= lo && chord.pos < hi).map((chord) => ({ ...chord, pos: chord.pos - lo }));
    line.text = line.text.slice(lo, hi);
  };
  const pieces: Piece[] = [];
  for (let s = sections.indexOf(a.section); s <= sections.indexOf(b.section); s += 1) {
    const section = sections[s];
    const start = section === a.section ? a.index : 0;
    const end = section === b.section ? b.index : section.lines.length - 1;
    const lines = copyLines(section.lines.slice(start, end + 1));
    if (section === b.section) clip(lines[lines.length - 1], 0, to.off);
    if (section === a.section) clip(lines[0], from.off, Infinity);
    pieces.push({ type: section.type, label: section.label, lines });
  }
  return pieces;
}

/** Pieces as plain words: a line each, and a blank line between sections. */
export function piecesText(pieces: Piece[]): string {
  return pieces.map((piece) => piece.lines.filter((line) => line.kind === "lyric").map((line) => (line as LyricLine).text).join("\n")).join("\n\n");
}

/* ── Chords and keys ──────────────────────────────────────────────────── */

const NOTE_INDEX: Record<string, number> = { C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11 };
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
export const MAJOR_KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const MINOR_KEYS = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

/** What a chord can look like; anything else still saves, with a warning. */
export const CHORD_PATTERN = /^(?:[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add|M|\d|\+|-|\(|\)|#|b|°|ø)*(?:\/[A-G](?:#|b)?)?|N\.?C\.?)$/;

const mod12 = (value: number) => ((value % 12) + 12) % 12;
const noteName = (index: number, flat: boolean) => (flat ? FLATS : SHARPS)[mod12(index)];

export function parseChordName(chord: string): { root: string; quality: string; bass: string } | null {
  const match = /^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/.exec(chord.trim());
  return match ? { root: match[1], quality: match[2], bass: match[3] ?? "" } : null;
}

export const isMinorKey = (key: string) => /^[A-G](?:#|b)?m(?!aj)/.test(key);

/** Whether a key is written with flats (F, Bb, Dm …); null for no key. */
export function keyUsesFlats(key: string): boolean | null {
  const parsed = parseChordName(key);
  if (!parsed) return null;
  if (parsed.root.includes("b")) return true;
  if (parsed.root.includes("#")) return false;
  return isMinorKey(key) ? ["D", "G", "C", "F"].includes(parsed.root) : parsed.root === "F";
}

/** Moves a chord by semitones, spelled with flats or sharps (or as it was written, when `flat` is null). */
export function moveChord(chord: string, semitones: number, flat: boolean | null): string {
  const parsed = parseChordName(chord);
  if (!parsed) return chord;
  const useFlats = flat ?? parsed.root.includes("b");
  const bass = parsed.bass ? `/${noteName(NOTE_INDEX[parsed.bass] + semitones, useFlats)}` : "";
  return noteName(NOTE_INDEX[parsed.root] + semitones, useFlats) + parsed.quality + bass;
}

export function moveKey(key: string, semitones: number): string {
  const parsed = parseChordName(key);
  if (!parsed) return key;
  const index = mod12(NOTE_INDEX[parsed.root] + semitones);
  return isMinorKey(key) ? MINOR_KEYS[index].slice(0, -1) + parsed.quality : MAJOR_KEYS[index] + parsed.quality;
}

/** Semitones from one key to another, between -5 and +6; null when either is not a key. */
export function keyDistance(from: string, to: string): number | null {
  const a = parseChordName(from);
  const b = parseChordName(to);
  if (!a || !b) return null;
  const steps = mod12(NOTE_INDEX[b.root] - NOTE_INDEX[a.root]);
  return steps > 6 ? steps - 12 : steps;
}

/** Moves every chord in the song; the key moves too when `withKey`. */
export function transposeDoc(doc: SongDoc, semitones: number, withKey: boolean): void {
  const key = findMeta(doc, "key");
  if (withKey && key && parseChordName(key.value)) key.value = moveKey(key.value, semitones);
  const flat = key ? keyUsesFlats(key.value) : null;
  for (const item of doc.items) {
    if (item.kind !== "section") continue;
    for (const line of item.lines) {
      if (line.kind === "lyric") line.chords.forEach((chord) => { chord.name = moveChord(chord.name, semitones, flat); });
    }
  }
}

/** The chords that belong to a key, the ones a song in it mostly uses. */
export function chordsInKey(key: string): string[] {
  const parsed = parseChordName(key) ?? { root: "C", quality: "", bass: "" };
  const root = NOTE_INDEX[parsed.root];
  const flat = keyUsesFlats(key) ?? false;
  const steps: Array<[number, string]> = isMinorKey(key)
    ? [[0, "m"], [3, ""], [5, "m"], [7, "m"], [7, ""], [8, ""], [10, ""]]
    : [[0, ""], [2, "m"], [4, "m"], [5, ""], [7, ""], [9, "m"], [7, "7"]];
  const chords = steps.map(([step, quality]) => noteName(root + step, flat) + quality);
  if (!isMinorKey(key)) chords.push(`${noteName(root + 7, flat)}/${noteName(root + 11, flat)}`);
  return [...new Set(chords)];
}

export function chordVariants(root: string, key: string): string[] {
  const flat = keyUsesFlats(key) ?? root.includes("b");
  return [root, `${root}m`, `${root}7`, `${root}maj7`, `${root}sus4`, `${root}sus2`, `${root}add9`, `${root}/${noteName(NOTE_INDEX[root] + 4, flat)}`];
}

/* ── Pasted text with chords over the lyrics ──────────────────────────── */

const isChordLine = (line: string) => {
  const trimmed = line.trim();
  return Boolean(trimmed) && trimmed.split(/\s+/).every((word) => CHORD_PATTERN.test(word) || word === "|" || word === "-");
};
const HEADINGS: Array<[RegExp, string]> = [
  [/^(verse|vers)$/i, "verse"],
  [/^(chorus|refreng|kor)$/i, "chorus"],
  [/^(pre-?chorus|pre-?refreng)$/i, "prechorus"],
  [/^(bridge|bro)$/i, "bridge"],
  [/^intro$/i, "intro"],
  [/^outro$/i, "outro"],
  [/^(interlude|mellomspill)$/i, "interlude"],
  [/^tag$/i, "tag"],
];
function headingType(line: string): string | null {
  const match = /^\[?\s*([A-Za-zæøåÆØÅ-]+)\s*\d*\s*\]?\s*:?$/.exec(line.trim());
  if (!match) return null;
  return HEADINGS.find(([pattern]) => pattern.test(match[1]))?.[1] ?? null;
}

/**
 * Plain text as sections of lines. A line of chords over a line of words
 * becomes one line with the chords in place; headings such as "Chorus"
 * start a section of that type, and a blank line starts a new one.
 */
export interface PastedSection {
  type: string;
  /** Started by a heading such as "Chorus" rather than by a blank line. */
  headed: boolean;
  lines: LyricLine[];
}

export function convertPlain(source: string): { sections: PastedSection[]; converted: number } {
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const sections: PastedSection[] = [];
  let current: PastedSection | null = null;
  let converted = 0;
  const ensure = () => {
    if (!current) {
      current = { type: "verse", headed: false, lines: [] };
      sections.push(current);
    }
    return current;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      current = null;
      continue;
    }
    const heading = headingType(line);
    if (heading) {
      current = { type: heading, headed: true, lines: [] };
      sections.push(current);
      continue;
    }
    if (isChordLine(line)) {
      const tokens = [...line.matchAll(/\S+/g)].filter((match) => CHORD_PATTERN.test(match[0]));
      const chords = () => tokens.map((match) => ({ id: newId(), pos: match.index!, name: match[0] }));
      const next = lines[index + 1];
      converted += 1;
      if (next !== undefined && next.trim() && !isChordLine(next) && !headingType(next)) {
        const widest = Math.max(...tokens.map((match) => match.index!));
        ensure().lines.push({ id: newId(), kind: "lyric", text: next.trimEnd().padEnd(widest, " "), chords: chords() });
        index += 1;
      } else {
        ensure().lines.push({ id: newId(), kind: "lyric", text: " ".repeat(tokens[tokens.length - 1].index!), chords: chords() });
      }
      continue;
    }
    ensure().lines.push(parseLyric(line.trimEnd(), 0, []));
  }
  return { sections, converted };
}
