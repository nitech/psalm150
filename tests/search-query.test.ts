import { describe, expect, it } from "vitest";
import { applyKey, keyTokenAt, matchingKeys, parseSearch } from "../src/search-query";

const keys = ["A", "Am", "Bb", "C", "D", "D#", "E"];

describe("parseSearch", () => {
  it("splits a known key from the text search", () => {
    expect(parseSearch("#D grace", keys)).toEqual({ key: "D", text: "grace" });
    expect(parseSearch("grace #am", keys)).toEqual({ key: "Am", text: "grace" });
    expect(parseSearch("#D#", keys)).toEqual({ key: "D#", text: "" });
  });

  it("leaves numbers and unknown keys in the text", () => {
    expect(parseSearch("#123", keys)).toEqual({ key: null, text: "#123" });
    expect(parseSearch("#H song", keys)).toEqual({ key: null, text: "#H song" });
    expect(parseSearch("C#m", keys)).toEqual({ key: null, text: "C#m" });
  });
});

describe("keyTokenAt", () => {
  it("finds the # word under the caret", () => {
    expect(keyTokenAt("#", 1)).toEqual({ start: 0, end: 1, partial: "" });
    expect(keyTokenAt("love #b", 7)).toEqual({ start: 5, end: 7, partial: "b" });
    expect(keyTokenAt("#D grace", 1)).toEqual({ start: 0, end: 2, partial: "D" });
  });

  it("ignores numbers, words with # inside, and a caret past the token", () => {
    expect(keyTokenAt("#12", 3)).toBeNull();
    expect(keyTokenAt("C#", 2)).toBeNull();
    expect(keyTokenAt("#D grace", 8)).toBeNull();
  });
});

describe("key choice", () => {
  it("offers prefix matches and inserts the chosen key", () => {
    expect(matchingKeys(keys, "d")).toEqual(["D", "D#"]);
    expect(matchingKeys(keys, "")).toEqual(keys);
    const token = keyTokenAt("love #d", 7)!;
    expect(applyKey("love #d", token, "D#")).toEqual({ query: "love #D# ", caret: 9 });
  });
});
