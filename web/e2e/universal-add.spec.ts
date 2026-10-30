import { execSync } from "node:child_process";

import { expect, test } from "./support/fixtures";
import { fixture, pythonCommand } from "./support/paths";

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

for (const [target, useMoreWays] of [
  ["Add box", false],
  ["More ways → Upload file", true],
] as const) {
  for (const choice of ["skip", "replace"] as const) {
    test(`dropping the same file twice with ${choice} via ${target} leaves one song`, async ({
      page,
      seed,
    }) => {
      const buffer = await import("node:fs").then((fs) =>
        fs.readFileSync(fixture("sunny-chords.cho")),
      );
      const drop = async () => {
        await page.goto("/");
        await page.getByTestId("add-song").click();
        await page.getByTestId("add-more-toggle").click();
        await page.getByTestId(choice === "skip" ? "dup-skip" : "dup-replace").check();
        if (useMoreWays) {
          await page.getByTestId("add-mode-file").click();
          await page.getByTestId("add-file-input").setInputFiles({
            name: "sunny-chords.cho",
            mimeType: "text/plain",
            buffer,
          });
        } else {
          await page.getByTestId("any-file-input").setInputFiles({
            name: "sunny-chords.cho",
            mimeType: "text/plain",
            buffer,
          });
        }
      };
      await drop();
      await expect(page).toHaveURL(/\/songs\/[^/]+$/);
      await drop();
      if (choice === "skip") await expect(page.getByTestId("add-notice")).toBeVisible();
      else await expect(page).toHaveURL(/\/songs\/[^/]+$/);
      await expect.poll(async () => (await seed.list()).length).toBe(1);
    });
  }
}

for (const choice of ["skip", "keep_both"] as const) {
  test(`bulk upload via More ways → Upload file honours ${choice} for duplicate files`, async ({
    page,
    seed,
  }) => {
    const buffer = await import("node:fs").then((fs) =>
      fs.readFileSync(fixture("sunny-chords.cho")),
    );
    await page.goto("/");
    await page.getByTestId("add-song").click();
    await page.getByTestId("add-more-toggle").click();
    await page.getByTestId("add-mode-file").click();
    await page.getByTestId("add-file-input").setInputFiles({
      name: "sunny-chords.cho",
      mimeType: "text/plain",
      buffer,
    });
    await expect(page).toHaveURL(/\/songs\/[^/]+$/);
    expect(await seed.list()).toHaveLength(1);

    await page.goto("/");
    await page.getByTestId("add-song").click();
    await page.getByTestId("add-more-toggle").click();
    await page.getByTestId(choice === "skip" ? "dup-skip" : "dup-keep").check();
    await page.getByTestId("add-mode-file").click();
    await page
      .getByTestId("add-file-input")
      .setInputFiles([fixture("sunny-chords.cho"), fixture("practice-riff.musicxml")]);

    await expect(page.getByTestId("recent-imports-panel")).toBeVisible();
    await expect(page.getByTestId("song-title").filter({ hasText: "Practice Riff" })).toBeVisible();

    if (choice === "skip") {
      await expect.poll(async () => (await seed.list()).length).toBe(2);
    } else {
      await expect.poll(async () => (await seed.list()).length).toBe(3);
    }
  });
}

for (const choice of ["skip", "keep_both"] as const) {
  test(`zip upload via More ways → Upload file honours ${choice} for duplicate scores`, async ({
    page,
    seed,
  }) => {
    const py = pythonCommand();
    const script =
      "import zipfile, io, sys; b = io.BytesIO(); z = zipfile.ZipFile(b, 'w'); " +
      "z.writestr('dup.cho', '{title: Zip Song}\\n{artist: Band}\\n[C]Hello\\n'); " +
      "z.writestr('other.cho', '{title: Other Song}\\n{artist: Band}\\n[D]World\\n'); " +
      "z.close(); sys.stdout.buffer.write(b.getvalue())";
    const zipBuffer = execSync(`${py} -c "${script}"`);

    await seed.create({ title: "Zip Song", artist: "Band", chordpro: "[C]Hello" });
    expect(await seed.list()).toHaveLength(1);

    await page.goto("/");
    await page.getByTestId("add-song").click();
    await page.getByTestId("add-more-toggle").click();
    await page.getByTestId(choice === "skip" ? "dup-skip" : "dup-keep").check();
    await page.getByTestId("add-mode-file").click();
    await page.getByTestId("add-file-input").setInputFiles({
      name: "pack.zip",
      mimeType: "application/zip",
      buffer: zipBuffer,
    });

    await expect(page.getByTestId("recent-imports-panel")).toBeVisible();
    await expect(page.getByTestId("song-title").filter({ hasText: "Other Song" })).toBeVisible();

    if (choice === "skip") {
      await expect.poll(async () => (await seed.list()).length).toBe(2);
    } else {
      await expect.poll(async () => (await seed.list()).length).toBe(3);
    }
  });
}
