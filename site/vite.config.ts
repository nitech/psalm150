import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { BRAND_MARK } from "../shared/brand.ts";

const icon = readFileSync(new URL("../shared/brand/icon.svg", import.meta.url));

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
  plugins: [brand()],
  server: { port: 5180 },
  build: { outDir: "dist", emptyOutDir: true },
});
