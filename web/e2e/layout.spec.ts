import { expect, test } from "./support/fixtures";

// Phone and tablet widths used to grow a horizontal scrollbar: the practice
// heatmap's year of cells widened the page, and the player's action row did
// the same, which also pushed the fixed dock off the screen.
async function noSidewaysScroll(page: import("@playwright/test").Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

test("practice and the player stay within a phone and a tablet", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();

  for (const size of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/practice");
    await expect(page.getByTestId("practice-heatmap")).toBeVisible();
    await noSidewaysScroll(page);

    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId("player-play")).toBeVisible();
    const dock = await page.evaluate(() => {
      const rect = document.querySelector(".dock")!.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        innerH: window.innerHeight,
        client: document.documentElement.clientWidth,
      };
    });
    expect(dock.right).toBeLessThanOrEqual(dock.client + 1);
    expect(dock.top).toBeGreaterThanOrEqual(0);
    expect(dock.bottom).toBeLessThanOrEqual(dock.innerH + 1);
    await noSidewaysScroll(page);
  }
});

// Issue #245: on a phone the fretboard sits above the dock instead of under it, the
// secondary buttons fold into a ⋯ popover, and the score doesn't move while it plays.
test("the phone player keeps the fretboard clear of the dock and doesn't shift", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();

  for (const size of [
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 414, height: 896 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId("player-play")).toBeVisible();
    await page.getByTestId("player-panel-toggle").click();
    await page.getByTestId("fretboard-on").check();
    await page.getByTestId("player-panel-toggle").click();
    await expect(page.getByTestId("player-fretboard")).toBeVisible();

    const rects = () =>
      page.evaluate(() => {
        const box = (selector: string) => {
          const rect = document.querySelector(selector)!.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        };
        return {
          fretboard: box("[data-testid=player-fretboard]"),
          dock: box(".dock-bar"),
          score: box("[data-testid=player-score]"),
        };
      });
    const before = await rects();
    expect(before.fretboard.bottom).toBeLessThanOrEqual(before.dock.top);

    await page.getByTestId("player-play").click();
    await page.waitForTimeout(1500);
    const during = await rects();
    // Starting playback may scroll the page once to bring the score into view; after
    // that nothing moves, and the score ends above the fretboard, which ends above the dock.
    expect(during.score.bottom).toBeLessThanOrEqual(during.fretboard.top + 1);
    expect(during.fretboard.bottom).toBeLessThanOrEqual(during.dock.top);
    await page.waitForTimeout(1500);
    const later = await rects();
    expect(later.score.top).toBeCloseTo(during.score.top, 0);
    expect(later.fretboard.top).toBeCloseTo(during.fretboard.top, 0);
    await page.getByTestId("player-play").click();

    await expect(page.getByTestId("stage-toggle")).toBeHidden();
    await page.getByTestId("player-more").click();
    await expect(page.getByTestId("stage-toggle")).toBeVisible();
    await page.screenshot({ path: `test-results/player-${size.width}.png` });
  }
});
