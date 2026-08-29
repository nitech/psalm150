import { describe, expect, it } from "vitest";
import type { SongRow } from "../src/api";
import { DEFAULT_SONG_SORT, parseSongSort, sortSongs, toggleSongSort } from "../src/song-sort";

function row(title: string, song_num: number | null, key: string | null): SongRow {
  return {
    id: 0,
    filename: `${title}.pro`,
    title,
    title_sort: title.toUpperCase(),
    song_num,
    key,
    category: null,
    tags: null,
    ccli: null,
    modified_at: null,
    favorite: false,
  };
}

const songs: SongRow[] = [
  row("Bless the Lord", 12, "G"),
  row("amazing grace", 3, null),
  row("Song 10", null, "D"),
  row("Song 9", 100, ""),
  row("Cornerstone", 100, "C"),
];

const titles = (rows: SongRow[]) => rows.map((song) => song.title);

describe("sortSongs", () => {
  it("defaults to title ascending, case-insensitive and numeric-aware", () => {
    expect(titles(sortSongs(songs, DEFAULT_SONG_SORT))).toEqual([
      "amazing grace",
      "Bless the Lord",
      "Cornerstone",
      "Song 9",
      "Song 10",
    ]);
  });

  it("sorts by song number with missing numbers last in both directions", () => {
    expect(titles(sortSongs(songs, { column: "song_num", direction: "asc" }))).toEqual([
      "amazing grace",
      "Bless the Lord",
      "Cornerstone",
      "Song 9",
      "Song 10",
    ]);
    expect(titles(sortSongs(songs, { column: "song_num", direction: "desc" }))).toEqual([
      "Cornerstone",
      "Song 9",
      "Bless the Lord",
      "amazing grace",
      "Song 10",
    ]);
  });

  it("sorts by key, treating empty keys as missing", () => {
    expect(titles(sortSongs(songs, { column: "key", direction: "asc" }))).toEqual([
      "Cornerstone",
      "Song 10",
      "Bless the Lord",
      "amazing grace",
      "Song 9",
    ]);
  });

  it("does not mutate the input", () => {
    const copy = [...songs];
    sortSongs(songs, { column: "key", direction: "desc" });
    expect(songs).toEqual(copy);
  });
});

describe("toggleSongSort", () => {
  it("flips direction on the active column and starts ascending on a new one", () => {
    const byTitleDesc = toggleSongSort(DEFAULT_SONG_SORT, "title");
    expect(byTitleDesc).toEqual({ column: "title", direction: "desc" });
    expect(toggleSongSort(byTitleDesc, "key")).toEqual({ column: "key", direction: "asc" });
  });
});

describe("parseSongSort", () => {
  it("round-trips a valid sort and falls back on garbage", () => {
    const sort = { column: "song_num", direction: "desc" } as const;
    expect(parseSongSort(JSON.stringify(sort))).toEqual(sort);
    expect(parseSongSort(null)).toEqual(DEFAULT_SONG_SORT);
    expect(parseSongSort("{not json")).toEqual(DEFAULT_SONG_SORT);
    expect(parseSongSort(JSON.stringify({ column: "bogus", direction: "asc" }))).toEqual(
      DEFAULT_SONG_SORT,
    );
  });
});
