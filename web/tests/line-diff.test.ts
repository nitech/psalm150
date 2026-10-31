import { describe, expect, it } from "vitest";
import { diffLines, withContext } from "../../shared/songs/line-diff.ts";

describe("diffLines", () => {
  it("keeps common lines and marks the rest", () => {
    expect(diffLines("{title: A}\nWords\nMore", "{title: A}\n[G]Words\nMore")).toEqual([
      { kind: "same", text: "{title: A}" },
      { kind: "removed", text: "Words" },
      { kind: "added", text: "[G]Words" },
      { kind: "same", text: "More" },
    ]);
  });

  it("treats CRLF and LF alike and handles added and removed ends", () => {
    expect(diffLines("a\r\nb", "a\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
      { kind: "added", text: "c" },
    ]);
    expect(diffLines("a\nb", "b")).toEqual([
      { kind: "removed", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });
});

describe("withContext", () => {
  it("folds long unchanged runs and keeps context around changes", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n");
    const after = ["1", "2", "3", "4", "5", "6", "x", "8"].join("\n");
    expect(withContext(diffLines(before, after), 1)).toEqual([
      { kind: "fold", count: 5 },
      { kind: "same", text: "6" },
      { kind: "removed", text: "7" },
      { kind: "added", text: "x" },
      { kind: "same", text: "8" },
    ]);
  });

  it("gives nothing when nothing changed", () => {
    expect(withContext(diffLines("a\nb", "a\nb"))).toEqual([]);
  });
});
