import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CourseView from "./CourseView.svelte";
import { markLessonPassed, resetCelebrations } from "../lib/celebrate";

const mockGet = vi.fn();
const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  getCourse: (...args: unknown[]) => mockGet(...args),
  listCourses: () => mockList(),
  deleteCourse: (...args: unknown[]) => mockDelete(...args),
}));

const lesson = (id: string, status: string) => ({
  id,
  title: `Lesson ${id}`,
  summary: "",
  status,
  source: "builtin",
  has_pass_condition: false,
  pass_condition: null,
  requires: [],
  minutes: 6,
  stars: status === "completed" ? 2 : 0,
});

const course = (extra = {}) => ({
  id: "g1",
  title: "Guitar one",
  track: "guitar",
  summary: "A start",
  source: "user",
  lesson_count: 3,
  completed_count: 1,
  locked: false,
  requires: [],
  next_lesson_id: "b",
  minutes_left: 90,
  stars: 2,
  max_stars: 9,
  levels: [
    {
      id: "basics",
      title: "Basics",
      lessons: [lesson("a", "completed"), lesson("b", "available")],
    },
    { id: "next", title: "Next level", lessons: [lesson("c", "locked")] },
  ],
  ...extra,
});

describe("CourseView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCelebrations();
    localStorage.removeItem("fretbook.celebrations");
    mockGet.mockResolvedValue(course());
    mockList.mockResolvedValue({ can_edit: false });
  });

  it("lists lessons by level with their state and links only the open ones", async () => {
    render(CourseView, { id: "g1" });
    expect(await screen.findByRole("heading", { name: "Guitar one" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Basics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Next level" })).toBeInTheDocument();
    expect(screen.getByTestId("lesson-row-a")).toHaveTextContent("Done");
    expect(screen.getByTestId("lesson-row-b").querySelector("a")).toHaveAttribute(
      "href",
      "/lessons/g1/b",
    );
    expect(screen.getByTestId("lesson-row-c").querySelector("a")).toBeNull();
    // The lock icon carries the reason, not a sentence repeated on every row.
    expect(screen.getByTestId("lesson-row-c")).not.toHaveTextContent("Finish the lesson");
    expect(screen.getByRole("img", { name: /Locked: Lesson c/ })).toBeInTheDocument();
    expect(screen.getByTestId("lesson-row-b")).toHaveTextContent("Up next");
    expect(screen.getByTestId("lesson-row-b")).toHaveTextContent("Mark the lesson as done");
    expect(screen.getByRole("img", { name: "2 of 3 stars" })).toBeInTheDocument();
    expect(screen.getByTestId("course-continue")).toHaveAttribute("href", "/lessons/g1/b");
    expect(screen.getByTestId("course-continue")).toHaveTextContent("Continue: Lesson b");
    expect(screen.getByTestId("course-side")).toHaveTextContent("≈ 1h 30m");
    expect(screen.getByTestId("course-stars")).toHaveTextContent("2 of 9");
    expect(screen.queryByTestId("course-admin")).toBeNull();
  });

  it("offers to start a course with no progress, and explains a locked one", async () => {
    mockGet.mockResolvedValue(
      course({ completed_count: 0, locked: true, requires: ["Basics 1"], next_lesson_id: null }),
    );
    render(CourseView, { id: "g1" });
    expect(await screen.findByText("Finish Basics 1 first.")).toBeInTheDocument();
    expect(screen.queryByTestId("course-continue")).toBeNull();
  });

  it("shows a finished course without a continue button", async () => {
    mockGet.mockResolvedValue(
      course({ completed_count: 3, next_lesson_id: null, minutes_left: 0, stars: 9 }),
    );
    const view = render(CourseView, { id: "g1" });
    expect(await screen.findByText("Course complete")).toBeInTheDocument();
    const banner = screen.getByTestId("course-finished");
    expect(banner).toHaveTextContent("Course finished");
    expect(banner).toHaveTextContent("Total time 18 min");
    expect(banner).toHaveClass("arrive");
    expect(screen.getByTestId("course-side").querySelector(".art")).toBeNull();
    expect(screen.queryByTestId("course-continue")).toBeNull();
    view.unmount();
    render(CourseView, { id: "g1" });
    const again = await screen.findByTestId("course-finished");
    expect(again).not.toHaveClass("arrive");
  });

  it("draws the check on the lesson that was just passed, and only once", async () => {
    markLessonPassed("g1", "a");
    const view = render(CourseView, { id: "g1" });
    expect(await screen.findByTestId("lesson-row-a")).toHaveAttribute("data-celebrate", "lesson");
    view.unmount();
    render(CourseView, { id: "g1" });
    expect(await screen.findByTestId("lesson-row-a")).not.toHaveAttribute("data-celebrate");
  });

  it("lets editors add, edit and delete", async () => {
    mockList.mockResolvedValue({ can_edit: true });
    mockDelete.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(CourseView, { id: "g1" });
    const admin = await screen.findByTestId("course-admin");
    await fireEvent.click(admin);
    expect(screen.getByTestId("course-edit")).toBeInTheDocument();
    expect(screen.getByTestId("course-new-lesson")).toBeInTheDocument();
    expect(screen.getByTestId("course-import-item")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("course-delete"));
    expect(mockDelete).toHaveBeenCalledWith("g1");
  });

  it("cannot delete a built-in course", async () => {
    mockGet.mockResolvedValue(course({ source: "builtin" }));
    mockList.mockResolvedValue({ can_edit: true });
    render(CourseView, { id: "g1" });
    const admin = await screen.findByTestId("course-admin");
    await fireEvent.click(admin);
    expect(screen.getByTestId("course-edit")).toBeInTheDocument();
    expect(screen.queryByTestId("course-delete")).toBeNull();
  });

  it("shows an error when the course is missing", async () => {
    mockGet.mockRejectedValue(new Error("That course was not found."));
    render(CourseView, { id: "nope" });
    expect(await screen.findByRole("alert")).toHaveTextContent("That course was not found.");
  });
});
