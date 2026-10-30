import { expect, test } from "./support/fixtures";

// Issue #344: the fretboard (and wait mode's expected-note dot) must sit inside the viewport,
// above the dock and the wait bar, on a desktop and on a phone. Wait mode needs a microphone,
// so the browser gets a fake one.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    ...(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

test("the fretboard stays above the dock and the wait bar", async ({ page, seed }) => {
  const song = await seed.chordTab();

  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 664 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId("player-play")).toBeVisible();
    await page.getByTestId("player-panel-toggle").click();
    await page.getByTestId("player-sheet-tab-view").click();
    await page.getByTestId("fretboard-on").check();
    await page.getByTestId("player-sheet-tab-practice").click();
    await page.getByTestId("wait-silent").check();
    await page.getByTestId("wait-toggle").click();
    await expect(page.getByTestId("wait-status")).toBeVisible();
    await page.getByTestId("player-panel-toggle").click();
    await expect(page.getByTestId("player-fretboard")).toBeVisible();

    const clear = async () => {
      const r = await page.evaluate(() => {
        const fretboard = document
          .querySelector("[data-testid=player-fretboard]")!
          .getBoundingClientRect();
        const dock = document.querySelector(".dock .wait-status")!.getBoundingClientRect();
        return { top: fretboard.top, bottom: fretboard.bottom, dockTop: dock.top };
      });
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(r.dockTop + 1);
    };
    await clear();
    await page.getByTestId("player-play").click();
    await page.waitForTimeout(1000);
    await clear();
    await page.getByTestId("player-play").click();
  }
});
