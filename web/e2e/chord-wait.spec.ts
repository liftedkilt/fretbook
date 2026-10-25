import { expect, test } from "./support/fixtures";
import { fixture } from "./support/paths";

// The fake microphone loops `chords-played.wav` (a strummed C major, then G major, 2 s apart) from
// the moment the browser starts. Wait mode stops on each chord until the matching one comes round,
// so the tests do not depend on where in the loop they begin.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${fixture("chords-played.wav")}`,
    ],
  },
});

test("a tab waits on each chord beat until the chord is strummed", async ({ page, seed }) => {
  const song = await seed.chordTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("wait-silent").check();
  await expect(page.getByTestId("wait-chords")).toBeChecked();
  await page.getByTestId("wait-toggle").click();
  const status = page.getByTestId("wait-status");
  await expect(status).toHaveAttribute("data-total", "2");

  await page.getByTestId("player-play").click();
  await expect(status).toHaveAttribute("data-state", "waiting");
  await expect(status).toHaveAttribute("data-hits", "2", { timeout: 50_000 });
  await expect(status).toHaveAttribute("data-state", "done");
});

test("a chord sheet advances on the right chord until the sheet is done", async ({
  page,
  seed,
}) => {
  const song = await seed.create({ title: "Two Chords", chordpro: "[C]Hello [G]world" });
  await page.goto(`/songs/${song.id}`);

  await expect(page.getByTestId("chord-wait-input")).toBeHidden();
  await page.getByTestId("chord-wait-toggle").click();
  const status = page.getByTestId("chord-wait-status");
  await expect(status).toHaveAttribute("data-total", "2");

  await expect(status).toHaveAttribute("data-state", "waiting");
  await expect(status).toContainText("C");
  await expect(status).toHaveAttribute("data-hits", "2", { timeout: 50_000 });
  await expect(status).toHaveAttribute("data-state", "done");
  await expect(status).toContainText("Done: 2 of 2");

  // The input device and level meter sit in a popover, only while waiting.
  await expect(page.getByTestId("chord-wait").getByTestId("listen-panel")).toBeHidden();
  await page.getByTestId("chord-wait-input").click();
  await expect(page.getByTestId("chord-wait").getByTestId("listen-meter")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chord-wait").getByTestId("listen-panel")).toBeHidden();
});

test("a chord sheet does not advance on the wrong chord, but can be skipped", async ({
  page,
  seed,
}) => {
  // The microphone only ever plays C and G, so F# major never comes round.
  const song = await seed.create({ title: "Wrong Chord", chordpro: "[F#]Hello" });
  await page.goto(`/songs/${song.id}`);

  await page.getByTestId("chord-wait-toggle").click();
  const status = page.getByTestId("chord-wait-status");
  await expect(status).toHaveAttribute("data-state", "waiting");
  // A whole pass of the recording (4.4 s) and then some: both its chords were heard and refused.
  await page.waitForTimeout(6_000);
  await expect(status).toHaveAttribute("data-state", "waiting");
  await expect(status).toHaveAttribute("data-hits", "0");

  await page.getByTestId("chord-wait-skip").click();
  await expect(status).toHaveAttribute("data-state", "done");
});
