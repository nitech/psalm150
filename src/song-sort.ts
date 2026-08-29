import type { SongRow } from "./api";

export type SongSortColumn = "title" | "song_num" | "key";
export type SongSortDirection = "asc" | "desc";

export interface SongSort {
  column: SongSortColumn;
  direction: SongSortDirection;
}

export const DEFAULT_SONG_SORT: SongSort = { column: "title", direction: "asc" };

const SORT_COLUMNS: readonly SongSortColumn[] = ["title", "song_num", "key"];

/** Natural, case-insensitive ordering so "amazing" sorts with "Amazing" and 10 comes after 9. */
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Clicking the active column flips its direction; clicking another column starts ascending. */
export function toggleSongSort(current: SongSort, column: SongSortColumn): SongSort {
  if (current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: "asc" };
}

/** Parse a persisted sort; anything malformed falls back to the default. */
export function parseSongSort(raw: string | null | undefined): SongSort {
  if (!raw) return DEFAULT_SONG_SORT;
  try {
    const value = JSON.parse(raw) as Partial<SongSort> | null;
    if (
      value &&
      SORT_COLUMNS.includes(value.column as SongSortColumn) &&
      (value.direction === "asc" || value.direction === "desc")
    ) {
      return { column: value.column as SongSortColumn, direction: value.direction };
    }
  } catch {
    // Corrupt localStorage entry: ignore it.
  }
  return DEFAULT_SONG_SORT;
}

/**
 * Sorted copy of the rows. Rows without a value for the column go last in both
 * directions; ties fall back to title, then to the incoming order.
 */
export function sortSongs(songs: readonly SongRow[], sort: SongSort): SongRow[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return songs
    .map((song, index) => ({ song, index }))
    .sort((a, b) => {
      const av = columnValue(a.song, sort.column);
      const bv = columnValue(b.song, sort.column);
      if (av == null || bv == null) {
        if (av == null && bv == null) return tieBreak(a, b);
        return av == null ? 1 : -1;
      }
      const primary = compareValues(av, bv) * sign;
      return primary !== 0 ? primary : tieBreak(a, b);
    })
    .map((entry) => entry.song);
}

interface IndexedRow {
  song: SongRow;
  index: number;
}

function tieBreak(a: IndexedRow, b: IndexedRow): number {
  const byTitle = collator.compare(a.song.title, b.song.title);
  return byTitle !== 0 ? byTitle : a.index - b.index;
}

function columnValue(song: SongRow, column: SongSortColumn): string | number | null {
  if (column === "song_num") return song.song_num;
  if (column === "key") {
    const key = song.key?.trim();
    return key ? key : null;
  }
  return song.title;
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}
