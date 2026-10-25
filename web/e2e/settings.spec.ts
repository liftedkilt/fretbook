import { expect, test } from "./support/fixtures";

test("the settings gear opens a sectioned page", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  await page.getByTestId("settings-nav-audio").click();
  await expect(page).toHaveURL(/\/settings#audio$/);
  await expect(page.getByTestId("calibration-setting")).toBeVisible();
  await expect(page.getByTestId("input-device-default")).toBeVisible();

  await expect(page.getByTestId("pedal-summary")).toContainText("Page Down");
  await expect(page.getByTestId("pedal-PageDown")).toHaveCount(0);
  await page.getByTestId("pedal-toggle").click();
  await expect(page.getByTestId("pedal-PageDown")).toBeVisible();
  await expect(page.getByTestId("pedal-reset")).toBeVisible();

  await expect(page.getByTestId("shortcut-summary")).toBeVisible();
  await page.getByTestId("shortcuts-toggle").click();
  await expect(page.getByTestId("shortcut-summary")).toHaveCount(0);

  await expect(page.getByTestId("about-docs")).toBeVisible();
  await expect(page.getByTestId("about-changelog")).toBeVisible();
});
