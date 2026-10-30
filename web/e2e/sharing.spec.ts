import { test as base, expect } from "@playwright/test";

import { Seeder } from "./support/seed";
import { menuItem } from "./support/song-page";
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
  await menuItem(page, "song-share");
  await page.getByTestId("share-create").click();
  const url = await page.getByTestId("share-url").inputValue();
  expect(url).toContain("/share/sh_");

  await page.goto(url);
  await expect(page.getByTestId("share-player")).toBeVisible();
  await expect(page.getByTestId("song-heading")).toHaveText(song.title);
  await expect(page.getByTestId("song-edit-link")).toHaveCount(0);
});

test("a song moves from the personal library into a band library", async ({ page, request }) => {
  const song = await new Seeder(request).chordSheet();
  const created = await request.post("/api/libraries", { data: { name: "Tuesday Night" } });
  expect(created.ok()).toBe(true);
  const band = (await created.json()) as { id: string };

  await page.goto(`/songs/${song.id}`);
  await menuItem(page, "song-move");
  const destination = page.getByTestId("move-destination");
  await expect(destination.locator("option")).toHaveText(["Tuesday Night"]);
  await expect(destination).toHaveValue(band.id);
  const movedResponse = page.waitForResponse(
    (response) => response.url().includes("/move") && response.request().method() === "POST",
  );
  await page.getByTestId("move-move").click();
  expect((await movedResponse).ok()).toBe(true);
  await expect(page.getByTestId("move-sheet")).toBeHidden();
  await expect(page.getByTestId("song-heading")).toHaveText(song.title);

  const personal = await request.get("/api/songs");
  expect(personal.ok()).toBe(true);
  expect(((await personal.json()) as { total: number }).total).toBe(0);
  const inBand = await request.get(`/api/songs?library=${band.id}`);
  expect(inBand.ok()).toBe(true);
  const moved = (await inBand.json()) as { total: number; items: { title: string }[] };
  expect(moved.total).toBe(1);
  expect(moved.items[0]?.title).toBe(song.title);

  await page.goto("/");
  await expect(page.getByTestId("song-title")).toHaveText(song.title);
  await page.getByTestId("library-switcher").selectOption({ label: "Your library" });
  await expect(page.getByTestId("library-empty")).toBeVisible();
  await page.getByTestId("library-switcher").selectOption({ label: "Tuesday Night" });
  await expect(page.getByTestId("song-title")).toHaveText(song.title);
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
