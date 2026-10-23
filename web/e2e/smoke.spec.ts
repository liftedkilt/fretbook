import { readFile } from "node:fs/promises";

import { expect, test } from "./support/fixtures";
import { fixture } from "./support/paths";

test.describe("container smoke flows", () => {
  // Run tests in serial since they share the same container and data volume
  test.describe.configure({ mode: "serial" });

  test("health and metadata report version and yt-dlp version", async ({ page }) => {
    const health = await (await page.request.get("/api/health")).json();
    expect(health.ok).toBe(true);
    expect(health.version).toBeTruthy();

    const meta = await (await page.request.get("/api/meta")).json();
    expect(meta.name).toBe("Fretbook");
    expect(meta.version).toBeTruthy();
    expect(meta.ytdlp?.version).toBeTruthy();

    await page.goto("/");
    await page.getByTestId("open-settings").click();

    const about = page.getByTestId("about-setting");
    await expect(about).toContainText(`Version ${meta.version}`);
    if (meta.commit) {
      await expect(about).toContainText(`Build ${meta.commit.slice(0, 7)}`);
    }

    const ytdlp = page.getByTestId("ytdlp-setting");
    await expect(ytdlp).toContainText(meta.ytdlp.version);
    await page.keyboard.press("Escape");
  });

  test("library loads, imports MusicXML tab and renders score", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("add-song").click();
    await page.getByTestId("add-mode-file").click();
    await page.getByTestId("add-file-input").setInputFiles(fixture("practice-riff.musicxml"));

    await expect(page).toHaveURL(/\/songs\/[^/]+$/);
    await expect(page.getByTestId("song-heading")).toHaveText("Practice Riff");
    await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("song-title")).toHaveText("Practice Riff");
  });

  test("transposes chords and exports PDF", async ({ page }) => {
    // Add a chord sheet
    await page.goto("/");
    await page.getByTestId("add-song").click();
    await page.getByTestId("add-mode-chords").click();
    await page.getByTestId("add-sheet-title").fill("Smoke Chords");
    await page.getByTestId("add-sheet-text").fill("[C]Hello [G]world\n[Am]Goodbye [F]moon");
    await page.getByTestId("add-sheet-submit").click();

    await expect(page).toHaveURL(/\/songs\/[^/]+$/);
    await expect(page.getByTestId("song-heading")).toHaveText("Smoke Chords");
    const chords = page.getByTestId("chord-name");
    await expect(chords).toHaveText(["C", "G", "Am", "F"]);

    await page.getByTestId("transpose-up").click();
    await expect(page.getByTestId("transpose-value")).toHaveText("+1");

    // Test PDF export
    await page.getByTestId("export-menu").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-pdf").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(100);
  });

  test("switches language between English and Brazilian Portuguese", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const englishCount = await page.getByTestId("library-count").innerText();

    await page.getByTestId("open-settings").click();
    await page.getByTestId("language-select").selectOption("pt-BR");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("library-count")).not.toHaveText(englishCount);

    await page.getByTestId("open-settings").click();
    await page.getByTestId("language-select").selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("library-count")).toHaveText(englishCount);
  });
});
