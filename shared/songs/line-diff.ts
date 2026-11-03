/**
 * Line differences between two versions of a song's ChordPro, for the
 * history (song-history.ts). Songs are short, so the longest common
 * subsequence of their lines is found directly.
 *
 * Both the web client and the desktop use this folder as it is.
 */

export interface DiffLine {
  /** Kept, only in the new text (added), or only in the old one (removed). */
  kind: "same" | "added" | "removed";
  text: string;
}

/** What turns `before` into `after`, line by line, removals before additions. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  // lengths[i][j]: the longest common run of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      lines.push({ kind: "removed", text: a[i] });
      i += 1;
    } else {
      lines.push({ kind: "added", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) lines.push({ kind: "removed", text: a[i++] });
  while (j < b.length) lines.push({ kind: "added", text: b[j++] });
  return lines;
}

/** A run of unchanged lines folded away, with how many. */
export interface DiffFold {
  kind: "fold";
  count: number;
}

/**
 * The changes with `context` unchanged lines around each; longer unchanged
 * runs fold into one marker. No changes at all: nothing.
 */
export function withContext(lines: DiffLine[], context = 2): Array<DiffLine | DiffFold> {
  if (!lines.some((line) => line.kind !== "same")) return [];
  const keep = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep[k] = true;
  });
  const out: Array<DiffLine | DiffFold> = [];
  let folded = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (folded) out.push({ kind: "fold", count: folded });
      folded = 0;
      out.push(line);
    } else {
      folded += 1;
    }
  });
  if (folded) out.push({ kind: "fold", count: folded });
  return out;
}
