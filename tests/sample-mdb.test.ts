import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("sample mdb fixture", () => {
  it("exists in repo", () => {
    const path = join(process.cwd(), "brattvaag-2018-12-28.mdb");
    expect(existsSync(path)).toBe(true);
    const stat = readFileSync(path);
    expect(stat.length).toBeGreaterThan(0);
  });
});
