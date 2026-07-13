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
 * Expands chorus2 templates into performance-order sections — mirrors
 * `expand_chorus_sections` in src-tauri/src/projection/mod.rs.
 */
export function buildPerformanceSections(sections: SongSection[]): PerformanceSection[] {
  const chorus2Idx = sections.findIndex((section) => section.kind === "chorus2");
  if (chorus2Idx < 0) {
    return sections.map((section, sectionIndex) => ({
      label: section.label,
      kind: section.kind,
      lines: section.lines,
      lineProvenance: provenanceForLines(sectionIndex, section.lines),
    }));
  }

  const mainChorusIdx = sections.findIndex(
    (section, index) => index < chorus2Idx && section.kind === "chorus",
  );
  const mainChorus = mainChorusIdx >= 0 ? sections[mainChorusIdx] : undefined;
  const altChorus = sections[chorus2Idx];
  let useAlt = false;
  const result: PerformanceSection[] = [];

  for (let idx = 0; idx < sections.length; idx++) {
    const section = sections[idx];
    if (section.kind === "chorus2") continue;
    if (section.kind === "chorus" && idx < chorus2Idx) continue;

    if (section.kind === "chorus") {
      const source = useAlt ? altChorus ?? mainChorus : mainChorus;
      if (!source) continue;

      const fromSlot = sectionHasLyrics(section.lines);
      const lines = fromSlot ? section.lines : source.lines;
      const sourceIndex = fromSlot ? idx : useAlt ? chorus2Idx : mainChorusIdx;

      result.push({
        label: section.label,
        kind: useAlt && altChorus ? "chorus2" : "chorus",
        lines,
        lineProvenance: provenanceForLines(sourceIndex, lines),
      });
      useAlt = !useAlt;
      continue;
    }

    result.push({
      label: section.label,
      kind: section.kind,
      lines: section.lines,
      lineProvenance: provenanceForLines(idx, section.lines),
    });
  }

  return result;
}

/** Stable key for a stanza block within performance sections. */
export function stanzaBlockKey(performanceSectionIndex: number, stanzaIndexInSection: number): string {
  return `${performanceSectionIndex}:${stanzaIndexInSection}`;
}

/** Stable key for a source line in parsed.sections. */
export function sourceLineKey(sectionIndex: number, lineIndex: number): string {
  return `${sectionIndex}:${lineIndex}`;
}
