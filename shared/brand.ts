/**
 * The Psalm150 mark, "Wind": one breath that comes in low and curls upward.
 * "Let every thing that hath breath praise the LORD" (Psalm 150:6); in Hebrew
 * ruach is breath, wind and Spirit in one word.
 *
 * An `<svg>` string drawn in `currentColor`, for the brand mark in both apps'
 * headers. The app icons are made from the same path (`shared/brand/`).
 * Both the web client and the desktop use this file as it is.
 */
export const BRAND_MARK_PATH =
  "M200 700 H560 A180 180 0 0 0 740 520 A180 180 0 0 0 560 340 A129.6 129.6 0 0 0 430.4 469.6 A86.4 86.4 0 0 0 516.8 556 A48.6 48.6 0 0 0 565.4 507.4";

export const BRAND_MARK = `<svg class="brand-wind" viewBox="170 310 600 420" aria-hidden="true" focusable="false"><path d="${BRAND_MARK_PATH}" fill="none" stroke="currentColor" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
