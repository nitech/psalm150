import { describe, expect, it } from "vitest";
import { groupSets, resolveCurrentSet } from "../src/current-set.ts";
import type { SetSummary } from "../src/types.ts";

function set(id: string, service_date: string | null, updated_at = "2026-09-01T10:00:00Z"): SetSummary {
  return { id, name: id, service_date, version: 1, item_count: 0, updated_at };
}

const TODAY = "2026-10-01";
const sets = [
  set("past", "2026-09-27"),
  set("later", "2026-10-11"),
  set("next", "2026-10-04"),
  set("draft", null),
];

describe("resolveCurrentSet", () => {
  it("picks the next dated service", () => {
    expect(resolveCurrentSet(sets, null, TODAY)?.id).toBe("next");
  });

  it("counts a service today as upcoming", () => {
    expect(resolveCurrentSet([...sets, set("today", TODAY)], null, TODAY)?.id).toBe("today");
  });

  it("prefers the most recently edited set when two share a date", () => {
    const twins = [set("old", "2026-10-04", "2026-09-01T10:00:00Z"), set("new", "2026-10-04", "2026-09-02T10:00:00Z")];
    expect(resolveCurrentSet(twins, null, TODAY)?.id).toBe("new");
  });

  it("uses the set chosen on this phone, undated ones included", () => {
    expect(resolveCurrentSet(sets, "later", TODAY)?.id).toBe("later");
    expect(resolveCurrentSet(sets, "draft", TODAY)?.id).toBe("draft");
  });

  it("forgets a chosen set once its service is over or it is gone", () => {
    expect(resolveCurrentSet(sets, "past", TODAY)?.id).toBe("next");
    expect(resolveCurrentSet(sets, "deleted", TODAY)?.id).toBe("next");
  });

  it("never picks an undated set by itself", () => {
    expect(resolveCurrentSet([set("past", "2026-09-27"), set("draft", null)], null, TODAY)).toBeNull();
  });
});

describe("groupSets", () => {
  it("orders upcoming soonest first and past newest first", () => {
    const groups = groupSets([...sets, set("older", "2026-09-20")], TODAY);
    expect(groups.upcoming.map((entry) => entry.id)).toEqual(["next", "later"]);
    expect(groups.undated.map((entry) => entry.id)).toEqual(["draft"]);
    expect(groups.past.map((entry) => entry.id)).toEqual(["past", "older"]);
  });
});
