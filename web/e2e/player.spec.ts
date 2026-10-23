import { expect, test } from "./support/fixtures";

test("the synth plays a tab and the cursor moves", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);

  const score = page.getByTestId("player-score");
  await expect(score.locator("svg").first()).toBeVisible();
  const status = page.getByTestId("player-status");
  const play = page.getByTestId("player-play");
  // The play button works once alphaTab has loaded its sound font.
  await expect(status).toHaveAttribute("data-measure", "-1");
  await expect(play).toBeEnabled();

  await play.click();
  await expect(play).toHaveAttribute("data-playing", "true", { timeout: 30_000 });
  const cursor = score.locator(".at-cursor-beat");
  await expect(cursor).toHaveCount(1);
  const first = await cursor.boundingBox();

  // 240 bpm in 4/4 is one second a bar, so playback reaches bar 2 within a few seconds.
  await expect(status).toHaveAttribute("data-measure", /^[1-3]$/, { timeout: 15_000 });
  const later = await cursor.boundingBox();
  expect(later).not.toEqual(first);

  await play.click();
  await expect(play).toHaveAttribute("data-playing", "false");
});

test("the bar buttons move the position", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-next").click();
  await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", "1");
  await page.getByTestId("player-next").click();
  await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", "2");
  await page.getByTestId("player-prev").click();
  await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", "1");
});

test("a song with audio plays the audio and follows its sync marks", async ({ page, seed }) => {
  const song = await seed.syncedSongWithAudio();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  const audio = page.getByTestId("player-audio");
  await expect(audio).toHaveCount(1);
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(3);

  await page.getByTestId("player-play").click();
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime), {
      timeout: 15_000,
    })
    .toBeGreaterThan(1.2);
  // Sync points put a bar at each second, so by now the status is on bar 2 or later.
  await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", /^[1-3]$/);
});

test("switches between Tab, Highway and Split views and remembers the choice", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);

  const stage = page.getByTestId("player-stage");
  await expect(stage).toHaveAttribute("data-view", "tab");
  await expect(page.getByTestId("player-highway")).toHaveCount(0);

  await page.getByTestId("player-view-highway").click();
  await expect(stage).toHaveAttribute("data-view", "highway");
  await expect(page.getByTestId("highway-canvas")).toBeVisible();

  await page.getByTestId("player-view-split").click();
  await expect(stage).toHaveAttribute("data-view", "split");
  await expect(page.getByTestId("highway-canvas")).toBeVisible();
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  // Reloading keeps the chosen view.
  await page.reload();
  await expect(page.getByTestId("player-stage")).toHaveAttribute("data-view", "split");
  await expect(page.getByTestId("highway-canvas")).toBeVisible();
});
