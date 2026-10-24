import { expect, test } from "./support/fixtures";

test("tag a song, star it, and filter the library by tags and favourites", async ({
  page,
  seed,
}) => {
  const funk = await seed.create({ title: "Slap Funk", artist: "Band" });
  await seed.create({ title: "Slow Blues", artist: "Band" });
  await seed.create({ title: "Jazz Walk", artist: "Band" });

  // Tag and star from the song page.
  await page.goto(`/songs/${funk.id}`);
  await page.getByTestId("song-tag-input").fill("funk");
  await page.getByTestId("song-tag-input").press("Enter");
  await expect(page.getByTestId("song-tag")).toHaveText(/funk/);
  await page.getByTestId("song-tag-input").fill("slap");
  await page.getByTestId("song-tag-input").press("Enter");
  await expect(page.getByTestId("song-tag")).toHaveCount(2);
  await page.getByTestId("song-favourite").click();
  await expect(page.getByTestId("song-favourite")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("side-favourites")).toContainText("Slap Funk");

  // The library offers the tags as filters and the star as a section.
  await page.goto("/");
  await expect(page.getByTestId("song-card")).toHaveCount(3);
  await expect(page.getByTestId("library-filter-favourites")).toContainText("1");
  await page.getByTestId("library-tag").filter({ hasText: "funk" }).click();
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await expect(page.getByTestId("song-title")).toHaveText("Slap Funk");
  await page.getByTestId("library-tag").filter({ hasText: "slap" }).click();
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await page.getByTestId("library-tag").filter({ hasText: "funk" }).click();
  await page.getByTestId("library-tag").filter({ hasText: "slap" }).click();
  await expect(page.getByTestId("song-card")).toHaveCount(3);
  await page.getByTestId("library-filter-favourites").click();
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await page.getByTestId("library-filter-favourites").click();

  // Bulk tagging: select every song shown and add a tag.
  await page.getByTestId("library-select").click();
  await page.getByTestId("library-select-all").click();
  await expect(page.getByTestId("library-selected")).toContainText("3");
  await page.getByTestId("library-bulk-tag").fill("practice");
  await page.getByTestId("library-bulk-apply").click();
  await expect(page.getByTestId("library-bulk-notice")).toContainText("practice");
  await page.getByTestId("library-tag").filter({ hasText: "practice" }).click();
  await expect(page.getByTestId("song-card")).toHaveCount(3);
});

test("an imported song starts with tags suggested from its instrument", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("song-tag").first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("song-card-tags")).toBeVisible();
});

test("rename, merge and delete a tag from the library", async ({ page, seed }) => {
  const one = await seed.create({ title: "One", artist: "Band" });
  const two = await seed.create({ title: "Two", artist: "Band" });
  for (const [song, tags] of [
    [one, ["funk", "jazz"]],
    [two, ["jazz", "blues"]],
  ] as const) {
    await page.goto(`/songs/${song.id}`);
    for (const tag of tags) {
      await page.getByTestId("song-tag-input").fill(tag);
      await page.getByTestId("song-tag-input").press("Enter");
    }
    await expect(page.getByTestId("song-tag")).toHaveCount(2);
  }

  await page.goto("/");
  await page.getByTestId("library-manage-tags").click();
  const row = (tag: string) => page.getByTestId("manage-tag").filter({ hasText: tag });

  // Rename.
  await row("funk").getByTestId("manage-tag-rename").click();
  await page.getByTestId("manage-tag-name").fill("groove");
  await page.getByTestId("manage-tag-save").click();
  await expect(page.getByTestId("manage-tags-notice")).toContainText("groove");
  await expect(row("groove")).toBeVisible();
  await expect(row("funk")).toHaveCount(0);

  // Merge "blues" into "jazz": song Two keeps one jazz tag.
  await row("blues").getByTestId("manage-tag-rename").click();
  await page.getByTestId("manage-tag-name").fill("jazz");
  await expect(page.getByTestId("manage-tag-merge")).toBeVisible();
  await page.getByTestId("manage-tag-save").click();
  await expect(row("blues")).toHaveCount(0);
  await expect(row("jazz")).toContainText("2");

  // Delete.
  await row("groove").getByTestId("manage-tag-delete").click();
  await page.getByTestId("manage-tag-confirm").click();
  await expect(row("groove")).toHaveCount(0);

  await page.goto(`/songs/${two.id}`);
  await expect(page.getByTestId("song-tag")).toHaveCount(1);
  await expect(page.getByTestId("song-tag")).toHaveText(/jazz/);
});
