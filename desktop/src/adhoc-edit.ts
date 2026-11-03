import type { ChordPlacement, LyricLine, SongSection } from "./api";
import { sourceLineKey } from "./performance-sections";

export interface LineEdit {
  sectionIndex: number;
  lineIndex: number;
  text: string;
}

export interface PendingLineEdit {
  original: string;
  text: string;
}

export type PendingEdits = Map<string, PendingLineEdit>;

export function formatLyricLineForRaw(line: LyricLine): string {
  if (line.chords.length === 0) return line.text;
  let rendered = line.text;
  let offset = 0;
  for (const chord of line.chords) {
    const pos = chord.position + offset;
    const byteIdx = charIndexToByte(rendered, pos);
    const insert = `[${chord.chord}]`;
    rendered = rendered.slice(0, byteIdx) + insert + rendered.slice(byteIdx);
    offset += insert.length;
  }
  return rendered;
}

function charIndexToByte(value: string, charIndex: number): number {
  let count = 0;
  for (const [index] of [...value].entries()) {
    if (count === charIndex) return index;
    count++;
  }
  return value.length;
}

function isBlankLine(line: LyricLine): boolean {
  return !line.text && line.chords.length === 0;
}

function parseChordLine(line: string): LyricLine {
  const chords: ChordPlacement[] = [];
  let text = "";
  let last = 0;
  const re = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    text += line.slice(last, match.index);
    chords.push({ chord: match[1], position: [...text].length });
    last = match.index + match[0].length;
  }
  text += line.slice(last);
  return { text, chords };
}

type DirectiveKind =
  | "verse"
  | "chorus"
  | "chorus2"
  | "bridge"
  | "intro"
  | "pre_chorus"
  | "interlude"
  | "other";

function directiveBaseName(directive: string): string {
  return directive.split(":")[0]?.trim() ?? directive.trim();
}

function kindFromDirective(directive: string): DirectiveKind | null {
  switch (directiveBaseName(directive)) {
    case "start_of_verse":
    case "sov":
      return "verse";
    case "start_of_chorus":
    case "soc":
      return "chorus";
    case "start_of_chorus2":
      return "chorus2";
    case "start_of_bridge":
    case "sob":
      return "bridge";
    case "start_of_intro":
      return "intro";
    case "start_of_prechorus":
      return "pre_chorus";
    case "start_of_interlude":
      return "interlude";
    default:
      return null;
  }
}

/**
 * Apply pending line edits to ChordPro raw text, preserving directives and
 * chord markup on edited lines.
 */
export function patchChordProRaw(raw: string, sections: SongSection[], edits: PendingEdits): string {
  if (edits.size === 0) return raw;

  const editLookup = new Map<string, string>();
  for (const [key, edit] of edits) {
    if (edit.text !== edit.original) {
      editLookup.set(key, edit.text);
    }
  }
  if (editLookup.size === 0) return raw;

  const lines = raw.split(/\r?\n/);
  const output: string[] = [];
  let sectionIndex = -1;
  let lineIndex = -1;
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const inner = trimmed.slice(1, -1);
      const directive = inner.split(":")[0]?.trim() ?? inner.trim();
      const sectionKind = kindFromDirective(directive);
      if (sectionKind) {
        sectionIndex += 1;
        lineIndex = -1;
        inSection = true;
        output.push(line);
        continue;
      }
      output.push(line);
      continue;
    }

    if (!inSection || sectionIndex < 0) {
      output.push(line);
      continue;
    }

    if (trimmed === "") {
      output.push(line);
      continue;
    }

    lineIndex += 1;
    const key = sourceLineKey(sectionIndex, lineIndex);
    const newText = editLookup.get(key);
    if (newText == null) {
      output.push(line);
      continue;
    }

    const section = sections[sectionIndex];
    const parsedLine = section?.lines[lineIndex] ?? parseChordLine(trimmed);
    const updated: LyricLine = { text: newText, chords: parsedLine.chords };
    output.push(formatLyricLineForRaw(updated));
  }

  return output.join("\n");
}

/** Word-level diff segments for highlighting changed text. */
export interface DiffSegment {
  text: string;
  changed: boolean;
}

export function diffLineSegments(original: string, current: string): DiffSegment[] {
  if (original === current) return [{ text: current, changed: false }];
  if (!original) return [{ text: current, changed: true }];
  if (!current) return [{ text: current, changed: true }];

  const origWords = original.split(/(\s+)/);
  const currWords = current.split(/(\s+)/);

  const m = origWords.length;
  const n = currWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        origWords[i - 1] === currWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const segments: DiffSegment[] = [];
  let i = m;
  let j = n;
  const reversed: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origWords[i - 1] === currWords[j - 1]) {
      reversed.push({ text: origWords[i - 1], changed: false });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ text: currWords[j - 1], changed: true });
      j--;
    } else {
      i--;
    }
  }

  reversed.reverse();
  for (const segment of reversed) {
    const last = segments[segments.length - 1];
    if (last && last.changed === segment.changed) {
      last.text += segment.text;
    } else {
      segments.push({ ...segment });
    }
  }

  return segments.length > 0 ? segments : [{ text: current, changed: true }];
}

export function applyPendingEditsToLineText(
  sectionIndex: number,
  lineIndex: number,
  originalText: string,
  pendingEdits: PendingEdits,
): string {
  const edit = pendingEdits.get(sourceLineKey(sectionIndex, lineIndex));
  return edit?.text ?? originalText;
}

export function collectLineEdits(pendingEdits: PendingEdits): LineEdit[] {
  const edits: LineEdit[] = [];
  for (const [key, edit] of pendingEdits) {
    if (edit.text === edit.original) continue;
    const [sectionIndex, lineIndex] = key.split(":").map(Number);
    edits.push({ sectionIndex, lineIndex, text: edit.text });
  }
  return edits;
}

export function hasPendingEdits(pendingEdits: PendingEdits): boolean {
  for (const edit of pendingEdits.values()) {
    if (edit.text !== edit.original) return true;
  }
  return false;
}

export function lineIsBlank(line: LyricLine): boolean {
  return isBlankLine(line);
}
