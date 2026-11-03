import { describe, expect, it } from "vitest";
import { chordSegments } from "../src/chord-line";

describe("chordSegments", () => {
  it("puts each chord over the words up to the next one", () => {
    expect(
      chordSegments({ text: "Amazing grace", chords: [{ chord: "D", position: 8 }, { chord: "G", position: 0 }] }),
    ).toEqual([
      { chord: "G", text: "Amazing " },
      { chord: "D", text: "grace" },
    ]);
  });

  it("keeps words before the first chord and chords past the end", () => {
    expect(chordSegments({ text: "Blå himmel", chords: [{ chord: "C", position: 4 }, { chord: "F", position: 40 }] })).toEqual([
      { chord: null, text: "Blå " },
      { chord: "C", text: "himmel" },
      { chord: "F", text: "" },
    ]);
  });

  it("transposes the chords", () => {
    expect(chordSegments({ text: "Ord", chords: [{ chord: "G/B", position: 0 }] }, 2)).toEqual([{ chord: "A/C#", text: "Ord" }]);
  });

  it("leaves a line without chords whole", () => {
    expect(chordSegments({ text: "Bare ord", chords: [] })).toEqual([{ chord: null, text: "Bare ord" }]);
  });
});
