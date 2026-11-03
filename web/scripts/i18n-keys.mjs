// The texts the web client translates, read from the source: every
// `t("…")` and `tn(count, "…", "…")` with a plain string (no `${}`) in
// web/src and shared/songs. Translators fill web/src/i18n/{code}.json.
//
//   node web/scripts/i18n-keys.mjs           every key, as JSON
//   node web/scripts/i18n-keys.mjs nb        the keys nb.json lacks
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = [join(web, "src"), join(web, "..", "shared", "songs")];

const BACKSLASH = "\\\\";
/** A quoted string whose quote is capture group `group`, its text the next. */
const string = (group) => `(["'\`])((?:${BACKSLASH}.|(?!\\${group})[^${BACKSLASH}])*)\\${group}`;
const T = new RegExp(`\\bt\\(\\s*${string(1)}`, "g");
// The count is a name, a property or one call: `tn(songs.length, …)`.
const TN = new RegExp(`\\btn\\(\\s*[^,()]+(?:\\([^()]*\\))?\\s*,\\s*${string(1)}\\s*,\\s*${string(3)}`, "g");

const unescape = (text) => text.replace(/\\(.)/g, (_, character) => (character === "n" ? "\n" : character));

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "i18n" ? [] : files(path);
    return /\.ts$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** Every key: for `t` the text, for `tn` the English plural, with its singular. */
export function collectKeys() {
  const keys = new Map();
  for (const file of ROOTS.flatMap(files)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(T)) {
      if (match[1] === "`" && match[2].includes("${")) continue;
      const key = unescape(match[2]);
      if (!keys.has(key)) keys.set(key, { key });
    }
    for (const match of source.matchAll(TN)) {
      const other = unescape(match[4]);
      keys.set(other, { key: other, one: unescape(match[2]) });
    }
  }
  return [...keys.values()];
}

export function catalogPath(code) {
  return join(web, "src", "i18n", `${code}.json`);
}

export function readCatalog(code) {
  const path = catalogPath(code);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = process.argv[2];
  const keys = collectKeys();
  const catalog = code ? readCatalog(code) : {};
  const wanted = code ? keys.filter(({ key }) => !(key in catalog)) : keys;
  process.stdout.write(`${JSON.stringify(wanted, null, 2)}\n`);
}
