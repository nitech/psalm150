import { describe, expect, it } from "vitest";
import {
  applyPendingEditsToLineText,
  diffLineSegments,
  patchChordProRaw,
  type PendingEdits,
} from "../src/adhoc-edit";
import { buildPerformanceSections } from "../src/performance-sections";
import { buildPreviewStanzaBlocksFromSections } from "../src/stanza-markers";
import type { SongSection } from "../src/api";

describe("buildPerformanceSections", () => {
  it("passes through songs without chorus2 unchanged", () => {
    const sections: SongSection[] = [
      { label: "Verse", kind: "verse", lines: [{ text: "Line one", chords: [] }] },
      { label: "Chorus", kind: "chorus", lines: [{ text: "Chorus line", chords: [] }] },
    ];
    const performance = buildPerformanceSections(sections);
    expect(performance).toHaveLength(2);
    expect(performance[1].lines[0].text).toBe("Chorus line");
  });

  it("shows every chorus where it is written, as the song server does", () => {
    const sections: SongSection[] = [
      { label: "Verse", kind: "verse", lines: [{ text: "Verse one", chords: [] }] },
      { label: "Chorus", kind: "chorus", lines: [{ text: "Main chorus", chords: [] }] },
      { label: "Verse", kind: "verse", lines: [{ text: "Verse two", chords: [] }] },
      { label: "Chorus2", kind: "chorus2", lines: [{ text: "Alt chorus", chords: [] }] },
    ];
    expect(buildPerformanceSections(sections).map((section) => section.lines[0]?.text)).toEqual([
      "Verse one",
      "Main chorus",
      "Verse two",
      "Alt chorus",
    ]);
  });

  it("fills an empty chorus with the last one and maps edits to it", () => {
    const sections: SongSection[] = [
      { label: "Chorus", kind: "chorus", lines: [{ text: "Main chorus", chords: [] }] },
      { label: "Verse", kind: "verse", lines: [{ text: "Verse", chords: [] }] },
      { label: "Chorus", kind: "chorus", lines: [] },
    ];
    const performance = buildPerformanceSections(sections);
    expect(performance[2].lines[0].text).toBe("Main chorus");
    expect(performance[2].lineProvenance[0]).toEqual({ sectionIndex: 0, lineIndex: 0 });
  });
});

describe("patchChordProRaw", () => {
  it("updates lyric text while preserving chords", () => {
    const raw = `{title: Test}
{start_of_verse}
[Am]Hello world
`;
    const sections: SongSection[] = [
      {
        label: "Verse",
        kind: "verse",
        lines: [{ text: "Hello world", chords: [{ chord: "Am", position: 0 }] }],
      },
    ];
    const edits: PendingEdits = new Map([
      ["0:0", { original: "Hello world", text: "Hello there" }],
    ]);
    const patched = patchChordProRaw(raw, sections, edits);
    expect(patched).toContain("[Am]Hello there");
    expect(patched).not.toContain("Hello world");
  });
});

describe("diffLineSegments", () => {
  it("marks changed words", () => {
    const segments = diffLineSegments("Amazing grace", "Amazing graece");
    expect(segments.some((segment) => segment.changed && segment.text.includes("graece"))).toBe(
      true,
    );
  });
});

describe("applyPendingEditsToLineText", () => {
  it("returns edited text when present", () => {
    const edits: PendingEdits = new Map([["0:1", { original: "old", text: "new" }]]);
    expect(applyPendingEditsToLineText(0, 1, "old", edits)).toBe("new");
  });
});
