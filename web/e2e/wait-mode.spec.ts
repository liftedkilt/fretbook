import { expect, test } from "./support/fixtures";
import { fixture } from "./support/paths";

// The fake microphone loops `practice-riff-played.wav` (the riff's notes, 0.7 s apart) from the
// moment the browser starts. Wait mode stops on each note until the matching one comes round, so
// the test does not depend on where in the loop the song starts.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${fixture("practice-riff-played.wav")}`,
    ],
  },
});

test("the cursor waits on each note until it is played, then the song finishes", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("wait-silent").check();
  await page.getByTestId("wait-toggle").click();
  const status = page.getByTestId("wait-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-total", "8");

  await page.getByTestId("player-play").click();
  await expect(status).toHaveAttribute("data-state", "waiting");
  await expect(status).toContainText("Play E1");
  await expect(page.getByTestId("player-score")).toHaveAttribute("data-wait", "waiting");
  // The expected string and fret are lit on the fretboard (E1 is the open low string of the bass).
  await expect(page.getByTestId("fretboard-now")).toHaveCount(1);
  await expect(page.getByTestId("fretboard-summary")).toContainText("fret 0");

  // It only moves on when a note is played, one step at a time, and ends after the last one.
  await expect(status).toHaveAttribute("data-hits", "8", { timeout: 50_000 });
  await expect(status).toHaveAttribute("data-state", "done");
  await expect(status).toContainText("Done: 8 of 8");
});

test("wait mode starts from the bar the player chose", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("wait-silent").check();
  await page.getByTestId("player-next").click();
  await page.getByTestId("player-next").click();
  await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", "2");
  await page.getByTestId("wait-toggle").click();
  await page.getByTestId("player-play").click();

  const status = page.getByTestId("wait-status");
  // Bar 3 holds A1, then bar 4 holds E1: two notes are left.
  await expect(status).toHaveAttribute("data-hits", "2", { timeout: 50_000 });
  await expect(status).toHaveAttribute("data-state", "done");
});

test("wait mode stays inside the loop range", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("wait-silent").check();
  await page.getByTestId("player-next").click();
  await page.getByTestId("player-next").click();
  await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", "2");
  // Bar 3 only: its one note (A1) has to be played again and again.
  await page.getByRole("button", { name: "Loop A" }).click();
  await page.getByRole("button", { name: "Loop B" }).click();
  await page.getByTestId("wait-toggle").click();
  await page.getByTestId("player-play").click();

  const status = page.getByTestId("wait-status");
  await expect(status).toHaveAttribute("data-hits", /^[3-9]$/, { timeout: 50_000 });
  await expect(status).not.toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", "2");
});

test("clicking a later bar on the score moves the wait to that bar's note", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  const score = page.getByTestId("player-score");
  await expect(score.locator("svg").first()).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("wait-silent").check();
  await page.getByTestId("wait-toggle").click();
  await page.getByTestId("player-play").click();
  const status = page.getByTestId("wait-status");
  await expect(status).toHaveAttribute("data-state", "waiting");
  await expect(status).toContainText("Play E1");

  // Bar 3 holds A1. alphaTab maps a click to the beat under the pointer.
  await page.getByTestId("player-panel-toggle").click();
  await score.scrollIntoViewIfNeeded();
  // Bar 3 spans about x 378 to 445 of the score at the default viewport; click its note.
  await score.click({ position: { x: 396, y: 190 } });
  await expect(status).toContainText("Play A1");
});
