import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { alphaTab } from "@coderline/alphatab-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { build, type Plugin } from "vite";
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

// Build output the app does not need offline: other font formats alphaTab never picks, licence text, the
// second soundfont, and the Guitar Pro converter worker that only runs while importing.
const NOT_PRECACHED =
  /^(index\.html|sw\.js)$|\.(map|txt|md|eot|otf|svg)$|^font\/.*\.svg$|LICENSE$|\.sf3$|gpWorker-/;

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? listFiles(full, base)
      : [path.relative(base, full).split(path.sep).join("/")];
  });
}

/**
 * Bundles `src/sw.ts` into `dist/sw.js` after the app build, with the list of files to precache and a version
 * that changes whenever any of them does. The favicon stays in: the manifest and apple-touch icons point at it.
 */
function fretbookServiceWorker(): Plugin {
  let root = "";
  let outDir = "";
  return {
    name: "fretbook-service-worker",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files = listFiles(outDir).filter(
        (file) => !NOT_PRECACHED.test(file) || file === "favicon.svg",
      );
      files.sort();
      const hash = createHash("sha256");
      for (const file of files) hash.update(file).update(readFileSync(path.join(outDir, file)));
      await build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: "warn",
        define: {
          __PRECACHE__: JSON.stringify(files),
          __VERSION__: JSON.stringify(hash.digest("hex").slice(0, 12)),
        },
        build: {
          outDir,
          emptyOutDir: false,
          lib: {
            entry: path.resolve(root, "src/sw.ts"),
            formats: ["iife"],
            name: "fretbookSw",
            fileName: () => "sw.js",
          },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), alphaTab(), svelteTesting(), fretbookServiceWorker()],
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
        // Glue between the service worker events and `offline/swCore.ts`, which is tested. Playwright covers it.
        "src/sw.ts",
      ],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      // The floor: current coverage rounded down. Raise it as tests are added; never lower it.
      thresholds: { lines: 90, statements: 90, functions: 94, branches: 83 },
    },
  },
});
