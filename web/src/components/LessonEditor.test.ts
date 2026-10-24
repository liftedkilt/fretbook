import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LessonEditor from "./LessonEditor.svelte";

const mockPreview = vi.fn();
const mockGetLesson = vi.fn();
const mockSaveLesson = vi.fn();
const mockDelete = vi.fn();
const mockGetCourse = vi.fn();
const mockSaveCourse = vi.fn();

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  previewLesson: (...args: unknown[]) => mockPreview(...args),
  getLessonSource: (...args: unknown[]) => mockGetLesson(...args),
  saveLessonSource: (...args: unknown[]) => mockSaveLesson(...args),
  deleteLesson: (...args: unknown[]) => mockDelete(...args),
  getCourseSource: (...args: unknown[]) => mockGetCourse(...args),
  saveCourseSource: (...args: unknown[]) => mockSaveCourse(...args),
}));

const preview = {
  title: "Hello",
  summary: "",
  blocks: [{ kind: "markdown", text: "Body text", params: {} }],
  pass_condition: null,
};

describe("LessonEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    history.replaceState({}, "", "/");
    mockPreview.mockResolvedValue(preview);
  });

  it("starts a new lesson from a template, derives the id from the title and saves it", async () => {
    mockSaveLesson.mockResolvedValue({ text: "", source: "user" });
    render(LessonEditor, { kind: "lesson", course: "g1" });
    const source = await screen.findByTestId("lesson-source");
    expect((source as HTMLTextAreaElement).value).toMatch(/^---\ntitle: /);
    await fireEvent.input(source, {
      target: { value: "---\ntitle: Barre Chords!\n---\nBody\n" },
    });
    expect(screen.getByTestId("lesson-id")).toHaveValue("barre-chords");
    expect(await screen.findByText("Body text")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("lesson-save"));
    await waitFor(() =>
      expect(mockSaveLesson).toHaveBeenCalledWith(
        "g1",
        "barre-chords",
        "---\ntitle: Barre Chords!\n---\nBody\n",
      ),
    );
    await waitFor(() => expect(location.pathname).toBe("/lessons/g1/barre-chords"));
  });

  it("keeps an id the author typed", async () => {
    render(LessonEditor, { kind: "lesson", course: "g1" });
    const id = await screen.findByTestId("lesson-id");
    await fireEvent.input(id, { target: { value: "mine" } });
    await fireEvent.input(screen.getByTestId("lesson-source"), {
      target: { value: "---\ntitle: Other\n---\n" },
    });
    expect(id).toHaveValue("mine");
  });

  it("shows the server's complaint about the text in the preview", async () => {
    mockPreview.mockRejectedValue(new Error("The lesson could not be read: bad (line 4)."));
    render(LessonEditor, { kind: "lesson", course: "g1" });
    expect(await screen.findByTestId("lesson-preview-error")).toHaveTextContent("line 4");
  });

  it("inserts a block snippet", async () => {
    render(LessonEditor, { kind: "lesson", course: "g1" });
    const source = (await screen.findByTestId("lesson-source")) as HTMLTextAreaElement;
    await fireEvent.click(screen.getByTestId("lesson-insert-chord"));
    expect(source.value).toContain("```fretbook:chord\nname: Am\n```");
    await fireEvent.click(screen.getByTestId("lesson-insert-pass"));
    expect(source.value).toContain("```fretbook:pass\ntype: score");
  });

  it("edits an existing lesson, which cannot change its id, and can delete the user's copy", async () => {
    mockGetLesson.mockResolvedValue({ text: "---\ntitle: Old\n---\n", source: "user" });
    mockDelete.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(LessonEditor, { kind: "lesson", course: "g1", lesson: "old" });
    const id = await screen.findByTestId("lesson-id");
    expect(id).toHaveValue("old");
    expect(id).toHaveAttribute("readonly");
    expect(mockGetLesson).toHaveBeenCalledWith("g1", "old");
    await fireEvent.click(screen.getByTestId("lesson-delete"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("g1", "old"));
  });

  it("does not offer to delete a built-in lesson, and says saving makes a copy", async () => {
    mockGetLesson.mockResolvedValue({ text: "---\ntitle: Old\n---\n", source: "builtin" });
    render(LessonEditor, { kind: "lesson", course: "g1", lesson: "old" });
    await screen.findByTestId("lesson-source");
    expect(screen.queryByTestId("lesson-delete")).toBeNull();
    expect(screen.getByText(/Saving keeps your version as a copy/)).toBeInTheDocument();
  });

  it("writes a course file without a preview", async () => {
    mockSaveCourse.mockResolvedValue({ text: "", source: "user" });
    render(LessonEditor, { kind: "course" });
    await screen.findByTestId("lesson-source");
    expect(screen.queryByTestId("lesson-preview")).toBeNull();
    expect(screen.queryByTestId("lesson-insert-chord")).toBeNull();
    await fireEvent.input(screen.getByTestId("lesson-id"), { target: { value: "mine" } });
    await fireEvent.click(screen.getByTestId("lesson-save"));
    await waitFor(() => expect(mockSaveCourse).toHaveBeenCalledWith("mine", expect.any(String)));
    await waitFor(() => expect(location.pathname).toBe("/lessons/mine"));
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it("shows a save error and stays put", async () => {
    mockSaveLesson.mockRejectedValue(new Error("The lesson could not be read."));
    render(LessonEditor, { kind: "lesson", course: "g1" });
    await fireEvent.input(await screen.findByTestId("lesson-id"), { target: { value: "x" } });
    await fireEvent.click(screen.getByTestId("lesson-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be read");
    expect(location.pathname).toBe("/");
  });
});
