import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import type { ScoreSummary } from "../lib/listen/scored";
import ScoreResults from "./ScoreResults.svelte";

const summary: ScoreSummary = {
  counts: { hit: 6, early: 1, late: 1, wrong: 0, missed: 2 },
  extras: 3,
  graded: 10,
  total: 10,
  accuracy: 0.7,
  streak: 0,
  bestStreak: 4,
  bars: [{ credit: 4, total: 4 }, { credit: 1, total: 4 }, null],
};

function props(extra: Partial<Parameters<typeof render<typeof ScoreResults>>[1]> = {}) {
  return {
    open: true,
    summary,
    sections: [
      { name: "Intro", from: 0, to: 0, accuracy: 1, total: 4 },
      { name: null, from: 1, to: 2, accuracy: 0.25, total: 4 },
    ],
    speed: 80,
    loop: null,
    isBest: false,
    best: null,
    onclose: vi.fn(),
    onagain: vi.fn(),
    onpractise: vi.fn(),
    ...extra,
  };
}

describe("ScoreResults", () => {
  it("shows the overall score, the counts, the sections and the heatmap", () => {
    render(ScoreResults, { props: props() });
    expect(screen.getByTestId("score-overall").textContent).toBe("70%");
    expect(screen.getByRole("img", { name: "1 of 3 stars" })).toBeTruthy();
    expect(screen.getByTestId("score-counts").textContent).toContain("3");
    expect(screen.getByTestId("score-sections").textContent).toContain("Intro");
    expect(screen.getByTestId("score-sections").textContent).toContain("Bars 2–3");
    const heatmap = screen.getByTestId("score-heatmap");
    expect(heatmap.children).toHaveLength(3);
    expect(heatmap.children[1].getAttribute("aria-label")).toBe("Bar 2: 25%");
    expect(heatmap.children[2].getAttribute("aria-label")).toBe("Bar 3: no notes");
    // jsdom serialises the hsl() paint as rgb. 30% lightness at hue 120 is this green.
    expect((heatmap.children[0] as HTMLElement).style.background).toBe("rgb(29, 124, 29)");
  });

  it("loops the weakest bars, a chosen section, or plays again", async () => {
    const given = props();
    render(ScoreResults, { props: given });
    await fireEvent.click(screen.getByTestId("score-practise"));
    expect(given.onpractise).toHaveBeenLastCalledWith(0, 2);
    await fireEvent.click(screen.getByTestId("score-practise-section-1"));
    expect(given.onpractise).toHaveBeenLastCalledWith(1, 2);
    await fireEvent.click(screen.getByTestId("score-again"));
    expect(given.onagain).toHaveBeenCalledOnce();
  });

  it("announces a new personal best, or shows the one to beat", () => {
    const { unmount } = render(ScoreResults, { props: props({ isBest: true }) });
    expect(screen.getByTestId("score-new-best")).toHaveTextContent("New best");
    expect(screen.getByTestId("score-new-best")).not.toHaveTextContent("+");
    expect(screen.getByTestId("score-overall")).toHaveClass("best");
    unmount();
    const risen = render(ScoreResults, {
      props: props({
        isBest: true,
        best: {
          at: 1,
          accuracy: 0.64,
          stars: 1,
          hits: 6,
          total: 10,
          extras: 0,
          bestStreak: 4,
          loop: "full",
          speed: 80,
        },
      }),
    });
    expect(screen.getByTestId("score-new-best")).toHaveTextContent("New best · +6");
    risen.unmount();
    render(ScoreResults, {
      props: props({
        loop: { from: 1, to: 3 },
        best: {
          at: 1,
          accuracy: 0.9,
          stars: 3,
          hits: 9,
          total: 10,
          extras: 0,
          bestStreak: 9,
          loop: "1-3",
          speed: 80,
        },
      }),
    });
    expect(screen.getByTestId("score-best").textContent).toContain("90%");
  });
});
