import { defineConfig } from "vite";
import { sharedSounds } from "../shared/vite-sounds.mjs";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [sharedSounds()],
  // Shown at the foot of the menu, so a deploy can be told from the last one.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
