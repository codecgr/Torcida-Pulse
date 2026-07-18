import { defineConfig } from "vitest/config";

export default defineConfig({
  // The release is a same-origin Node service (see docs/DEPLOYMENT.md), so
  // root-relative assets also resolve correctly for social crawlers.
  base: "/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4173",
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
