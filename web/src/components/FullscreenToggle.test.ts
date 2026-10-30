import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FullscreenToggle from "./FullscreenToggle.svelte";

describe("FullscreenToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute("data-fullscreen");
    // Stub Fullscreen API as unsupported (iPhone Safari emulation)
    vi.stubGlobal("document", Object.assign(document, { fullscreenEnabled: false }));
  });

  it("toggles focus mode without scrolling to top 0 when fullscreen API is missing", async () => {
    const scrollToSpy = vi.spyOn(window, "scrollTo");
    render(FullscreenToggle);

    const button = screen.getByTestId("player-fullscreen");
    expect(button).toBeInTheDocument();
    expect(document.documentElement.hasAttribute("data-fullscreen")).toBe(false);
    expect(screen.queryByTestId("player-focus-exit")).toBeNull();

    // Toggle on (focus mode)
    await fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-fullscreen")).toBe("player");
    expect(scrollToSpy).not.toHaveBeenCalled();

    // Corner exit control is now visible
    const exitControl = screen.getByTestId("player-focus-exit");
    expect(exitControl).toBeInTheDocument();

    // Clicking the corner exit control leaves focus mode
    await fireEvent.click(exitControl);
    expect(document.documentElement.hasAttribute("data-fullscreen")).toBe(false);
    expect(screen.queryByTestId("player-focus-exit")).toBeNull();
  });

  it("leaves focus mode on Escape key and hides the exit button", async () => {
    render(FullscreenToggle);
    const button = screen.getByTestId("player-fullscreen");

    await fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-fullscreen")).toBe("player");
    expect(screen.getByTestId("player-focus-exit")).toBeInTheDocument();

    await fireEvent.keyDown(document, { key: "Escape" });
    expect(document.documentElement.hasAttribute("data-fullscreen")).toBe(false);
    expect(screen.queryByTestId("player-focus-exit")).toBeNull();
  });

  it("calls onbeforetoggle and onaftertoggle callbacks", async () => {
    const before = vi.fn();
    const after = vi.fn();
    render(FullscreenToggle, { onbeforetoggle: before, onaftertoggle: after });

    const button = screen.getByTestId("player-fullscreen");
    await fireEvent.click(button);

    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledWith(true);
  });
});
