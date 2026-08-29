/**
 * Fit planning for the audience (congregation) window.
 *
 * Lyric lines are laid out unwrapped at their natural width and the whole block
 * is scaled down uniformly so every line stays on one row. Only when a single
 * line is so wide that shrinking would make the slide hard to read do we fall
 * back to balanced word-wrapping. Pure so it can be unit-tested without a DOM.
 */

/** Below this width ratio, shrinking unwrapped lines hurts legibility more than wrapping them. */
export const MIN_UNWRAPPED_WIDTH_SCALE = 0.7;

export interface FitBox {
  /** Space the block may occupy: screen minus padding and reserved overlays. */
  availableWidth: number;
  availableHeight: number;
  /** Natural, unscaled size of the rendered block. */
  contentWidth: number;
  contentHeight: number;
}

export interface FitPlan {
  /** Uniform scale to apply to the block; never enlarges (at most 1). */
  scale: number;
  /** Lines are too wide to shrink legibly: enable wrapping and measure again. */
  wrap: boolean;
}

export function planFit(box: FitBox): FitPlan {
  const widthScale = ratio(box.availableWidth, box.contentWidth);
  const heightScale = ratio(box.availableHeight, box.contentHeight);
  return {
    scale: Math.min(widthScale, heightScale, 1),
    wrap: widthScale < MIN_UNWRAPPED_WIDTH_SCALE,
  };
}

function ratio(available: number, content: number): number {
  if (!Number.isFinite(content) || content <= 0) return 1;
  return Math.max(1, available) / content;
}
