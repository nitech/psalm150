import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setLanguage, t, tn } from "../../shared/songs/i18n.ts";
// @ts-expect-error: a plain Node script without types.
import { catalogPath, collectKeys, readCatalog } from "../scripts/i18n-keys.mjs";

describe("t and tn", () => {
  afterEach(() => setLanguage("en", {}));

  it("falls back to English and fills in values", () => {
    expect(t("Add {title} to {set}", { title: "Amazing Grace", set: "Sunday" })).toBe("Add Amazing Grace to Sunday");
    setLanguage("nb", { "Search songs": "Søk i sanger" });
    expect(t("Search songs")).toBe("Søk i sanger");
    expect(t("Not translated")).toBe("Not translated");
  });

  it("picks the plural form of the language", () => {
    expect(tn(1, "{n} song", "{n} songs")).toBe("1 song");
    expect(tn(3, "{n} song", "{n} songs")).toBe("3 songs");
    setLanguage("pl", { "{n} songs": { one: "{n} pieśń", few: "{n} pieśni", many: "{n} pieśni", other: "{n} pieśni" } });
    expect(tn(1, "{n} song", "{n} songs")).toBe("1 pieśń");
    expect(tn(22, "{n} song", "{n} songs")).toBe("22 pieśni");
  });
});

type Key = { key: string; one?: string };
const keys: Key[] = collectKeys();
const codes = readdirSync(join(catalogPath("en"), "..")).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""));
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);

describe.each(codes)("the %s catalog", (code) => {
  const catalog = readCatalog(code) as Record<string, string | Record<string, string>>;

  it("translates every text on screen, and nothing that is gone", () => {
    expect(keys.filter(({ key }) => !(key in catalog)).map(({ key }) => key)).toEqual([]);
    const known = new Set(keys.map(({ key }) => key));
    expect(Object.keys(catalog).filter((key) => !known.has(key))).toEqual([]);
  });

  it("keeps the values and their names", () => {
    for (const { key } of keys) {
      const message = catalog[key];
      if (message === undefined) continue;
      const forms = typeof message === "string" ? [message] : Object.values(message);
      // A form may leave out the count ("one song" as "én sang"), nothing else.
      const wanted = new Set(placeholders(key));
      for (const form of forms) {
        const found = new Set(placeholders(form));
        expect([...found].filter((name) => !wanted.has(name)), `${code}: ${key}`).toEqual([]);
        expect([...wanted].filter((name) => name !== "n" && !found.has(name)), `${code}: ${key}`).toEqual([]);
      }
    }
  });
});
