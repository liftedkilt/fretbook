import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

import { expect, test as base } from "./support/fixtures";
import { renderNotes, type SynthNote } from "../src/lib/listen/harness/synth";
import { encodeWav } from "../src/lib/listen/harness/wav";

const RATE = 22050;

/** Three seconds of a synthesized bass note plucked every half second. Chromium repeats the file. */
function pluckedWav(midi: number): string {
  const notes: SynthNote[] = [];
  for (let start = 0.25; start < 2.8; start += 0.5) notes.push({ midi, start, duration: 0.4 });
  const samples = renderNotes(notes, 3, { sampleRate: RATE, instrument: "bass", seed: 7 });
  const file = path.join(mkdtempSync(path.join(tmpdir(), "fretbook-wait-")), `note-${midi}.wav`);
  writeFileSync(file, encodeWav(samples, RATE));
  return file;
}

// Chromium plays a WAV file as the microphone, so the real pitch engine hears a bass. The file
// is a launch flag, so each test starts its own browser.
async function microphone(
  midi: number,
  baseURL: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${pluckedWav(midi)}`,
    ],
  });
  const context = await browser.newContext({
    baseURL,
    permissions: ["microphone"],
    locale: "en-US",
  });
  return { page: await context.newPage(), close: () => browser.close() };
}

// `wait-riff.json` is two bars of 4/4 open-E quarter notes: eight notes, each an E1.
const test = base;

test.describe("playing the right note", () => {
  test("the cursor waits for each note and the song finishes", async ({ server, seed }) => {
    const song = await seed.waitRiff();
    const mic = await microphone(28, server.url);
    const page = mic.page;
    try {
      await page.goto(`/songs/${song.id}`);
      await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

      await page.getByTestId("player-wait").click();
      const chip = page.getByTestId("wait-status");
      await expect(chip).toBeVisible();
      const play = page.getByTestId("player-play");
      await expect(play).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
      await play.click();

      // The microphone plays an E1 every half second, so all eight notes get played.
      await expect(chip).toHaveAttribute("data-phase", "done", { timeout: 50_000 });
      await expect(chip).toHaveAttribute("data-hits", "8");
      await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", "1");
    } finally {
      await mic.close();
    }
  });
});

test.describe("playing the wrong note", () => {
  test("the cursor stays put and a hint appears", async ({ server, seed }) => {
    const song = await seed.waitRiff();
    const mic = await microphone(33, server.url);
    const page = mic.page;
    try {
      await page.goto(`/songs/${song.id}`);
      await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();

      await page.getByTestId("player-panel-toggle").click();
      await page.getByTestId("wait-hint-after").selectOption("2");
      await page.getByTestId("player-wait").click();
      const play = page.getByTestId("player-play");
      await expect(play).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
      await play.click();

      const chip = page.getByTestId("wait-status");
      await expect(chip).toHaveAttribute("data-phase", "waiting", { timeout: 15_000 });
      await expect(page.getByTestId("wait-hint")).toContainText("String 4, fret 0", {
        timeout: 15_000,
      });
      await expect(chip).toHaveAttribute("data-hits", "0");
      await expect(page.getByTestId("player-status")).toHaveAttribute("data-measure", /^(-1|0)$/);
      await expect(page.getByTestId("player-score")).toHaveAttribute("data-wait", "hint");

      // Skipping the note moves the cursor on.
      await page.getByTestId("wait-skip").click();
      await expect(chip).toHaveAttribute("data-phase", "waiting");
      await expect(page.getByTestId("wait-hint")).toBeHidden();
    } finally {
      await mic.close();
    }
  });
});
