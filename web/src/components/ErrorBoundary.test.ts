import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import CrashScreen from "./CrashScreen.svelte";
import ErrorBoundary from "./ErrorBoundary.svelte";
import { ui } from "../lib/ui.svelte";

afterEach(() => {
  vi.restoreAllMocks();
  ui.version = null;
});

describe("ErrorBoundary", () => {
  it("shows the page when nothing goes wrong", () => {
    const children = createRawSnippet(() => ({ render: () => "<p>the page</p>" }));
    render(ErrorBoundary, { path: "/", children });
    expect(screen.getByText("the page")).toBeInTheDocument();
    expect(screen.queryByTestId("crash-screen")).toBeNull();
  });

  it("replaces a page that throws while rendering with the error screen, and can try again", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    const children = createRawSnippet(() => ({
      render: () => {
        if (broken) throw new Error("bars is undefined");
        return "<p>the page</p>";
      },
    }));
    render(ErrorBoundary, { path: "/songs/abc", children });

    expect(screen.getByTestId("crash-screen")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("crash-details")).toHaveTextContent("Error: bars is undefined");
    expect(screen.getByTestId("crash-details")).toHaveTextContent("Page: /songs/abc");
    expect(logged).toHaveBeenCalled();

    broken = false;
    await fireEvent.click(screen.getByTestId("crash-retry"));
    await waitFor(() => expect(screen.getByText("the page")).toBeInTheDocument());
    expect(screen.queryByTestId("crash-screen")).toBeNull();
  });
});

describe("CrashScreen", () => {
  it("starts over when the page changes", async () => {
    const reset = vi.fn();
    const view = render(CrashScreen, { error: new Error("boom"), reset, path: "/songs/abc" });
    expect(reset).not.toHaveBeenCalled();
    await view.rerender({ path: "/" });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("copies the details with the version", async () => {
    ui.version = "0.1.3";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(CrashScreen, { error: "nope", reset: () => {}, path: "/tools" });
    await fireEvent.click(screen.getByTestId("crash-copy"));
    expect(writeText).toHaveBeenCalledWith("Error: nope\nPage: /tools\nFretbook 0.1.3");
    await waitFor(() => expect(screen.getByTestId("crash-copy")).toHaveTextContent("Copied"));
  });

  it("keeps the button as it is when the clipboard is refused", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(CrashScreen, { error: new Error("boom"), reset: () => {}, path: "/" });
    await fireEvent.click(screen.getByTestId("crash-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByTestId("crash-copy")).toHaveTextContent("Copy details");
  });
});
