import { expect, test } from "./support/fixtures";
import { fixture } from "./support/paths";

test("paste a chord sheet into the Add box without saying what it is", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  // The Add box is the first mode.
  await page.getByTestId("any-text").fill("G        C\nHello my friend\n");
  await page.getByTestId("any-submit").click();

  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("chord-name").first()).toBeVisible();
});

test("drop a score whose file name gives nothing away", async ({ page, seed }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("any-file-input").setInputFiles({
    name: "download",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(
      await import("node:fs").then((fs) => fs.readFileSync(fixture("practice-riff.musicxml"))),
    ),
  });

  await expect(page).toHaveURL(/\/songs\/[^/]+$/);
  await expect(page.getByTestId("song-heading")).toHaveText("Practice Riff");
  expect(await seed.list()).toHaveLength(1);
});

test("text that is not music says what Fretbook can read", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("any-text").fill("Remember to buy milk and call mum.");
  await page.getByTestId("any-submit").click();

  await expect(page.getByTestId("add-error")).toContainText("Couldn't recognise");
  await expect(page).toHaveURL(/\/$/);
});
