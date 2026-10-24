import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LessonsView from "./LessonsView.svelte";

const mockList = vi.fn();
const mockImport = vi.fn();

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  listCourses: () => mockList(),
  importLessonPack: (...args: unknown[]) => mockImport(...args),
}));

const course = (id: string, track: string, extra = {}) => ({
  id,
  title: `Course ${id}`,
  track,
  summary: "",
  source: "builtin",
  lesson_count: 4,
  completed_count: 1,
  locked: false,
  requires: [],
  next_lesson_id: "a",
  ...extra,
});

const list = (extra = {}) => ({
  courses: [
    course("g1", "guitar"),
    course("b1", "bass", { locked: true, requires: ["Course g1"] }),
  ],
  resume: { course_id: "g1", course_title: "Course g1", lesson_id: "l2", lesson_title: "Second" },
  can_edit: false,
  problems: [],
  ...extra,
});

describe("LessonsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(list());
  });

  it("groups courses by track, shows progress and offers to continue", async () => {
    render(LessonsView);
    const resume = await screen.findByTestId("lessons-continue");
    expect(resume).toHaveAttribute("href", "/lessons/g1/l2");
    expect(resume).toHaveTextContent("Second");
    expect(screen.getByRole("heading", { name: "Guitar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bass" })).toBeInTheDocument();
    expect(screen.getByTestId("course-card-g1")).toHaveTextContent("1 of 4 lessons done");
    expect(screen.getByTestId("course-card-g1")).toHaveAttribute("href", "/lessons/g1");
    expect(screen.getByTestId("course-card-b1")).toHaveTextContent("Finish Course g1 first.");
  });

  it("hides editing tools from people who cannot edit", async () => {
    render(LessonsView);
    await screen.findByTestId("course-card-g1");
    expect(screen.queryByTestId("lessons-admin")).toBeNull();
    expect(screen.queryByTestId("lessons-problems")).toBeNull();
  });

  it("says when there are no courses", async () => {
    mockList.mockResolvedValue(list({ courses: [], resume: null }));
    render(LessonsView);
    expect(await screen.findByTestId("lessons-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("lessons-continue")).toBeNull();
  });

  it("lets editors see file problems and import a pack", async () => {
    mockList.mockResolvedValue(list({ can_edit: true, problems: ["user/x/y.md: line 2: bad"] }));
    mockImport.mockResolvedValue({ courses: 1, lessons: 3 });
    render(LessonsView);
    expect(await screen.findByTestId("lessons-problems")).toHaveTextContent("line 2: bad");
    const file = new File(["zip"], "pack.zip", { type: "application/zip" });
    await fireEvent.change(screen.getByTestId("lessons-import"), { target: { files: [file] } });
    await waitFor(() => expect(mockImport).toHaveBeenCalledWith(file));
    expect(await screen.findByText("Imported 1 courses and 3 lessons.")).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("shows an import error", async () => {
    mockList.mockResolvedValue(list({ can_edit: true }));
    mockImport.mockRejectedValue(new Error("That pack could not be imported."));
    render(LessonsView);
    await screen.findByTestId("lessons-admin");
    const file = new File(["zip"], "pack.zip");
    await fireEvent.change(screen.getByTestId("lessons-import"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That pack could not be imported.");
  });
});
