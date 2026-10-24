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

test("library cards and the tab bar fit a phone", async ({ page, seed }) => {
  await seed.create({ title: "First Song", artist: "Band" });
  await seed.create({ title: "Second Song", artist: "Band" });

  for (const size of [
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 414, height: 896 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.getByTestId("song-card")).toHaveCount(2);
    await noSidewaysScroll(page);

    // Every card action sits inside its own card and is at least 44px.
    const measure = () =>
      page.getByTestId("song-card").evaluateAll((nodes) =>
        nodes.flatMap((node) => {
          const card = node.getBoundingClientRect();
          return Array.from(node.querySelectorAll(".song-actions > *")).map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              inside: rect.left >= card.left - 1 && rect.right <= card.right + 1,
              small: rect.width < 44 || rect.height < 44,
            };
          });
        }),
      );
    // Buttons animate in, so wait for them to settle.
    await expect.poll(async () => (await measure()).every((b) => b.inside && !b.small)).toBe(true);
    expect(await measure()).toHaveLength(8);

    // The + is centred, and there is one of it.
    const add = await page.locator(".tab-add").boundingBox();
    expect(Math.abs(add!.x + add!.width / 2 - size.width / 2)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("add-song-topbar")).toHaveCount(0);

    // Scrolled to the end, the list clears the tab bar and its + button.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const showing = await page.getByTestId("library-showing").boundingBox();
    const bar = await page.locator(".tabbar").boundingBox();
    expect(showing!.y + showing!.height).toBeLessThanOrEqual(bar!.y - 26);
  }
});
