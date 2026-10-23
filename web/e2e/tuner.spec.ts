import { expect, test } from "./support/fixtures";

test("the tuner shows the GuitarTuna-style layout with a headstock of tappable strings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("open-tuner-topbar").click();
  await expect(page.getByTestId("tuner-sheet")).toBeVisible();

  await page.getByTestId("tuner-source").selectOption("standard");
  // Low strings on the left, high strings on the right, each at least 44px tall.
  const lowE = page.getByTestId("tuner-string-5");
  const highE = page.getByTestId("tuner-string-0");
  const low = await lowE.boundingBox();
  const high = await highE.boundingBox();
  expect(low!.height).toBeGreaterThanOrEqual(44);
  expect(low!.x).toBeLessThan(high!.x);

  await expect(page.getByTestId("tuner-needle")).toBeVisible();
  await expect(page.getByTestId("tuner-auto")).toBeChecked();
  await expect(page.getByTestId("tuner-restart")).toBeVisible();

  // Switching to bass changes the headstock.
  await page.getByTestId("tuner-source").selectOption("bass4");
  await expect(page.getByTestId("tuner-string-3")).toContainText("E1");
  await expect(page.getByTestId("tuner-string-4")).toHaveCount(0);
});
