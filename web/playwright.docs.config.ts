import { defineConfig, devices } from "@playwright/test";

// Screenshots for the documentation site (docs/). Same per-test server as the e2e suite; see
// e2e/docs/screenshots.shots.ts and `npm run docs:screenshots`.
export default defineConfig({
  testDir: "./e2e/docs",
  testMatch: "**/*.shots.ts",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: { locale: "en-US", deviceScaleFactor: 1 },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: a Chromium that is not the one `playwright install` fetched.
        launchOptions: { executablePath: process.env.FRETBOOK_CHROMIUM || undefined },
      },
    },
  ],
});
