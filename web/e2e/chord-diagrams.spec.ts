import { expect, test } from "./support/fixtures";

const SHEET =
  "{define: Am7 base-fret 1 frets x 0 2 0 1 0}\n[C]Hello [G]world\n[Am7]Goodbye [F]moon";

test("a chord sheet shows diagrams that follow transpose and remember the voicing", async ({
  page,
  seed,
}) => {
  const song = await seed.create({ title: "Diagram Song", chordpro: SHEET });
  await page.goto(`/songs/${song.id}`);

  const names = page.getByTestId("strip-chord-name");
  await expect(names).toHaveText(["C", "G", "Am7", "F"]);
  await expect(page.getByTestId("chord-card").first().getByRole("img")).toHaveAttribute(
    "aria-label",
    /x 3 2 0 1 0/,
  );
  await expect(page.getByText("From this song")).toBeVisible();

  const first = page.getByTestId("chord-card").first();
  await first.getByTestId("voicing-next").click();
  await expect(first.getByTestId("voicing-count")).toHaveText("2 of 6");
  const label = await first.getByRole("img").getAttribute("aria-label");

  await page.reload();
  await expect(page.getByTestId("chord-card").first().getByTestId("voicing-count")).toHaveText(
    "2 of 6",
  );
  await expect(page.getByTestId("chord-card").first().getByRole("img")).toHaveAttribute(
    "aria-label",
    label!,
  );

  await page.getByTestId("transpose-up").click();
  await page.getByTestId("transpose-up").click();
  await expect(names).toHaveText(["D", "A", "Bm7", "G"]);

  await page.getByTestId("chord-instrument").selectOption("ukulele");
  await expect(page.getByTestId("chord-card").first().getByRole("img")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("chord-instrument")).toHaveValue("ukulele");
});

test("the chord library finds voicings for a chord", async ({ page }) => {
  await page.goto("/tools");
  await page.getByTestId("tool-card-chords").click();
  await expect(page).toHaveURL("/tools/chords");
  await expect(page.getByTestId("chord-voicing").first()).toBeVisible();

  await page.getByTestId("chord-search").fill("F#m7");
  await expect(page.getByTestId("chord-voicing").first()).toBeVisible();
  await page.getByTestId("chord-instrument").selectOption("ukulele");
  await expect(page.getByTestId("chord-voicing").first()).toBeVisible();
  await page.getByTestId("voicing-play").first().click();

  await page.getByTestId("chord-search").fill("Hm");
  await expect(page.getByTestId("chord-unknown")).toBeVisible();
  await page.getByTestId("tool-back").click();
  await expect(page).toHaveURL("/tools");
});
