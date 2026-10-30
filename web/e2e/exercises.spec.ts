import { expect, test } from "./support/fixtures";

test("generate an exercise, preview it, and save it to the library", async ({ page }) => {
  await page.goto("/tools");
  await page.getByTestId("tool-card-exercises").click();
  await expect(page).toHaveURL("/tools/exercises");

  await page.getByTestId("exercise-preset-pentatonicBox").click();
  await expect(page.getByTestId("exercise-title")).toHaveText("A minor pentatonic, from fret 5");
  await expect(page.getByTestId("tab-preview").locator("svg").first()).toBeVisible();

  await page.getByTestId("exercise-kind-scale").click();
  await page.getByTestId("exercise-scale").selectOption("dorian");
  await page.getByTestId("exercise-root").selectOption({ label: "D" });
  await expect(page.getByTestId("exercise-title")).toHaveText("D Dorian, from fret 5");

  await page.getByTestId("exercise-save").click();
  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("song-title")).toHaveText("D Dorian, from fret 5");
});

test("the spider warm-up preview stays inside the stage", async ({ page }) => {
  await page.goto("/tools/exercises?preset=spiderWarmUp");
  const preview = page.getByTestId("tab-preview");
  const stage = page.getByTestId("tool-stage");
  await expect(preview.locator("svg").first()).toBeVisible();

  const box = async () => {
    const previewBox = await preview.boundingBox();
    const stageBox = await stage.boundingBox();
    if (!previewBox || !stageBox) throw new Error("preview or stage has no box");
    return { previewBox, stageBox };
  };

  const first = await box();
  expect(first.previewBox.x + first.previewBox.width).toBeLessThanOrEqual(
    first.stageBox.x + first.stageBox.width + 1,
  );
  // The old layout grew by the border on every alphaTab render.
  await page.waitForTimeout(1200);
  const later = await box();
  expect(later.previewBox.width).toBeLessThanOrEqual(first.previewBox.width + 1);
  expect(later.previewBox.x + later.previewBox.width).toBeLessThanOrEqual(
    later.stageBox.x + later.stageBox.width + 1,
  );

  await page.getByTestId("exercise-preset-pentatonicBox").click();
  await expect(page.getByTestId("exercise-title")).toHaveText("A minor pentatonic, from fret 5");
  await expect(preview.locator("svg").first()).toBeVisible();
  const pentatonic = await box();
  expect(pentatonic.previewBox.x + pentatonic.previewBox.width).toBeLessThanOrEqual(
    pentatonic.stageBox.x + pentatonic.stageBox.width + 1,
  );
});

test("chord changes show a drill for the chosen chords", async ({ page }) => {
  await page.goto("/tools/exercises");
  await page.getByTestId("exercise-instrument").selectOption("guitar-6");
  await page.getByTestId("exercise-preset-openChordChanges").click();
  await expect(page.getByTestId("exercise-title")).toHaveText("Chord changes: G – C – D – Em");
  await page.getByTestId("exercise-chords").fill("G nope");
  await expect(page.getByTestId("exercise-error")).toBeVisible();
});

test("the exercise preview does not scroll the page on load", async ({ page }) => {
  await page.goto("/tools/exercises");
  await expect(page.getByTestId("tab-preview").locator("svg").first()).toBeVisible();
  // alphaTab's cursor scroll fires shortly after the first render.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
