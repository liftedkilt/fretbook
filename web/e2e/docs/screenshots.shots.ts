// Regenerates the screenshots in docs/assets/screenshots/. Not a test: run it with
// `npm run docs:screenshots` (after `npm run build`) and commit the changed PNGs.
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { repoRoot } from "../support/paths";

const out = (name: string) => path.join(repoRoot, "docs", "assets", "screenshots", `${name}.png`);

/** Screenshot once fonts are loaded and finite transitions have finished, so no frame is caught mid-fade. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out(name), animations: "disabled" });
}

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light", locale: "en-US" });

test("library", async ({ page, seed }) => {
  await seed.musicXmlTab();
  await seed.chordSheet();
  await seed.syncedSongWithAudio();
  await page.goto("/");
  await expect(page.getByTestId("song-card")).toHaveCount(3);
  await shoot(page, "library");
});

test("add sheet", async ({ page, seed }) => {
  await seed.musicXmlTab();
  await page.goto("/");
  await page.getByTestId("add-song").first().click();
  await expect(page.getByTestId("add-sheet")).toBeVisible();
  await shoot(page, "add-sheet");
});

test("song page and practice panel", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await shoot(page, "song-page");

  await page.getByTestId("player-panel-toggle").click();
  await expect(page.getByTestId("practice-mode-free")).toBeVisible();
  await shoot(page, "practice-panel");
});
