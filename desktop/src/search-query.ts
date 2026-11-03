/**
 * The search field doubles as the key filter: `#D` narrows to songs in D and
 * the rest of the text searches as usual. `#` followed by a digit stays a
 * song-number search, as before (keys never start with a digit).
 */

export interface ParsedSearch {
  /** Exact key picked with `#Key`, matched case-insensitively against `keys`. */
  key: string | null;
  /** Text search with the key token removed. */
  text: string;
}

/** The `#…` word the caret is in, when it can still become a key. */
export interface KeyToken {
  start: number;
  end: number;
  /** What follows `#` so far; empty right after typing `#`. */
  partial: string;
}

const KEY_TOKEN = /(^|\s)#([A-Za-z][^\s]*)?(?=\s|$)/g;

export function parseSearch(query: string, keys: readonly string[]): ParsedSearch {
  let key: string | null = null;
  const text = query.replace(KEY_TOKEN, (match, lead: string, value: string | undefined) => {
    if (key !== null || !value) return match;
    const found = keys.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
    if (!found) return match;
    key = found;
    return lead;
  });
  return { key, text: text.replace(/\s+/g, " ").trim() };
}

export function keyTokenAt(query: string, caret: number): KeyToken | null {
  const before = query.slice(0, caret);
  const start = before.lastIndexOf("#");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(query[start - 1])) return null;
  const endMatch = /\s|$/.exec(query.slice(start));
  const end = start + (endMatch?.index ?? query.length - start);
  if (caret > end) return null;
  const partial = query.slice(start + 1, end);
  if (/^\d/.test(partial) || /\s/.test(partial)) return null;
  return { start, end, partial };
}

/** Keys offered for a partial token: prefix matches, in library order. */
export function matchingKeys(keys: readonly string[], partial: string): string[] {
  const lower = partial.toLowerCase();
  return keys.filter((key) => key.toLowerCase().startsWith(lower));
}

/** Replace the token with the chosen key and a trailing space; returns the new caret too. */
export function applyKey(query: string, token: KeyToken, key: string): { query: string; caret: number } {
  const head = `${query.slice(0, token.start)}#${key}`;
  const tail = query.slice(token.end).replace(/^\s*/, "");
  return { query: `${head} ${tail}`, caret: head.length + 1 };
}
