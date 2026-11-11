import { expect, test } from "./support/fixtures";

test("a deleted song comes back from the toast, and later from Settings", async ({
  page,
  seed,
}) => {
  await seed.create({ title: "Doomed Riff", artist: "Band" });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await expect(page.getByTestId("song-card")).toHaveCount(1);

  // Delete, then undo from the toast.
  await page.getByTestId("song-menu").click();
  await page.getByTestId("song-delete").click();
  await expect(page.getByTestId("song-card")).toHaveCount(0);
  await expect(page.getByTestId("trash-undo")).toContainText("Doomed Riff moved to the trash");
  await page.getByTestId("trash-undo-button").click();
  await expect(page.getByTestId("trash-undo")).toHaveCount(0);
  await expect(page.getByTestId("song-card")).toHaveCount(1);

  // Delete again, let the toast go, and restore from Settings.
  await page.getByTestId("song-menu").click();
  await page.getByTestId("song-delete").click();
  await expect(page.getByTestId("song-card")).toHaveCount(0);
  await page.getByTestId("trash-undo-dismiss").click();
  await page.goto("/settings");
  const trash = page.getByTestId("trash-settings");
  await expect(trash.getByTestId("trash-row")).toHaveCount(1);
  await expect(trash.getByTestId("trash-row")).toContainText("Doomed Riff");
  await trash.getByTestId("trash-restore").click();
  await expect(trash.getByTestId("trash-empty")).toBeVisible();
  await expect(trash.getByTestId("trash-notice")).toContainText("Restored Doomed Riff");
  await page.goto("/");
  await expect(page.getByTestId("song-title")).toHaveText("Doomed Riff");
});
