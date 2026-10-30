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
  // Everything is shown, so there is no "Showing N of M".
  await expect(page.getByTestId("library-showing")).toHaveCount(0);

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
  await page.getByTestId("library-sort").selectOption("title:asc");
  await expect(page.getByTestId("song-title").first()).toHaveText("Needle in a Haystack");
  await page.getByTestId("library-sort").selectOption("title:desc");
  await expect(page.getByTestId("song-title").first()).toHaveText("Song 50");
  await page.reload();
  await expect(page.getByTestId("library-sort")).toHaveValue("title:desc");
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
  await page.getByTestId("library-sort").selectOption("opened:desc");
  await expect(page.getByTestId("song-title").first()).toHaveText("Beta");
});

test("the toolbar is one row on a desktop and the popover holds the filters", async ({
  page,
  seed,
}) => {
  await seed.musicXmlTab();
  await seed.chordSheet();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("song-card")).toHaveCount(2);

  const [search, sort, filters, select] = await Promise.all(
    ["library-search", "library-sort", "library-filters", "library-select"].map(async (id) =>
      page.getByTestId(id).boundingBox(),
    ),
  );
  for (const box of [sort, filters, select]) {
    expect(Math.abs(box!.y + box!.height / 2 - (search!.y + search!.height / 2))).toBeLessThan(12);
  }

  await page.getByTestId("library-filters").click();
  const dialog = page.getByRole("dialog", { name: "Filters" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("library-filters-done")).toBeHidden();
  expect(await dialog.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
  await page.getByTestId("library-level-easy").click();
  await expect(page.getByTestId("library-filters-count")).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeHidden();
  await expect(page.getByTestId("library-filters")).toBeFocused();
  await expect(page.getByTestId("library-active-filter")).toHaveText("Easy (1–3)");
  await page.getByTestId("library-clear-filters").click();
  await expect(page.getByTestId("library-active-filter")).toHaveCount(0);
});

test("on a phone the filters open as a sheet without scrolling the page", async ({
  page,
  seed,
}) => {
  const song = await seed.create({ title: "Phone Riff", artist: "Band" });
  await page.request.put(`/api/songs/${song.id}/tags`, {
    data: { tags: ["funk", "slap", "jazz", "blues", "rock", "latin"] },
  });
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto("/");
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  const trigger = page.getByTestId("library-filters");
  await expect(trigger).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Filters" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("library-filters-done")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId("topbar-title")).toHaveCount(0);

  const fit = await page.evaluate(() => {
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, height: r.height };
    };
    const inside = (r: ReturnType<typeof box>) =>
      !!r &&
      r.height > 0 &&
      r.top >= -1 &&
      r.left >= -1 &&
      r.bottom <= viewH + 1 &&
      r.right <= viewW + 1;
    const panel = document.querySelector('[role="dialog"]');
    const chips = [...document.querySelectorAll('[data-testid="library-tag"]')];
    const body = chips[0]?.closest(".sheet-body");
    const bodyBox = box(body ?? null);
    const chipBoxes = chips.map((chip) => box(chip));
    // A chip in the sheet's scrollport counts: the sheet scrolls, the page does not.
    const chipsInSheet = chipBoxes.every((r) => {
      if (!r || !bodyBox || !body) return false;
      const onScreen = r.bottom <= viewH + 1 && r.top >= -1 && r.left >= -1 && r.right <= viewW + 1;
      if (onScreen && r.top >= bodyBox.top - 1 && r.bottom <= bodyBox.bottom + 1) return true;
      return (
        body.scrollHeight > body.clientHeight + 1 &&
        bodyBox.bottom <= viewH + 1 &&
        bodyBox.top >= -1
      );
    });
    const first = chipBoxes[0];
    return {
      position: panel ? getComputedStyle(panel).position : "",
      dialog: inside(box(panel)),
      done: inside(box(document.querySelector('[data-testid="library-filters-done"]'))),
      trigger: inside(box(document.querySelector('[data-testid="library-filters"]'))),
      chipCount: chips.length,
      firstChipVisible:
        !!first && !!bodyBox && first.top >= bodyBox.top - 1 && first.bottom <= bodyBox.bottom + 1,
      chipsInSheet,
    };
  });
  expect(fit.position).toBe("fixed");
  expect(fit.dialog).toBe(true);
  expect(fit.done).toBe(true);
  expect(fit.trigger).toBe(true);
  expect(fit.chipCount).toBeGreaterThan(1);
  expect(fit.firstChipVisible).toBe(true);
  expect(fit.chipsInSheet).toBe(true);

  await page.getByTestId("library-level-easy").click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByTestId("library-filters-done").click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("a song's menu holds edit, setlist and a delete that names the song", async ({
  page,
  seed,
}) => {
  await seed.create({ title: "Doomed Riff", artist: "Band" });
  await page.goto("/");
  await page.getByTestId("song-menu").click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveText(["Edit", "Add to setlist", "Delete"]);

  const prompts: string[] = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByTestId("song-delete").click();
  await expect.poll(() => prompts).toEqual(["Delete Doomed Riff?"]);
  await expect(page.getByTestId("song-card")).toHaveCount(1);
});

test("on a phone the songs are rows with a menu, not cards with a delete button", async ({
  page,
  seed,
}) => {
  await seed.create({ title: "Corpus Riff", artist: "Band" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const card = page.getByTestId("song-card");
  await expect(card).toHaveCount(1);
  await expect(page.getByTestId("song-delete")).toHaveCount(0);
  await expect(page.getByTestId("song-menu")).toBeVisible();
  const box = await card.boundingBox();
  expect(box!.height).toBeLessThan(110);
});
