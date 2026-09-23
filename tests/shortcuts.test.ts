import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  actionForCombo,
  comboFromEvent,
  formatCombo,
  hasCommandModifier,
  normalizeCombo,
  resolveShortcuts,
  shortcutProblem,
} from "../src/shortcuts";

function key(key: string, code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) {
  return { key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods };
}

describe("comboFromEvent", () => {
  it("names modifiers in a fixed order and takes letters from the code", () => {
    expect(comboFromEvent(key("ß", "KeyS", { altKey: true }))).toBe("Alt+S");
    expect(comboFromEvent(key("f", "KeyF", { ctrlKey: true }))).toBe("Ctrl+F");
    expect(comboFromEvent(key("b", "KeyB"))).toBe("B");
    expect(comboFromEvent(key("ArrowRight", "ArrowRight"))).toBe("ArrowRight");
  });

  it("ignores a lone modifier", () => {
    expect(comboFromEvent(key("Alt", "AltLeft", { altKey: true }))).toBeNull();
  });
});

describe("stored shortcuts", () => {
  it("fills defaults and accepts the old KeyB spelling", () => {
    const resolved = resolveShortcuts({ blank: "KeyB", next_slide: "pagedown" });
    expect(resolved.blank).toBe("B");
    expect(resolved.add_to_setlist).toBe("Alt+S");
    expect(normalizeCombo("alt+shift+s")).toBe("Alt+Shift+S");
  });

  it("finds the action for a combo", () => {
    expect(actionForCombo(DEFAULT_SHORTCUTS, "Alt+S")).toBe("add_to_setlist");
    expect(actionForCombo(DEFAULT_SHORTCUTS, "Alt+Q")).toBeNull();
    expect(hasCommandModifier("Alt+S")).toBe(true);
    expect(hasCommandModifier("B")).toBe(false);
  });
});

describe("shortcutProblem", () => {
  it("refuses reserved keys, bare Shift letters and duplicates", () => {
    expect(shortcutProblem(DEFAULT_SHORTCUTS, "blank", "Enter")).toMatch(/already used/);
    expect(shortcutProblem(DEFAULT_SHORTCUTS, "blank", "3")).toMatch(/already used/);
    expect(shortcutProblem(DEFAULT_SHORTCUTS, "blank", "Shift+B")).toMatch(/types text/);
    expect(shortcutProblem(DEFAULT_SHORTCUTS, "blank", "Alt+S")).toMatch(/Add the selected song/);
    expect(shortcutProblem(DEFAULT_SHORTCUTS, "blank", "Alt+B")).toBeNull();
    expect(shortcutProblem(DEFAULT_SHORTCUTS, "blank", "B")).toBeNull();
  });

  it("formats combos for display", () => {
    expect(formatCombo("Alt+S")).toBe("Alt + S");
    expect(formatCombo("ArrowRight")).toBe("→");
    expect(formatCombo("")).toBe("Not set");
  });
});
