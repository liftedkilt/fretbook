import { defineConfig, devices } from "@playwright/test";

// Each test starts its own Fretbook server on a free port (see e2e/support/fixtures.ts),
// so there is no `webServer` here and tests can run in parallel without sharing a library.
// The server serves the built app: run `npm run build` first (`npm run e2e` does).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    // Stable English UI whatever the machine's language is; the language test switches it itself.
    locale: "en-US",
    acceptDownloads: true,
    // The service worker precaches the whole app on every fresh context, which is slow and can serve stale files.
    // e2e/offline.spec.ts turns it back on.
    serviceWorkers: "block",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
