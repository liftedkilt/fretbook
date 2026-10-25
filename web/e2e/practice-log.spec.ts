import { expect, test } from "./support/fixtures";

const SHEET = "{title: Hello}\n[C]Hello [G]friend\n";

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

test("the dashboard shows logged practice, and the daily goal can be changed", async ({
  page,
  seed,
}) => {
  const song = await seed.create({ title: "Warm Up", chordpro: SHEET });
  await page.goto("/");
  await page.getByTestId("nav-practice").click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(page.getByTestId("practice-empty")).toBeVisible();

  const logged = await page.request.post("/api/practice/sessions", {
    data: { song_id: song.id, day: today(), duration_seconds: 7 * 60, speed: 0.8, mode: "free" },
  });
  expect(logged.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("practice-today")).toHaveText("7");
  await expect(page.getByTestId("practice-streak")).toContainText("1");
  await expect(page.getByTestId("practice-songs")).toHaveText("1");
  await expect(page.getByTestId("practice-heat-day")).toHaveCount(1);
  await expect(page.getByTestId("practice-list-recent")).toContainText("Warm Up");
  await expect(page.getByTestId("practice-ring")).toHaveAttribute("data-progress", "0.47");

  await page.getByTestId("practice-goal-chip").click();
  await page.getByTestId("practice-goal-input").fill("7");
  await page.getByTestId("practice-goal-input").press("Enter");
  await expect(page.getByTestId("practice-ring")).toHaveAttribute("data-progress", "1.00");
  await page.reload();
  await expect(page.getByTestId("practice-goal-chip")).toContainText("7 min");
});

test("playing a tab is logged and shows in the song's history", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  const play = page.getByTestId("player-play");
  await expect(play).toBeEnabled();
  // The riff is four seconds long and a session needs at least five, so play it through twice;
  // the pause between the two is short enough to stay one session.
  for (let pass = 0; pass < 2; pass += 1) {
    await play.click();
    await expect(play).toHaveAttribute("data-playing", "true", { timeout: 30_000 });
    await expect(play).toHaveAttribute("data-playing", "false", { timeout: 30_000 });
  }

  // Leaving the song ends the session, even though the pause has not lasted a minute yet.
  await page.getByTestId("nav-practice").click();
  // The session is sent as the player closes, so the first read can beat it to the server.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("practice-songs")).toHaveText("1", { timeout: 2_000 });
  }).toPass();
  await expect(page.getByTestId("practice-list-recent")).toContainText("Practice Riff");

  await page.goBack();
  await expect(page.getByTestId("song-practice")).toBeVisible();
  await page.getByTestId("song-practice").locator("summary").click();
  await expect(page.getByTestId("song-practice-row")).toHaveCount(1);
});
