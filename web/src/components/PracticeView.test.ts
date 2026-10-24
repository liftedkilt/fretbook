import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeStats } from "../lib/types";
import PracticeView from "./PracticeView.svelte";

const mockStats = vi.fn();
const mockSaveGoal = vi.fn();

vi.mock("../lib/api", () => ({
  getPracticeStats: (...args: unknown[]) => mockStats(...args),
  savePracticeGoal: (...args: unknown[]) => mockSaveGoal(...args),
  getRecommendations: () => Promise.reject(new Error("offline")),
}));

function stats(overrides: Partial<PracticeStats> = {}): PracticeStats {
  return {
    today: "2026-03-10",
    goal: { daily_minutes: 10, weekly_summary: true },
    today_seconds: 300,
    current_streak: 3,
    longest_streak: 5,
    total_seconds: 7200,
    songs_practised: 2,
    heatmap: [
      { day: "2026-03-10", seconds: 300, sessions: 1 },
      { day: "2026-03-09", seconds: 700, sessions: 2 },
    ],
    week: { seconds: 1000, previous_seconds: 500, days_practised: 2, goal_days: 1 },
    recent: [
      {
        song_id: "s1",
        title: "Alpha",
        artist: "Band",
        content_kind: "tab",
        session_count: 2,
        total_seconds: 900,
        last_practised: "2026-03-10T10:00:00+00:00",
        last_day: "2026-03-10",
        best_speed: 0.9,
        best_score: 88.4,
      },
    ],
    best_scores: [
      {
        song_id: "s1",
        title: "Alpha",
        artist: "Band",
        content_kind: "tab",
        session_count: 2,
        total_seconds: 900,
        last_practised: "2026-03-10T10:00:00+00:00",
        last_day: "2026-03-10",
        best_speed: 0.9,
        best_score: 88.4,
      },
    ],
    stale: [
      {
        song_id: "s2",
        title: "Dusty",
        artist: "",
        content_kind: "chords",
        session_count: 1,
        total_seconds: 60,
        last_practised: "2026-02-20T10:00:00+00:00",
        last_day: "2026-02-20",
        best_speed: 1,
        best_score: null,
      },
    ],
    ...overrides,
  };
}

describe("PracticeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStats.mockResolvedValue(stats());
  });

  it("shows the ring, streaks, week, heatmap and song lists", async () => {
    render(PracticeView);
    expect(await screen.findByTestId("practice-today")).toHaveTextContent("5");
    expect(screen.getByTestId("practice-ring")).toHaveAttribute("data-progress", "0.50");
    expect(screen.getByTestId("practice-streak")).toHaveTextContent("3");
    expect(screen.getByTestId("practice-longest")).toHaveTextContent("5");
    expect(screen.getByTestId("practice-songs")).toHaveTextContent("2");
    expect(screen.getByTestId("practice-week")).toHaveTextContent("+100% on last week");
    expect(screen.getAllByTestId("practice-heat-day")).toHaveLength(2);
    expect(screen.getByTestId("practice-list-recent")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("practice-list-scores")).toHaveTextContent("88%");
    const stale = screen.getByTestId("practice-list-stale");
    expect(stale).toHaveTextContent("Dusty");
    expect(stale).toHaveTextContent("18 days ago");
    expect(screen.queryByTestId("practice-empty")).toBeNull();
  });

  it("asks for the player's own day", async () => {
    render(PracticeView);
    await screen.findByTestId("practice-today");
    expect(mockStats.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("saves the daily goal", async () => {
    mockSaveGoal.mockResolvedValue({ daily_minutes: 20, weekly_summary: false });
    render(PracticeView);
    const input = (await screen.findByTestId("practice-goal-input")) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "20" } });
    await fireEvent.click(screen.getByTestId("practice-weekly-toggle"));
    await fireEvent.click(screen.getByTestId("practice-goal-save"));
    await waitFor(() =>
      expect(mockSaveGoal).toHaveBeenCalledWith({ daily_minutes: 20, weekly_summary: false }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("practice-ring")).toHaveAttribute("data-progress", "0.25"),
    );
    // The weekly summary is switched off by the saved goal.
    expect(screen.queryByTestId("practice-week")).toBeNull();
  });

  it("explains an empty log and hides the lists", async () => {
    mockStats.mockResolvedValue(
      stats({
        songs_practised: 0,
        heatmap: [],
        recent: [],
        best_scores: [],
        stale: [],
        current_streak: 0,
      }),
    );
    render(PracticeView);
    expect(await screen.findByTestId("practice-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("practice-list-recent")).toBeNull();
  });

  it("shows an error when the dashboard cannot load", async () => {
    mockStats.mockRejectedValue(new Error("down"));
    render(PracticeView);
    expect(await screen.findByRole("alert")).toHaveTextContent("down");
  });

  it("with no goal the ring counts minutes and stays empty", async () => {
    mockStats.mockResolvedValue(stats({ goal: { daily_minutes: 0, weekly_summary: true } }));
    render(PracticeView);
    await screen.findByTestId("practice-today");
    expect(screen.getByTestId("practice-ring")).toHaveAttribute("data-progress", "0.00");
  });
});
