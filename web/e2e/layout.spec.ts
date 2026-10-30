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
  // An empty log only shows its first step; the heatmap and lists need some history.
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const logged = await page.request.post("/api/practice/sessions", {
    data: {
      song_id: song.id,
      day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      duration_seconds: 420,
      speed: 1,
      mode: "free",
    },
  });
  expect(logged.ok()).toBeTruthy();

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

// Issue #333: player panel must fit desktop, phone landscape and phone portrait without overflowing sideways.
test("the player sheet fits desktop and phone landscape without scrolling sideways", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  for (const size of [
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

    // 1. Open with the dock toggle
    await page.getByTestId("player-panel-toggle").click();
    await expect(page.getByTestId("player-sheet")).toBeVisible();

    const box = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(box.scroll).toBeLessThanOrEqual(box.inner);

    const closeBtn = page.getByTestId("player-sheet-close");
    await expect(closeBtn).toBeVisible();
    const closeBox = (await closeBtn.boundingBox())!;
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(size.width);

    // 2. Close with ✕
    await closeBtn.click();
    await expect(page.getByTestId("player-sheet")).toBeHidden();

    // 3. Open and close with the dock toggle
    await page.getByTestId("player-panel-toggle").click();
    await expect(page.getByTestId("player-sheet")).toBeVisible();
    await page.getByTestId("player-panel-toggle").click();
    await expect(page.getByTestId("player-sheet")).toBeHidden();
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
    await page.getByTestId("player-sheet-tab-view").click();
    await page.getByTestId("fretboard-on").check();
    await expect(page.getByTestId("stage-toggle")).toBeVisible();
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

    await expect(page.getByTestId("player-shortcuts")).toBeHidden();
    await page.getByTestId("player-more").click();
    await expect(page.getByTestId("player-shortcuts")).toBeVisible();
    await page.screenshot({ path: `test-results/player-${size.width}.png` });
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

    // Every row action sits inside its own row and is at least 44px.
    const measure = () =>
      page.getByTestId("song-card").evaluateAll((nodes) =>
        nodes.flatMap((node) => {
          const card = node.getBoundingClientRect();
          return Array.from(
            node.querySelectorAll("[data-testid=song-star], [data-testid=song-menu]"),
          ).map((button) => {
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
    // A star and a menu per song; delete is behind the menu, not a tap away.
    expect(await measure()).toHaveLength(4);

    // The + is centred, and there is one of it.
    const add = await page.locator(".tab-add").boundingBox();
    expect(Math.abs(add!.x + add!.width / 2 - size.width / 2)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("add-song-topbar")).toHaveCount(0);

    // Scrolled to the end, the list clears the tab bar and its + button.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const showing = await page.getByTestId("library-end").boundingBox();
    const bar = await page.locator(".tabbar").boundingBox();
    expect(showing!.y + showing!.height).toBeLessThanOrEqual(bar!.y - 26);
  }
});
