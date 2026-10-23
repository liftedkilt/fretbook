import { test as base, expect, request as playwrightRequest } from "@playwright/test";

import { Seeder } from "./seed";
import { type RunningServer, startServer } from "./server";

type Fixtures = {
  /** A fresh single-user server with an empty library and its own data directory, stopped after the test. */
  server: RunningServer;
  /** Seeds `server` over its API. */
  seed: Seeder;
};

export const test = base.extend<Fixtures>({
  server: async ({}, use) => {
    const external = process.env.FRETBOOK_TEST_URL;
    if (external) {
      const url = external.replace(/\/$/, "");
      const parsed = new URL(url);
      const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
      await use({
        url,
        port,
        dataDir: "",
        stop: async () => {},
      });
      return;
    }
    const server = await startServer();
    try {
      await use(server);
    } finally {
      await server.stop();
    }
  },
  seed: async ({ server }, use) => {
    const context = await playwrightRequest.newContext({ baseURL: server.url });
    try {
      await use(new Seeder(context));
    } finally {
      await context.dispose();
    }
  },
  // Every page of a test talks to that test's server.
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
});

export { expect };
