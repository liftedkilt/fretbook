import { expect, test } from "./support/fixtures";

test.describe("Ear and fretboard trainer", () => {
  test("finds a note on the fretboard, shows per-string stats and feeds the practice log", async ({
    page,
  }) => {
    await page.goto("/tools");
    await page.getByTestId("tool-card-trainer").click();
    await expect(page).toHaveURL("/tools/trainer");

    await page.getByTestId("trainer-time").selectOption("0");
    await page.getByTestId("trainer-start").click();
    const name = (await page.getByTestId("trainer-note").textContent())!.trim();
    const prompt = (await page.getByTestId("trainer-prompt").textContent())!;
    const string = Number(/string (\d)/.exec(prompt)![1]) - 1;
    const open = [4, 11, 7, 2, 9, 4][string];
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const fret = (names.indexOf(name) - open + 12) % 12;
    await page.getByTestId(`fret-tap-${string}-${fret}`).click({ force: true });
    await expect(page.getByTestId("trainer-score")).toContainText("1 of 1");
    await page.waitForTimeout(1100);
    await page.getByTestId("trainer-stop").click();

    await expect(page.getByTestId("trainer-final-score")).toHaveText("100%");
    await expect(page.getByTestId(`trainer-string-${string}`)).toContainText("100%");

    // The game is in the practice log.
    await page.goto("/practice");
    await expect(page.getByTestId("practice-list-exercises")).toContainText("Fretboard notes");
  });

  test("names an interval with the buttons", async ({ page }) => {
    await page.goto("/tools/trainer");
    await page.getByTestId("trainer-tab-interval").click();
    await page.getByTestId("trainer-time").selectOption("0");
    await page.getByTestId("trainer-start").click();
    await expect(page.getByTestId("trainer-choices")).toBeVisible();
    await page.getByTestId("trainer-choice-m3").click();
    await expect(page.getByTestId("trainer-score")).toContainText("of 1");
    await expect(page.getByTestId("trainer-feedback")).not.toBeEmpty();
    await page.getByTestId("trainer-stop").click();
    await expect(page.getByTestId("trainer-results")).toBeVisible();
  });
});
