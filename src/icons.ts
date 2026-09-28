import { html } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { ICON_PATHS, type IconName } from "./shared/icons";

export type { IconName };

/**
 * A shared stroke icon (src/shared/icons.ts, mirrored from the song server).
 * The paths are static constants, so `unsafeSVG` never sees user input. They
 * inherit `currentColor`, so buttons colour them through CSS.
 */
export function icon(name: IconName, size = 18) {
  return html`<svg
    class="icon icon-${name}"
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >${unsafeSVG(ICON_PATHS[name])}</svg>`;
}
