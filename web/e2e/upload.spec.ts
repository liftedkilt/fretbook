import { execSync } from "node:child_process";
import { expect, test } from "./support/fixtures";
import { fixture, pythonCommand } from "./support/paths";

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

test("failed import appears in recent imports and can be dismissed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-file").click();
  await page.getByTestId("add-file-input").setInputFiles({
    name: "bad-riff.musicxml",
    mimeType: "application/xml",
    buffer: Buffer.from("<not-a-score/>"),
  });
  await expect(page.getByTestId("add-error")).toBeVisible();
  await page.getByTestId("add-sheet-close").click();

  await expect(page.getByTestId("recent-imports-panel")).toBeVisible();
  await expect(page.getByTestId("job-label")).toHaveText("bad-riff.musicxml");
  await expect(page.getByTestId("job-retry")).toBeVisible();
  await expect(page.getByTestId("job-dismiss")).toBeVisible();

  await page.getByTestId("job-dismiss").click();
  await expect(page.getByTestId("recent-imports-panel")).toBeHidden();
});

test("bulk upload multiple files at once shows progress and imports all songs", async ({
  page,
  seed,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("library-empty")).toBeVisible();

  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-file").click();
  await page
    .getByTestId("add-file-input")
    .setInputFiles([fixture("practice-riff.musicxml"), fixture("sunny-chords.cho")]);

  // Bulk import opens Recent Imports panel with jobs for each file
  await expect(page.getByTestId("recent-imports-panel")).toBeVisible();
  await expect(page.getByText("practice-riff.musicxml")).toBeVisible();
  await expect(page.getByText("sunny-chords.cho")).toBeVisible();

  // Both songs finish and appear in the library
  await expect(page.getByTestId("song-title").filter({ hasText: "Practice Riff" })).toBeVisible();
  await expect(page.getByTestId("song-title").filter({ hasText: "Sunny Day Blues" })).toBeVisible();
  expect(await seed.list()).toHaveLength(2);
});

test("bulk upload a zip archive extracts and imports all scores with archive name as tag", async ({
  page,
  seed,
}) => {
  const py = pythonCommand();
  const script =
    "import zipfile, io, sys; b = io.BytesIO(); z = zipfile.ZipFile(b, 'w'); " +
    "z.writestr('song-a.cho', '{title: Archive Song A}\\n{artist: Archive Band}\\n[C]Hello\\n'); " +
    "z.writestr('song-b.cho', '{title: Archive Song B}\\n{artist: Archive Band}\\n[D]World\\n'); " +
    "z.close(); sys.stdout.buffer.write(b.getvalue())";
  const zipBuffer = execSync(`${py} -c "${script}"`);

  await page.goto("/");
  await page.getByTestId("add-song").click();
  await page.getByTestId("add-mode-file").click();
  await page.getByTestId("add-file-input").setInputFiles({
    name: "my-pack.zip",
    mimeType: "application/zip",
    buffer: zipBuffer,
  });

  await expect(page.getByTestId("recent-imports-panel")).toBeVisible();
  await expect(page.getByTestId("song-title").filter({ hasText: "Archive Song A" })).toBeVisible();
  await expect(page.getByTestId("song-title").filter({ hasText: "Archive Song B" })).toBeVisible();

  const songs = await seed.list();
  expect(songs).toHaveLength(2);
  const detail = (await (await page.request.get(`/api/songs/${songs[0].id}`)).json()) as {
    source_ref?: { tags?: string[] };
  };
  expect(detail.source_ref?.tags).toContain("my-pack");
});
