import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// The sample songbook is not in git; copy it to the repo root to run this.
const path = join(process.cwd(), "brattvaag-2018-12-28.mdb");

describe("sample mdb fixture", () => {
  it.skipIf(!existsSync(path))("is readable when present", () => {
    expect(readFileSync(path).length).toBeGreaterThan(0);
  });
});
