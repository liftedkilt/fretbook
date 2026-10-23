import { defineConfig } from "vite";

// One self-contained file (alphaTab included) so the runtime image needs only the Node binary:
// `npm run build:gp-cli` writes dist-gp/gp-to-document.mjs.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: "scripts/gp-to-document.ts",
    outDir: "dist-gp",
    emptyOutDir: true,
    target: "node22",
    rollupOptions: { output: { entryFileNames: "gp-to-document.mjs", format: "es" } },
  },
  ssr: { noExternal: true },
});
