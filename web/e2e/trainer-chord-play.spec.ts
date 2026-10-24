import { expect, test } from "./support/fixtures";
import { fixture } from "./support/paths";

// A fake microphone is enough to open the listener; what it plays does not matter here, because
// the chord matching is covered on synthesized strums in Vitest.
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

test("the chord game can be answered by playing instead of with buttons", async ({ page }) => {
  await page.goto("/tools/trainer");
  await page.getByTestId("trainer-tab-chord").click();
  await page.getByTestId("trainer-answer-by").selectOption("play");
  await page.getByTestId("trainer-time").selectOption("0");
  await page.getByTestId("trainer-start").click();

  await expect(page.getByTestId("trainer-prompt")).toContainText("Play the chord you heard.");
  await expect(page.getByTestId("trainer-choices")).toHaveCount(0);
  await page.getByTestId("trainer-stop").click();
  await expect(page.getByTestId("trainer-results")).toBeVisible();
});
