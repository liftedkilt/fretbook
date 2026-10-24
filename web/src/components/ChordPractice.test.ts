import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChordPractice from "./ChordPractice.svelte";
import { MERGE_PAUSE_MS, SHEET_IDLE_MS } from "../lib/practiceLog";

const record = vi.fn();

vi.mock("../lib/api", () => ({
  recordPracticeSession: (...args: unknown[]) => record(...args),
}));

describe("ChordPractice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    record.mockReset();
    record.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("logs nothing until the player opts in", () => {
    const { unmount } = render(ChordPractice, { props: { songId: "s1" } });
    vi.advanceTimersByTime(60_000);
    unmount();
    expect(record).not.toHaveBeenCalled();
  });

  it("logs a free session for the chord sheet when switched off", async () => {
    const onlogged = vi.fn();
    render(ChordPractice, { props: { songId: "s1", onlogged } });
    const toggle = screen.getByTestId("chord-practice");
    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    vi.advanceTimersByTime(30_000);
    await fireEvent.click(toggle);
    // A short pause keeps the session open; it is saved once the pause outlasts the merge window.
    expect(record).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MERGE_PAUSE_MS);
    expect(record).toHaveBeenCalledTimes(1);
    const session = record.mock.calls[0][0];
    expect(session).toMatchObject({ song_id: "s1", mode: "free", track_id: "chords", score: null });
    expect(session.duration_seconds).toBeGreaterThanOrEqual(30);
    await vi.waitFor(() => expect(onlogged).toHaveBeenCalled());
  });

  it("stops counting after a long time with no input", async () => {
    render(ChordPractice, { props: { songId: "s1" } });
    await fireEvent.click(screen.getByTestId("chord-practice"));
    vi.advanceTimersByTime(SHEET_IDLE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole("status")).toHaveTextContent("Paused");
    vi.advanceTimersByTime(30 * 60_000);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].duration_seconds).toBe(SHEET_IDLE_MS / 1000);
  });
});
