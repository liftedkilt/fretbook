import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import LessonView from "./LessonView.svelte";

const mockGet = vi.fn();
const mockOpen = vi.fn();
const mockReport = vi.fn();
const mockCheck = vi.fn();

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  getLesson: (...args: unknown[]) => mockGet(...args),
  openLesson: (...args: unknown[]) => mockOpen(...args),
  reportLessonProgress: (...args: unknown[]) => mockReport(...args),
  checkLesson: (...args: unknown[]) => mockCheck(...args),
}));

const progress = (extra = {}) => ({
  completed: false,
  completed_at: null,
  attempts: 0,
  best_score: null,
  best_bpm: null,
  ...extra,
});

const lesson = (extra = {}) => ({
  course_id: "g1",
  course_title: "Guitar one",
  id: "l1",
  title: "Em and Am",
  summary: "Two chords",
  status: "available",
  source: "builtin",
  blocks: [
    { kind: "markdown", text: "Press **firmly**.", params: {} },
    { kind: "chord", text: "", params: { name: "Em", instrument: "guitar" } },
  ],
  pass_condition: null,
  progress: progress(),
  next_lesson_id: "l2",
  can_edit: false,
  ...extra,
});

const result = (passed: boolean, extra = {}) => ({
  passed,
  progress: progress({ completed: passed, attempts: 1, ...extra }),
  next_lesson_id: "l2",
});

describe("LessonView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockOpen.mockResolvedValue(undefined);
    mockGet.mockResolvedValue(lesson());
  });

  it("shows the lesson, notes the visit, and marks a lesson with no condition as done", async () => {
    mockReport.mockResolvedValue(result(true));
    render(LessonView, { course: "g1", lesson: "l1" });
    expect(await screen.findByRole("heading", { name: "Em and Am" })).toBeInTheDocument();
    expect(screen.getByTestId("lesson-chord")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("g1", "l1");
    expect(mockOpen).toHaveBeenCalledWith("g1", "l1");
    expect(screen.queryByTestId("lesson-edit")).toBeNull();
    expect(screen.queryByTestId("lesson-next")).toBeNull();

    await fireEvent.click(screen.getByTestId("lesson-complete"));
    expect(mockReport).toHaveBeenCalledWith("g1", "l1", { completed: true });
    expect(await screen.findByTestId("lesson-passed")).toBeInTheDocument();
    expect(screen.getByTestId("lesson-done")).toBeInTheDocument();
    expect(screen.getByTestId("lesson-next")).toHaveAttribute("href", "/lessons/g1/l2");
    expect(screen.queryByTestId("lesson-complete")).toBeNull();
  });

  it("takes a reported score and tempo, and says when it is not enough", async () => {
    mockGet.mockResolvedValue(
      lesson({ pass_condition: { type: "score", min_score: 80, min_bpm: 90, song: "" } }),
    );
    mockReport.mockResolvedValueOnce(result(false, { best_score: 70 }));
    mockReport.mockResolvedValueOnce(result(true, { best_score: 85 }));
    render(LessonView, { course: "g1", lesson: "l1" });
    expect(await screen.findByTestId("lesson-pass")).toHaveTextContent(
      "at least 80% at 90 BPM or faster",
    );
    expect(screen.getByTestId("lesson-report")).toBeDisabled();

    await fireEvent.input(screen.getByTestId("lesson-score"), { target: { value: "70" } });
    await fireEvent.input(screen.getByTestId("lesson-bpm"), { target: { value: "80" } });
    await fireEvent.click(screen.getByTestId("lesson-report"));
    expect(mockReport).toHaveBeenLastCalledWith("g1", "l1", { score: 70, bpm: 80 });
    expect(await screen.findByTestId("lesson-missed")).toBeInTheDocument();
    expect(screen.queryByTestId("lesson-next")).toBeNull();

    await fireEvent.input(screen.getByTestId("lesson-score"), { target: { value: "85" } });
    await fireEvent.click(screen.getByTestId("lesson-report"));
    expect(await screen.findByTestId("lesson-passed")).toBeInTheDocument();
    expect(screen.getByTestId("lesson-done")).toHaveTextContent("best score 85%");
  });

  it("reports wait mode with one click", async () => {
    mockGet.mockResolvedValue(lesson({ pass_condition: { type: "wait", song: "" } }));
    mockReport.mockResolvedValue(result(true));
    render(LessonView, { course: "g1", lesson: "l1" });
    await fireEvent.click(await screen.findByTestId("lesson-report-wait"));
    expect(mockReport).toHaveBeenCalledWith("g1", "l1", { wait_completed: true });
    expect(await screen.findByTestId("lesson-passed")).toBeInTheDocument();
  });

  it("checks the practice log for a lesson tied to a song", async () => {
    mockGet.mockResolvedValue(
      lesson({ pass_condition: { type: "score", min_score: 80, min_bpm: null, song: "s1" } }),
    );
    mockCheck.mockResolvedValue(result(false));
    render(LessonView, { course: "g1", lesson: "l1" });
    await fireEvent.click(await screen.findByTestId("lesson-check"));
    expect(mockCheck).toHaveBeenCalledWith("g1", "l1");
    expect(await screen.findByTestId("lesson-missed")).toBeInTheDocument();
    expect(screen.queryByTestId("lesson-score")).toBeNull();
  });

  it("offers editors the editor, and points the last lesson back at the course", async () => {
    mockGet.mockResolvedValue(
      lesson({ can_edit: true, progress: progress({ completed: true }), next_lesson_id: null }),
    );
    render(LessonView, { course: "g1", lesson: "l1" });
    expect(await screen.findByTestId("lesson-edit")).toHaveAttribute("href", "/lessons/g1/l1/edit");
    expect(screen.queryByTestId("lesson-next")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the course" })).toBeInTheDocument();
  });

  it("explains a locked lesson", async () => {
    mockGet.mockRejectedValue(
      new ApiError(403, "Finish the lessons before this one to open it.", "lesson.locked", {}),
    );
    render(LessonView, { course: "g1", lesson: "l2" });
    expect(await screen.findByTestId("lesson-locked")).toHaveTextContent("Finish the lessons");
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("shows other failures from reporting", async () => {
    mockReport.mockRejectedValue(new Error("boom"));
    render(LessonView, { course: "g1", lesson: "l1" });
    await fireEvent.click(await screen.findByTestId("lesson-complete"));
    await waitFor(() => expect(screen.getByTestId("lesson-error")).toHaveTextContent("boom"));
  });
});
