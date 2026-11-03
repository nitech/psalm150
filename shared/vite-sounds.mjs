// The chord sounds (shared/sounds/, credited in its CREDITS.txt) at /sounds/
// in both the web client and the desktop: served from this folder while
// developing and copied into each build. Plain JavaScript, so the apps'
// type checks (which include shared/) leave it alone.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const folder = fileURLToPath(new URL("./sounds/", import.meta.url));
const types = { ".mp3": "audio/mpeg", ".txt": "text/plain; charset=utf-8" };

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** @returns {import("vite").Plugin} */
export function sharedSounds() {
  return {
    name: "psa150-shared-sounds",
    configureServer(server) {
      server.middlewares.use("/sounds", (req, res, next) => {
        const path = join(folder, decodeURIComponent((req.url ?? "/").split("?")[0]));
        if (!path.startsWith(folder) || !existsSync(path) || statSync(path).isDirectory()) return next();
        res.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
        res.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const path of files(folder)) {
        const fileName = `sounds/${relative(folder, path).split(sep).join("/")}`;
        this.emitFile({ type: "asset", fileName, source: readFileSync(path) });
      }
    },
  };
}
