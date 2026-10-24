import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import type { ScoreSummary } from "../lib/listen/scored";
import ScorePanel from "./ScorePanel.svelte";

const summary = (graded: number): ScoreSummary => ({
  counts: { hit: graded, early: 0, late: 0, wrong: 0, missed: 0 },
  extras: 0,
  graded,
  total: 10,
  accuracy: 0.8,
  streak: 3,
  bestStreak: 3,
  bars: [],
});

function props(extra: Partial<Parameters<typeof render<typeof ScorePanel>>[1]> = {}) {
  return {
    on: false,
    summary: null,
    bleed: false,
    calibrated: true,
    error: "",
    ontoggle: vi.fn(),
    ...extra,
  };
}

describe("ScorePanel", () => {
  it("switches scoring on and off", async () => {
    const given = props();
    render(ScorePanel, { props: given });
    await fireEvent.click(screen.getByTestId("score-toggle"));
    expect(given.ontoggle).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("score-live")).toBeNull();
  });

  it("shows the live accuracy and streak, or asks you to start playing", () => {
    const { unmount } = render(ScorePanel, { props: props({ on: true, summary: summary(0) }) });
    expect(screen.getByTestId("score-live").textContent).toContain("Press play");
    unmount();
    render(ScorePanel, { props: props({ on: true, summary: summary(5) }) });
    const live = screen.getByTestId("score-live").textContent ?? "";
    expect(live).toContain("80%");
    expect(live).toContain("3");
    expect(live).toContain("5 of 10");
  });

  it("warns about missing calibration, bleed and errors", () => {
    render(ScorePanel, {
      props: props({ on: true, calibrated: false, bleed: true, error: "No mic" }),
    });
    expect(screen.getByTestId("score-no-calibration")).toBeTruthy();
    expect(screen.getByTestId("score-bleed")).toBeTruthy();
    expect(screen.getByTestId("score-error").textContent).toContain("No mic");
  });
});
