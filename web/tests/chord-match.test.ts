import { describe, expect, it } from "vitest";
import { chordKey, keySteps, lineLikeness, matchChords, moveChordsTo } from "../src/chord-match.ts";
import { parseDoc, parseLyric } from "../src/chord-doc.ts";

const line = (source: string) => parseLyric(source, 0, []);
const placed = (text: string, chords: { pos: number; name: string }[]) =>
  chords.map((chord) => `${chord.name}@${text.slice(chord.pos).split(" ")[0]}`).join(" ");

describe("lineLikeness", () => {
  it("ignores case, punctuation and accents", () => {
    expect(lineLikeness("Bless the Lord, oh my soul!", "bless the lord oh my soul")).toBe(1);
    expect(lineLikeness("Å min sjel", "A min sjel")).toBe(1);
  });

  it("is low for different lines", () => {
    expect(lineLikeness("The sun comes up", "Worship His holy name")).toBeLessThan(0.3);
  });
});

describe("moveChordsTo", () => {
  it("keeps each chord on its word when the words differ around it", () => {
    const text = "Bless the Lord, O my soul";
    const chords = moveChordsTo(line("[G]Bless the [D]Lord oh my [Em]soul"), text);
    expect(placed(text, chords)).toBe("G@Bless D@Lord, Em@soul");
  });

  it("keeps a chord inside a word as far into it", () => {
    const text = "Amazing grace";
    const chords = moveChordsTo(line("A[G]mazing [C]grace"), text);
    expect(chords.map((c) => c.pos)).toEqual([1, 8]);
  });

  it("puts a chord on a missing word between its neighbours, and one after the words at the end", () => {
    const text = "how sweet that sound";
    const chords = moveChordsTo(line("how [C]sweet the [G]sound [D]"), text);
    expect(placed(text, chords)).toBe("C@sweet G@sound D@");
    expect(chords[2].pos).toBe(text.length);
  });
});

describe("matchChords", () => {
  const ours = `{title: 10000 grunner}
{meta: song_num=858}
{start_of_chorus}
Bless the Lord, O my soul
O my soul
{end_of_chorus}

{start_of_verse}
The sun comes up, it's a new day dawning
A line that is not online
{end_of_verse}
`;
  const online = `{title: 10,000 Reasons}
{key: G}
{start_of_verse}
The [G]sun comes up, it's a [D]new day dawning
{end_of_verse}
{start_of_chorus}
[C]Bless the [G]Lord oh my [D]soul
[C]Oh my [G]soul
{end_of_chorus}
`;

  it("adds chords to our words and nothing else", () => {
    const result = matchChords(ours, online);
    expect(result.lines).toBe(4);
    expect(result.matched).toBe(3);
    expect(result.key).toBe("G");
    expect(result.chordpro).toContain("[C]Bless the [G]Lord, O my [D]soul");
    expect(result.chordpro).toContain("The [G]sun comes up, it's a [D]new day dawning");
    expect(result.chordpro).toContain("\nA line that is not online\n");
    expect(result.chordpro).toContain("{meta: song_num=858}");
    // Our key was missing: it takes the online song's.
    expect(result.chordpro).toMatch(/\{key: G\}/);
  });

  it("moves the chords into our key", () => {
    const result = matchChords(ours.replace("{meta: song_num=858}", "{key: A}"), online);
    expect(result.transposed).toBe(2);
    expect(result.chordpro).toContain("[D]Bless the [A]Lord, O my [E]soul");
  });

  it("leaves lines that already have chords alone", () => {
    const result = matchChords(`{title: X}\n[F]Bless the Lord, O my soul\n`, online);
    expect(result.lines).toBe(0);
    expect(result.chordpro).toContain("[F]Bless the Lord, O my soul");
  });

  it("keeps the song's key by default and can take the online key instead", () => {
    const inA = ours.replace("{meta: song_num=858}", "{key: A}");
    const kept = matchChords(inA, online);
    expect(kept).toMatchObject({ songKey: "A", onlineKey: "G", key: "A", transposed: 2, choice: "song" });
    const taken = matchChords(inA, online, "online");
    expect(taken).toMatchObject({ key: "G", transposed: 0, choice: "online" });
    expect(taken.chordpro).toContain("{key: G}");
    expect(taken.chordpro).not.toContain("{key: A}");
    expect(taken.chordpro).toContain("[C]Bless the [G]Lord, O my [D]soul");
  });

  it("does not move chords between a minor key and its relative major", () => {
    const result = matchChords(ours.replace("{meta: song_num=858}", "{key: Em}"), online);
    expect(result.transposed).toBe(0);
    expect(result.key).toBe("Em");
    expect(result.chordpro).toContain("[C]Bless the [G]Lord, O my [D]soul");
  });
});

describe("keys", () => {
  it("counts a minor key and its relative major as the same chords", () => {
    expect(keySteps("Em", "G")).toBe(0);
    expect(keySteps("G", "A")).toBe(2);
    expect(keySteps("Em", "Am")).toBe(5);
    expect(keySteps("Dm", "F")).toBe(0);
  });

  it("reads the key from the chords when the written key disagrees, or with a capo", () => {
    const keyOf = (...head: string[]) =>
      chordKey(parseDoc([...head, "[C]Bless the [G]Lord oh my [D]soul", "[C]Oh my [G]soul"].join("\n")).doc);
    expect(keyOf("{key: G}")).toBe("G");
    expect(keyOf("{key: Em}")).toBe("Em");
    expect(keyOf("{key: Bb}")).toBe("G");
    expect(keyOf("{key: A}", "{capo: 2}")).toBe("G");
  });
});
