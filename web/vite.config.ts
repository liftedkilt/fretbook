import { alphaTab } from "@coderline/alphatab-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte(), alphaTab(), svelteTesting()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8137",
      "/auth": "http://127.0.0.1:8137",
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/lib/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["src/components/**/*.test.ts"],
          setupFiles: ["src/setupTests.ts"],
        },
      },
    ],
  },
});
