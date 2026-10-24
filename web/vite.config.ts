import { alphaTab } from "@coderline/alphatab-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig, type ProxyOptions } from "vitest/config";

// The API refuses a write whose Origin host is not the Host header. The dev
// proxy must keep the browser's host, or every save from `npm run dev` is a 403.
const apiProxy: ProxyOptions = {
  target: "http://127.0.0.1:8137",
  changeOrigin: false,
  configure(proxy) {
    proxy.on("proxyReq", (proxyReq, req) => {
      const host = req.headers.host;
      if (host) proxyReq.setHeader("host", host);
    });
  },
};

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
      "/api": apiProxy,
      "/auth": apiProxy,
    },
  },
  test: {
    testTimeout: 15000,
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
          include: [
            "src/components/**/*.test.ts",
            // Components import these too. v8 reports each project separately and the merged figure
            // follows whichever report wins, so run their tests here as well to keep it steady.
            "src/lib/highway.test.ts",
            "src/lib/playback.test.ts",
            "src/lib/tuner.test.ts",
            "src/lib/ui.svelte.test.ts",
            "src/lib/listen/calibration.test.ts",
            "src/lib/listen/input.test.ts",
          ],
          setupFiles: ["src/setupTests.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Svelte components are left out: v8 cannot attribute coverage to them under Vitest's node
      // environment (untested ones report 100%), and Playwright covers them as user flows.
      include: ["src/**/*.ts"],
      // Generated from openapi.json, entry point, and ambient type declarations.
      exclude: [
        "src/**/*.test.ts",
        "src/lib/api-types.ts",
        "src/main.ts",
        "src/**/*.d.ts",
        // Runs in the AudioWorkletGlobalScope, which Vitest cannot host; the DSP it wraps is covered.
        "src/lib/listen/processor.ts",
      ],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      // The floor: current coverage rounded down. Raise it as tests are added; never lower it.
      thresholds: { lines: 90, statements: 90, functions: 94, branches: 83 },
    },
  },
});
