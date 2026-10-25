// Issue #280: the song page header order, one toolbar, and the music on the first phone screen.
import { expect, test } from "./support/fixtures";
import { addTag, menuItem } from "./support/song-page";

test("on a phone the first tab system is visible above the dock without scrolling", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/songs/${song.id}`);
  const score = page.getByTestId("player-score");
  await expect(score.locator("svg").first()).toBeVisible();

  const scoreBox = (await score.boundingBox())!;
  const dockBox = (await page.locator(".dock").boundingBox())!;
  const systemBox = (await score.locator("svg").first().boundingBox())!;
  expect(scoreBox.y).toBeLessThan(300);
  // The tab system ends before the dock begins.
  expect(systemBox.y + systemBox.height).toBeLessThan(dockBox.y);
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(812);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The compact header: the star and the menu beside the back link; tags and facts are in the sheet.
  await expect(page.getByTestId("song-favourite")).toBeVisible();
  await expect(page.getByTestId("song-more")).toBeVisible();
  await expect(page.locator(".song-header").getByTestId("song-tag-new")).toHaveCount(0);
  await menuItem(page, "song-metadata-edit");
  await expect(page.getByTestId("metadata-sheet")).toBeVisible();
  await expect(page.getByTestId("metadata-sheet").getByTestId("song-tag-new")).toBeVisible();
});

test("the desktop header reads back link, title, facts and tags, then the view row and score", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  const top = async (selector: string) => (await page.locator(selector).first().boundingBox())!.y;
  const back = await top(".song-header .back");
  const title = await top("[data-testid=song-heading]");
  const facts = await top(".song-header .facts");
  const viewRow = await top("[data-testid=player-view-row]");
  const score = await top("[data-testid=player-score]");
  expect(back).toBeLessThan(title);
  expect(title).toBeLessThan(facts);
  expect(facts).toBeLessThan(viewRow);
  expect(viewRow).toBeLessThan(score);

  // Cover 120px, tags as chips with a "+ Tag" chip that opens the inline input.
  expect((await page.locator(".song-header .cover").boundingBox())!.width).toBe(120);
  await expect(page.getByTestId("song-tag")).toHaveCount(1);
  await expect(page.getByTestId("song-tag-input")).toHaveCount(0);
  await addTag(page, "warm-up");
  await expect(page.getByTestId("song-tag")).toHaveCount(2);

  // Actions: star, Transpose, Edit, "⋯". Everything else is in the menu, delete last.
  await expect(page.getByTestId("song-favourite")).toBeVisible();
  await expect(page.getByTestId("song-retune")).toHaveText("Transpose");
  await expect(page.getByTestId("song-edit-link")).toBeVisible();
  await expect(page.getByTestId("offline-toggle")).toHaveCount(0);
  await page.getByTestId("song-more").click();
  const ids = await page
    .getByRole("menuitem")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  expect(ids).toEqual([
    "offline-toggle",
    "export-open",
    "song-add-to-setlist",
    "song-tuner",
    "song-move",
    "song-metadata-edit",
    "song-delete",
  ]);

  // One full screen button, in the dock.
  await expect(page.getByTestId("player-fullscreen")).toHaveCount(1);
  await expect(page.locator(".dock").getByTestId("player-fullscreen")).toBeVisible();
});

test("the Details section follows the score with no dead gap", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  const stage = (await page.getByTestId("player-stage").boundingBox())!;
  const details = (await page.getByTestId("song-details").boundingBox())!;
  expect(details.y - (stage.y + stage.height)).toBeLessThan(64);
  await expect(page.getByTestId("song-difficulty-panel")).toBeVisible();
});

test("the view row shows the speed in use and opens the practice panel", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await expect(page.getByTestId("player-speed-chip")).toHaveCount(0);
  await expect(page.getByTestId("player-loop-chip")).toHaveCount(0);

  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("player-loop-a").click();
  await page.getByTestId("player-loop-b").click();
  await expect(page.getByTestId("player-loop-chip")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("player-loop-chip").click();
  await expect(page.getByTestId("loop-panel")).toBeVisible();
});

test("a chord sheet shares the header: no Transpose button, the same menu", async ({
  page,
  seed,
}) => {
  const song = await seed.chordSheet();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("song-heading")).toHaveText(song.title);
  await expect(page.getByTestId("song-retune")).toHaveCount(0);
  await expect(page.getByTestId("song-tag-new")).toBeVisible();
  await page.getByTestId("song-more").click();
  await expect(page.getByTestId("export-open")).toBeVisible();
  await expect(page.getByTestId("song-tuner")).toHaveCount(0);
  await expect(page.getByTestId("song-delete")).toBeVisible();
});

test("delete song asks first, then returns to the library", async ({ page, seed }) => {
  const song = await seed.chordSheet();
  await page.goto(`/songs/${song.id}`);
  const messages: string[] = [];
  page.once("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  await menuItem(page, "song-delete");
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain(song.title);
  expect(await seed.list()).toHaveLength(1);

  page.once("dialog", (dialog) => void dialog.accept());
  await menuItem(page, "song-delete");
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await seed.list()).length).toBe(0);
});

test("on a phone the highway and split views start in the first 300px too", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("player-view-highway").click();
  await expect(page.getByTestId("player-highway")).toBeVisible();
  expect((await page.getByTestId("player-highway").boundingBox())!.y).toBeLessThan(300);

  await page.getByTestId("player-view-split").click();
  await expect(page.getByTestId("player-highway")).toBeVisible();
  expect((await page.getByTestId("player-highway").boundingBox())!.y).toBeLessThan(300);
  expect((await page.getByTestId("player-score").boundingBox())!.y).toBeLessThan(
    (await page.locator(".dock").boundingBox())!.y,
  );
});

test("saved loops do not push the music down on a phone", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("player-loop-a").click();
  await page.getByTestId("player-next").click();
  await page.getByTestId("player-loop-b").click();
  await page.getByTestId("save-loop-name").fill("Solo");
  await page.getByTestId("save-loop-button").click();
  await expect(page.getByTestId("song-saved-loops")).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByTestId("song-saved-loops")).toBeHidden();
  expect((await page.getByTestId("player-score").boundingBox())!.y).toBeLessThan(300);
});
