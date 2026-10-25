import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { recallLessonSong } from "../lib/lessonRun";
import { ui } from "../lib/ui.svelte";
import LessonView from "./LessonView.svelte";

const mockGet = vi.fn();
const mockCourse = vi.fn();
const mockOpen = vi.fn();
const mockReport = vi.fn();
const mockCheck = vi.fn();
const mockSongs = vi.fn();

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  getCourse: (...args: unknown[]) => mockCourse(...args),
  getLesson: (...args: unknown[]) => mockGet(...args),
  openLesson: (...args: unknown[]) => mockOpen(...args),
  reportLessonProgress: (...args: unknown[]) => mockReport(...args),
  checkLesson: (...args: unknown[]) => mockCheck(...args),
  listSongs: (...args: unknown[]) => mockSongs(...args),
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

const summary = (id: string, status: string) => ({
  id,
  title: id,
  summary: "",
  status,
  source: "builtin",
  requires: [],
  has_pass_condition: false,
});

const course = (
  levels = [
    ["l1", "available"],
    ["l2", "locked"],
    ["l3", "locked"],
  ],
) => ({
  id: "g1",
  title: "Guitar one",
  levels: [
    { id: "basics", title: "Basics", lessons: levels.map(([id, status]) => summary(id, status)) },
  ],
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
    mockSongs.mockResolvedValue({ items: [] });
    mockCourse.mockResolvedValue(course());
    localStorage.clear();
    ui.sheet = "";
    ui.addForLesson = null;
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

  it("offers the learner's tab songs to play the lesson on, linking back to the lesson", async () => {
    mockGet.mockResolvedValue(
      lesson({ pass_condition: { type: "wait", min_score: null, min_bpm: null, song: "" } }),
    );
    mockSongs.mockResolvedValue({
      items: [
        { id: "s1", title: "Riff", artist: "Me", content_kind: "tab" },
        { id: "s2", title: "Sheet", artist: "", content_kind: "chords" },
      ],
    });
    render(LessonView, { course: "g1", lesson: "l1" });
    const pick = await screen.findByTestId("lesson-song-pick");
    expect(screen.queryByTestId("lesson-play-link")).toBeNull();
    // Chord sheets cannot be played in wait or scored mode.
    expect(pick.querySelectorAll("option")).toHaveLength(2);
    await fireEvent.change(pick, { target: { value: "s1" } });
    expect(await screen.findByTestId("lesson-play-link")).toHaveAttribute(
      "href",
      "/songs/s1?lesson=g1/l1",
    );
  });

  const waitLesson = () =>
    lesson({ pass_condition: { type: "wait", min_score: null, min_bpm: null, song: "" } });
  const songItems = {
    items: [
      { id: "s1", title: "Riff", artist: "", content_kind: "tab" },
      { id: "s2", title: "Lick", artist: "", content_kind: "tab" },
    ],
  };

  it("lets a learner with an empty library import a song for the lesson", async () => {
    mockGet.mockResolvedValue(waitLesson());
    render(LessonView, { course: "g1", lesson: "l1" });
    expect(screen.queryByTestId("lesson-song-pick")).toBeNull();
    await fireEvent.click(await screen.findByTestId("lesson-import"));
    expect(ui.sheet).toBe("add");
    expect(ui.addForLesson).toEqual({ course: "g1", lesson: "l1" });
  });

  it("remembers the picked song and starts on it next time", async () => {
    mockGet.mockResolvedValue(waitLesson());
    mockSongs.mockResolvedValue(songItems);
    const first = render(LessonView, { course: "g1", lesson: "l1" });
    const pick = await screen.findByTestId("lesson-song-pick");
    await fireEvent.change(pick, { target: { value: "s2" } });
    expect(recallLessonSong(ui.me?.user_id, { course: "g1", lesson: "l1" })).toBe("s2");
    first.unmount();

    render(LessonView, { course: "g1", lesson: "l1" });
    expect(await screen.findByTestId("lesson-play-link")).toHaveAttribute(
      "href",
      "/songs/s2?lesson=g1/l1",
    );
  });

  it("ignores a remembered song that is no longer in the library", async () => {
    localStorage.setItem("fretbook.lessonSong.local.g1/l1", "gone");
    mockGet.mockResolvedValue(waitLesson());
    mockSongs.mockResolvedValue(songItems);
    render(LessonView, { course: "g1", lesson: "l1" });
    await screen.findByTestId("lesson-song-pick");
    expect(screen.queryByTestId("lesson-play-link")).toBeNull();
  });

  it("offers no song picker when the lesson names a song or has no pass condition", async () => {
    mockGet.mockResolvedValue(
      lesson({ pass_condition: { type: "wait", min_score: null, min_bpm: null, song: "s1" } }),
    );
    mockSongs.mockResolvedValue({
      items: [{ id: "s1", title: "Riff", artist: "", content_kind: "tab" }],
    });
    render(LessonView, { course: "g1", lesson: "l1" });
    await screen.findByTestId("lesson-check");
    expect(screen.queryByTestId("lesson-song-pick")).toBeNull();
    expect(mockSongs).not.toHaveBeenCalled();
  });

  it("shows where the lesson sits, with a locked next step until it is passed", async () => {
    mockReport.mockResolvedValue(result(true));
    render(LessonView, { course: "g1", lesson: "l1" });
    expect(await screen.findByText("Basics · Lesson 1 of 3")).toBeInTheDocument();
    expect(screen.queryByTestId("lesson-previous")).toBeNull();
    const locked = await screen.findByTestId("lesson-step-next");
    expect(locked).toHaveTextContent("Pass this lesson to unlock the next one.");
    expect(locked.querySelector("button")).toBeDisabled();

    await fireEvent.click(screen.getByTestId("lesson-complete"));
    await waitFor(() =>
      expect(screen.getByTestId("lesson-step-next")).toHaveAttribute("href", "/lessons/g1/l2"),
    );
  });

  it("links to the previous lesson, and has no next step on the last one", async () => {
    mockCourse.mockResolvedValue(
      course([
        ["l1", "completed"],
        ["l2", "completed"],
        ["l3", "available"],
      ]),
    );
    render(LessonView, { course: "g1", lesson: "l3" });
    expect(await screen.findByText("Basics · Lesson 3 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("lesson-previous")).toHaveAttribute("href", "/lessons/g1/l2");
    expect(screen.queryByTestId("lesson-step-next")).toBeNull();
  });

  it("makes playing the exercise the primary action, and self-reporting a ghost", async () => {
    mockGet.mockResolvedValue(
      lesson({
        pass_condition: { type: "wait", song: "" },
        blocks: [{ kind: "exercise", text: "", params: { preset: "warmup" } }],
      }),
    );
    render(LessonView, { course: "g1", lesson: "l1" });
    const play = await screen.findByTestId("lesson-play-link");
    expect(play).toHaveClass("primary");
    expect(play).toHaveTextContent("Play the exercise in wait mode");
    expect(play).toHaveAttribute("href", "/tools/exercises?preset=warmup");
    expect(screen.getByTestId("lesson-report-wait")).toHaveClass("ghost");
    expect(screen.getByTestId("lesson-report-wait")).toHaveTextContent("I’ve done this");
  });
});
