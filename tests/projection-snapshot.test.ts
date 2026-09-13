import { describe, expect, it } from "vitest";
import type { ProjectionSnapshot, SlidePayload } from "../src/api";
import {
  projectionStructureSignature,
  shouldAcceptProjectionSnapshot,
  shouldResetStanzaSequence,
} from "../src/projection-snapshot";

const slide = (index: number, stanza: number): SlidePayload => ({
  index,
  section_index: stanza,
  stanza_index: stanza,
  section_label: `Verse ${stanza + 1}`,
  lines: [{ text: "Line", chords: [] }],
  overlay: {},
});

const snapshot = (revision: number, session: string, slides: SlidePayload[]): ProjectionSnapshot => ({
  revision,
  session_id: session,
  projection: {
    slides,
    current_index: 0,
    blank: false,
    transpose_semitones: 0,
  },
  theme: {} as ProjectionSnapshot["theme"],
  audience: slide(0, 0),
  stage: null,
});

describe("projection snapshot sequencing", () => {
  it("ignores delayed command or event responses", () => {
    expect(shouldAcceptProjectionSnapshot(12, snapshot(11, "a", [slide(0, 0)]))).toBe(false);
    expect(shouldAcceptProjectionSnapshot(12, snapshot(12, "a", [slide(0, 0)]))).toBe(false);
    expect(shouldAcceptProjectionSnapshot(12, snapshot(13, "a", [slide(0, 0)]))).toBe(true);
  });

  it("keeps a typed stanza sequence across ordinary navigation", () => {
    const slides = [slide(0, 0), slide(1, 1)];
    const structure = projectionStructureSignature(slides);
    expect(shouldResetStanzaSequence("a", structure, snapshot(2, "a", slides))).toBe(false);
  });

  it("resets the sequence for a new session or changed slide structure", () => {
    const slides = [slide(0, 0), slide(1, 1)];
    const structure = projectionStructureSignature(slides);
    expect(shouldResetStanzaSequence("a", structure, snapshot(2, "b", slides))).toBe(true);
    expect(shouldResetStanzaSequence("a", structure, snapshot(2, "a", [slide(0, 0)]))).toBe(true);
  });
});
