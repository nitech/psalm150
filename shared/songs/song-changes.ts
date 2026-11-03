/**
 * What a song's history shows for each saved version without anyone
 * writing it: a short note made from what changed, like a commit message
 * ("Chords in Chorus", "Key G → A", "Added Bridge"), and the lanes that draw
 * the versions as a graph. Versions follow each other in one line today; a
 * version saved on top of an older one (a translation branching off, say)
 * gets a lane of its own, and the lanes join where they share a version.
 *
 * Both the web client and the desktop use this folder as it is.
 */
import { lineSections } from "./chordpro.ts";
import { t, tn } from "./i18n.ts";
import { diffLines } from "./line-diff.ts";

const DIRECTIVE = /^\s*\{\s*([A-Za-z_][\w-]*)\s*(?::\s*(.*?))?\s*\}\s*$/;
const CHORD = /\[[^\]]*\]/g;

/** Directives that are the song's details rather than its words. */
const DETAILS = new Set([
  "subtitle", "st", "artist", "composer", "lyricist", "copyright", "album", "year",
  "capo", "tempo", "time", "duration", "ccli", "meta", "song_number", "number",
]);

type Kind = "chords" | "words" | "punctuation";

/**
 * A short note for the change from `before` to `after`: what changed and
 * where, the two most telling things at most. `before` is null for the
 * first version.
 */
export function describeChange(before: string | null, after: string): string {
  if (before === null) return t("First version");
  if (before === after) return t("No changes");
  const lines = diffLines(before, after);
  // Only line endings or blank lines differ.
  if (!lines.some((line) => line.kind !== "same")) return t("Spacing");
  const oldSections = lineSections(before);
  const newSections = lineSections(after);

  // Set while walking the changes (in `settle`).
  const meta = { title: null as string | null, oldKey: null as string | null, newKey: null as string | null, keyChanged: false, details: false };
  const kinds = new Map<Kind, string[]>();
  const note = (kind: Kind, section: string) => {
    const list = kinds.get(kind) ?? [];
    if (!list.includes(section)) list.push(section);
    kinds.set(kind, list);
  };
  // Sections there now and not before (or the other way round) are named
  // once as added or removed, not line by line.
  const before_ = new Set(oldSections.filter(Boolean));
  const after_ = new Set(newSections.filter(Boolean));
  const added = [...after_].filter((label) => !before_.has(label));
  const removed = [...before_].filter((label) => !after_.has(label));

  let i = 0;
  let j = 0;
  let run: { removed: Array<{ text: string; section: string }>; added: Array<{ text: string; section: string }> } = { removed: [], added: [] };
  const settle = () => {
    const body = (side: typeof run.removed) => side.filter((line) => {
      const directive = DIRECTIVE.exec(line.text);
      if (!directive) return line.text.trim() !== "";
      const name = directive[1].toLowerCase();
      if (name === "title" || name === "t") meta.title = directive[2] ?? "";
      else if (name === "key") meta.keyChanged = true;
      else if (DETAILS.has(name)) meta.details = true;
      return false;
    });
    for (const line of run.removed) {
      const directive = DIRECTIVE.exec(line.text);
      if (directive?.[1].toLowerCase() === "key") meta.oldKey = directive[2] ?? null;
    }
    for (const line of run.added) {
      const directive = DIRECTIVE.exec(line.text);
      if (directive?.[1].toLowerCase() === "key") meta.newKey = directive[2] ?? null;
    }
    const gone = body(run.removed).filter((line) => !removed.includes(line.section));
    const come = body(run.added).filter((line) => !added.includes(line.section));
    const pairs = Math.min(gone.length, come.length);
    for (let k = 0; k < pairs; k += 1) note(lineChange(gone[k].text, come[k].text), come[k].section);
    for (const line of [...gone.slice(pairs), ...come.slice(pairs)]) note("words", line.section);
    run = { removed: [], added: [] };
  };
  for (const line of lines) {
    if (line.kind === "same") {
      settle();
      i += 1;
      j += 1;
    } else if (line.kind === "removed") {
      run.removed.push({ text: line.text, section: oldSections[i] ?? "" });
      i += 1;
    } else {
      run.added.push({ text: line.text, section: newSections[j] ?? "" });
      j += 1;
    }
  }
  settle();

  const { title, oldKey, newKey, keyChanged, details } = meta;
  const parts: string[] = [];
  if (title !== null) parts.push(title ? t("Renamed “{title}”", { title }) : t("Title"));
  const onlyChords = kinds.has("chords") && !kinds.has("words") && !kinds.has("punctuation") && !added.length && !removed.length;
  if (keyChanged && oldKey && newKey && onlyChords) parts.push(t("Transposed {from} → {to}", { from: oldKey, to: newKey }));
  else if (keyChanged) {
    parts.push(oldKey && newKey ? t("Key {from} → {to}", { from: oldKey, to: newKey }) : newKey ? t("Key {key}", { key: newKey }) : t("Key removed"));
  }
  if (added.length) parts.push(t("Added {sections}", { sections: where(added) }));
  if (removed.length) parts.push(t("Removed {sections}", { sections: where(removed) }));
  for (const kind of ["words", "chords", "punctuation"] as Kind[]) {
    if (kind === "chords" && keyChanged && onlyChords) continue;
    const sections = kinds.get(kind);
    if (sections) parts.push(kindNote(kind, sections.some(Boolean) ? where(sections.filter(Boolean)) : null));
  }
  if (details) parts.push(t("Details"));
  if (!parts.length) return t("Spacing");
  return parts.length > 2 ? `${parts[0]} · ${parts[1]} · …` : parts.join(" · ");
}

/** One line changed into another: its chords only, its words, or only punctuation and capitals. */
function lineChange(before: string, after: string): Kind {
  const words = (line: string) => line.replace(CHORD, "");
  const chords = (line: string) => (line.match(CHORD) ?? []).join(" ");
  if (words(before).trim() === words(after).trim()) return "chords";
  const letters = (line: string) => words(line).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (letters(before) === letters(after) && chords(before) === chords(after)) return "punctuation";
  return "words";
}

/** "Chords in Chorus", or "Chords" when no section is named. */
function kindNote(kind: Kind, sections: string | null): string {
  if (kind === "words") return sections ? t("Words in {sections}", { sections }) : t("Words");
  if (kind === "chords") return sections ? t("Chords in {sections}", { sections }) : t("Chords");
  return sections ? t("Punctuation in {sections}", { sections }) : t("Punctuation");
}

/** "Chorus", "Verse 1 and Chorus", "4 sections". */
function where(sections: string[]): string {
  if (sections.length === 2) return t("{first} and {second}", { first: sections[0], second: sections[1] });
  if (sections.length < 2) return sections.join("");
  const count = sections.length;
  return tn(count, "{n} section", "{n} sections");
}

/** A version and the one it was saved on top of. */
export interface GraphNode {
  id: string;
  parent: string | null;
}

/** How one row of the graph is drawn. Lanes count from 0 at the left. */
export interface GraphRow {
  /** The lane the version's dot is in. */
  lane: number;
  /** Lanes coming down into the dot from the versions above it (saved on top of it). */
  into: number[];
  /** Lanes passing by, top to bottom, waiting for an older version. */
  through: number[];
  /** The line goes on down to the version it was saved on top of. */
  down: boolean;
}

/**
 * Lanes for versions listed newest first, as git draws branches: each
 * version takes the lane that was waiting for it (the first, when several
 * were: there they join) or a free one, and then waits in it for its own
 * parent.
 */
export function revisionGraph(nodes: GraphNode[]): { rows: GraphRow[]; lanes: number } {
  const waiting: Array<string | null> = [];
  let lanes = 1;
  const rows = nodes.map((node) => {
    const into = waiting.flatMap((want, index) => (want === node.id ? [index] : []));
    let lane = into[0] ?? waiting.indexOf(null);
    if (lane < 0) lane = waiting.length;
    const through = waiting.flatMap((want, index) => (want !== null && want !== node.id ? [index] : []));
    for (const index of into) waiting[index] = null;
    waiting[lane] = node.parent;
    while (waiting.length && waiting[waiting.length - 1] === null) waiting.pop();
    lanes = Math.max(lanes, lane + 1, ...through.map((index) => index + 1));
    return { lane, into, through, down: node.parent !== null };
  });
  return { rows, lanes };
}
