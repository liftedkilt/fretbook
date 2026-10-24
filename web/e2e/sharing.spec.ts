import { test as base, expect } from "@playwright/test";

import { Seeder } from "./support/seed";
import { type RunningServer, startServer } from "./support/server";

const test = base.extend<{ server: RunningServer }>({
  server: async ({}, use) => {
    const server = await startServer({ env: { FRETBOOK_SHARE_LINKS: "true" } });
    try {
      await use(server);
    } finally {
      await server.stop();
    }
  },
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
});

test("a share link opens the song without the editor", async ({ page, request }) => {
  const song = await new Seeder(request).chordSheet();
  await page.goto(`/songs/${song.id}`);
  await page.getByTestId("song-share").click();
  await page.getByTestId("share-create").click();
  const url = await page.getByTestId("share-url").inputValue();
  expect(url).toContain("/share/sh_");

  await page.goto(url);
  await expect(page.getByTestId("share-player")).toBeVisible();
  await expect(page.getByTestId("song-heading")).toHaveText(song.title);
  await expect(page.getByTestId("song-edit-link")).toHaveCount(0);
});

test("a band library is separate from the personal library", async ({ page, request }) => {
  await new Seeder(request).chordSheet();
  await page.goto("/bands");
  await page.getByTestId("band-name").fill("Tuesday Night");
  await page.getByTestId("band-create").click();
  await expect(page.getByRole("heading", { name: "Tuesday Night" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("library-empty")).toBeVisible();
  await page.getByTestId("library-switcher").selectOption({ label: "Your library" });
  await expect(page.getByTestId("song-title")).toHaveText("Sunny Day Blues");
});
