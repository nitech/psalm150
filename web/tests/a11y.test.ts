import { describe, expect, it } from "vitest";
import { focusSelector, nextRadioIndex, pageTitle } from "../../shared/songs/a11y.ts";
import { toastDuration } from "../src/ui.ts";

describe("pageTitle", () => {
  it("puts the most specific part first and the app last", () => {
    expect(pageTitle("Amazing Grace", "Songs")).toBe("Amazing Grace · Songs · Psalm150");
  });

  it("leaves out empty parts", () => {
    expect(pageTitle(undefined, " ", "Sets", null)).toBe("Sets · Psalm150");
    expect(pageTitle()).toBe("Psalm150");
  });
});

describe("nextRadioIndex", () => {
  it("moves with the arrow keys and wraps around", () => {
    expect(nextRadioIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextRadioIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextRadioIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextRadioIndex("ArrowUp", 1, 3)).toBe(0);
  });

  it("goes to the ends with Home and End", () => {
    expect(nextRadioIndex("Home", 2, 3)).toBe(0);
    expect(nextRadioIndex("End", 0, 3)).toBe(2);
  });

  it("ignores other keys and empty groups", () => {
    expect(nextRadioIndex("Enter", 0, 3)).toBeNull();
    expect(nextRadioIndex(" ", 0, 3)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("focusSelector", () => {
  it("prefers the id", () => {
    expect(focusSelector({ tag: "BUTTON", id: "play-next", attributes: [["data-act", "x"]] })).toBe("#play-next");
  });

  it("uses the first identifying attribute, inside its row", () => {
    expect(focusSelector({
      tag: "BUTTON",
      attributes: [["type", "button"], ["class", "icon-button"], ["data-act", "up"], ["aria-label", "Move up"]],
      scopeKey: "item-1",
    })).toBe('[data-key="item-1"] button[data-act="up"]');
  });

  it("finds links by their address and escapes quotes", () => {
    expect(focusSelector({ tag: "A", attributes: [["class", "list-row"], ["href", '#/songs/"x"']] }))
      .toBe('a[href="#/songs/\\"x\\""]');
  });

  it("is null when nothing tells the control apart", () => {
    expect(focusSelector({ tag: "BUTTON", attributes: [["type", "button"], ["class", "chip"]] })).toBeNull();
  });
});

describe("toastDuration", () => {
  it("keeps errors until they are closed", () => {
    expect(toastDuration("Could not save.", { error: true })).toBeNull();
  });

  it("gives time to read, and more with a button", () => {
    expect(toastDuration("Saved.", {})).toBe(5000);
    expect(toastDuration("x".repeat(120), {})).toBe(10_000);
    expect(toastDuration("Added to Sunday morning.", { action: true })).toBe(10_000);
  });
});
