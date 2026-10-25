import { expect, test } from "./support/fixtures";
import { startServer } from "./support/server";

test("an empty library offers every way to start", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("library-empty")).toBeVisible();
  for (const step of ["import", "demo", "instrument", "tuner", "course"]) {
    await expect(page.getByTestId(`first-run-${step}`)).toBeVisible();
  }

  await page.getByTestId("first-run-tuner").getByRole("button").click();
  await expect(page.getByTestId("tuner-sheet")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("first-run-import").getByRole("button").click();
  await expect(page.getByTestId("add-sheet")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("first-run-course").getByRole("link").click();
  await expect(page).toHaveURL(/\/lessons\/(bass|guitar)-first-steps$/);
});

test("the default instrument chosen on the welcome sticks", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("first-run-instrument").getByRole("combobox").selectOption("guitar-6");
  await page.reload();
  await expect(page.getByTestId("first-run-instrument").getByRole("combobox")).toHaveValue(
    "guitar-6",
  );
  await page.getByTestId("first-run-course").getByRole("link").click();
  await expect(page).toHaveURL(/\/lessons\/guitar-first-steps$/);
});

test("the demo songs can be added with one click and removed again", async ({ page, seed }) => {
  await page.goto("/");
  await page.getByTestId("first-run-add-demo").click();
  await expect(page.getByTestId("song-card")).toHaveCount(3);
  await expect(page.getByTestId("library-empty")).toHaveCount(0);

  // A song of the user's own survives removing the demo songs.
  await seed.create({ title: "My Own Song", artist: "Me" });
  await page.reload();
  await expect(page.getByTestId("song-card")).toHaveCount(4);

  await page.getByTestId("open-settings").click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("demo-remove").click();
  await expect(page.getByTestId("demo-add")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("song-card")).toHaveCount(1);
  await expect(page.getByTestId("song-title")).toHaveText("My Own Song");
});

test("the demo tab with audio opens in the player", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("first-run-add-demo").click();
  await page.getByTestId("song-title").filter({ hasText: "Walking Home" }).click();
  await expect(page.getByTestId("player-play")).toBeVisible();
});

test("a demo instance is read-only", async ({ browser }) => {
  const server = await startServer({ env: { FRETBOOK_DEMO_MODE: "true" } });
  try {
    const page = await browser.newPage({ baseURL: server.url });
    await page.goto("/");
    await expect(page.getByTestId("song-card")).toHaveCount(3);
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await expect(page.getByTestId("add-song")).toHaveCount(0);
    await expect(page.getByTestId("add-song-hero")).toHaveCount(0);

    // None of the controls the server would refuse are offered.
    for (const id of [
      "song-star",
      "song-edit",
      "song-add-to-setlist",
      "song-delete",
      "library-select",
      "library-manage-tags",
    ]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }

    await page.getByTestId("song-title").filter({ hasText: "Walking Home" }).click();
    await expect(page.getByTestId("player-play")).toBeVisible();
    for (const id of ["song-favourite", "song-tag-input", "song-edit-link", "player-tap"]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
    await page.getByTestId("export-menu").click();
    await expect(page.getByTestId("export-pdf")).toBeVisible();
    await expect(page.getByTestId("song-add-to-setlist")).toHaveCount(0);

    await page.goto("/");
    await page.getByTestId("song-title").filter({ hasText: "Porch Light" }).click();
    await expect(page.getByTestId("song-edit-link")).toHaveCount(0);
    await expect(page.getByTestId("song-favourite")).toHaveCount(0);

    await page.goto("/setlists");
    await expect(page.getByTestId("setlist-new-name")).toHaveCount(0);

    await page.goto("/");
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("calibration-setting")).toBeVisible();
    await expect(page.getByTestId("api-tokens")).toHaveCount(0);

    const refused = await page.request.post(`${server.url}/api/songs`, {
      data: { title: "Nope", artist: "", preset: "bass-4" },
    });
    expect(refused.status()).toBe(403);
    await page.close();
  } finally {
    await server.stop();
  }
});
