import { expect, test } from "./support/fixtures";

test("create a chord sheet and transpose it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-chords").click();
  await page.getByTestId("add-sheet-title").fill("Two Chords");
  await page.getByTestId("add-sheet-text").fill("[C]Hello [G]world\n[Am]Goodbye [F]moon");
  await page.getByTestId("add-sheet-submit").click();

  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("song-heading")).toHaveText("Two Chords");
  const chords = page.getByTestId("chord-name");
  await expect(chords).toHaveText(["C", "G", "Am", "F"]);

  await page.getByTestId("transpose-up").click();
  await page.getByTestId("transpose-up").click();
  await expect(page.getByTestId("transpose-value")).toHaveText("+2");
  await expect(chords).toHaveText(["D", "A", "Bm", "G"]);

  await page.getByTestId("transpose-down").click();
  await page.getByTestId("transpose-down").click();
  await page.getByTestId("transpose-down").click();
  await expect(chords).toHaveText(["B", "F#", "G#m", "E"]);
  await page.getByTestId("chords-flats").click();
  await expect(chords).toHaveText(["B", "Gb", "Abm", "E"]);
  await page.getByTestId("transpose-value").click();
  await expect(chords).toHaveText(["C", "G", "Am", "F"]);
});

test("an imported ChordPro file shows its chords, and edits persist", async ({ page, seed }) => {
  const song = await seed.chordSheet();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("song-heading")).toHaveText("Sunny Day Blues");
  await expect(page.getByTestId("chord-name").first()).toHaveText("C");

  await page.getByTestId("song-edit-link").click();
  const text = page.getByTestId("chord-text");
  await expect(text).toHaveValue(/Walking down/);
  await text.fill("[E]Edited [A]line");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("chord-text")).toHaveValue(/^\[E\]Edited \[A\]line\s*$/);
});
