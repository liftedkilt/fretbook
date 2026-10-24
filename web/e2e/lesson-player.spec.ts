import { expect, test } from "./support/fixtures";
import { fixture } from "./support/paths";

// The fake microphone plays the riff of `practice-riff-played.wav` on a loop, as in wait-mode.spec.ts.
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

const COURSE = "---\ntitle: Play along\ntrack: bass\nlevels:\n  - start: Start\n---\n";
const lesson = (title: string, pass: string) =>
  `---\ntitle: ${title}\nlevel: start\nrequires: []\n---\nPlay the riff.\n\n\`\`\`fretbook:pass\n${pass}\n\`\`\`\n`;

test("finish a wait-mode lesson from the player, and the practice log keeps the completed run", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.request.put("/api/courses/play-along/source", { data: { text: COURSE } });
  await page.request.put("/api/courses/play-along/lessons/riff/source", {
    data: { text: lesson("Play the riff", "type: wait") },
  });

  // Pick a song on the lesson page; the link opens it in the player with the lesson attached.
  await page.goto("/lessons/play-along/riff");
  await page.getByTestId("lesson-song-pick").selectOption(song.id);
  await page.getByTestId("lesson-play-link").click();
  await expect(page).toHaveURL(new RegExp(`/songs/${song.id}\\?lesson=play-along/riff$`));
  const banner = page.getByTestId("lesson-run");
  await expect(banner).toContainText("wait mode");
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("wait-silent").check();
  await page.getByTestId("wait-toggle").click();
  await page.getByTestId("player-play").click();
  const status = page.getByTestId("wait-status");
  await expect(status).toHaveAttribute("data-state", "done", { timeout: 50_000 });

  // The whole song was played: the lesson is passed without typing a result.
  await expect(page.getByTestId("lesson-run-passed")).toBeVisible();
  await page.getByTestId("lesson-run-back").click();
  await expect(page.getByTestId("lesson-done")).toBeVisible();

  // The run is in the practice log as a completed wait session.
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/songs/${song.id}/practice`);
      const history = await response.json();
      return history.sessions.some(
        (item: { mode: string; completed: boolean }) => item.mode === "wait" && item.completed,
      );
    })
    .toBe(true);
});

test("a wait run that starts part way through the song does not finish the lesson", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.request.put("/api/courses/play-along/source", { data: { text: COURSE } });
  await page.request.put("/api/courses/play-along/lessons/riff/source", {
    data: { text: lesson("Play the riff", "type: wait") },
  });

  await page.goto(`/songs/${song.id}?lesson=play-along/riff`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("wait-silent").check();
  await page.getByTestId("player-next").click();
  await page.getByTestId("player-next").click();
  await page.getByTestId("wait-toggle").click();
  await page.getByTestId("player-play").click();
  const status = page.getByTestId("wait-status");
  await expect(status).toHaveAttribute("data-state", "done", { timeout: 50_000 });
  await expect(page.getByTestId("lesson-run-passed")).toHaveCount(0);

  const response = await page.request.get("/api/courses/play-along/lessons/riff");
  expect((await response.json()).progress.completed).toBe(false);
});
