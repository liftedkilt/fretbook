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
  const enter = page.getByTestId("player-fullscreen");
  const exit = page.getByTestId("player-fullscreen-exit");
  await expect(exit).toBeHidden();
  const normalHeight = (await score.boundingBox())?.height ?? 0;

  await enter.click();
  await expect(page.locator("html")).toHaveAttribute("data-fullscreen", "player");
  expect(await page.evaluate(() => document.fullscreenElement?.tagName)).toBe("HTML");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".song-header")).toBeHidden();
  await expect(page.getByTestId("song-tags")).toBeHidden();
  await expect(page.getByTestId("song-metadata")).toBeHidden();
  await expect(page.getByTestId("player-play")).toBeVisible();
  await expect(exit).toBeVisible();
  await expect(exit).toHaveAttribute("aria-pressed", "true");
  expect((await score.boundingBox())?.height ?? 0).toBeGreaterThan(normalHeight);
  // The score fills the screen above the dock, so the window itself does not scroll.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
  ).toBe(true);

  await exit.click();
  await expect(page.locator("html")).not.toHaveAttribute("data-fullscreen");
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(enter).toBeVisible();
  await expect(exit).toBeHidden();

  // Leaving full screen another way (Esc, the browser's own control) restores the layout too.
  await enter.click();
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
    await expect(page.getByTestId("player-fullscreen-exit")).toBeVisible();
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
