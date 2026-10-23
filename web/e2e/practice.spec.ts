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
