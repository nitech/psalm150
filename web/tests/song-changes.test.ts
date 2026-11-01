import { describe, expect, it } from "vitest";
import { describeChange, revisionGraph } from "../../shared/songs/song-changes.ts";

const SONG = `{title: Everyday Hallelujah}
{key: G}

[G]I can see You in the morning
[G]Painting colors in the sky

{start_of_chorus}
[G/B]In the joy and [C2]in the pain
[G/B]In the sun and [Dadd4]in the rain
{end_of_chorus}`;

describe("describeChange", () => {
  it("names the first version", () => {
    expect(describeChange(null, SONG)).toBe("First version");
  });

  it("says punctuation in the section it changed in", () => {
    expect(describeChange(SONG, SONG.replace("in the pain", "in the pain!"))).toBe("Punctuation in Chorus");
  });

  it("tells chords from words", () => {
    expect(describeChange(SONG, SONG.replace("[C2]in the pain", "[C]in the pain"))).toBe("Chords in Chorus");
    expect(describeChange(SONG, SONG.replace("Painting colors", "Painting colours"))).toBe("Words in Verse 1");
  });

  it("joins the sections that changed", () => {
    const after = SONG.replace("[G]Painting", "[D]Painting").replace("[C2]in the pain", "[C]in the pain");
    expect(describeChange(SONG, after)).toBe("Chords in Verse 1 and Chorus");
  });

  it("calls a new key with only its chords moved a transposition", () => {
    const after = SONG.replace("{key: G}", "{key: A}").replace(/\[G\]/g, "[A]").replace(/\[G\/B\]/g, "[A/C#]");
    expect(describeChange(SONG, after)).toBe("Transposed G → A");
  });

  it("names added sections once, and the title", () => {
    const after = `${SONG.replace("{title: Everyday Hallelujah}", "{title: Every Day}")}\n\n{start_of_bridge}\n[Em]Every breath\n{end_of_bridge}`;
    expect(describeChange(SONG, after)).toBe("Renamed “Every Day” · Added Bridge");
  });

  it("says when nothing changed, or only spacing", () => {
    expect(describeChange(SONG, SONG)).toBe("No changes");
    expect(describeChange(SONG, SONG.replace(/\n/g, "\r\n"))).toBe("Spacing");
    expect(describeChange(SONG, SONG.replace("{end_of_chorus}", "\n{end_of_chorus}"))).toBe("Spacing");
  });
});

describe("revisionGraph", () => {
  it("keeps a straight line in one lane", () => {
    const { rows, lanes } = revisionGraph([
      { id: "c", parent: "b" },
      { id: "b", parent: "a" },
      { id: "a", parent: null },
    ]);
    expect(lanes).toBe(1);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.down)).toEqual([true, true, false]);
    expect(rows[1].into).toEqual([0]);
  });

  it("gives a branch its own lane until it joins the version it came from", () => {
    // b and t were both saved on top of a (t: a translation).
    const { rows, lanes } = revisionGraph([
      { id: "t", parent: "a" },
      { id: "b", parent: "a" },
      { id: "a", parent: null },
    ]);
    expect(lanes).toBe(2);
    expect(rows[0]).toEqual({ lane: 0, into: [], through: [], down: true });
    expect(rows[1]).toEqual({ lane: 1, into: [], through: [0], down: true });
    expect(rows[2]).toEqual({ lane: 0, into: [0, 1], through: [], down: false });
  });
});
