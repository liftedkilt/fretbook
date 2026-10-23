import { expect, test } from "./support/fixtures";

test("the library loads and filters", async ({ page, seed }) => {
  await seed.musicXmlTab();
  await seed.chordSheet();
  await seed.syncedSongWithAudio();

  await page.goto("/");
  await expect(page.getByTestId("song-card")).toHaveCount(3);
  await expect(page.getByTestId("library-filter-all")).toContainText("3");

  // Instrument filters count what the server stored.
  await page.getByTestId("library-filter-bass").click();
  await expect(page.getByTestId("song-card")).toHaveCount(2);
  await page.getByTestId("library-filter-chords").click();
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await expect(page.getByTestId("song-title")).toHaveText("Sunny Day Blues");
  await page.getByTestId("library-filter-all").click();

  // Search matches the title and the artist.
  await page.getByTestId("library-search").fill("groove");
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await expect(page.getByTestId("song-title")).toHaveText("Synced Groove");
  await page.getByTestId("library-search").fill("no such song");
  await expect(page.getByTestId("library-filter-empty")).toBeVisible();
  await page.getByTestId("library-search").fill("");
  await expect(page.getByTestId("song-card")).toHaveCount(3);
});

test("an empty library invites you to add a song", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("library-empty")).toBeVisible();
  await expect(page.getByTestId("song-card")).toHaveCount(0);
});
