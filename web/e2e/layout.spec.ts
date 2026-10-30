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

    // 3. Open and close with the dock toggle. On a phone the sheet covers the dock, so ✕ closes it.
    await page.getByTestId("player-panel-toggle").click();
    await expect(page.getByTestId("player-sheet")).toBeVisible();
    if (size.width <= 767) {
      await expect(page.locator(".dock")).toBeHidden();
      await page.getByTestId("player-sheet-close").click();
    } else {
      await page.getByTestId("player-panel-toggle").click();
    }
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
    // The sheet hides the dock on a phone, so close it from the sheet.
    await page.getByTestId("player-sheet-close").click();
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

// On a phone the page is the only scroller: the score has no scroll box of its own, so a
// swipe on the music moves the page (and the browser toolbar can collapse).
test("the phone player scrolls the page, not the score", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(`/songs/${song.id}`);
  const score = page.getByTestId("player-score");
  await expect(score.locator("svg").first()).toBeVisible();
  const box = await score.evaluate((element) => ({
    overflow: getComputedStyle(element).overflowY,
    scrollable: element.scrollHeight - element.clientHeight,
  }));
  expect(box.overflow).toBe("visible");
  expect(box.scrollable).toBeLessThanOrEqual(1);
});

test("the phone library shows a song on the first screen", async ({ page, seed }) => {
  for (let i = 1; i <= 6; i += 1) {
    await seed.create({ title: `Song ${i}`, artist: "Artist" });
  }
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto("/");
  const card = page.getByTestId("song-card").first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  // The tab bar starts at 590, so a whole card has to fit above it.
  expect(box!.y).toBeLessThan(400);
  const bar = await page.locator(".tabbar").boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
  await noSidewaysScroll(page);

  // The search icon sits inside the input field.
  const searchInput = (await page.getByTestId("library-search").boundingBox())!;
  const searchIcon = (await page.locator(".search svg").boundingBox())!;
  expect(searchIcon.x).toBeGreaterThan(searchInput.x);
  expect(searchIcon.x + searchIcon.width).toBeLessThan(searchInput.x + searchInput.width);

  // The large title collapses into the top bar on scroll and search stays sticky.
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect(page.getByTestId("topbar-title")).toBeVisible();
  await expect(page.getByTestId("topbar-title")).toHaveText("Your library");

  const searchBox = (await page.getByTestId("library-search").boundingBox())!;
  expect(searchBox).not.toBeNull();
  expect(searchBox.y).toBeGreaterThanOrEqual(58);
  expect(searchBox.y).toBeLessThan(120);

  // Scrolling back restores the top bar.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId("topbar-title")).toHaveCount(0);
});

// Issue #384: the phone scrubber's 44px target used to cover the top of the transport
// buttons, so a tap on Play sought instead of starting playback.
test("a phone tap on Play hits the button, and the scrubber still has a 44px target", async ({
  page,
  seed,
}) => {
  const song = await seed.longBassTab(40);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(`/songs/${song.id}`);
  const play = page.getByTestId("player-play");
  const status = page.getByTestId("player-status");
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await expect(play).toBeVisible();
  await expect(status).toHaveAttribute("data-measure", "-1");
  await expect(page.locator(".scrubber input")).toHaveAttribute("max", "39");

  const layout = await page.evaluate(() => {
    const input = document.querySelector(".scrubber input");
    if (!(input instanceof HTMLInputElement)) return null;
    const inputBox = input.getBoundingClientRect();
    const buttons = ["player-prev", "player-play", "player-next", "player-mute"].map((id) => {
      const button = document.querySelector(`[data-testid="${id}"]`);
      const rect = button?.getBoundingClientRect();
      const hit = (y: number) => {
        if (!rect) return null;
        const el = document.elementFromPoint(rect.left + rect.width / 2, y);
        return el?.closest("button")?.getAttribute("data-testid") ?? null;
      };
      return {
        id,
        top: rect ? hit(rect.top) : null,
        below: rect ? hit(rect.top + 4) : null,
        gap: rect ? rect.top - inputBox.bottom : null,
      };
    });
    const above = document.elementFromPoint(inputBox.left + inputBox.width / 2, inputBox.top + 2);
    return {
      height: inputBox.height,
      aboveIsScrubber: above === input,
      buttons,
    };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  expect(layout.height).toBeGreaterThanOrEqual(44);
  expect(layout.aboveIsScrubber).toBe(true);
  for (const button of layout.buttons) {
    expect(button.gap, button.id).toBeGreaterThan(0);
    expect(button.top, button.id).toBe(button.id);
    expect(button.below, button.id).toBe(button.id);
  }

  // The reported tap: a few pixels below the top edge seeks when the scrubber covers it.
  const next = page.getByTestId("player-next");
  const nextBox = (await next.boundingBox())!;
  await next.click({ position: { x: nextBox.width / 2, y: 6 } });
  await expect(status).toHaveAttribute("data-measure", "1");

  const playBox = (await play.boundingBox())!;
  await play.click({ position: { x: playBox.width / 2, y: 4 } });
  // A seek would move the bar immediately. Playback only advances after the synth starts,
  // so this read must not retry: the measure leaves 1 once the song is actually playing.
  expect(await status.getAttribute("data-measure")).toBe("1");
  await expect(play).toHaveAttribute("data-playing", "true", { timeout: 30_000 });

  // The padding above the line is part of the target: a tap there still seeks.
  await play.click();
  await expect(play).toHaveAttribute("data-playing", "false");
  const scrubber = page.locator(".scrubber input");
  const scrubberBox = (await scrubber.boundingBox())!;
  await scrubber.click({ position: { x: scrubberBox.width * 0.8, y: 2 } });
  await expect
    .poll(async () => Number(await status.getAttribute("data-measure")))
    .toBeGreaterThan(15);
});

test("the phone speed picker sits entirely on screen", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(`/songs/${song.id}`);
  await page.getByTestId("player-speed").click();
  await expect(page.getByTestId("player-speed-popover")).toBeVisible();
  const width = await page.evaluate(() => window.innerWidth);
  const buttons = page.getByTestId("player-speed-popover").locator("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const box = (await buttons.nth(i).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});

// Follow-scroll parks the playing system below the sticky song header, not under it (#383).
test("the phone player keeps the playing line below the sticky header", async ({ page, seed }) => {
  const song = await seed.longBassTab(60);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-play").click();
  const header = page.locator(".song-header");
  await expect(header).toBeVisible();
  // Wait until follow has scrolled the page, then check the playing line against the header.
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 30_000 })
    .toBeGreaterThan(300);
  // Sample the cursor while the page follows it: it must never sit under the header.
  const bar = (await header.boundingBox())!;
  let lowest = Infinity;
  for (let i = 0; i < 20; i += 1) {
    const cursor = await page.locator(".at-cursor-bar").first().boundingBox();
    if (cursor) lowest = Math.min(lowest, cursor.y);
    await page.waitForTimeout(250);
  }
  expect(lowest).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
});

test.describe("phone landscape library", () => {
  test.use({ hasTouch: true });

  test("the phone library in landscape shows a song above the tab bar and does not scroll sideways", async ({
    page,
    seed,
  }) => {
    for (let i = 1; i <= 6; i += 1) {
      await seed.create({ title: `Song ${i}`, artist: "Artist" });
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    const card = page.getByTestId("song-card").first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    const bar = await page.locator(".tabbar").boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
    expect(bar!.height).toBeLessThanOrEqual(44);
    await noSidewaysScroll(page);

    // The search icon sits inside the input field.
    const searchInput = (await page.getByTestId("library-search").boundingBox())!;
    const searchIcon = (await page.locator(".search svg").boundingBox())!;
    expect(searchIcon.x).toBeGreaterThan(searchInput.x);
    expect(searchIcon.x + searchIcon.width).toBeLessThan(searchInput.x + searchInput.width);

    // Sticky search stays sticky when scrolling.
    await page.evaluate(() => window.scrollTo(0, 200));
    const scrolledSearch = (await page.getByTestId("library-search").boundingBox())!;
    expect(scrolledSearch.y).toBeGreaterThanOrEqual(58);
    expect(scrolledSearch.y).toBeLessThan(120);
  });
});
