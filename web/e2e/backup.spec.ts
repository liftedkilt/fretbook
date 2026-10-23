import { expect, test } from "./support/fixtures";

test("export the library, then restore it: songs already there are skipped", async ({
  page,
  seed,
}) => {
  await seed.chordSheet();
  await seed.musicXmlTab();
  await page.goto("/");
  await page.getByTestId("open-settings").click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("backup-export").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^fretbook-library-\d{8}\.zip$/);
  const archive = await download.path();

  await page.getByTestId("backup-file").setInputFiles(archive);
  await expect(page.getByTestId("backup-summary")).toHaveText(
    "Added 0, skipped 2, kept 0 as copies, 0 failed.",
  );

  await page.getByRole("radio", { name: "Keep both" }).click();
  await page.getByTestId("backup-file").setInputFiles(archive);
  await expect(page.getByTestId("backup-summary")).toHaveText(
    "Added 0, skipped 0, kept 2 as copies, 0 failed.",
  );
});

test("a file that is not a backup is refused with a readable message", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("backup-file").setInputFiles({
    name: "notes.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("not a zip"),
  });
  await expect(page.getByRole("alert")).toHaveText("That file is not a Fretbook backup.");
});
