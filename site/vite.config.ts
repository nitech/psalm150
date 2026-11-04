import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { BRAND_MARK } from "../shared/brand.ts";
import { en, no, type Words } from "./src/text.ts";

const icon = readFileSync(new URL("../shared/brand/icon.svg", import.meta.url));
const template = fileURLToPath(new URL("./src/page.html", import.meta.url));

/** Each page and its words: English at /, Norwegian at /no/. */
const PAGES: Record<string, Words> = { "/index.html": en, "/no/index.html": no };

/**
 * The page in each language: src/page.html with every {{key}} from
 * src/text.ts. A key with no words stops the build rather than showing
 * {{key}} on the site.
 */
function pages(): Plugin {
  return {
    name: "psalm150-pages",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const words = PAGES[ctx.path];
        if (!words) return html;
        return readFileSync(template, "utf8").replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
          if (!(key in words)) throw new Error(`src/page.html: no words for {{${key}}}`);
          return words[key as keyof Words];
        });
      },
    },
    configureServer(server) {
      // The template is not an entry, so tell the browser when it changes.
      server.watcher.add(template);
      server.watcher.on("change", (file) => {
        if (file.replaceAll("\\", "/") === template.replaceAll("\\", "/")) server.ws.send({ type: "full-reload" });
      });
    },
  };
}

/**
 * The brand from shared/: the Wind mark where the page says <!-- brand-mark -->,
 * and the app icon as /favicon.svg, so the site never keeps copies of its own.
 */
function brand(): Plugin {
  return {
    name: "psalm150-brand",
    transformIndexHtml: (html) => html.replaceAll("<!-- brand-mark -->", BRAND_MARK),
    configureServer(server) {
      server.middlewares.use("/favicon.svg", (_req, res) => {
        res.setHeader("Content-Type", "image/svg+xml");
        res.end(icon);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "favicon.svg", source: icon });
    },
  };
}

export default defineConfig({
  plugins: [pages(), brand()],
  server: { port: 5180 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        en: fileURLToPath(new URL("./index.html", import.meta.url)),
        no: fileURLToPath(new URL("./no/index.html", import.meta.url)),
      },
    },
  },
});
