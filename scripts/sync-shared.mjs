// Mirrors the song server's shared UI files (design tokens, icon paths) into
// src/shared/. The server repo is canonical; never edit the mirror by hand.
//
//   bun run sync:shared    copy the files from the server checkout
//   bun run check:shared   fail if the mirror differs from the server
//
// The server checkout defaults to ../PSA150-server; set PSA150_SERVER_DIR to
// use another path.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["psa150-tokens.css", "icons.ts"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = resolve(root, process.env.PSA150_SERVER_DIR ?? "../PSA150-server");
const sourceDir = join(serverDir, "shared");
const targetDir = join(root, "src", "shared");
const check = process.argv.includes("--check");

if (!existsSync(sourceDir)) {
  console.error(`No server checkout at ${serverDir} (set PSA150_SERVER_DIR).`);
  process.exit(2);
}

// Compare text with LF endings so a Windows checkout matches CI.
const read = (path) => (existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : null);

const stale = FILES.filter((file) => read(join(sourceDir, file)) !== read(join(targetDir, file)));

if (check) {
  if (stale.length) {
    console.error(`src/shared/ is out of date with the server: ${stale.join(", ")}. Run bun run sync:shared.`);
    process.exit(1);
  }
  console.log("src/shared/ matches the server.");
} else {
  mkdirSync(targetDir, { recursive: true });
  for (const file of stale) writeFileSync(join(targetDir, file), read(join(sourceDir, file)));
  console.log(stale.length ? `Updated ${stale.join(", ")}.` : "src/shared/ already matches the server.");
}
