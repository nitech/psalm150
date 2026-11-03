import { describe, expect, it } from "vitest";
import { chordNotes, guitarShapes, parseChord, pianoShapes } from "../../shared/songs/chord-shapes.ts";

const chord = (name: string) => {
  const parsed = parseChord(name);
  if (!parsed) throw new Error(`cannot read ${name}`);
  return parsed;
};
const frets = (name: string) => guitarShapes(chord(name)).map((shape) => shape.frets.map((fret) => (fret < 0 ? "x" : fret)).join(""));

describe("parseChord", () => {
  it("reads the root, the bass and the tones", () => {
    expect(chordNotes(chord("G"))).toEqual(["G", "B", "D"]);
    expect(chordNotes(chord("Gm"))).toEqual(["G", "Bb", "D"]);
    expect(chordNotes(chord("F#m7"))).toEqual(["F#", "A", "C#", "E"]);
    expect(chordNotes(chord("Bbmaj7"))).toEqual(["Bb", "D", "F", "A"]);
    expect(chordNotes(chord("Dsus4"))).toEqual(["D", "G", "A"]);
    expect(chordNotes(chord("Cadd9"))).toEqual(["C", "E", "G", "D"]);
    expect(chordNotes(chord("Bdim7"))).toEqual(["B", "D", "F", "Ab"]);
    expect(chordNotes(chord("D/F#"))).toEqual(["D", "F#", "A"]);
    expect(chordNotes(chord("Am/G"))).toEqual(["G", "A", "C", "E"]);
    expect(chordNotes(chord("Hm"))).toEqual(["B", "D", "F#"]);
    expect(chord("Dadd4").quality).toBe("major add4");
    expect(chord("G7").quality).toBe("dominant seventh");
    expect(chord("Cmaj7").quality).toBe("major seventh");
    expect(chord("Am7").quality).toBe("minor seventh");
    expect(parseChord("N.C.")).toBeNull();
  });
});

describe("guitarShapes", () => {
  it("starts with the usual open chord", () => {
    expect(frets("C")[0]).toBe("x32010");
    expect(frets("G")[0]).toBe("320003");
    expect(frets("D")[0]).toBe("xx0232");
    expect(frets("A")[0]).toBe("x02220");
    expect(frets("E")[0]).toBe("022100");
    expect(frets("Am")[0]).toBe("x02210");
    expect(frets("Em")[0]).toBe("022000");
    expect(frets("Dm")[0]).toBe("xx0231");
    expect(frets("E7")[0]).toBe("020100");
    expect(frets("Cadd9")).toContain("x32033");
    expect(frets("Fmaj7")[0]).toBe("xx3210");
    expect(frets("D/F#")[0]).toBe("200232");
    expect(frets("G/B")[0]).toBe("x20003");
  });

  it("uses a barre where there is no open shape", () => {
    const [f] = guitarShapes(chord("F"));
    expect(f.frets).toEqual([1, 3, 3, 2, 1, 1]);
    expect(f.barre).toEqual({ fret: 1, from: 0, to: 5 });
    expect(f.label).toBe("Barre, fret 1");
    expect(f.fingers).toEqual([1, 3, 4, 2, 1, 1]);
    expect(frets("F#m")[0]).toBe("244222");
  });

  it("goes on to barre chords up the neck", () => {
    expect(frets("C")).toContain("x35553");
    expect(frets("G")).toContain("355433");
    expect(frets("Am")).toContain("577555");
  });

  it("names open shapes and numbers fingers like chord books", () => {
    const [c] = guitarShapes(chord("C"));
    expect(c.label).toBe("Open");
    expect(c.fingers).toEqual([0, 3, 2, 0, 1, 0]);
  });
});

describe("pianoShapes", () => {
  it("gives root position and inversions near middle C", () => {
    const shapes = pianoShapes(chord("C"));
    expect(shapes.map((shape) => shape.label)).toEqual(["Root position", "1st inversion", "2nd inversion"]);
    expect(shapes[0].notes).toEqual([60, 64, 67]);
    expect(shapes[1].notes).toEqual([64, 67, 72]);
    expect(shapes[2].notes).toEqual([55, 60, 64]);
  });

  it("puts a slash chord's bass in the left hand", () => {
    const [shape] = pianoShapes(chord("D/F#"));
    expect(shape.bass! % 12).toBe(6);
    expect(shape.bass!).toBeLessThan(shape.notes[0] - 2);
    expect(shape.bass!).toBeGreaterThan(shape.notes[0] - 15);
  });
});
