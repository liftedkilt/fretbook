import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import Page from "./Page.svelte";
import PageHeader from "./PageHeader.svelte";

describe("Page", () => {
  it("sets the container width token", () => {
    render(Page, { width: "narrow", testid: "page" });
    const page = screen.getByTestId("page");
    expect(page).toHaveAttribute("data-page-width", "narrow");
    expect(page).toHaveClass("width-narrow");
  });
});

describe("PageHeader", () => {
  it("puts the back link above the title, with the eyebrow and subtitle", () => {
    render(PageHeader, {
      title: "Practice log",
      titleSize: "display",
      eyebrow: "Practice",
      subtitle: "What you played this week",
      backHref: "/",
      backLabel: "Library",
      backTestId: "back",
    });
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Practice log");
    expect(heading).toHaveClass("display");
    expect(screen.getByText("Practice")).toHaveClass("eyebrow");
    expect(screen.getByText("What you played this week")).toBeInTheDocument();
    const back = screen.getByTestId("back");
    expect(back).toHaveAttribute("href", "/");
    expect(back).toHaveTextContent("Library");
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses the smaller title size on a sub-page", () => {
    render(PageHeader, { title: "Metronome", titleSize: "title", eyebrow: "Tools" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("title");
  });
});
