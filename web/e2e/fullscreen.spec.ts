// The song page's full screen button: only the score and the dock while it is on (issue #233).
import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./support/fixtures";

test("full screen shows only the score and the dock, and every exit restores the page", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto(`/songs/${song.id}`);
  const score = page.getByTestId("player-score");
  await expect(score.locator("svg").first()).toBeVisible();
  // One button, in the dock: it enters full screen and, once on, leaves it.
  const button = page.getByTestId("player-fullscreen");
  await expect(page.getByTestId("player-fullscreen")).toHaveCount(1);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".song-header").getByTestId("player-fullscreen")).toHaveCount(0);
  const normalHeight = (await score.boundingBox())?.height ?? 0;

  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen", "player");
  expect(await page.evaluate(() => document.fullscreenElement?.tagName)).toBe("HTML");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".song-header")).toBeHidden();
  await expect(page.getByTestId("song-tags")).toBeHidden();
  await expect(page.getByTestId("song-details")).toBeHidden();
  await expect(page.getByTestId("player-view-row")).toBeHidden();
  await expect(page.getByTestId("player-play")).toBeVisible();
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  expect((await score.boundingBox())?.height ?? 0).toBeGreaterThan(normalHeight);
  // The score fills the screen above the dock, so the window itself does not scroll.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
  ).toBe(true);

  await button.click();
  await expect(page.locator("html")).not.toHaveAttribute("data-fullscreen");
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "false");

  // Leaving full screen another way (Esc, the browser's own control) restores the layout too.
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen", "player");
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator("html")).not.toHaveAttribute("data-fullscreen");
  await expect(page.locator(".song-header")).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`full screen has no axe violations in the ${scheme} theme`, async ({ page, seed }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const song = await seed.musicXmlTab();
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
    await page.getByTestId("player-fullscreen").click();
    await expect(page.getByTestId("player-fullscreen")).toHaveAttribute("aria-pressed", "true");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
}

test("leaving the song page leaves full screen", async ({ page, seed }) => {
  await seed.musicXmlTab();
  await page.goto("/");
  await page.getByTestId("song-link").click();
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-fullscreen").click();
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen", "player");

  await page.goBack();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-fullscreen");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test("iPhone focus mode preserves scroll position and exits via corner button", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  // iPhone viewport with no Fullscreen API
  await page.setViewportSize({ width: 390, height: 664 });
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
    // @ts-expect-error stubbing unsupported API
    delete Element.prototype.requestFullscreen;
  });
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  // Scroll down into the song
  await page.evaluate(() => window.scrollTo(0, 500));
  const beforeScroll = await page.evaluate(() => window.scrollY);
  expect(beforeScroll).toBeGreaterThan(0);

  // Open the ⋯ menu and tap Full screen (which toggles focus mode)
  await page.getByTestId("player-more").click();
  await page.getByTestId("player-fullscreen-menu").click();

  // Focus mode layout is active
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen", "player");

  // Scroll did NOT jump to 0
  const duringScroll = await page.evaluate(() => window.scrollY);
  expect(duringScroll).toBeGreaterThan(0);

  // Corner exit button is visible on touch screens
  const exitButton = page.getByTestId("player-focus-exit");
  await expect(exitButton).toBeVisible();

  // Clicking the corner exit button exits focus mode
  await exitButton.click();
  await expect(page.locator("html")).not.toHaveAttribute("data-fullscreen");
  await expect(page.locator(".song-header")).toBeVisible();
});
