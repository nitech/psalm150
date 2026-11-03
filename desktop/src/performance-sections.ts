import type { LyricLine, SectionKind, SongSection } from "./api";

export interface LineProvenance {
  sectionIndex: number;
  lineIndex: number;
}

export interface PerformanceSection {
  label: string;
  kind: SectionKind;
  lines: LyricLine[];
  /** Maps each line index to its source in parsed.sections (for ad hoc edits). */
  lineProvenance: LineProvenance[];
}

function sectionHasLyrics(lines: LyricLine[]): boolean {
  return lines.some((line) => line.text.length > 0);
}

function provenanceForLines(sourceSectionIndex: number, lines: LyricLine[]): LineProvenance[] {
  return lines.map((_, lineIndex) => ({ sectionIndex: sourceSectionIndex, lineIndex }));
}

/**
 * The sections as written, the way the song server's web client shows them:
 * a second chorus (`{start_of_chorus2}`) is a chorus of its own where it is
 * written. An empty chorus (a slot) repeats the last chorus of its kind with
 * words, the first one when none came yet; an empty chorus2 falls back to the
 * chorus. Mirrors `expand_chorus_sections` in src-tauri/src/projection/mod.rs.
 */
export function buildPerformanceSections(sections: SongSection[]): PerformanceSection[] {
  const first = (kind: SectionKind) =>
    sections.findIndex((section) => section.kind === kind && sectionHasLyrics(section.lines));
  let lastChorus = -1;
  let lastAlt = -1;
  return sections.map((section, sectionIndex) => {
    const isChorus = section.kind === "chorus" || section.kind === "chorus2";
    let sourceIndex = sectionIndex;
    if (isChorus && sectionHasLyrics(section.lines)) {
      if (section.kind === "chorus2") lastAlt = sectionIndex;
      else lastChorus = sectionIndex;
    } else if (isChorus) {
      const chorus = lastChorus >= 0 ? lastChorus : first("chorus");
      const alt = lastAlt >= 0 ? lastAlt : first("chorus2");
      const source = section.kind === "chorus2" ? (alt >= 0 ? alt : chorus) : chorus;
      if (source >= 0) sourceIndex = source;
    }
    const lines = sections[sourceIndex].lines;
    return {
      label: section.label,
      kind: section.kind,
      lines,
      lineProvenance: provenanceForLines(sourceIndex, lines),
    };
  });
}

/** Stable key for a stanza block within performance sections. */
export function stanzaBlockKey(performanceSectionIndex: number, stanzaIndexInSection: number): string {
  return `${performanceSectionIndex}:${stanzaIndexInSection}`;
}

/** Stable key for a source line in parsed.sections. */
export function sourceLineKey(sectionIndex: number, lineIndex: number): string {
  return `${sectionIndex}:${lineIndex}`;
}
