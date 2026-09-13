import type { ProjectionSnapshot, SlidePayload } from "./api";

export function projectionStructureSignature(slides: SlidePayload[]): string {
  return slides
    .map((slide) => `${slide.index}:${slide.section_index ?? -1}:${slide.stanza_index ?? -1}`)
    .join("|");
}

export function shouldAcceptProjectionSnapshot(
  currentRevision: number,
  snapshot: ProjectionSnapshot,
): boolean {
  return snapshot.revision > currentRevision;
}

export function shouldResetStanzaSequence(
  currentSessionId: string | null,
  currentStructure: string,
  snapshot: ProjectionSnapshot,
): boolean {
  return (
    snapshot.session_id !== currentSessionId ||
    projectionStructureSignature(snapshot.projection.slides) !== currentStructure
  );
}
