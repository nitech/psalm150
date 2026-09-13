import type { SlidePayload } from "./api";
import { buildStanzaMarkers } from "./stanza-markers";

export const STANZA_NUMBER_TIMEOUT_MS = 600;

/** Collect multi-digit stanza numbers without briefly projecting their prefixes. */
export class StanzaNumberInput {
  private digits = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  reset = () => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.digits = "";
  };

  push(digit: string, slides: SlidePayload[], jump: (slideIndex: number) => void) {
    const digits = this.digits + digit;
    this.reset();
    if (!/^[1-9][0-9]*$/.test(digits)) return;
    const markers = buildStanzaMarkers(slides);
    const number = Number(digits);
    const slideIndex = markers[number - 1]?.slideIndices[0];
    if (slideIndex === undefined) return;

    if (number * 10 <= markers.length) {
      this.digits = digits;
      this.timer = setTimeout(() => {
        this.reset();
        jump(slideIndex);
      }, STANZA_NUMBER_TIMEOUT_MS);
    } else {
      jump(slideIndex);
    }
  }
}
