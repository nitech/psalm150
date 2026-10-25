/**
 * Fit planning for the audience (congregation) window.
 *
 * The words are as large as they can be: one font size for the whole song,
 * the largest at which every stanza of it still fits the screen, up to a
 * maximum. So the size does not jump from stanza to stanza, and a short
 * stanza is as large as a long one.
 *
 * Lyric lines are laid out unwrapped, so every line stays on one row. Only
 * when a single line is so wide that keeping it whole would make the slide
 * hard to read does that stanza wrap its lines in balanced halves instead.
 * Pure (the DOM measures, this decides) so it can be unit-tested.
 */

/** Below this share of the size it could otherwise have, a stanza wraps its lines rather than shrink. */
export const MIN_UNWRAPPED_WIDTH_SCALE = 0.7;

/** The largest lyric font, as a share of the screen's height. */
export const MAX_FONT_SCREEN_SHARE = 0.1;

/** Smallest font ever chosen, so a broken measurement cannot hide the words. */
export const MIN_FONT = 12;

/** A stanza's natural size, unwrapped, at the base font. */
export interface SlideSize {
  width: number;
  height: number;
}

export interface SongFitInput {
  /** Space the words may take: screen minus margins and the corner overlays. */
  availableWidth: number;
  availableHeight: number;
  /** The font size the stanzas were measured at. */
  baseFont: number;
  maxFont: number;
  slides: SlideSize[];
  /** Whether stanza `index`, wrapped to the available width, fits at `font`. */
  wrappedFits: (index: number, font: number) => boolean;
}

export interface SongFit {
  /** The font size for every stanza of the song. */
  font: number;
  /** Per stanza, the largest font at which it fits unwrapped. */
  unwrappedFonts: number[];
}

export function planSongFit(input: SongFitInput): SongFit {
  const width = Math.max(1, input.availableWidth);
  const height = Math.max(1, input.availableHeight);
  const maxFont = Math.max(MIN_FONT, input.maxFont);
  const scale = (available: number, content: number) =>
    Number.isFinite(content) && content > 0 ? available / content : Infinity;
  const unwrappedFonts = input.slides.map(
    (slide) => input.baseFont * Math.min(scale(width, slide.width), scale(height, slide.height)),
  );
  const heightFonts = input.slides.map((slide) => input.baseFont * scale(height, slide.height));

  // Stanzas that fit whole without shrinking much set the size first.
  let font = maxFont;
  const wrapping: number[] = [];
  unwrappedFonts.forEach((unwrapped, index) => {
    if (unwrapped >= MIN_UNWRAPPED_WIDTH_SCALE * Math.min(maxFont, heightFonts[index])) {
      font = Math.min(font, unwrapped);
    } else {
      wrapping.push(index);
    }
  });
  // A stanza with a very long line wraps; it may still bring the size down.
  for (const index of wrapping) {
    const low = unwrappedFonts[index];
    const high = Math.min(font, heightFonts[index]);
    if (high <= low) {
      font = Math.min(font, Math.max(low, high));
      continue;
    }
    if (input.wrappedFits(index, high)) continue;
    let fits = low;
    let fails = high;
    while (fails - fits > 0.5) {
      const middle = (fits + fails) / 2;
      if (input.wrappedFits(index, middle)) fits = middle;
      else fails = middle;
    }
    font = Math.min(font, fits);
  }
  return { font: Math.max(MIN_FONT, font), unwrappedFonts };
}

/** Whether a stanza must wrap its lines at the song's font. */
export function needsWrap(fit: SongFit, index: number): boolean {
  const unwrapped = fit.unwrappedFonts[index];
  return unwrapped !== undefined && fit.font > unwrapped * 1.001;
}
