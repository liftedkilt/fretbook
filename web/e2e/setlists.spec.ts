import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";
import { menuItem } from "./support/song-page";

async function addSongs(page: Page, titles: string[]) {
  await page.getByTestId("setlist-add-open").click();
  for (const title of titles) {
    await page.getByTestId("setlist-result").filter({ hasText: title }).click();
  }
  await page.getByTestId("setlist-picker-add").click();
  await expect(page.getByTestId("setlist-song-picker")).toBeHidden();
}

async function openAndClick(page: Page, menu: string, item: string) {
  await page.getByTestId(menu).click();
  await page.getByTestId(item).click();
}

async function rowMenu(page: Page, title: string, item: string) {
  await page.getByRole("button", { name: `More for ${title}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

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
  await page.getByTestId("setlist-new").click();
  await page.getByTestId("setlist-new-name").fill("Friday gig");
  await page.getByTestId("setlist-create").click();
  await expect(page).toHaveURL(/\/setlists\/[^/]+$/);
  await expect(page.getByTestId("setlist-name")).toHaveValue("Friday gig");
  await expect(page.getByTestId("setlist-entries-empty")).toBeVisible();

  await addSongs(page, ["Alpha", "Bravo", "Charlie"]);
  const titles = page.getByTestId("setlist-entry-title");
  await expect(titles).toHaveText(["Alpha", "Bravo", "Charlie"]);

  // Buttons.
  await rowMenu(page, "Charlie", "Move up");
  await expect(titles).toHaveText(["Alpha", "Charlie", "Bravo"]);
  // Keyboard: focus stays on the moved row, and Alt+arrows move it again.
  await expect(page.getByRole("button", { name: "More for Charlie" })).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(titles).toHaveText(["Charlie", "Alpha", "Bravo"]);
  await expect(page.getByTestId("setlist-announce")).toHaveText(
    "Charlie moved to position 1 of 3.",
  );

  // Notes and a per-entry transpose.
  const entry = (title: string) => page.getByTestId("setlist-entry").filter({ hasText: title });
  await entry("Alpha").getByTestId("setlist-entry-note-text").click();
  await entry("Alpha").getByTestId("setlist-entry-note").fill("capo 2, skip solo");
  await entry("Alpha").getByTestId("setlist-entry-note").blur();
  await entry("Alpha").getByTestId("setlist-transpose-up").click();
  await entry("Alpha").getByTestId("setlist-transpose-up").click();
  await expect(entry("Alpha").getByTestId("setlist-transpose-value")).toHaveText("+2");

  // The order survives a reload.
  await expect(async () => {
    await page.reload();
    await expect(titles).toHaveText(["Charlie", "Alpha", "Bravo"]);
    await expect(entry("Alpha").getByTestId("setlist-entry-note-text")).toContainText(
      "capo 2, skip solo",
    );
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
    openAndClick(page, "setlist-overflow", "setlist-export-pdf"),
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
  const two = page.getByTestId("setlist-row").filter({ hasText: "Two" });
  await two.getByTestId("setlist-card-menu").click();
  await page.getByTestId("setlist-card-delete").click();
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
  await page.getByTestId("setlist-new").click();
  await page.getByTestId("setlist-new-name").fill("Scroll test");
  await page.getByTestId("setlist-create").click();
  await addSongs(page, [tab.title, "Zulu"]);
  await page.getByTestId("setlist-play").click();
  await expect(page.getByTestId("player-play")).toBeVisible();

  await page.evaluate(() => {
    document.body.style.minHeight = "4000px";
    // Inside the song page, like a long score: the sticky bars stay within their parent.
    document
      .querySelector(".song-header")!
      .parentElement!.insertAdjacentHTML(
        "beforeend",
        '<div style="height:3000px" aria-hidden="true"></div>',
      );
  });
  // Wheel over the sticky play bar: the score keeps wheel events that land on it.
  await page.mouse.move(200, 100);
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
  // One slim row, not the old 168px card.
  expect(rects.bar.height).toBeLessThanOrEqual(64);
});

test("on a phone the play bar sits under the song header and Next goes to the next song", async ({
  page,
  seed,
}) => {
  await seed.create({ title: "Alpha", chordpro: SHEET("Alpha") });
  await seed.create({ title: "Bravo", chordpro: SHEET("Bravo") });
  await page.setViewportSize({ width: 390, height: 664 });

  await page.goto("/setlists");
  await page.getByTestId("setlist-new").click();
  await page.getByTestId("setlist-new-name").fill("Phone gig");
  await page.getByTestId("setlist-create").click();
  await addSongs(page, ["Alpha", "Bravo"]);
  await page.getByTestId("setlist-play").click();
  await expect(page.getByTestId("setlist-play-bar")).toBeVisible();
  await expect(page.getByTestId("song-heading")).toHaveText("Alpha");

  // The bar starts right under the header, with no strip above the header.
  const layout = await page.evaluate(() => {
    const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    return { header: r(".song-header"), bar: r("[data-testid=setlist-play-bar]") };
  });
  expect(layout.header.top).toBeLessThanOrEqual(1);
  expect(layout.bar.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);

  // Every bar button is hit-testable: nothing (the header) covers it.
  for (const id of ["setlist-prev", "setlist-position", "setlist-next"]) {
    const covered = await page.getByTestId(id).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return !(top && (top === el || el.contains(top)));
    });
    expect(covered, id).toBe(false);
  }

  await page.getByTestId("setlist-next").click();
  await expect(page).toHaveURL(/\/play\/2$/);
  await expect(page.getByTestId("song-heading")).toHaveText("Bravo");
  await expect(page.getByTestId("setlist-position")).toHaveText("Song 2 of 2");
});

test("add a song to a setlist from the library and from the song page", async ({ page, seed }) => {
  await seed.create({ title: "Alpha", chordpro: SHEET("Alpha") });
  await seed.create({ title: "Bravo", chordpro: SHEET("Bravo") });

  await page.goto("/");
  // Library card: keyboard-reachable button, creating a new setlist on the way.
  const card = page.getByTestId("song-card").filter({ hasText: "Alpha" });
  await card.getByTestId("song-menu").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("song-add-to-setlist").click();
  await expect(page.getByTestId("setlist-picker-empty")).toBeVisible();
  await page.getByTestId("setlist-picker-name").fill("Friday gig");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("setlist-picker-done")).toContainText("Added Alpha to Friday gig.");
  await page.keyboard.press("Escape");

  // Song page: pick the existing setlist.
  await page.getByTestId("song-card").filter({ hasText: "Bravo" }).getByTestId("song-link").click();
  await menuItem(page, "song-add-to-setlist");
  await page.getByTestId("setlist-picker-item").filter({ hasText: "Friday gig" }).click();
  await expect(page.getByTestId("setlist-picker-done")).toContainText("Added Bravo to Friday gig.");
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page.getByTestId("setlist-entry-title")).toHaveText(["Alpha", "Bravo"]);
});

test("the picker marks songs already added, and removing a song can be undone", async ({
  page,
  seed,
}) => {
  await seed.create({ title: "Alpha", chordpro: SHEET("Alpha") });
  await seed.create({ title: "Bravo", chordpro: SHEET("Bravo") });
  const made = await page.request.post("/api/setlists", { data: { name: "Gig" } });
  const setlist = (await made.json()) as { id: string };

  await page.goto(`/setlists/${setlist.id}`);
  await expect(page.getByTestId("setlist-subtitle")).toHaveText("0 songs");
  await addSongs(page, ["Alpha"]);

  await page.getByTestId("setlist-add-open").click();
  const alpha = page.getByTestId("setlist-result").filter({ hasText: "Alpha" });
  await expect(alpha).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("setlist-add-search").fill("Brav");
  await expect(page.getByTestId("setlist-result")).toHaveCount(1);
  await page.getByTestId("setlist-song-picker-close").click();

  const titles = page.getByTestId("setlist-entry-title");
  await expect(titles).toHaveText(["Alpha"]);
  await rowMenu(page, "Alpha", "Remove from setlist");
  await expect(titles).toHaveCount(0);
  await page.getByTestId("setlist-undo").click();
  await expect(titles).toHaveText(["Alpha"]);
});

test("the setlist menu holds the destructive action last", async ({ page }) => {
  const made = await page.request.post("/api/setlists", { data: { name: "Gig" } });
  const setlist = (await made.json()) as { id: string };
  await page.goto(`/setlists/${setlist.id}`);
  await page.getByTestId("setlist-overflow").click();
  const items = page.getByRole("menuitem");
  await expect(items.last()).toHaveText("Delete setlist…");
});
