import { expect, test } from "./support/fixtures";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("set a song's details and notes, upload cover art, and filter the library by key and genre", async ({
  page,
  seed,
}) => {
  const blues = await seed.create({ title: "Slow Blues", artist: "Band" });
  await seed.create({ title: "Pop Hook", artist: "Band" });

  await page.goto(`/songs/${blues.id}`);
  await page.getByTestId("song-metadata-edit").click();
  await expect(page.getByTestId("metadata-sheet")).toBeVisible();
  await page.getByTestId("metadata-key").selectOption("Am");
  await page.getByTestId("metadata-genre").fill("Blues");
  await page.getByTestId("metadata-album").fill("Live at Home");
  await page.getByTestId("metadata-year").fill("1999");
  await page.getByTestId("metadata-notes").fill("Play **slowly**\n\n- watch the bend");
  await page.getByTestId("metadata-cover-input").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByTestId("metadata-cover-remove")).toBeVisible();
  await page.getByTestId("metadata-save").click();
  await expect(page.getByTestId("metadata-sheet")).toBeHidden();

  await expect(page.getByTestId("song-key")).toHaveText("A minor");
  await expect(page.getByTestId("song-genre")).toHaveText("Blues");
  await expect(page.getByTestId("song-year")).toHaveText("1999");
  await expect(page.getByTestId("song-album")).toHaveText("Live at Home");
  await expect(page.getByTestId("song-notes").locator("strong")).toHaveText("slowly");
  await expect(page.getByTestId("song-notes").locator("li")).toHaveText("watch the bend");
  await expect(page.locator(".song-header .cover-image")).toBeVisible();

  // It is kept, and the library shows it.
  await page.reload();
  await expect(page.getByTestId("song-key")).toHaveText("A minor");
  await page.goto("/");
  await expect(page.getByTestId("song-card")).toHaveCount(2);
  await expect(page.getByTestId("song-card-details")).toHaveText("A minor · Blues");
  await expect(page.locator(".song-card .cover-image")).toHaveCount(1);

  await page.getByTestId("library-genre-filter").selectOption("Blues");
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await expect(page.getByTestId("song-title")).toHaveText("Slow Blues");
  await page.getByTestId("library-genre-filter").selectOption("");
  await page.getByTestId("library-key-filter").selectOption("Am");
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await page.getByTestId("library-key-filter").selectOption("");
  await expect(page.getByTestId("song-card")).toHaveCount(2);

  // Removing the cover goes back to the generated one.
  await page.goto(`/songs/${blues.id}`);
  await page.getByTestId("song-metadata-edit").click();
  await page.getByTestId("metadata-cover-remove").click();
  await expect(page.getByTestId("metadata-cover-remove")).toBeHidden();
  await page.getByTestId("metadata-save").click();
  await expect(page.locator(".song-header .cover-image")).toHaveCount(0);
});

test("the key of a chord sheet comes from its {key} directive, and a chosen key wins", async ({
  page,
  seed,
}) => {
  const sheet = await seed.create({
    title: "Em Song",
    chordpro: "{title: Em Song}\n{key: Em}\n[Em]Hello [G]there\n",
  });
  await page.goto(`/songs/${sheet.id}`);
  await expect(page.getByTestId("song-key")).toHaveText("E minor");
  await expect(page.getByTestId("song-key")).toHaveAttribute("title", /detected/);

  await page.getByTestId("song-metadata-edit").click();
  await expect(page.getByTestId("metadata-key")).toHaveValue("");
  await page.getByTestId("metadata-key").selectOption("Bb");
  await page.getByTestId("metadata-save").click();
  await expect(page.getByTestId("song-key")).toHaveText("B♭ major");
  await expect(page.getByTestId("song-key")).not.toHaveAttribute("title", /detected/);
});
