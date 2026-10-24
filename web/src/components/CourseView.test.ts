import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CourseView from "./CourseView.svelte";

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
  requires: [],
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
    expect(screen.getByTestId("lesson-row-c")).toHaveTextContent(
      "Finish the lesson before this one",
    );
    expect(screen.getByTestId("course-continue")).toHaveAttribute("href", "/lessons/g1/b");
    expect(screen.getByTestId("course-continue")).toHaveTextContent("Continue where you left off");
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

  it("lets editors add, edit and delete", async () => {
    mockList.mockResolvedValue({ can_edit: true });
    mockDelete.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(CourseView, { id: "g1" });
    const admin = await screen.findByTestId("course-admin");
    expect(admin.querySelector('a[href="/lessons/g1/new"]')).not.toBeNull();
    expect(admin.querySelector('a[href="/lessons/g1/edit"]')).not.toBeNull();
    await fireEvent.click(screen.getByTestId("course-delete"));
    expect(mockDelete).toHaveBeenCalledWith("g1");
  });

  it("cannot delete a built-in course", async () => {
    mockGet.mockResolvedValue(course({ source: "builtin" }));
    mockList.mockResolvedValue({ can_edit: true });
    render(CourseView, { id: "g1" });
    await screen.findByTestId("course-admin");
    expect(screen.queryByTestId("course-delete")).toBeNull();
  });

  it("shows an error when the course is missing", async () => {
    mockGet.mockRejectedValue(new Error("That course was not found."));
    render(CourseView, { id: "nope" });
    expect(await screen.findByRole("alert")).toHaveTextContent("That course was not found.");
  });
});
