import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";

import manifest from "./manifest.config.ts";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // MV3 service workers and content scripts run on modern Chromium only.
    target: "chrome120",
    rollupOptions: {
      // Keep hashed asset names predictable for review; CRXJS still emits the
      // manifest with the resolved filenames.
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
