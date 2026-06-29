import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@hellodword/curl-parser/browser": fileURLToPath(
        new URL("../../packages/node/src/browser.ts", import.meta.url),
      ),
    },
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL("../..", import.meta.url))],
    },
  },
});
