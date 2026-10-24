import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import LessonBlocks from "./LessonBlocks.svelte";

const block = (kind: string, params: Record<string, string> = {}, text = "") =>
  ({
    kind,
    params,
    text,
  }) as never;

describe("LessonBlocks", () => {
  it("renders Markdown as escaped HTML", () => {
    render(LessonBlocks, {
      blocks: [block("markdown", {}, "# Hello\n\n<script>alert(1)</script> **bold**")],
    });
    const prose = screen.getByTestId("lesson-prose");
    expect(prose.querySelector("h2")).toHaveTextContent("Hello");
    expect(prose.querySelector("script")).toBeNull();
    expect(prose.querySelector("strong")).toHaveTextContent("bold");
  });

  it("draws a chord diagram and a fretboard", () => {
    render(LessonBlocks, {
      blocks: [
        block("chord", { name: "Am", instrument: "guitar" }),
        block("fretboard", { notes: "E A D G", instrument: "bass" }),
      ],
    });
    expect(screen.getByTestId("lesson-chord").querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("lesson-chord")).toHaveTextContent("Am");
    expect(screen.getByTestId("lesson-fretboard").querySelector("svg")).not.toBeNull();
  });

  it("shows a tab excerpt as text", () => {
    render(LessonBlocks, { blocks: [block("tab", {}, "e|-0-|")] });
    expect(screen.getByTestId("lesson-tab")).toHaveTextContent("e|-0-|");
  });

  it("links to a song and to an exercise preset", () => {
    render(LessonBlocks, {
      blocks: [
        block("song", { song: "abc", title: "Warm up" }),
        block("exercise", { preset: "pentatonicBox" }),
      ],
    });
    expect(screen.getByTestId("lesson-song")).toHaveAttribute("href", "/songs/abc");
    expect(screen.getByTestId("lesson-song")).toHaveTextContent("Warm up");
    expect(screen.getByTestId("lesson-exercise")).toHaveAttribute(
      "href",
      "/tools/exercises?preset=pentatonicBox",
    );
  });

  it("plays audio and video, and links out to YouTube", () => {
    const { container } = render(LessonBlocks, {
      blocks: [
        block("media", { type: "audio", src: "https://example.test/a.mp3", title: "Clip" }),
        block("media", { type: "video", src: "https://example.test/a.mp4", title: "Video" }),
        block("media", { type: "video", src: "https://youtu.be/x", title: "Lesson video" }),
      ],
    });
    expect(container.querySelector("audio")).toHaveAttribute("src", "https://example.test/a.mp3");
    expect(container.querySelector("video")).toHaveAttribute("src", "https://example.test/a.mp4");
    const link = screen.getByRole("link", { name: "Lesson video" });
    expect(link).toHaveAttribute("href", "https://youtu.be/x");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("leaves the pass block to the lesson page", () => {
    const { container } = render(LessonBlocks, {
      blocks: [block("pass", { type: "wait" })],
    });
    expect(container.querySelector(".lesson-blocks")?.children).toHaveLength(0);
  });
});
