import { describe, expect, it } from "vitest";
import { hasChords, parseChordPro, splitChords, transposeChord, transposeSong } from "../../shared/songs/chordpro.ts";

describe("splitChords", () => {
  it("pairs each chord with the text after it", () => {
    expect(splitChords("[G]Amazing [D/F#]grace")).toEqual([
      { chord: "G", text: "Amazing " },
      { chord: "D/F#", text: "grace" },
    ]);
  });

  it("keeps text before the first chord and chords at the end", () => {
    expect(splitChords("How [C]sweet [G]")).toEqual([
      { chord: null, text: "How " },
      { chord: "C", text: "sweet " },
      { chord: "G", text: "" },
    ]);
  });

  it("returns one plain segment for a line without chords", () => {
    expect(splitChords("the sound")).toEqual([{ chord: null, text: "the sound" }]);
  });
});

describe("parseChordPro", () => {
  it("reads title, key, labelled sections and numbered verses", () => {
    const song = parseChordPro(`{title: Grace}
{key: G}
[G]Amazing grace

{start_of_chorus}
[C]My chains are gone
{end_of_chorus}
Line two of verse two

{soc: Final}
Sing
{eoc}`);
    expect(song.title).toBe("Grace");
    expect(song.key).toBe("G");
    expect(song.sections.map((section) => section.label)).toEqual(["Verse 1", "Chorus", "Verse 2", "Final"]);
    expect(hasChords(song)).toBe(true);
  });

  it("starts a new verse at a blank line, and a chorus paragraph after it becomes a verse", () => {
    const song = parseChordPro("{soc}\nChorus line\n\nAfter the chorus\n{eoc}");
    expect(song.sections.map((section) => [section.kind, section.label])).toEqual([
      ["chorus", "Chorus"],
      ["verse", "Verse 1"],
    ]);
  });

  it("shows comments and skips hash lines and unknown directives", () => {
    const song = parseChordPro("# private\n{c: Slowly}\n{capo: 2}\nWords");
    expect(song.sections[0].lines.map((line) => line.kind)).toEqual(["comment", "lyrics"]);
    expect(hasChords(song)).toBe(false);
  });

  it("takes the key from a meta directive", () => {
    expect(parseChordPro("{meta: key Eb}\nx").key).toBe("Eb");
  });
});

describe("transpose", () => {
  it("moves roots and slash basses, keeping the chord quality", () => {
    expect(transposeChord("G", 2)).toBe("A");
    expect(transposeChord("D/F#", 2)).toBe("E/G#");
    expect(transposeChord("Am7", -2)).toBe("Gm7");
    expect(transposeChord("C", -1)).toBe("B");
  });

  it("keeps flats when the chord is written with flats", () => {
    expect(transposeChord("Bb", 2)).toBe("C");
    expect(transposeChord("Eb", 1)).toBe("E");
    expect(transposeChord("Ab", 1)).toBe("A");
    expect(transposeChord("Db", 2)).toBe("Eb");
  });

  it("leaves non-chords alone and transposes a whole song with its key", () => {
    expect(transposeChord("N.C.", 3)).toBe("N.C.");
    const song = transposeSong(parseChordPro("{key: G}\n[G]One [C]two"), 5);
    expect(song.key).toBe("C");
    expect(song.sections[0].lines[0].segments.map((segment) => segment.chord)).toEqual(["C", "F"]);
  });
});
