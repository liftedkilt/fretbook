import { expect, test } from "./support/fixtures";
import { fixture } from "./support/paths";

test("upload a MusicXML file and open it", async ({ page, seed }) => {
  await page.goto("/");
  await expect(page.getByTestId("library-empty")).toBeVisible();

  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-file").click();
  await page.getByTestId("add-file-input").setInputFiles(fixture("practice-riff.musicxml"));

  // The import runs as a job; the app opens the new song when it is done.
  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("song-heading")).toHaveText("Practice Riff");
  // alphaTab draws the score as SVG.
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  expect(await seed.list()).toHaveLength(1);
  await page.goto("/");
  await expect(page.getByTestId("song-title")).toHaveText("Practice Riff");
});

test("a file that is not a score is refused with a message", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-file").click();
  await page.getByTestId("add-file-input").setInputFiles({
    name: "notes.musicxml",
    mimeType: "application/xml",
    buffer: Buffer.from("<not-a-score/>"),
  });
  await expect(page.getByTestId("add-error")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
