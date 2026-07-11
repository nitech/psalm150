import type { LyricLine, SlidePayload, SongSection } from "./api";

export interface StanzaMarker {
  stanzaIndex: number;
  slideIndices: number[];
  sectionIndex: number;
  fullText: string;
  lines: LyricLine[];
}

export interface PreviewStanzaBlock {
  sectionIndex: number;
  lines: LyricLine[];
}

function stanzaKey(slide: SlidePayload): number {
  return slide.stanza_index ?? slide.section_index ?? slide.index;
}

function slideLinesToText(slide: SlidePayload): string {
  return slide.lines
    .map((line) => line.text)
    .join("\n")
    .trim();
}

function appendSlideText(existing: string, slide: SlidePayload): string {
  const addition = slideLinesToText(slide);
  if (!addition) return existing;
  if (!existing) return addition;
  return `${existing}\n${addition}`;
}

function slideToLyricLines(slide: SlidePayload): LyricLine[] {
  return slide.lines.map((line) => ({ text: line.text, chords: [] }));
}

function appendSlideLines(existing: LyricLine[], slide: SlidePayload): LyricLine[] {
  const addition = slideToLyricLines(slide);
  if (addition.length === 0) return existing;
  if (existing.length === 0) return addition;
  return existing.concat(addition);
}

/** Blank-line blocks from parsed sections — matches song preview layout. */
export function buildPreviewStanzaBlocks(sections: SongSection[]): PreviewStanzaBlock[] {
  const blocks: PreviewStanzaBlock[] = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    let current: LyricLine[] = [];
    for (const line of section.lines) {
      if (!line.text && line.chords.length === 0) {
        if (current.length > 0) {
          blocks.push({ sectionIndex, lines: current });
          current = [];
        }
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) {
      blocks.push({ sectionIndex, lines: current });
    }
  }
  return blocks;
}

export function buildStanzaMarkers(slides: SlidePayload[]): StanzaMarker[] {
  const markers: StanzaMarker[] = [];
  for (const slide of slides) {
    const stanzaIndex = stanzaKey(slide);
    const last = markers[markers.length - 1];
    if (last && last.stanzaIndex === stanzaIndex) {
      last.slideIndices.push(slide.index);
      last.fullText = appendSlideText(last.fullText, slide);
      last.lines = appendSlideLines(last.lines, slide);
    } else {
      markers.push({
        stanzaIndex,
        slideIndices: [slide.index],
        sectionIndex: slide.section_index ?? 0,
        fullText: slideLinesToText(slide),
        lines: slideToLyricLines(slide),
      });
    }
  }
  return markers;
}

export function activeStanzaIndex(markers: StanzaMarker[], currentIndex: number): number {
  const idx = markers.findIndex((marker) => marker.slideIndices.includes(currentIndex));
  return idx >= 0 ? idx : 0;
}

/** First slide index of the next/previous stanza, or null if at the boundary. */
export function stanzaStepSlideIndex(
  markers: StanzaMarker[],
  currentIndex: number,
  direction: "next" | "prev",
): number | null {
  if (markers.length === 0) return null;
  const active = activeStanzaIndex(markers, currentIndex);
  const target = direction === "next" ? active + 1 : active - 1;
  if (target < 0 || target >= markers.length) return null;
  return markers[target].slideIndices[0] ?? null;
}
