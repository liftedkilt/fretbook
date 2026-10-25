import { expect, test } from "./support/fixtures";

const SHEET = (word: string) => `{title: ${word}}\n[C]${word} [G]line\n`;

test("build a setlist, reorder it with buttons and the keyboard, and play it through", async ({
  page,
  seed,
}) => {
  await seed.create({ title: "Alpha", chordpro: SHEET("Alpha") });
  await seed.create({ title: "Bravo", chordpro: SHEET("Bravo") });
  await seed.create({ title: "Charlie", chordpro: SHEET("Charlie") });

  await page.goto("/");
  await page.getByTestId("nav-setlists").click();
  await expect(page.getByTestId("setlists-empty")).toBeVisible();
  await page.getByTestId("setlist-new-name").fill("Friday gig");
  await page.getByTestId("setlist-create").click();
  await expect(page).toHaveURL(/\/setlists\/[^/]+$/);
  await expect(page.getByTestId("setlist-name")).toHaveValue("Friday gig");
  await expect(page.getByTestId("setlist-entries-empty")).toBeVisible();

  for (const title of ["Alpha", "Bravo", "Charlie"]) {
    await page.getByRole("button", { name: `Add ${title}` }).click();
  }
  const titles = page.getByTestId("setlist-entry-title");
  await expect(titles).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // Buttons.
  await page.getByRole("button", { name: "Move Charlie up" }).click();
  await expect(titles).toHaveText(["Alpha", "Charlie", "Bravo"]);
  // Keyboard: focus stays on the moved row, and Alt+arrows move it again.
  await expect(page.getByRole("button", { name: "Move Charlie up" })).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(titles).toHaveText(["Charlie", "Alpha", "Bravo"]);
  await expect(page.getByTestId("setlist-announce")).toHaveText(
    "Charlie moved to position 1 of 3.",
  );

  // Notes and a per-entry transpose.
  const entry = (title: string) => page.getByTestId("setlist-entry").filter({ hasText: title });
  await entry("Alpha").getByTestId("setlist-entry-note").fill("capo 2, skip solo");
  await entry("Alpha").getByTestId("setlist-entry-note").blur();
  await entry("Alpha").getByTestId("setlist-transpose-up").click();
  await entry("Alpha").getByTestId("setlist-transpose-up").click();
  await expect(entry("Alpha").getByTestId("setlist-transpose-value")).toHaveText("+2");

  // The order survives a reload.
  await expect(async () => {
    await page.reload();
    await expect(titles).toHaveText(["Charlie", "Alpha", "Bravo"]);
    await expect(entry("Alpha").getByTestId("setlist-entry-note")).toHaveValue("capo 2, skip solo");
    await expect(entry("Alpha").getByTestId("setlist-transpose-value")).toHaveText("+2");
  }).toPass();

  // Play-through: next and previous, the note, and the transpose.
  await page.getByTestId("setlist-play").click();
  await expect(page).toHaveURL(/\/setlists\/[^/]+\/play\/1$/);
  await expect(page.getByTestId("setlist-position")).toHaveText("Song 1 of 3");
  await expect(page.getByTestId("song-heading")).toHaveText("Charlie");
  await expect(page.getByTestId("setlist-prev")).toBeDisabled();

  await page.getByTestId("setlist-next").click();
  await expect(page.getByTestId("setlist-position")).toHaveText("Song 2 of 3");
  await expect(page.getByTestId("song-heading")).toHaveText("Alpha");
  await expect(page.getByTestId("setlist-play-note")).toContainText("capo 2, skip solo");
  await expect(page.getByTestId("chord-name")).toHaveText(["D", "A"]);
  await expect(page.getByTestId("transpose-value")).toHaveText("+2");

  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("song-heading")).toHaveText("Bravo");
  await expect(page.getByTestId("chord-name")).toHaveText(["C", "G"]);
  await expect(page.getByTestId("setlist-next")).toHaveCount(0);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("setlist-position")).toHaveText("Song 2 of 3");

  await page.getByTestId("setlist-prev").click();
  await expect(page.getByTestId("song-heading")).toHaveText("Charlie");
});

test("drag a song to a new place, then export the setlist as one PDF", async ({ page, seed }) => {
  await seed.create({ title: "Alpha", chordpro: SHEET("Alpha") });
  await seed.create({ title: "Bravo", chordpro: SHEET("Bravo") });
  const tab = await seed.musicXmlTab();
  const response = await page.request.post("/api/setlists", { data: { name: "Mixed" } });
  const setlist = (await response.json()) as { id: string };
  const songs = await seed.list();
  await page.request.put(`/api/setlists/${setlist.id}/entries`, {
    data: { entries: songs.map((song) => ({ song_id: song.id })) },
  });
  expect(songs.map((song) => song.id)).toContain(tab.id);

  await page.goto(`/setlists/${setlist.id}`);
  const titles = page.getByTestId("setlist-entry-title");
  await expect(titles).toHaveCount(3);
  const before = await titles.allTextContents();

  await page.getByTestId("setlist-entry").nth(2).dragTo(page.getByTestId("setlist-entry").nth(0));
  await expect(titles).toHaveText([before[2], before[0], before[1]]);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("setlist-export-pdf").click(),
  ]);
  expect(download.suggestedFilename()).toBe("Mixed.pdf");

  // The same setlist is part of a library backup.
  const backup = await page.request.get("/api/library/export");
  expect(backup.ok()).toBe(true);
});

test("a song can be in several setlists, and setlists can be renamed and deleted", async ({
  page,
  seed,
}) => {
  const song = await seed.create({ title: "Shared", chordpro: SHEET("Shared") });
  for (const name of ["One", "Two"]) {
    const made = await page.request.post("/api/setlists", {
      data: { name, entries: [{ song_id: song.id }] },
    });
    expect(made.status()).toBe(201);
  }

  await page.goto("/setlists");
  await expect(page.getByTestId("setlist-row")).toHaveCount(2);
  await page.getByTestId("setlist-row").filter({ hasText: "One" }).getByRole("link").click();
  await page.getByTestId("setlist-name").fill("Renamed");
  await page.getByTestId("setlist-name").blur();
  await page.locator(".page-header").getByRole("link", { name: "Setlists" }).click();
  await expect(page.getByTestId("setlist-row").filter({ hasText: "Renamed" })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByTestId("setlist-row")
    .filter({ hasText: "Two" })
    .getByRole("button", { name: /Delete setlist/ })
    .click();
  await expect(page.getByTestId("setlist-row")).toHaveCount(1);
});

test("the play bar stays on screen while the score scrolls, clear of the dock", async ({
  page,
  seed,
}) => {
  const tab = await seed.musicXmlTab();
  await seed.create({ title: "Zulu", chordpro: SHEET("Zulu") });
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto("/setlists");
  await page.getByTestId("setlist-new-name").fill("Scroll test");
  await page.getByTestId("setlist-create").click();
  await page.getByRole("button", { name: `Add ${tab.title}` }).click();
  await page.getByRole("button", { name: "Add Zulu" }).click();
  await page.getByTestId("setlist-play").click();
  await expect(page.getByTestId("player-play")).toBeVisible();

  await page.evaluate(() => {
    document.body.style.minHeight = "4000px";
    document
      .querySelector(".content")!
      .insertAdjacentHTML("beforeend", '<div style="height:3000px" aria-hidden="true"></div>');
  });
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);

  const bar = page.getByTestId("setlist-play-bar");
  await expect(bar).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("setlist-next")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("setlist-prev")).toBeInViewport({ ratio: 1 });

  const rects = await page.evaluate(() => {
    const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    return { bar: r("[data-testid=setlist-play-bar]"), dock: r(".dock") };
  });
  expect(rects.bar.bottom).toBeLessThanOrEqual(rects.dock.top);
});

test("add a song to a setlist from the library and from the song page", async ({ page, seed }) => {
  await seed.create({ title: "Alpha", chordpro: SHEET("Alpha") });
  await seed.create({ title: "Bravo", chordpro: SHEET("Bravo") });

  await page.goto("/");
  // Library card: keyboard-reachable button, creating a new setlist on the way.
  const card = page.getByTestId("song-card").filter({ hasText: "Alpha" });
  await card.getByTestId("song-add-to-setlist").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("setlist-picker-empty")).toBeVisible();
  await page.getByTestId("setlist-picker-name").fill("Friday gig");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("setlist-picker-done")).toContainText("Added Alpha to Friday gig.");
  await page.keyboard.press("Escape");

  // Song page: pick the existing setlist.
  await page.getByTestId("song-card").filter({ hasText: "Bravo" }).getByTestId("song-link").click();
  await page.getByTestId("export-menu").click();
  await page.getByTestId("song-add-to-setlist").click();
  await page.getByTestId("setlist-picker-item").filter({ hasText: "Friday gig" }).click();
  await expect(page.getByTestId("setlist-picker-done")).toContainText("Added Bravo to Friday gig.");
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.getByTestId("setlist-entry-title")).toHaveText(["Alpha", "Bravo"]);
});
