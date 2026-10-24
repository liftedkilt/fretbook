import { expect, test } from "./support/fixtures";

test("transpose a tab, preview it, and save it as a new track", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

  await page.getByTestId("song-retune").click();
  await expect(page.getByTestId("retune-sheet")).toBeVisible();
  await expect(page.getByTestId("retune-nothing")).toBeVisible();
  await page.getByTestId("retune-semitones").fill("2");
  await page.getByTestId("retune-semitones").blur();
  await expect(page.getByTestId("retune-report")).toContainText("notes moved");
  await page.getByTestId("retune-add").click();

  await expect(page.getByTestId("retune-sheet")).toBeHidden();
  const saved = await (await page.request.get(`/api/songs/${song.id}`)).json();
  expect(saved.document.tracks).toHaveLength(2);
  expect(saved.document.tracks[1].name).toMatch(/\(converted\)$/);
  // The player switches to the new track in place.
  await expect(page.getByRole("combobox", { name: "Track" })).toHaveValue(
    saved.document.tracks[1].id,
  );
  // The same bar, two frets higher on the same string.
  const first = (track: { bars: { voices: { beats: { notes: { fret: number }[] }[] }[] }[] }) =>
    track.bars[0].voices[0].beats.flatMap((beat) => beat.notes)[0].fret;
  expect(first(saved.document.tracks[1])).toBe(first(saved.document.tracks[0]) + 2);
});

test("retune a bass tab to a 5-string bass and replace the track", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await page.getByTestId("song-retune").click();
  await page.getByTestId("retune-goal").selectOption("convert");
  await page.getByTestId("retune-preset").selectOption("bass-5");
  await expect(page.getByTestId("retune-report")).toBeVisible();
  await page.getByTestId("retune-replace").click();
  await expect(page.getByTestId("retune-sheet")).toBeHidden();

  const saved = await (await page.request.get(`/api/songs/${song.id}`)).json();
  expect(saved.document.tracks).toHaveLength(1);
  expect(saved.document.tracks[0].tuning_midi).toHaveLength(5);
});

test("a chord sheet suggests a capo for barre chords", async ({ page, seed }) => {
  const song = await seed.create({
    title: "Flat Key",
    chordpro: "[Bb]Hello [Eb]world\n[F]Goodbye [Gm]moon",
  });
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("capo-option-3")).toContainText("play G, C, D, Em");
});
