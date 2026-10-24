import { render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LessonRunBanner from "./LessonRunBanner.svelte";

const mockGet = vi.fn();
const mockReport = vi.fn();

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  getLesson: (...args: unknown[]) => mockGet(...args),
  reportLessonProgress: (...args: unknown[]) => mockReport(...args),
}));

const lesson = (condition: unknown) => ({
  title: "A steady strum",
  pass_condition: condition,
  progress: { completed: false },
});
const waitCondition = { type: "wait", min_score: null, min_bpm: null, song: "" };
const ref = { course: "g1", lesson: "l3" };

function mount() {
  const view = render(LessonRunBanner, { lesson: ref });
  return view.component as unknown as { report: (run: unknown) => Promise<void> };
}

describe("LessonRunBanner", () => {
  beforeEach(() => vi.resetAllMocks());

  it("says what the lesson asks for and links back to it", async () => {
    mockGet.mockResolvedValue(lesson(waitCondition));
    mount();
    expect(await screen.findByText(/in wait mode, from the first note/)).toBeInTheDocument();
    expect(screen.getByTestId("lesson-run-back")).toHaveAttribute("href", "/lessons/g1/l3");
    expect(mockGet).toHaveBeenCalledWith("g1", "l3");
  });

  it("posts a finished wait run and shows that the lesson was passed, with the next lesson", async () => {
    mockGet.mockResolvedValue(lesson(waitCondition));
    mockReport.mockResolvedValue({ passed: true, progress: {}, next_lesson_id: "l4" });
    const banner = mount();
    await screen.findByText(/in wait mode/);
    await banner.report({ kind: "wait" });
    expect(mockReport).toHaveBeenCalledWith("g1", "l3", { wait_completed: true, completed: false });
    expect(await screen.findByTestId("lesson-run-passed")).toBeInTheDocument();
    expect(screen.getByTestId("lesson-run-next")).toHaveAttribute("href", "/lessons/g1/l4");
  });

  it("shows a miss, and an error when the result cannot be saved", async () => {
    mockGet.mockResolvedValue(lesson({ type: "score", min_score: 80, min_bpm: null, song: "" }));
    mockReport.mockResolvedValueOnce({ passed: false, progress: {}, next_lesson_id: null });
    const banner = mount();
    await screen.findByText(/at least 80%/);
    const run = { kind: "scored", accuracy: 60, songBpm: 100, rate: 1, wholeSong: true };
    await banner.report(run);
    expect(await screen.findByTestId("lesson-run-missed")).toBeInTheDocument();
    mockReport.mockRejectedValueOnce(new Error("offline"));
    await banner.report(run);
    expect(await screen.findByTestId("lesson-run-error")).toBeInTheDocument();
  });

  it("posts nothing for a run that does not count towards the lesson", async () => {
    mockGet.mockResolvedValue(lesson({ type: "score", min_score: 80, min_bpm: null, song: "" }));
    const banner = mount();
    await screen.findByText(/at least 80%/);
    await banner.report({ kind: "wait" });
    await banner.report({ kind: "scored", accuracy: 99, songBpm: 100, rate: 1, wholeSong: false });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("points a song-bound lesson at the practice check", async () => {
    mockGet.mockResolvedValue(lesson({ ...waitCondition, song: "s1" }));
    const banner = mount();
    expect(await screen.findByText(/Check my practice/)).toBeInTheDocument();
    await banner.report({ kind: "wait" });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it("copes with a lesson that cannot be loaded", async () => {
    mockGet.mockRejectedValue(new Error("nope"));
    mount();
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());
  });
});
