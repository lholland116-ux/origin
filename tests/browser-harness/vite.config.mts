import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const harnessRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: harnessRoot,
  envDir: false,
  envPrefix: "LVTCHAT_HARNESS_",
  cacheDir: "/tmp/lvtchat-er-ui-cs2-vite-cache",
  resolve: {
    alias: [{ find: /^@\//, replacement: `${repositoryRoot}/` }],
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    hmr: false,
    fs: { allow: [repositoryRoot] },
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
