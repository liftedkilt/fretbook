import { expect, test } from "./support/fixtures";

type LabelBox = { text: string; top: number; bottom: number; left: number; right: number };

/** Tempo, section, and let-ring text drawn by alphaTab on the open score. */
async function effectLabels(page: import("@playwright/test").Page): Promise<LabelBox[]> {
  return page.getByTestId("player-score").evaluate((root) => {
    return [...root.querySelectorAll("text")]
      .map((node) => {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        const box = node.getBoundingClientRect();
        return {
          text,
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
        };
      })
      .filter(
        (item) => item.text === "Intro" || item.text === "LetRing" || item.text.includes("92"),
      );
  });
}

function overlaps(labels: LabelBox[]): string[] {
  const hits: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i];
      const b = labels[j];
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 1 && y > 1) hits.push(`${a.text} overlaps ${b.text}`);
    }
  }
  return hits;
}

test("tempo, section, and let-ring labels stay apart on a phone", async ({ page, seed }) => {
  const song = await seed.effectLabelTab();

  for (const size of [
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 414, height: 896 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/songs/${song.id}`);
    const score = page.getByTestId("player-score");
    await expect(score.locator("svg").first()).toBeVisible();
    await expect(score.locator("text", { hasText: "LetRing" }).first()).toBeVisible();
    const labels = await effectLabels(page);
    expect(labels.some((label) => label.text === "Intro")).toBe(true);
    expect(labels.some((label) => label.text.includes("92"))).toBe(true);
    expect(labels.some((label) => label.text === "LetRing")).toBe(true);
    expect(overlaps(labels)).toEqual([]);
  }
});
