import { describe, expect, it } from "vitest";
import { MIN_UNWRAPPED_WIDTH_SCALE, planFit } from "../src/audience-fit";

const screen = { availableWidth: 800, availableHeight: 400 };

describe("planFit", () => {
  it("leaves a block that already fits untouched", () => {
    expect(planFit({ ...screen, contentWidth: 600, contentHeight: 200 })).toEqual({
      scale: 1,
      wrap: false,
    });
  });

  it("shrinks a slightly-too-wide block instead of wrapping its lines", () => {
    const plan = planFit({ ...screen, contentWidth: 1000, contentHeight: 200 });
    expect(plan.scale).toBeCloseTo(0.8);
    expect(plan.wrap).toBe(false);
  });

  it("wraps when a line is far wider than the screen", () => {
    const plan = planFit({ ...screen, contentWidth: 2000, contentHeight: 200 });
    expect(plan.wrap).toBe(true);
    expect(plan.scale).toBeLessThan(MIN_UNWRAPPED_WIDTH_SCALE);
  });

  it("never wraps for height overflow alone", () => {
    const plan = planFit({ ...screen, contentWidth: 600, contentHeight: 1000 });
    expect(plan.wrap).toBe(false);
    expect(plan.scale).toBeCloseTo(0.4);
  });

  it("uses the tighter of width and height", () => {
    const plan = planFit({ ...screen, contentWidth: 1000, contentHeight: 800 });
    expect(plan.scale).toBeCloseTo(0.5);
  });

  it("treats an empty block as fitting", () => {
    expect(planFit({ ...screen, contentWidth: 0, contentHeight: 0 })).toEqual({
      scale: 1,
      wrap: false,
    });
  });
});
