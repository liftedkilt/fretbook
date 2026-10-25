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
    songs_practised: 5,
    songs_this_month: 2,
    last_lesson: null,
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
    exercises: [],
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

  it("saves the daily goal as soon as it changes", async () => {
    mockSaveGoal.mockResolvedValue({ daily_minutes: 20, weekly_summary: true });
    render(PracticeView);
    await fireEvent.click(await screen.findByTestId("practice-goal-chip"));
    const input = screen.getByTestId("practice-goal-input") as HTMLInputElement;
    expect(input.value).toBe("10");
    await fireEvent.input(input, { target: { value: "20" } });
    await fireEvent.change(input);
    await waitFor(() =>
      expect(mockSaveGoal).toHaveBeenCalledWith({ daily_minutes: 20, weekly_summary: true }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("practice-ring")).toHaveAttribute("data-progress", "0.25"),
    );
  });

  it("switches the weekly summary off from the goal popover", async () => {
    mockSaveGoal.mockResolvedValue({ daily_minutes: 10, weekly_summary: false });
    render(PracticeView);
    await fireEvent.click(await screen.findByTestId("practice-goal-chip"));
    await fireEvent.click(screen.getByTestId("practice-weekly-toggle"));
    await waitFor(() =>
      expect(mockSaveGoal).toHaveBeenCalledWith({ daily_minutes: 10, weekly_summary: false }),
    );
    await waitFor(() => expect(screen.queryByTestId("practice-week")).toBeNull());
  });

  it("hides the ring and the goal copy when the goal is off", async () => {
    mockStats.mockResolvedValue(stats({ goal: { daily_minutes: 0, weekly_summary: true } }));
    render(PracticeView);
    expect(await screen.findByTestId("practice-today")).toHaveTextContent("5");
    expect(screen.queryByTestId("practice-ring")).toBeNull();
    expect(screen.getByTestId("practice-subtitle")).toHaveTextContent("5 min played today");
    expect(screen.getByTestId("practice-goal-chip")).toHaveTextContent("Set a daily goal");
  });

  it("offers to continue the song practised last, and says how far the goal is", async () => {
    render(PracticeView);
    const link = await screen.findByTestId("practice-continue");
    expect(link.getAttribute("href")).toContain("/songs/s1");
    expect(screen.getByTestId("practice-subtitle")).toHaveTextContent("5 min to today's goal");
    expect(screen.getByTestId("practice-best")).toHaveTextContent("88%");
  });

  it("continues the last lesson when it was opened after the last song", async () => {
    mockStats.mockResolvedValue(
      stats({
        last_lesson: {
          course_id: "basics",
          lesson_id: "one",
          opened_at: "2026-03-10T11:00:00+00:00",
        },
      }),
    );
    render(PracticeView);
    const link = await screen.findByTestId("practice-continue");
    expect(link.getAttribute("href")).toContain("/lessons/basics/one");
  });

  it("keeps the song when it was practised after the last lesson", async () => {
    mockStats.mockResolvedValue(
      stats({
        last_lesson: {
          course_id: "basics",
          lesson_id: "one",
          opened_at: "2026-03-09T11:00:00+00:00",
        },
      }),
    );
    render(PracticeView);
    const link = await screen.findByTestId("practice-continue");
    expect(link.getAttribute("href")).toContain("/songs/s1");
  });

  it("explains an empty log and hides the lists", async () => {
    mockStats.mockResolvedValue(
      stats({
        songs_practised: 0,
        songs_this_month: 0,
        heatmap: [],
        recent: [],
        best_scores: [],
        stale: [],
        exercises: [],
        current_streak: 0,
      }),
    );
    render(PracticeView);
    expect(await screen.findByTestId("practice-empty")).toBeInTheDocument();
    expect(screen.getByTestId("practice-start")).toBeInTheDocument();
    expect(screen.queryByTestId("practice-ring")).toBeNull();
    expect(screen.queryByTestId("practice-list-recent")).toBeNull();
  });

  it("shows an error when the dashboard cannot load", async () => {
    mockStats.mockRejectedValue(new Error("down"));
    render(PracticeView);
    expect(await screen.findByRole("alert")).toHaveTextContent("down");
  });

  it("lists the trainer games, and a log of only trainer time is not empty", async () => {
    mockStats.mockResolvedValue(
      stats({
        songs_practised: 0,
        songs_this_month: 0,
        recent: [],
        best_scores: [],
        stale: [],
        exercises: [
          {
            kind: "interval",
            session_count: 3,
            total_seconds: 180,
            last_day: "2026-03-10",
            best_score: 82.5,
          },
        ],
      }),
    );
    render(PracticeView);
    const list = await screen.findByTestId("practice-list-exercises");
    expect(list).toHaveTextContent("Intervals");
    expect(list).toHaveTextContent("83%");
    expect(screen.queryByTestId("practice-empty")).toBeNull();
  });

  it("lists recent rhythm runs with pattern, tempo, hit rate and timing", async () => {
    const run = {
      kind: "rhythm" as const,
      day: "2026-03-10",
      duration_seconds: 60,
      rounds: 8,
      correct: 6,
      score: 75,
    };
    mockStats.mockResolvedValue(
      stats({
        rhythm_runs: [
          { ...run, pattern: "eighths", bpm: 80, mean_error_ms: 12.4 },
          { ...run, pattern: "song:s1:3", bpm: 90, song_id: "s1", song_title: "My Riff", bar: 3 },
        ],
      }),
    );
    render(PracticeView);
    const list = await screen.findByTestId("practice-list-rhythm-runs");
    expect(list).toHaveTextContent("75% hit");
    expect(list).toHaveTextContent("80 BPM");
    expect(list).toHaveTextContent("12 ms avg late");
    expect(list).toHaveTextContent("My Riff, bar 3");
  });
});
