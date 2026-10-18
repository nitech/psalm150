import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import { desktopEndpoints, extractEndpoints, normalizeEndpoint } from "../scripts/server-endpoints.mjs";

describe("server endpoints", () => {
  it("normalises parameters, queries and the leading slash", () => {
    expect(normalizeEndpoint("api/v1/songs/{id}")).toBe("/api/v1/songs/{}");
    expect(normalizeEndpoint("api/v1/remote/desktop/commands?wait={LONG_POLL_SECONDS}")).toBe(
      "/api/v1/remote/desktop/commands",
    );
  });

  it("finds called paths but not comments or test modules", () => {
    const source = [
      'let a = base.join("api/v1/songs/import");',
      'let b = format!("{}/api/v1/info", url);',
      'let c = endpoint(url, &format!("api/v1/sets/{}", id));',
      "/// `DELETE /api/v1/session` in a doc comment",
      '// base.join("api/v1/commented")',
      'let d = "/church/api/v1/prefixed";',
      "#[cfg(test)]",
      "mod tests {",
      '    let e = "api/v1/only-in-tests";',
      "}",
    ].join("\n");
    expect([...extractEndpoints(source)].sort()).toEqual([
      "/api/v1/info",
      "/api/v1/sets/{}",
      "/api/v1/songs/import",
    ]);
  });

  it("finds the paths the desktop uses for sign-in, sync and the remote", () => {
    const endpoints = desktopEndpoints(process.cwd());
    for (const path of ["/api/v1/info", "/api/v1/songs/export", "/api/v1/sets/{}", "/api/v1/remote/desktop"]) {
      expect(endpoints).toContain(path);
    }
    expect(endpoints.every((path: string) => path.startsWith("/api/v1/") && !path.includes("?"))).toBe(true);
  });
});
