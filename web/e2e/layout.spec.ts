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
