import { ICON_PATHS, type IconName } from "../../shared/icons.ts";

export type { IconName };

/** A shared stroke icon as an inline SVG string. */
export function icon(name: IconName, label?: string): string {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${ICON_PATHS[name]}</svg>`;
}
