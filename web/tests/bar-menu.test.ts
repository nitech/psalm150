import { describe, expect, it } from "vitest";
import { DEMOTE_AT, MAX_FREQUENT, PROMOTE_AT, faded, frequent, recordUse, type UsageMap } from "../src/bar-menu.ts";

const DAY = 86_400_000;
const ids = ["add-to-set", "chords", "copy", "share", "edit"];

function used(times: number, id: string, now: number, usage: UsageMap = {}): UsageMap {
  for (let i = 0; i < times; i++) usage = recordUse(usage, id, now);
  return usage;
}

describe("frequent bar actions", () => {
  it("shows a menu action in the bar once it is used often", () => {
    const now = 1_000 * DAY;
    expect(frequent(used(PROMOTE_AT - 1, "copy", now), ids, now)).toEqual([]);
    expect(frequent(used(PROMOTE_AT, "copy", now), ids, now)).toEqual(["copy"]);
  });

  it("counts quick uses a moment apart as whole uses", () => {
    let usage: UsageMap = {};
    for (let i = 0; i < PROMOTE_AT; i++) usage = recordUse(usage, "copy", 1_000 * DAY + i * 300);
    expect(frequent(usage, ids, 1_000 * DAY + 1_000)).toEqual(["copy"]);
  });

  it("keeps at most a few, the most used, in the menu's order", () => {
    const now = 1_000 * DAY;
    let usage = used(6, "share", now);
    usage = used(4, "copy", now, usage);
    usage = used(5, "edit", now, usage);
    expect(frequent(usage, ids, now)).toEqual(["share", "edit"]);
    expect(frequent(usage, ids, now)).toHaveLength(MAX_FREQUENT);
  });

  it("lets an icon go again when it falls out of use, later than it came", () => {
    const start = 1_000 * DAY;
    const usage = used(PROMOTE_AT + 1, "copy", start);
    expect(frequent(usage, ids, start)).toEqual(["copy"]);
    // Half as much after two weeks: below the bar to come in, above the one to go.
    const later = start + 14 * DAY;
    expect(faded(usage.copy, later)).toBeGreaterThan(DEMOTE_AT);
    expect(frequent(usage, ids, later)).toEqual(["copy"]);
    expect(frequent(usage, ids, start + 40 * DAY)).toEqual([]);
  });
});
