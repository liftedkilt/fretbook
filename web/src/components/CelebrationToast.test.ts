import { render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { celebrations, resetCelebrations } from "../lib/celebrate";
import CelebrationToast from "./CelebrationToast.svelte";

describe("CelebrationToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCelebrations();
  });

  afterEach(() => {
    resetCelebrations();
    vi.useRealTimers();
  });

  it("announces one celebration at a time and then the next", async () => {
    render(CelebrationToast);
    celebrations.push({ id: "goal:day", kind: "goal", count: 6, visual: true });
    celebrations.push({ id: "streak:7:day", kind: "streak", count: 7, visual: true });
    await tick();
    const toast = screen.getByTestId("celebration-toast");
    expect(toast).toHaveAttribute("data-kind", "goal");
    expect(toast).toHaveTextContent("Daily goal met");
    expect(toast).toHaveTextContent("6-day streak");
    expect(screen.getByTestId("celebration-host")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("A full week of practice.")).toBeNull();

    await vi.advanceTimersByTimeAsync(5000);
    await tick();
    expect(screen.getByTestId("celebration-toast")).toHaveAttribute("data-kind", "streak");
    expect(screen.getByTestId("celebration-toast")).toHaveTextContent("7-day streak");
    expect(screen.getByTestId("celebration-toast")).toHaveTextContent("A full week of practice.");

    await vi.advanceTimersByTimeAsync(5000);
    await tick();
    expect(screen.queryByTestId("celebration-toast")).toBeNull();
  });

  it("keeps a practice-page goal in the live region without showing the card", async () => {
    render(CelebrationToast);
    celebrations.push({ id: "goal:day", kind: "goal", count: 1, visual: false });
    await tick();
    const toast = screen.getByTestId("celebration-toast");
    expect(toast).toHaveAttribute("data-visual", "false");
    expect(toast).toHaveClass("visually-hidden");
    expect(toast).toHaveTextContent("Daily goal met");
    expect(toast).toHaveTextContent("1-day streak");
  });

  it("hides the streak line when the goal was met with no streak yet", async () => {
    render(CelebrationToast);
    celebrations.push({ id: "goal:day", kind: "goal", count: 0, visual: true });
    await tick();
    expect(screen.getByTestId("celebration-toast")).toHaveTextContent("Daily goal met");
    expect(screen.getByTestId("celebration-toast").querySelectorAll(".copy span")).toHaveLength(0);
  });
});
