import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Wait for all running CSS/Web animations on the page (excluding infinite loops) to finish. */
async function waitForAnimations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const timing = a.effect?.getComputedTiming?.();
      return timing?.iterations === Infinity || a.playState !== "running";
    }),
  );
}

/** Every WCAG A/AA violation on the page as readable strings (empty when the page is clean). */
async function violations(page: Page, where: string, include?: string) {
  await waitForAnimations(page);
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations.map(
    (v) =>
      `${where}: ${v.id} (${v.impact}) ${v.nodes
        .slice(0, 4)
        .map((n) => `${n.target.join(" ")} ${n.failureSummary?.replace(/\s+/g, " ")}`)
        .join(" | ")}`,
  );
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("main pages have no axe violations", async ({ page, seed }) => {
      const tab = await seed.musicXmlTab();
      const sheet = await seed.chordSheet();
      const found: string[] = [];
      for (const path of [
        "/",
        "/practice",
        "/setlists",
        "/bands",
        "/tools",
        "/tools/tuner",
        "/tools/metronome",
        "/tools/rhythm",
        "/tools/chords",
        "/settings",
        "/lessons",
        "/lessons/guitar-first-steps",
        "/lessons/guitar-first-steps/02-the-open-strings",
        "/lessons/guitar-first-steps/01-holding-and-tuning/edit",
        `/songs/${tab.id}`,
        `/songs/${sheet.id}`,
        `/songs/${tab.id}/edit`,
      ]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        found.push(...(await violations(page, path)));
      }
      expect(found).toEqual([]);
    });

    test("the first-run welcome has no axe violations", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("first-run-demo")).toBeVisible();
      expect(await violations(page, "first run")).toEqual([]);
    });

    test("sheets have no axe violations", async ({ page, seed }) => {
      const tab = await seed.musicXmlTab();
      const found: string[] = [];

      await page.goto("/");
      for (const [trigger, sheet] of [["add-song", "add-sheet"]]) {
        await page.getByTestId(trigger).click();
        await expect(page.getByTestId(sheet)).toBeVisible();
        found.push(...(await violations(page, sheet)));
        await page.keyboard.press("Escape");
        await expect(page.getByTestId(sheet)).toBeHidden();
      }

      await page.goto(`/songs/${tab.id}`);
      await expect(page.getByTestId("player-play")).toBeVisible();
      await page.keyboard.press("?");
      await expect(page.getByTestId("shortcut-help")).toBeVisible();
      found.push(...(await violations(page, "shortcut-help")));
      await page.keyboard.press("Escape");

      await page.goto(`/songs/${tab.id}`);
      await expect(page.getByTestId("player-play")).toBeVisible();
      await page.getByTestId("song-metadata-edit").click();
      await expect(page.getByTestId("metadata-sheet")).toBeVisible();
      found.push(...(await violations(page, "metadata-sheet")));
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("metadata-sheet")).toBeHidden();

      // Auto-sync needs a recording: the click-track fixture is enough for the sheet to show a proposal.
      const synced = await seed.syncedSongWithAudio();
      await page.goto(`/songs/${synced.id}`);
      await expect(page.getByTestId("player-play")).toBeVisible();
      await page.getByTestId("player-panel-toggle").click();
      await page.getByTestId("player-autosync").click();
      await expect(page.getByTestId("autosync-sheet")).toBeVisible();
      found.push(...(await violations(page, "autosync-sheet")));
      await page.getByTestId("autosync-estimate").click();
      await expect(page.getByTestId("autosync-summary")).toBeVisible({ timeout: 30_000 });
      found.push(...(await violations(page, "autosync-sheet")));
      expect(found).toEqual([]);
    });

    test("the library toolbar popover, song menu and import banner have no axe violations", async ({
      page,
      seed,
    }) => {
      await seed.musicXmlTab();
      await seed.chordSheet();
      const found: string[] = [];
      await page.goto("/");
      await expect(page.getByTestId("song-card")).toHaveCount(2);

      await page.getByTestId("library-filters").click();
      await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
      found.push(...(await violations(page, "library-filters")));
      await page.getByTestId("library-level-easy").click();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("library-active-filter")).toBeVisible();
      found.push(...(await violations(page, "library-active-filters")));
      await page.getByTestId("library-clear-filters").click();

      await page.getByTestId("song-menu").first().click();
      await expect(page.getByRole("menu")).toBeVisible();
      found.push(...(await violations(page, "song-menu")));
      await page.keyboard.press("Escape");

      await page.getByTestId("add-song").click();
      await page.getByTestId("add-mode-file").click();
      await page.getByTestId("add-file-input").setInputFiles({
        name: "bad-riff.musicxml",
        mimeType: "application/xml",
        buffer: Buffer.from("<not-a-score/>"),
      });
      await expect(page.getByTestId("add-error")).toBeVisible();
      await page.getByTestId("add-sheet-close").click();
      await expect(page.getByTestId("recent-imports-banner")).toBeVisible();
      found.push(...(await violations(page, "import-banner")));
      await page.getByTestId("recent-imports-review").click();
      await expect(page.getByTestId("recent-import-item")).toBeVisible();
      found.push(...(await violations(page, "import-banner-open")));
      expect(found).toEqual([]);
    });

    test("the setlist overflow menu has no axe violations", async ({ page }) => {
      const made = await page.request.post("/api/setlists", { data: { name: "Friday" } });
      expect(made.ok()).toBeTruthy();
      const setlist = (await made.json()) as { id: string };
      await page.goto(`/setlists/${setlist.id}`);
      await page.getByTestId("setlist-overflow").click();
      await expect(page.getByRole("menu")).toBeVisible();
      expect(await violations(page, "setlist-overflow")).toEqual([]);
    });

    test("the practice home with history and its goal popover have no axe violations", async ({
      page,
      seed,
    }) => {
      const song = await seed.chordSheet();
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const logged = await page.request.post("/api/practice/sessions", {
        data: {
          song_id: song.id,
          day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
          duration_seconds: 420,
          speed: 1,
          mode: "free",
        },
      });
      expect(logged.ok()).toBeTruthy();
      await page.goto("/practice");
      await expect(page.getByTestId("practice-ring")).toBeVisible();
      const found = await violations(page, "practice home");
      await page.getByTestId("practice-goal-chip").click();
      await expect(page.getByTestId("practice-goal-input")).toBeVisible();
      found.push(...(await violations(page, "practice goal popover")));
      expect(found).toEqual([]);
    });
  });
}

test("sheets trap focus, close on Escape and give focus back", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByTestId("add-song");
  await opener.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByTestId("add-sheet");
  await expect(sheet).toBeVisible();

  // Tab far more times than the sheet has controls. The page behind is inert, so focus either
  // stays inside the sheet or briefly leaves the document (the browser's own UI), never on the page.
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const where = await sheet.evaluate((el) => {
      const active = document.activeElement;
      return el.contains(active) || active === document.body
        ? "ok"
        : active?.outerHTML.slice(0, 80);
    });
    expect(where).toBe("ok");
  }

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test("the library is reachable by keyboard with a visible focus ring", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto("/");
  const link = page.locator(`a[href$="/songs/${song.id}"]`).first();
  await expect(link).toBeVisible();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await link.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  const outline = await link.evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("player-play")).toBeVisible();
});

test("the player announces playback state and every dock button has a name", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  const play = page.getByTestId("player-play");
  await expect(play).toBeVisible();
  const status = page.getByTestId("player-announcer");
  await expect(status).toHaveText("Paused");
  await expect(status).toHaveAttribute("role", "status");

  await play.click();
  await expect(status).toHaveText(/Playing|Counting in/);
  await play.click();
  await expect(status).toHaveText("Paused");

  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label"))
      .map((b) => b.outerHTML.slice(0, 120)),
  );
  expect(unnamed).toEqual([]);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("animations and transitions are effectively off", async ({ page, seed }) => {
    const song = await seed.musicXmlTab();
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId("player-play")).toBeVisible();
    const slow = await page.evaluate(() => {
      const limit = 0.05;
      const toSeconds = (list: string) => list.split(",").map((v) => parseFloat(v));
      return [...document.querySelectorAll("*")]
        .filter((el) => {
          const style = getComputedStyle(el);
          return (
            toSeconds(style.animationDuration).some((v) => v > limit) &&
            style.animationName !== "none"
          );
        })
        .map((el) => el.className.toString())
        .slice(0, 5);
    });
    expect(slow).toEqual([]);
  });
});
