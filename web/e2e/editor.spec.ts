import { expect, test } from "./support/fixtures";

test("edit a bar, save, reload, and the change persists", async ({ page, seed }) => {
  const song = await seed.create({ title: "Blank Page", preset: "guitar-6" });
  await page.goto(`/songs/${song.id}/edit`);

  await expect(page.getByTestId("editor-title")).toHaveText("Blank Page");
  // A new tab starts with a bar of four quarter-note rests; add a fifth beat and play a note on the first.
  await expect(page.getByTestId("beat-card")).toHaveCount(4);
  await page.getByTestId("editor-add-beat").first().click();
  await expect(page.getByTestId("beat-card")).toHaveCount(5);
  const beat = page.getByTestId("beat-card").first();
  await beat.getByTestId("fret-input-2").fill("7");
  await page.getByTestId("editor-song-title").fill("Edited Page");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toBeVisible();
  await expect(page.getByTestId("editor-error")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("editor-title")).toHaveText("Edited Page");
  await expect(page.getByTestId("beat-card")).toHaveCount(5);
  await expect(page.getByTestId("beat-card").first().getByTestId("fret-input-2")).toHaveValue("7");
  await expect(page.getByTestId("beat-card").first().getByTestId("fret-input-0")).toHaveValue("");

  // The server has the same document.
  const saved = await (await page.request.get(`/api/songs/${song.id}`)).json();
  const notes = saved.document.tracks[0].bars[0].voices[0].beats[0].notes;
  expect(notes).toEqual([expect.objectContaining({ string: 2, fret: 7 })]);
});

test("a second bar can be added and edited", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}/edit`);
  await expect(page.getByTestId("editor-measure")).toHaveAttribute("data-bar", "0");
  await page.getByTestId("editor-add-measure").click();
  await expect(page.getByTestId("editor-measure")).toHaveAttribute("data-bar", "1");
  await expect(page.getByTestId("bar-chip-4")).toBeVisible();
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("bar-chip-4")).toBeVisible();
});
