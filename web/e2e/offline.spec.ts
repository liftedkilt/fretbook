import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

// The service worker is what makes the rest of this work, so it must be on here (it is blocked elsewhere).
test.use({ serviceWorkers: "allow" });

const SHEET = (word: string) => `{title: ${word}}\n[C]${word} [G]line\n`;

/** Wait for the worker to install, precache the app and take control of the page. */
async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 45_000,
  });
}

test("a saved song opens with no network, and an edit made offline is sent when it returns", async ({
  page,
  context,
  seed,
}) => {
  const song = await seed.create({ title: "Gig Tune", chordpro: SHEET("Gig Tune") });

  await page.goto(`/songs/${song.id}`);
  await controlled(page);
  await expect(page.getByTestId("song-heading")).toHaveText("Gig Tune");
  await page.getByTestId("offline-toggle").click();
  await expect(page.getByTestId("offline-toggle")).toContainText("Available offline");

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("song-heading")).toHaveText("Gig Tune");
  await expect(page.getByTestId("offline-indicator")).toBeVisible();

  // Edit while offline: the save is accepted and queued.
  await page.goto(`/songs/${song.id}/edit`);
  await expect(page.getByTestId("chord-text")).toBeVisible();
  await page.getByTestId("chord-text").fill(SHEET("Gig Tune") + "[Am]offline edit\n");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toBeVisible();
  await expect(page.getByTestId("offline-queued")).toBeVisible();

  // The saved copy already shows the edit.
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByText("offline edit", { exact: true })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByTestId("offline-status")).toBeHidden({ timeout: 15_000 });
  const saved = await page.request.get(`/api/songs/${song.id}`);
  expect(((await saved.json()) as { chordpro: string }).chordpro).toContain("offline edit");
});

test("an offline edit to a song changed elsewhere is surfaced, and can be kept", async ({
  page,
  context,
  seed,
}) => {
  const song = await seed.create({ title: "Contested", chordpro: SHEET("Contested") });
  await page.goto(`/songs/${song.id}/edit`);
  await controlled(page);
  await expect(page.getByTestId("chord-text")).toBeVisible();

  await context.setOffline(true);
  await page.getByTestId("chord-text").fill(SHEET("Contested") + "[Em]mine\n");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("offline-queued")).toBeVisible();

  // Someone else saves the song first.
  const current = (await (await page.request.get(`/api/songs/${song.id}`)).json()) as {
    revision: number;
  };
  const theirs = await page.request.put(`/api/songs/${song.id}`, {
    data: {
      title: "Contested",
      artist: "",
      revision: current.revision,
      chordpro: SHEET("Contested") + "[D]theirs\n",
    },
  });
  expect(theirs.ok()).toBe(true);

  await context.setOffline(false);
  await expect(page.getByTestId("offline-conflict")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("offline-keep-mine").click();
  await expect(page.getByTestId("offline-status")).toBeHidden();
  const saved = await page.request.get(`/api/songs/${song.id}`);
  const body = (await saved.json()) as { chordpro: string };
  expect(body.chordpro).toContain("mine");
  expect(body.chordpro).not.toContain("theirs");
});

test("a saved setlist plays with no network", async ({ page, context, seed }) => {
  const first = await seed.create({ title: "Opener", chordpro: SHEET("Opener") });
  const second = await seed.create({ title: "Closer", chordpro: SHEET("Closer") });
  const made = await page.request.post("/api/setlists", { data: { name: "Friday" } });
  const setlist = (await made.json()) as { id: string };
  await page.request.put(`/api/setlists/${setlist.id}/entries`, {
    data: {
      entries: [first, second].map((song) => ({ song_id: song.id, note: "", transpose: 0 })),
    },
  });

  await page.goto(`/setlists/${setlist.id}`);
  await controlled(page);
  await page.getByTestId("offline-toggle").click();
  await expect(page.getByTestId("offline-toggle")).toContainText("Available offline");

  await context.setOffline(true);
  await page.goto(`/setlists/${setlist.id}/play/2`);
  await expect(page.getByTestId("setlist-position")).toHaveText("Song 2 of 2");
  await expect(page.getByTestId("song-heading")).toHaveText("Closer");
});

test("the manifest makes the app installable", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const response = await page.request.get(new URL(href!, page.url()).href);
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    display: string;
    icons: { sizes: string; purpose?: string }[];
  };
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
});

test("a favourite and a tag set offline are queued and sent when the network returns", async ({
  page,
  context,
  seed,
}) => {
  const song = await seed.create({ title: "Queued Marks", chordpro: SHEET("Queued Marks") });

  await page.goto(`/songs/${song.id}`);
  await controlled(page);
  await expect(page.getByTestId("song-heading")).toHaveText("Queued Marks");
  await page.getByTestId("offline-toggle").click();
  await expect(page.getByTestId("offline-toggle")).toContainText("Available offline");

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("offline-indicator")).toBeVisible();
  await page.getByTestId("song-favourite").click();
  await page.getByTestId("song-tag-input").fill("gig");
  await page.getByTestId("song-tag-input").press("Enter");
  await expect(page.getByTestId("song-tag")).toContainText("gig");
  await expect(page.getByTestId("offline-queued")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByTestId("offline-status")).toBeHidden({ timeout: 15_000 });
  const saved = (await (await page.request.get(`/api/songs/${song.id}`)).json()) as {
    tags: string[];
    favourite: boolean;
  };
  expect(saved.tags).toEqual(["gig"]);
  expect(saved.favourite).toBe(true);
});
