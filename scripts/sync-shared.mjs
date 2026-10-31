// Mirrors the song server's shared files into this repo. The server repo is
// canonical; never edit a mirror by hand.
//
//   shared/psa150-tokens.css, shared/icons.ts,
//   shared/chord-match.ts                       →  src/shared/
//   shared/songs/ (editor, chords, recordings)  →  src/shared/songs/
//   web/public/sounds/ (the chord sounds)       →  public/sounds/
//   shared/lyrics/ (the online song lookup)     →  src-tauri/crates/psa150-lyrics/
//
//   bun run sync:shared    copy the files from the server checkout
//   bun run check:shared   fail if a mirror differs from the server
//
// The server checkout defaults to ../PSA150-server; set PSA150_SERVER_DIR to
// use another path.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = resolve(root, process.env.PSA150_SERVER_DIR ?? "../PSA150-server");
const check = process.argv.includes("--check");

/** `files`: only these; without it, the whole folder (build output left out). */
const MIRRORS = [
  { source: "shared", target: "src/shared", files: ["psa150-tokens.css", "icons.ts", "chord-match.ts"] },
  { source: "shared/songs", target: "src/shared/songs" },
  { source: "web/public/sounds", target: "public/sounds", binary: true },
  { source: "shared/lyrics", target: "src-tauri/crates/psa150-lyrics" },
];
const SKIPPED = new Set(["target", "Cargo.lock"]);

if (!existsSync(join(serverDir, "shared"))) {
  console.error(`No server checkout at ${serverDir} (set PSA150_SERVER_DIR).`);
  process.exit(2);
}

// Compare text with LF endings so a Windows checkout matches CI; sounds as they are.
const readText = (path) => (existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : null);
const readBytes = (path) => (existsSync(path) ? readFileSync(path) : null);
const same = (a, b) => (Buffer.isBuffer(a) && Buffer.isBuffer(b) ? a.equals(b) : a === b);

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const problems = [];
const changes = [];
for (const mirror of MIRRORS) {
  const sourceDir = join(serverDir, mirror.source);
  const targetDir = join(root, mirror.target);
  // A text file among the sounds (CREDITS.txt) compares as text.
  const read = (path) => (mirror.binary && !path.endsWith(".txt") ? readBytes(path) : readText(path));
  const files = mirror.files ?? listFiles(sourceDir).map((path) => relative(sourceDir, path));
  const stale = files.filter((file) => !same(read(join(sourceDir, file)), read(join(targetDir, file))));
  // A whole-folder mirror also loses files the server no longer has.
  const extra = mirror.files
    ? []
    : listFiles(targetDir)
        .map((path) => relative(targetDir, path))
        .filter((file) => !files.includes(file));
  if (check) {
    for (const file of [...stale, ...extra]) problems.push(join(mirror.target, file));
    continue;
  }
  for (const file of stale) {
    const target = join(targetDir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, read(join(sourceDir, file)));
    changes.push(`updated ${join(mirror.target, file)}`);
  }
  for (const file of extra) {
    rmSync(join(targetDir, file));
    changes.push(`removed ${join(mirror.target, file)}`);
  }
}

if (check) {
  if (problems.length) {
    console.error(`Out of date with the server: ${problems.join(", ")}. Run bun run sync:shared.`);
    process.exit(1);
  }
  console.log("The shared mirrors match the server.");
} else {
  console.log(changes.length ? changes.join("\n") : "The shared mirrors already match the server.");
}
