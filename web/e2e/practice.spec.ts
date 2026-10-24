import { expect, test } from "./support/fixtures";

test("the ? key lists the shortcuts, and Escape closes the list", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.keyboard.press("?");
  const help = page.getByTestId("shortcut-help");
  await expect(help).toBeVisible();
  await expect(help.getByText("Metronome on or off")).toBeVisible();
  await expect(help.getByText("Count-in: off, 1 bar, 2 bars")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
});

test("metronome, count-in and mixer settings are remembered per song", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-panel-toggle").click();

  const metronome = page.getByTestId("metronome-toggle");
  await expect(metronome).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("m");
  await expect(metronome).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("c");
  await expect(page.getByTestId("count-in-1")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("count-in-2").click();
  await expect(page.getByTestId("count-in-2")).toHaveAttribute("aria-checked", "true");

  const track = page.locator('[data-testid^="mix-track-"]').first();
  await track.getByRole("button", { name: /^Mute/ }).click();
  await expect(track.getByRole("button", { name: /^Mute/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("x");
  await expect(track.getByRole("button", { name: /^Mute/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.keyboard.press("s");
  await expect(track.getByRole("button", { name: /^Solo/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.reload();
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-panel-toggle").click();
  await expect(page.getByTestId("metronome-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("count-in-2")).toHaveAttribute("aria-checked", "true");
  await expect(
    page.locator('[data-testid^="mix-track-"]').first().getByRole("button", { name: /^Solo/ }),
  ).toHaveAttribute("aria-pressed", "true");

  // Another song starts from the defaults.
  const other = await seed.create({ title: "Other" });
  await page.goto(`/songs/${other.id}`);
  await page.getByTestId("player-panel-toggle").click();
  await expect(page.getByTestId("metronome-toggle")).toHaveAttribute("aria-pressed", "false");
});

test("a count-in runs before the synth starts", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  const play = page.getByTestId("player-play");
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await expect(play).toBeEnabled();

  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await page.keyboard.press(" ");
  // Two bars at 240 bpm last two seconds; nothing plays until they are over.
  await expect(play).toHaveAttribute("data-counting", "true");
  await expect(play).toHaveAttribute("data-playing", "false");
  await expect(play).toHaveAttribute("data-playing", "true", { timeout: 30_000 });
  await expect(play).toHaveAttribute("data-counting", "false");
  await page.keyboard.press(" ");
  await expect(play).toHaveAttribute("data-playing", "false");
});

test("slowing a recording keeps its pitch and the keys change the speed", async ({
  page,
  seed,
}) => {
  const song = await seed.syncedSongWithAudio();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  const audio = page.getByTestId("player-audio");
  await expect(audio).toHaveCount(1);

  await page.keyboard.press("[");
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  const state = () =>
    audio.evaluate((element: HTMLAudioElement) => ({
      rate: element.playbackRate,
      preservesPitch: element.preservesPitch,
    }));
  await expect.poll(state).toEqual({ rate: 0.75, preservesPitch: true });
  await page.keyboard.press("]");
  await expect.poll(state).toEqual({ rate: 0.8, preservesPitch: true });
});

test("the recording's volume and the metronome work alongside the audio", async ({
  page,
  seed,
}) => {
  const song = await seed.syncedSongWithAudio();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  const audio = page.getByTestId("player-audio");
  await page.getByTestId("player-panel-toggle").click();

  await page.getByTestId("mix-master").fill("0.4");
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.volume))
    .toBeCloseTo(0.4, 2);
  // Keys typed into the slider belong to the slider.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("-");
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.volume))
    .toBeCloseTo(0.35, 2);

  await page.getByTestId("metronome-toggle").click();
  await page.getByTestId("count-in-1").click();
  await expect(page.getByTestId("count-in-loops")).toBeVisible();
  await page.getByTestId("player-play").click();
  await expect(page.getByTestId("player-play")).toHaveAttribute("data-playing", "true", {
    timeout: 15_000,
  });
  await page.getByTestId("player-play").click();
});

test("saves named practice loops, jumps to them from the song page, and remembers speed trainer settings", async ({
  page,
  seed,
}) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  // Open dock drawer panel
  await page.getByTestId("player-panel-toggle").click();
  await expect(page.getByTestId("loop-panel")).toBeVisible();

  // Set loop A and B
  await page.getByTestId("player-loop-a").click();
  await page.getByTestId("player-next").click();
  await page.getByTestId("player-next").click();
  await page.getByTestId("player-loop-b").click();

  await expect(page.getByTestId("current-loop-range")).toBeVisible();

  // Save the loop with name "Solo"
  await page.getByTestId("save-loop-name").fill("Solo");
  await page.getByTestId("save-loop-button").click();

  // Verify saved loop appears in drawer panel
  const savedLoop = page.locator('[data-testid^="saved-loop-"]').first();
  await expect(savedLoop).toBeVisible();
  await expect(savedLoop.getByText("Solo")).toBeVisible();

  // Verify saved loop chip appears on the song page hero
  const heroChip = page.getByTestId("song-saved-loops");
  await expect(heroChip).toBeVisible();
  await expect(heroChip.getByText("Solo")).toBeVisible();

  // Clear current loop
  await page.getByTestId("player-clear-loop").click();
  await expect(page.getByTestId("current-loop-range")).toBeHidden();

  // Jump to the saved loop from the song page hero chip
  await heroChip.locator("button").first().click();
  await expect(page.getByTestId("current-loop-range")).toBeVisible();

  // Configure speed trainer
  await page.getByTestId("speed-trainer-toggle").click();
  await expect(page.getByTestId("speed-trainer-controls")).toBeVisible();
  await page.getByTestId("speed-trainer-start").fill("70");
  await page.getByTestId("speed-trainer-target").fill("100");
  await page.getByTestId("speed-trainer-step").fill("10");

  // Reload the page and verify loop and speed trainer settings are remembered
  await page.reload();
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await expect(page.getByTestId("song-saved-loops")).toBeVisible();
  await expect(page.getByTestId("song-saved-loops").getByText("Solo")).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  await expect(page.getByTestId("speed-trainer-toggle")).toBeChecked();
  await expect(page.getByTestId("speed-trainer-start")).toHaveValue("70");
});

test("speed trainer steps up speed and counts in between passes", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("player-panel-toggle").click();
  // Set loop on bar 0 (one short bar at 240 bpm)
  await page.getByTestId("player-loop-a").click();
  await page.getByTestId("player-loop-b").click();
  await expect(page.getByTestId("current-loop-range")).toHaveText("A1–B1");

  // Save loop
  await page.getByTestId("save-loop-name").fill("Short loop");
  await page.getByTestId("save-loop-button").click();

  // Enable speed trainer with start 60%, target 80%, step 20%, 1 pass
  await page.getByTestId("speed-trainer-toggle").click();
  await page.getByTestId("speed-trainer-start").fill("60");
  await page.getByTestId("speed-trainer-target").fill("80");
  await page.getByTestId("speed-trainer-step").fill("20");
  await page.getByTestId("speed-trainer-passes").fill("1");

  // Start playback
  const play = page.getByTestId("player-play");
  await play.click();

  // Count-in runs before playback
  await expect(play).toHaveAttribute("data-counting", "true");
  await expect(play).toHaveAttribute("data-playing", "true", { timeout: 15_000 });

  // After 1 pass (bar 0 loops back), count-in runs again between passes
  await expect(play).toHaveAttribute("data-counting", "true", { timeout: 15_000 });
  await expect(page.getByTestId("speed-trainer-status")).toBeVisible();

  await play.click();
});
