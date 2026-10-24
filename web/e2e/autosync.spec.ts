import { expect, test } from "./support/fixtures";

const RATE = 22050;

/** A mono 16-bit WAV with a kick on each bar's first beat, a click on the others and quiet hats, no music. */
function groove(bars: number, bpm: number, leadIn: number): Buffer {
  const beat = 60 / bpm;
  const total = Math.ceil((leadIn + bars * 4 * beat + 1) * RATE);
  const samples = new Float64Array(total);
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 31 - 1;
  };
  for (let index = 0; index < bars * 4 * 2; index += 1) {
    const start = Math.round((leadIn + (index * beat) / 2) * RATE);
    const downbeat = index % 8 === 0;
    const beatOnly = index % 2 === 0;
    for (let n = 0; n < 0.15 * RATE && start + n < total; n += 1) {
      const t = n / RATE;
      if (downbeat)
        samples[start + n] +=
          Math.sin(2 * Math.PI * (45 + 40 * Math.exp(-30 * t)) * t) * Math.exp(-18 * t);
      else if (beatOnly) samples[start + n] += 0.5 * noise() * Math.exp(-30 * t);
      else samples[start + n] += 0.1 * noise() * Math.exp(-120 * t);
    }
  }
  const data = Buffer.alloc(44 + total * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + total * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(total * 2, 40);
  for (let n = 0; n < total; n += 1) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[n] * 0.8)) * 32767), 44 + n * 2);
  }
  return data;
}

test("Auto-sync estimates the bar marks, previews them and saves them on accept", async ({
  page,
}) => {
  const bars = 8;
  const leadIn = 1.25;
  const created = await page.request.post("/api/songs", {
    data: { title: "Auto Groove", preset: "bass-4", bpm: 120, measures: bars },
  });
  const song = (await created.json()) as { id: string };
  await page.request.post(`/api/songs/${song.id}/audio`, {
    multipart: {
      file: { name: "groove.wav", mimeType: "audio/wav", buffer: groove(bars, 120, leadIn) },
    },
  });

  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-panel-toggle").click();
  await page.getByTestId("player-autosync").click();

  const sheet = page.getByTestId("autosync-sheet");
  await expect(sheet).toBeVisible();
  await page.getByTestId("autosync-estimate").click();
  const summary = page.getByTestId("autosync-summary");
  await expect(summary).toContainText(`${bars} bar marks found`, { timeout: 30_000 });
  await expect(summary).toContainText("120 BPM");

  // The preview plays the audio, with clicks.
  await page.getByTestId("autosync-preview").click();
  await expect(page.getByTestId("autosync-stop")).toBeVisible();
  await page.getByTestId("autosync-stop").click();
  await expect(page.getByTestId("autosync-preview")).toBeVisible();

  await page.getByTestId("autosync-accept").click();
  await expect(sheet).toBeHidden();

  // The marks were saved: bar k starts where the groove puts it, 2 s a bar after the lead-in.
  await expect
    .poll(
      async () => {
        const saved = await page.request.get(`/api/songs/${song.id}`);
        const body = (await saved.json()) as {
          document: { sync: { anchors: Record<string, number> } };
        };
        return body.document.sync.anchors;
      },
      { timeout: 10_000 },
    )
    .toMatchObject({ "0": expect.closeTo(leadIn, 1) });
  const saved = (await (await page.request.get(`/api/songs/${song.id}`)).json()) as {
    document: { sync: { anchors: Record<string, number> } };
  };
  for (let bar = 0; bar < bars; bar += 1) {
    expect(Math.abs(saved.document.sync.anchors[String(bar)] - (leadIn + bar * 2))).toBeLessThan(
      0.06,
    );
  }
});

test("Auto-sync is not offered for a song without audio", async ({ page, seed }) => {
  const song = await seed.musicXmlTab();
  await page.goto(`/songs/${song.id}`);
  await expect(page.getByTestId("player-score").locator("svg").first()).toBeVisible();
  await page.getByTestId("player-panel-toggle").click();
  await expect(page.getByTestId("player-autosync")).toHaveCount(0);
});
