import { describe, expect, it } from "vitest";
import { NO_ONLINE_SEARCH, onlineSearchAfter } from "../src/online-search";

describe("onlineSearchAfter", () => {
  it("offers a search when the library finds nothing", () => {
    expect(onlineSearchAfter(NO_ONLINE_SEARCH, "way maker", true)).toEqual({ status: "offer", query: "way maker" });
  });

  it("offers nothing when the library has songs or search is off", () => {
    expect(onlineSearchAfter({ status: "offer", query: "way" }, "way", false)).toEqual(NO_ONLINE_SEARCH);
  });

  it("keeps a running or finished search for the same query", () => {
    const searching = { status: "searching", query: "way maker" } as const;
    expect(onlineSearchAfter(searching, "way maker", true)).toBe(searching);
    const found = { status: "found", query: "way maker" } as const;
    expect(onlineSearchAfter(found, "way maker", true)).toBe(found);
  });

  it("goes back to the offer when the query changes", () => {
    expect(onlineSearchAfter({ status: "found", query: "way maker" }, "way maker live", true)).toEqual({
      status: "offer",
      query: "way maker live",
    });
  });
});
