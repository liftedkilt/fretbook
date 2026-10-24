import { render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SongPractice from "./SongPractice.svelte";

const mockHistory = vi.fn();

vi.mock("../lib/api", () => ({
  getSongPractice: (...args: unknown[]) => mockHistory(...args),
}));

const session = (id: string, extra: object = {}) => ({
  id,
  song_id: "s1",
  track_id: "t1",
  loop_name: "",
  loop_start: null,
  loop_end: null,
  started_at: "2026-03-10T10:00:00+00:00",
  day: "2026-03-10",
  duration_seconds: 125,
  speed: 0.8,
  mode: "free",
  score: null,
  ...extra,
});

describe("SongPractice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the song's sessions with what was practised", async () => {
    mockHistory.mockResolvedValue({
      session_count: 2,
      total_seconds: 250,
      best_speed: 0.8,
      best_score: 91,
      last_practised: "2026-03-10T10:00:00+00:00",
      sessions: [
        session("a", { loop_name: "Riff", mode: "wait" }),
        session("b", { loop_start: 2, loop_end: 5, mode: "scored", score: 91 }),
      ],
    });
    render(SongPractice, { songId: "s1" });
    const rows = await screen.findAllByTestId("song-practice-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Wait mode · Riff");
    expect(rows[0]).toHaveTextContent("80%");
    expect(rows[0]).toHaveTextContent("2m");
    expect(rows[1]).toHaveTextContent("Scored · bars 3–6");
    expect(screen.getByTestId("song-practice")).toHaveTextContent("Best speed: 80%");
    expect(screen.getByTestId("song-practice")).toHaveTextContent("Best score: 91%");
    expect(mockHistory).toHaveBeenCalledWith("s1");
  });

  it("shows nothing for a song that was never practised or when the history cannot load", async () => {
    mockHistory.mockResolvedValue({
      session_count: 0,
      total_seconds: 0,
      best_speed: null,
      best_score: null,
      last_practised: null,
      sessions: [],
    });
    const { unmount } = render(SongPractice, { songId: "s1" });
    await waitFor(() => expect(mockHistory).toHaveBeenCalled());
    expect(screen.queryByTestId("song-practice")).toBeNull();
    unmount();
    mockHistory.mockRejectedValue(new Error("down"));
    render(SongPractice, { songId: "s1" });
    await waitFor(() => expect(mockHistory).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("song-practice")).toBeNull();
  });
});
