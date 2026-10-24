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

test("search, sort and paging run on the server", async ({ page, seed }) => {
  for (let index = 1; index <= 50; index += 1) {
    await seed.create({ title: `Song ${String(index).padStart(2, "0")}`, artist: "Paged Band" });
  }
  await seed.create({ title: "Needle in a Haystack", artist: "Lone Wolf" });

  await page.goto("/");
  // 51 songs, 48 per page.
  await expect(page.getByTestId("song-card")).toHaveCount(48);
  await expect(page.getByTestId("library-showing")).toContainText("48");
  await page.getByTestId("library-load-more").click();
  await expect(page.getByTestId("song-card")).toHaveCount(51);
  await expect(page.getByTestId("library-load-more")).toHaveCount(0);

  // "/" jumps to the search box; the match comes from the server.
  await page.keyboard.press("/");
  await expect(page.getByTestId("library-search")).toBeFocused();
  await page.keyboard.type("hayst");
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await expect(page.getByTestId("song-title")).toHaveText("Needle in a Haystack");
  await page.getByTestId("library-search").fill("zzzz");
  await expect(page.getByTestId("library-filter-empty")).toBeVisible();
  await page.getByTestId("library-clear-search").click();
  await expect(page.getByTestId("song-card")).toHaveCount(48);

  // Sorting is remembered across reloads.
  await page.getByTestId("library-sort").selectOption("title");
  await expect(page.getByTestId("song-title").first()).toHaveText("Needle in a Haystack");
  await page.getByTestId("library-order").click();
  await expect(page.getByTestId("song-title").first()).toHaveText("Song 50");
  await page.reload();
  await expect(page.getByTestId("library-sort")).toHaveValue("title");
  await expect(page.getByTestId("song-title").first()).toHaveText("Song 50");
});

test("a search that matches only the lyrics shows the matching line", async ({ page, seed }) => {
  await seed.chordSheet();
  await page.goto("/");
  const search = page.getByTestId("library-search");

  await search.fill("road today");
  const card = page.getByTestId("song-card");
  await expect(card).toHaveCount(1);
  const snippet = card.getByTestId("song-lyrics-snippet");
  await expect(snippet).toContainText("Walking down the road today");
  await expect(snippet.locator("mark")).toHaveText(["road", "today"]);

  // A title match needs no explanation.
  await search.fill("sunny day");
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("song-lyrics-snippet")).toHaveCount(0);
});

test("opening a song feeds the last opened sort", async ({ page, seed }) => {
  await seed.create({ title: "Alpha" });
  const beta = await seed.create({ title: "Beta" });
  await page.goto(`/songs/${beta.id}`);
  await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();

  await page.goto("/");
  await page.getByTestId("library-sort").selectOption("opened");
  await expect(page.getByTestId("song-title").first()).toHaveText("Beta");
});
