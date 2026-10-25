import { readFile } from "node:fs/promises";

import { expect, test } from "./support/fixtures";
import { openExport } from "./support/song-page";

test("export a tab as PDF downloads a file", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await openExport(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-pdf").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
});

test("export a tab as MusicXML and JSON", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  for (const [id, pattern, start] of [
    ["export-musicxml", /\.(musicxml|xml)$/i, "<?xml"],
    ["export-json", /\.json$/i, "{"],
  ] as const) {
    await openExport(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId(id).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(pattern);
    expect((await readFile(await download.path())).toString().trimStart().startsWith(start)).toBe(
      true,
    );
  }
});

test("export a chord sheet as PDF and ChordPro", async ({ page, seed }) => {
  const song = await seed.chordSheet();
  await page.goto(`/songs/${song.id}`);

  await openExport(page);
  const [pdf] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-pdf").click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/i);
  expect((await readFile(await pdf.path())).subarray(0, 5).toString()).toBe("%PDF-");

  await openExport(page);
  const [cho] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-chordpro").click(),
  ]);
  expect((await readFile(await cho.path())).toString()).toContain("Sunny Day Blues");
});
