import { describe, expect, it } from "vitest";
import { MIN_FONT, needsWrap, planSongFit, type SlideSize } from "../src/audience-fit";

const screen = { availableWidth: 800, availableHeight: 400, baseFont: 100, maxFont: 200 };
const never = () => false;

function plan(slides: SlideSize[], wrappedFits: (index: number, font: number) => boolean = never) {
  return planSongFit({ ...screen, slides, wrappedFits });
}

describe("planSongFit", () => {
  it("enlarges a short stanza up to the maximum", () => {
    expect(plan([{ width: 200, height: 100 }]).font).toBeCloseTo(200);
  });

  it("gives every stanza the size of the one that fits least", () => {
    const fit = plan([
      { width: 400, height: 100 }, // fits up to 200
      { width: 1000, height: 100 }, // fits up to 80
      { width: 400, height: 200 }, // fits up to 200
    ]);
    expect(fit.font).toBeCloseTo(80);
    expect(fit.unwrappedFonts.map(Math.round)).toEqual([200, 80, 200]);
    expect(needsWrap(fit, 0)).toBe(false);
    expect(needsWrap(fit, 1)).toBe(false);
  });

  it("is limited by height as well as width", () => {
    expect(plan([{ width: 400, height: 800 }]).font).toBeCloseTo(50);
  });

  it("wraps a stanza with a far too long line instead of shrinking the song for it", () => {
    // The long stanza fits whole only at 40; wrapped, it fits up to 150.
    const fit = plan(
      [
        { width: 400, height: 100 },
        { width: 2000, height: 100 },
      ],
      (index, font) => index === 1 && font <= 150,
    );
    expect(fit.font).toBeCloseTo(150, 0);
    expect(needsWrap(fit, 1)).toBe(true);
    expect(needsWrap(fit, 0)).toBe(false);
  });

  it("does not wrap when the song's size is small enough already", () => {
    const fit = plan(
      [
        { width: 400, height: 1000 }, // fits up to 40
        { width: 2000, height: 100 }, // fits whole up to 40
      ],
      () => true,
    );
    expect(fit.font).toBeCloseTo(40);
    expect(needsWrap(fit, 1)).toBe(false);
  });

  it("treats empty stanzas as fitting, and never goes below the minimum", () => {
    expect(plan([{ width: 0, height: 0 }]).font).toBeCloseTo(200);
    expect(plan([{ width: 100000, height: 100 }]).font).toBe(MIN_FONT);
  });
});
