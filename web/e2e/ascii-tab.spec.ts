import { expect, test } from "./support/fixtures";

const TAB = [
  "Title: Pasted Riff",
  "",
  "e|-----------|-----------|",
  "B|-----------|-----------|",
  "G|-----------|-----------|",
  "D|-----0---0-|-----3-----|",
  "A|-----------|-----------|",
  "E|-0-----3---|-----------|",
].join("\n");

test("paste ASCII tab, preview it, and save it as a song", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-paste").click();
  await expect(page.getByTestId("paste-submit")).toBeDisabled();

  await page.getByTestId("paste-text").fill(TAB);
  await expect(page.getByTestId("rhythm-estimated")).toBeVisible();
  await expect(page.getByTestId("tab-preview")).toBeVisible();
  await expect(page.getByTestId("paste-title")).toHaveAttribute("placeholder", "Pasted Riff");

  await page.getByTestId("paste-submit").click();
  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("song-heading")).toHaveText("Pasted Riff");
  await expect(page.getByTestId("rhythm-estimated-pill")).toBeVisible();
});

test("pasted chords over lyrics are saved as a chord sheet", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-paste").click();
  await page.getByTestId("paste-title").fill("Pasted Chords");
  await page.getByTestId("paste-text").fill("C        G\nHello big world\n");
  await expect(page.getByTestId("paste-chords-note")).toBeVisible();

  await page.getByTestId("paste-submit").click();
  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("song-heading")).toHaveText("Pasted Chords");
  await expect(page.getByTestId("chord-name")).toHaveText(["C", "G"]);
});

test("an uploaded .tab file becomes a tab with estimated rhythm", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-file").click();
  await page.getByTestId("add-file-input").setInputFiles({
    name: "upload-riff.tab",
    mimeType: "text/plain",
    buffer: Buffer.from(TAB),
  });
  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("song-heading")).toHaveText("Pasted Riff");
  await expect(page.getByTestId("rhythm-estimated-pill")).toBeVisible();
});
