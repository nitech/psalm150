import { describe, expect, it } from "vitest";
import { parseDoc } from "../../shared/songs/chord-doc.ts";
import { bubbleRow, nextChords, placeInSong, readChord, rootsFor, songChords } from "../../shared/songs/chord-picker.ts";

describe("readChord", () => {
  it("reads chords typed loosely", () => {
    expect(readChord("F#m")).toBe("F#m");
    expect(readChord("f#m")).toBe("F#m");
    expect(readChord("fiss moll")).toBe("F#m");
    expect(readChord("Fiss-moll")).toBe("F#m");
    expect(readChord("f sharp minor")).toBe("F#m");
    expect(readChord("h7")).toBe("B7");
    expect(readChord("hm")).toBe("Bm");
    expect(readChord("b")).toBe("B");
    expect(readChord("bb")).toBe("Bb");
    expect(readChord("ebm")).toBe("Ebm");
    expect(readChord("e flat")).toBe("Eb");
    expect(readChord("ess dur")).toBe("Eb");
    expect(readChord("c major 7")).toBe("Cmaj7");
    expect(readChord("csus")).toBe("Csus4");
    expect(readChord("c / e")).toBe("C/E");
    expect(readChord("d/f#")).toBe("D/F#");
    expect(readChord("a-")).toBe("Am");
    expect(readChord("g°")).toBe("Gdim");
    expect(readChord("c+")).toBe("Caug");
    expect(readChord("Gadd9")).toBe("Gadd9");
  });
  it("gives up on what is not a chord", () => {
    expect(readChord("")).toBeNull();
    expect(readChord("hello")).toBeNull();
    expect(readChord("x7")).toBeNull();
    expect(readChord("c/e/g")).toBeNull();
  });
});

describe("rootsFor", () => {
  it("spells the roots for the key and marks its scale", () => {
    const f = rootsFor("F");
    expect(f.map((root) => root.name)).toContain("Bb");
    expect(f.filter((root) => root.inKey).map((root) => root.name)).toEqual(["C", "D", "E", "F", "G", "A", "Bb"]);
    expect(rootsFor("Em").filter((root) => root.inKey).map((root) => root.name)).toEqual(["C", "D", "E", "F#", "G", "A", "B"]);
  });
});

describe("suggestions", () => {
  const song = parseDoc(`{key: G}
{start_of_verse}
[G]Amazing [C]grace
[D]How sweet
{end_of_verse}
{start_of_chorus}
[Em]Chorus [B7]line
{end_of_chorus}
{start_of_verse}
Second verse here
How sweet again
{end_of_verse}
`).doc;
  const lines = song.items.flatMap((item) => (item.kind === "section" ? item.lines : []));

  it("finds the chord at the same place in the verse before, and the chord before", () => {
    const second = lines.find((line) => line.text === "Second verse here")!;
    expect(placeInSong(song, second.id, 0)).toEqual({ previous: "B7", earlier: { chord: "G", why: "Verse 1" } });
    expect(placeInSong(song, second.id, 7).earlier).toEqual({ chord: "G", why: "Verse 1" });
  });
  it("follows the usual progressions", () => {
    expect(nextChords("G", "G")).toEqual(["C", "D"]);
    expect(nextChords("D", "G")).toEqual(["G", "Em"]);
    expect(nextChords("Am", "Am")).toEqual(["F", "Dm"]);
  });
  it("puts the song's chords first, then the key's, with one hint", () => {
    const used = songChords(song);
    expect(used).toEqual(["G", "C", "D", "Em", "B7"]);
    expect(bubbleRow({ key: "G", used, previous: "D", earlier: { chord: "G", why: "Verse 1" } })).toEqual({
      chords: ["G", "C", "D", "Em", "B7", "Am", "Bm", "D7", "D/F#"],
      hint: { chord: "G", why: "Verse 1" },
    });
    expect(bubbleRow({ key: "G", used: [], previous: "D", earlier: null }).hint).toEqual({ chord: "G", why: "usually next" });
    expect(bubbleRow({ key: "G", used: [], previous: "", earlier: { chord: "Bb", why: "Verse 1" } }).chords[0]).toBe("Bb");
  });
});
