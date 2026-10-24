import { expect, test } from "./support/fixtures";

test.describe("Rhythm trainer", () => {
  test("play a pattern with Space and see the timing results", async ({ page }) => {
    await page.goto("/tools");
    await page.getByTestId("tool-card-rhythm").click();
    await expect(page).toHaveURL("/tools/rhythm");
    await expect(page.getByTestId("rhythm-trainer-view")).toBeVisible();

    await page.getByTestId("rhythm-pattern").selectOption("quarters");
    await page.getByTestId("rhythm-bpm").fill("240");
    await page.getByTestId("rhythm-bars").selectOption("2");
    await expect(page.getByTestId("rhythm-cell-0")).toHaveAttribute("data-state", "hit");

    await page.getByTestId("rhythm-start").click();
    await expect(page.getByTestId("rhythm-pad")).toBeEnabled();
    // Press Space on every beat (250 ms apart) through the count-in and both bars.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Space");
      await page.waitForTimeout(250);
    }

    await expect(page.getByTestId("rhythm-results")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("rhythm-hit-count")).toContainText("/ 8");
    await expect(page.getByTestId("rhythm-histogram")).toBeVisible();
    await expect(page.getByTestId("rhythm-verdict")).toBeVisible();
  });

  test("the tap pad has a touch-sized target on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tools/rhythm");
    const pad = await page.getByTestId("rhythm-pad").boundingBox();
    expect(pad!.height).toBeGreaterThanOrEqual(44);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
});
