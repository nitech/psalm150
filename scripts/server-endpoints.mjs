// Lists the song server paths the desktop calls, so a release can record
// them in latest.json and installed apps can check their server has every
// one before updating (src-tauri/src/updater.rs).
//
//   node scripts/server-endpoints.mjs    print the paths as a JSON array
//
// Paths are found as string literals starting with `api/v1/`, `/api/v1/` or
// `{}/api/v1/` in src-tauri/src, outside comments and `#[cfg(test)]` modules.
// Parameters become `{}` and query strings are dropped, the same way the
// app normalises the server's OpenAPI paths.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LITERAL = /"(?:\{\})?\/?(api\/v1\/[^"\s]*)"/g;

/** `api/v1/sets/{id}?wait=5` → `/api/v1/sets/{}` */
export function normalizeEndpoint(path) {
  const withoutQuery = path.split("?")[0].replace(/\/+$/, "");
  const rooted = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return rooted.replace(/\{[^}]*\}/g, "{}");
}

/** The server paths one Rust source file calls. */
export function extractEndpoints(source) {
  const code = source.replace(/\r\n/g, "\n").split(/^#\[cfg\(test\)\]\s*\nmod /m)[0];
  const found = new Set();
  for (const line of code.split("\n")) {
    if (line.trim().startsWith("//")) continue;
    for (const match of line.matchAll(LITERAL)) found.add(normalizeEndpoint(match[1]));
  }
  return found;
}

function rustFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return rustFiles(path);
    return entry.name.endsWith(".rs") ? [path] : [];
  });
}

/** Every server path the desktop calls, sorted. */
export function desktopEndpoints(root) {
  const all = new Set();
  for (const file of rustFiles(join(root, "src-tauri", "src"))) {
    for (const endpoint of extractEndpoints(readFileSync(file, "utf8"))) all.add(endpoint);
  }
  return [...all].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify(desktopEndpoints(root)));
}
