import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./support/fixtures";
import { repoRoot } from "./support/paths";

// A two-bar bass riff written for the repository's import corpus (CC0).
const RIFF = path.join(repoRoot, "tests", "fixtures", "corpus", "midi", "riff.mid");

test("drop a MIDI file, pick the instrument, and import it as a tab", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("any-file-input").setInputFiles(RIFF);

  await expect(page.getByTestId("midi-import")).toBeVisible();
  await expect(page.getByTestId("midi-part-0:0")).toContainText("7 notes");
  await page.getByTestId("midi-grid").selectOption("8");
  await page.getByTestId("midi-submit").click();

  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("song-heading")).toHaveText("Bass");
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
});

test("export an imported MIDI tab back to a .mid file", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("any-file-input").setInputFiles(RIFF);
  await page.getByTestId("midi-submit").click();
  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("export-menu").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-midi").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.mid$/i);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 4).toString()).toBe("MThd");
});

test("cancelling the MIDI dialog goes back to the Add box", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("any-file-input").setInputFiles(RIFF);
  await expect(page.getByTestId("midi-import")).toBeVisible();
  await page.getByTestId("midi-import").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("any-text")).toBeVisible();
});
