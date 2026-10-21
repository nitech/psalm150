import { describe, expect, it } from "vitest";
import {
  applyEdit,
  chordsInKey,
  convertPlain,
  copyPieces,
  joinSection,
  lyricLine,
  piecesText,
  replaceRange,
  sectionsOf,
  splitSection,
  diffText,
  keyDistance,
  lyricSource,
  metaValue,
  moveChord,
  parseDoc,
  serializeDoc,
  setMeta,
  transposeDoc,
  type LyricLine,
  type Section,
  type SongDoc,
} from "../src/chord-doc.ts";

const SONG = `{title: Amazing Grace}
{author: John Newton}
{key: G}
{meta: song_num=227}
# Arrangement: quiet start

{start_of_intro}
[G]   [C]   [G]   [D]
{end_of_intro}

{sov}
A[G]mazing [G7]grace, how [C]sweet the [G]sound
{c: Piano only}
That [G]saved a wretch like [D]me
{eov}

{start_of_verse: label="Last verse"}
When [G]we've been [G7]there
{end_of_verse}

Plain lines with no section
and a second one

{x_pres_transition: fade}
`;

const sections = (source: string) => parseDoc(source).doc.items.filter((item): item is Section => item.kind === "section");

describe("parseDoc and serializeDoc", () => {
  it("give back the same text when nothing changed", () => {
    expect(serializeDoc(parseDoc(SONG).doc).text).toBe(SONG);
  });

  it("read chords as positions in the line's text", () => {
    const line = sections(SONG)[1].lines[0] as LyricLine;
    expect(line.text).toBe("Amazing grace, how sweet the sound");
    expect(line.chords.map((chord) => [chord.pos, chord.name])).toEqual([[1, "G"], [8, "G7"], [19, "C"], [29, "G"]]);
  });

  it("read section types, labels and untagged lines", () => {
    expect(sections(SONG).map((section) => [section.type, section.label])).toEqual([
      ["intro", ""], ["verse", ""], ["verse", "Last verse"], ["none", ""],
    ]);
  });

  it("write a changed section with long-form directives", () => {
    const { doc } = parseDoc("{title: X}\n\n{soc}\n[C]Hi\n{eoc}\n");
    const chorus = doc.items[1] as Section;
    chorus.type = "bridge";
    expect(serializeDoc(doc).text).toBe("{title: X}\n\n{start_of_bridge}\n[C]Hi\n{end_of_bridge}\n");
  });

  it("write a changed {meta} field in its own form", () => {
    const { doc } = parseDoc(SONG);
    setMeta(doc, "song_num", "300");
    expect(serializeDoc(doc).text).toContain("{meta: song_num=300}");
  });

  it("add and remove song details", () => {
    const { doc } = parseDoc("{title: X}\n\n{sov}\nHi\n{eov}\n");
    setMeta(doc, "capo", "2");
    expect(serializeDoc(doc).text).toBe("{title: X}\n{capo: 2}\n\n{sov}\nHi\n{eov}\n");
    setMeta(doc, "capo", "");
    expect(metaValue(doc, "capo")).toBe("");
    expect(serializeDoc(doc).text).toBe("{title: X}\n\n{sov}\nHi\n{eov}\n");
  });

  it("report unfinished sections and broken chords", () => {
    const { issues } = parseDoc("{title: X}\n{sov}\n[G Hello\n");
    expect(issues.map((issue) => issue.line)).toEqual([2, 3]);
  });

  it("map items to the lines they were written to", () => {
    const { doc } = parseDoc(SONG);
    const verse = sections(SONG).length && (doc.items.filter((item) => item.kind === "section")[1] as Section);
    expect(serializeDoc(doc).lines[verse.lines[0].id]).toBe(12);
  });
});

describe("applyEdit", () => {
  const line = (): LyricLine => ({ id: "l", kind: "lyric", text: "Amazing grace", chords: [{ id: "a", pos: 0, name: "G" }, { id: "b", pos: 8, name: "D" }] });

  it("moves chords after typed text along with it", () => {
    const l = line();
    applyEdit(l, 7, 7, " sweet");
    expect(lyricSource(l)).toBe("[G]Amazing sweet [D]grace");
  });

  it("moves chords on deleted text to where the deletion starts", () => {
    const l = line();
    applyEdit(l, 6, 10, "");
    expect(lyricSource(l)).toBe("[G]Amazin[D]ace");
  });

  it("finds the edit between two texts", () => {
    expect(diffText("Amazing grace", "Amazing, grace")).toEqual({ start: 7, end: 7, insert: "," });
  });
});

describe("keys and chords", () => {
  it("moves chords, keeping slash basses", () => {
    expect(moveChord("D/F#", 2, false)).toBe("E/G#");
    expect(moveChord("G", 3, true)).toBe("Bb");
  });

  it("transposes the song and its key", () => {
    const { doc } = parseDoc("{title: X}\n{key: G}\n\n{sov}\n[G]Hi [D/F#]there\n{eov}\n");
    transposeDoc(doc, 3, true);
    expect(serializeDoc(doc).text).toContain("{key: Bb}");
    expect(serializeDoc(doc).text).toContain("[Bb]Hi [F/A]there");
  });

  it("measures the distance between keys", () => {
    expect(keyDistance("G", "A")).toBe(2);
    expect(keyDistance("G", "E")).toBe(-3);
  });

  it("lists the chords in a key", () => {
    expect(chordsInKey("G")).toEqual(["G", "Am", "Bm", "C", "D", "Em", "D7", "D/F#"]);
    expect(chordsInKey("Am")).toEqual(["Am", "C", "Dm", "Em", "E", "F", "G"]);
  });
});

describe("convertPlain", () => {
  it("puts chords written over the words into the line", () => {
    const { sections: result, converted } = convertPlain("Chorus\nG         D\nDeilig er jorden\n\nSecond verse here");
    expect(converted).toBe(1);
    expect(result.map((section) => section.type)).toEqual(["chorus", "verse"]);
    expect(lyricSource(result[0].lines[0])).toBe("[G]Deilig er [D]jorden");
  });

  it("keeps inline chords", () => {
    expect(lyricSource(convertPlain("[G]Hello [C]there").sections[0].lines[0])).toBe("[G]Hello [C]there");
  });
});

describe("convertPlain headings", () => {
  it("marks sections started by a heading", () => {
    expect(convertPlain("Chorus\nHi\n\nThere").sections.map((section) => section.headed)).toEqual([true, false]);
  });
});

describe("editing the song as one text", () => {
  const TWO = "{title: X}\n\n{sov}\n[G]One line\nTwo [D]line\n{eov}\n\n{soc}\nThree [C]line\nFour\n{eoc}\n";
  const setup = () => {
    const { doc } = parseDoc(TWO);
    const [verse, chorus] = sectionsOf(doc);
    const id = (section: Section, index: number) => section.lines[index].id;
    return { doc, verse, chorus, id };
  };
  const text = (doc: SongDoc) => serializeDoc(doc).text;

  it("splits a line in two, keeping its chords on their letters", () => {
    const { doc, verse, id } = setup();
    const { caret } = replaceRange(doc, { line: id(verse, 1), off: 4 }, { line: id(verse, 1), off: 4 }, [{ lines: [lyricLine(), lyricLine()] }]);
    expect(text(doc)).toContain("{sov}\n[G]One line\nTwo \n[D]line\n{eov}");
    expect(caret.off).toBe(0);
  });

  it("joins a line to the one before", () => {
    const { doc, verse, id } = setup();
    const { caret, lost } = replaceRange(doc, { line: id(verse, 0), off: 8 }, { line: id(verse, 1), off: 0 }, []);
    expect(text(doc)).toContain("{sov}\n[G]One lineTwo [D]line\n{eov}");
    expect(caret).toEqual({ line: id(verse, 0), off: 8 });
    expect(lost).toBe(0);
  });

  it("joins a section to the one before, and counts chords on removed text", () => {
    const { doc, verse, chorus, id } = setup();
    const { lost } = replaceRange(doc, { line: id(verse, 1), off: 3 }, { line: id(chorus, 0), off: 6 }, []);
    expect(sectionsOf(doc)).toHaveLength(1);
    expect(text(doc)).toBe("{title: X}\n\n{sov}\n[G]One line\nTwo[C]line\nFour\n{eov}\n");
    expect(lost).toBe(1);
  });

  it("puts in pieces as new sections after the place", () => {
    const { doc, verse, id } = setup();
    replaceRange(doc, { line: id(verse, 0), off: 3 }, { line: id(verse, 0), off: 3 }, [{ lines: [lyricLine("!")] }, { type: "bridge", lines: [lyricLine("Mid")] }]);
    expect(text(doc)).toContain("{sov}\n[G]One!\n{eov}\n\n{start_of_bridge}\nMid line\nTwo [D]line\n{end_of_bridge}");
  });

  it("starts a new section at an empty line", () => {
    const { doc, verse, id } = setup();
    replaceRange(doc, { line: id(verse, 0), off: 8 }, { line: id(verse, 0), off: 8 }, [{ lines: [lyricLine(), lyricLine()] }]);
    const point = splitSection(doc, id(verse, 1))!;
    expect(point.line).toBe(sectionsOf(doc)[1].lines[0].id);
    expect(text(doc)).toContain("{sov}\n[G]One line\n{eov}\n\n{start_of_verse}\nTwo [D]line\n{end_of_verse}");
    expect(splitSection(doc, id(verse, 0))).toBeNull();
  });

  it("joins a section to the one before, keeping its lines apart", () => {
    const { doc, chorus } = setup();
    expect(joinSection(doc, chorus.id)).toBe(true);
    expect(text(doc)).toBe("{title: X}\n\n{sov}\n[G]One line\nTwo [D]line\nThree [C]line\nFour\n{eov}\n");
    expect(joinSection(doc, sectionsOf(doc)[0].id)).toBe(false);
  });

  it("copies words with their chords, and as plain text", () => {
    const { doc, verse, chorus, id } = setup();
    const pieces = copyPieces(doc, { line: id(verse, 1), off: 4 }, { line: id(chorus, 0), off: 7 });
    expect(piecesText(pieces)).toBe("line\n\nThree l");
    const { doc: other } = parseDoc("{title: Y}\n\nHello\n");
    const [only] = sectionsOf(other);
    replaceRange(other, { line: only.lines[0].id, off: 5 }, { line: only.lines[0].id, off: 5 }, pieces);
    expect(text(other)).toContain("Hello[D]line\n\n{start_of_chorus}\nThree [C]l\n{end_of_chorus}");
  });
});
