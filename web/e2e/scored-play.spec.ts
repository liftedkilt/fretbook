import { expect, test } from "./support/fixtures";
import { fixture } from "./support/paths";

// The fake microphone loops `practice-riff-played.wav` from the moment the browser starts, so how
// many notes land in time depends on where the loop is. The flow is what is checked here: play
// through with scoring on, then the results screen opens and can loop a section.
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

test("playing through with scoring on ends in a results screen that can loop a section", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("score-toggle").click();
  await expect(page.getByTestId("score-live")).toBeVisible();

  await page.getByTestId("player-play").click();
  const results = page.getByTestId("score-results");
  await expect(results).toBeVisible({ timeout: 50_000 });
  await expect(page.getByTestId("score-overall")).toContainText("%");
  await expect(page.getByTestId("score-heatmap").locator("li").first()).toBeVisible();

  await page.getByTestId("score-practise").click();
  await expect(results).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Loop A" })).toBeVisible();
});
