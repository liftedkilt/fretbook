import { expect, test } from "./support/fixtures";

test("work through a built-in course: lessons unlock, progress is kept, and continue resumes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("nav-lessons").click();
  await expect(page).toHaveURL(/\/lessons$/);
  await expect(page.getByTestId("course-card-guitar-first-steps")).toBeVisible();
  await expect(page.getByTestId("course-card-bass-first-steps")).toBeVisible();
  await expect(page.getByTestId("course-card-guitar-first-steps")).toContainText(
    "0 of 4 lessons done",
  );

  await page.getByTestId("course-card-guitar-first-steps").click();
  await expect(page.getByTestId("lesson-row-02-e-minor-and-a-minor")).toContainText(
    "Finish the lesson before this one",
  );

  await page.getByTestId("course-continue").click();
  await expect(page.getByRole("heading", { name: "The open strings" })).toBeVisible();
  await expect(page.getByTestId("lesson-fretboard")).toBeVisible();
  await page.getByTestId("lesson-complete").click();
  await expect(page.getByTestId("lesson-passed")).toBeVisible();

  // The lesson that unlocked has a chord diagram, an exercise link and a score to report.
  await page.getByTestId("lesson-next").click();
  await expect(page.getByRole("heading", { name: "Em and Am" })).toBeVisible();
  await expect(page.getByTestId("lesson-chord")).toHaveCount(2);
  await expect(page.getByTestId("lesson-exercise")).toBeVisible();
  await page.getByTestId("lesson-score").fill("70");
  await page.getByTestId("lesson-bpm").fill("60");
  await page.getByTestId("lesson-report").click();
  await expect(page.getByTestId("lesson-missed")).toBeVisible();
  await page.getByTestId("lesson-score").fill("85");
  await page.getByTestId("lesson-report").click();
  await expect(page.getByTestId("lesson-passed")).toBeVisible();

  // Leave a lesson half-read and the home page offers to continue from it.
  await page.getByTestId("lesson-next").click();
  await expect(page.getByRole("heading", { name: "A steady strum" })).toBeVisible();
  await page.goto("/lessons");
  await expect(page.getByTestId("lessons-continue")).toContainText("A steady strum");
  await expect(page.getByTestId("course-card-guitar-first-steps")).toContainText(
    "2 of 4 lessons done",
  );

  // Progress survives a reload, and a locked lesson cannot be opened by its address.
  await page.goto("/lessons/guitar-first-steps/04-a-chord-song-of-your-own");
  await expect(page.getByTestId("lesson-locked")).toBeVisible();

  // The exercise link opens the preset drill.
  await page.goto("/lessons/guitar-first-steps/02-e-minor-and-a-minor");
  await page.getByTestId("lesson-exercise").click();
  await expect(page).toHaveURL(/\/tools\/exercises\?preset=openChordChanges$/);
  await expect(page.getByTestId("exercise-preset-openChordChanges")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("write a course and a lesson in the app, with a live preview", async ({ page }) => {
  await page.goto("/lessons");
  await page.getByRole("link", { name: "New course" }).click();
  await page
    .getByTestId("lesson-source")
    .fill(
      "---\ntitle: My own course\ntrack: bass\nsummary: Made in the browser\nlevels:\n  - start: Getting started\n---\n",
    );
  await page.getByTestId("lesson-id").fill("my-own");
  await page.getByTestId("lesson-save").click();
  await expect(page).toHaveURL(/\/lessons\/my-own$/);
  await expect(page.getByRole("heading", { name: "My own course" })).toBeVisible();

  await page.getByRole("link", { name: "New lesson" }).click();
  await page
    .getByTestId("lesson-source")
    .fill("---\ntitle: Hello bass\nlevel: start\n---\nPlay **slowly**.\n");
  await expect(page.getByTestId("lesson-id")).toHaveValue("hello-bass");
  await expect(page.getByTestId("lesson-preview")).toContainText("Play slowly.");
  await page.getByTestId("lesson-insert-pass").click();
  await page.getByTestId("lesson-insert-chord").click();
  await expect(page.getByTestId("lesson-preview").getByTestId("lesson-chord")).toBeVisible();

  // A mistake is reported with its line instead of being saved.
  await page.getByTestId("lesson-source").fill("---\ntitle: Broken\n---\n```fretbook:chord\n```\n");
  await expect(page.getByTestId("lesson-preview-error")).toContainText("line 4");
  await page
    .getByTestId("lesson-source")
    .fill("---\ntitle: Hello bass\nlevel: start\n---\nPlay **slowly**.\n");
  await expect(page.getByTestId("lesson-preview-error")).toHaveCount(0);
  await page.getByTestId("lesson-save").click();
  await expect(page).toHaveURL(/\/lessons\/my-own\/hello-bass$/);
  await expect(page.getByRole("heading", { name: "Hello bass" })).toBeVisible();

  // The lesson lists under the new course, and its edit page loads what was saved.
  await page.getByTestId("lesson-edit").click();
  await expect(page.getByTestId("lesson-source")).toHaveValue(/Play \*\*slowly\*\*/);
  await page.getByTestId("lesson-delete").click({ trial: true });
});

test("lesson pages look right on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/tools");
  await page.getByTestId("tool-card-lessons").click();
  await expect(page.getByTestId("lessons-view")).toBeVisible();
  await page.getByTestId("course-card-bass-first-steps").click();
  await page.getByTestId("course-continue").click();
  await expect(page.getByTestId("lesson-view")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
