import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import Chip from "./Chip.svelte";
import IconButton from "./IconButton.svelte";
import OverflowMenu from "./OverflowMenu.svelte";
import SegmentedControl from "./SegmentedControl.svelte";

describe("SegmentedControl", () => {
  it("selects one segment and moves with the arrow keys", async () => {
    const onchange = vi.fn();
    render(SegmentedControl, {
      label: "View",
      value: "tab",
      testid: "view",
      onchange,
      options: [
        { value: "tab", label: "Tab", testid: "view-tab" },
        { value: "highway", label: "Highway", testid: "view-highway" },
      ],
    });
    const tab = screen.getByTestId("view-tab");
    const highway = screen.getByTestId("view-highway");
    expect(tab).toHaveAttribute("aria-checked", "true");
    expect(highway).toHaveAttribute("aria-checked", "false");
    await fireEvent.click(highway);
    expect(onchange).toHaveBeenCalledWith("highway");
    tab.focus();
    await fireEvent.keyDown(screen.getByTestId("view"), { key: "ArrowRight" });
    expect(onchange).toHaveBeenLastCalledWith("highway");
  });

  it("uses tabs when asked", () => {
    render(SegmentedControl, {
      label: "Games",
      value: "note",
      role: "tablist",
      onchange: vi.fn(),
      options: [{ value: "note", label: "Notes", testid: "game-note" }],
    });
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByTestId("game-note")).toHaveAttribute("aria-selected", "true");
  });
});

describe("Chip", () => {
  it("toggles a filter chip and shows its count", async () => {
    const onclick = vi.fn();
    render(Chip, {
      variant: "filter",
      label: "Bass",
      count: 3,
      pressed: true,
      testid: "bass",
      onclick,
    });
    const chip = screen.getByTestId("bass");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveTextContent("Bass");
    expect(chip).toHaveTextContent("3");
    await fireEvent.click(chip);
    expect(onclick).toHaveBeenCalled();
  });

  it("draws a tag chip with the tag icon", () => {
    render(Chip, { variant: "tag", label: "jazz", testid: "tag" });
    expect(screen.getByTestId("tag").querySelector("svg")).toBeTruthy();
  });

  it("renders a meta chip that is not a button", () => {
    render(Chip, { variant: "meta", label: "120 BPM", testid: "bpm" });
    const chip = screen.getByTestId("bpm");
    expect(chip.tagName).toBe("SPAN");
    expect(chip).toHaveTextContent("120 BPM");
    expect(screen.queryByRole("button", { name: "120 BPM" })).not.toBeInTheDocument();
  });
});

describe("IconButton", () => {
  it("requires a label and shows it as a tooltip on focus", async () => {
    render(IconButton, { label: "Keyboard shortcuts", icon: "keyboard", testid: "keys" });
    const button = screen.getByTestId("keys");
    expect(button).toHaveAttribute("aria-label", "Keyboard shortcuts");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await fireEvent.focusIn(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Keyboard shortcuts");
    expect(button).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
  });

  it("shows tooltip on mouse hover and hides on mouse leave", async () => {
    render(IconButton, { label: "Play", icon: "play", testid: "play" });
    const button = screen.getByTestId("play");
    const tip = button.closest(".tip")!;
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await fireEvent.pointerEnter(tip, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Play");

    await fireEvent.pointerLeave(tip, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not show tooltip on touch input", async () => {
    render(IconButton, { label: "Play", icon: "play", testid: "play-touch" });
    const button = screen.getByTestId("play-touch");
    const tip = button.closest(".tip")!;

    // Touch tap: pointerdown + pointerup with pointerType === "touch"
    await fireEvent.pointerDown(tip, { pointerType: "touch" });
    await fireEvent.pointerUp(tip, { pointerType: "touch" });
    await fireEvent.focusIn(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Touch hover attempt
    await fireEvent.pointerEnter(tip, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not open tooltip on hover when the device cannot hover", async () => {
    const origMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === "(hover: none)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      render(IconButton, { label: "Play", icon: "play", testid: "play-no-hover" });
      const tip = screen.getByTestId("play-no-hover").closest(".tip")!;
      await fireEvent.pointerEnter(tip, { pointerType: "mouse" });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  it("closes an open tooltip on touch", async () => {
    render(IconButton, { label: "Play", icon: "play", testid: "play-close-touch" });
    const button = screen.getByTestId("play-close-touch");
    const tip = button.closest(".tip")!;

    await fireEvent.pointerEnter(tip, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Play");

    await fireEvent.pointerDown(tip, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes tooltip on Escape key", async () => {
    render(IconButton, { label: "Play", icon: "play", testid: "play-esc" });
    const button = screen.getByTestId("play-esc");
    const tip = button.closest(".tip")!;

    await fireEvent.pointerEnter(tip, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on focus only when :focus-visible matches", async () => {
    const origCSS = (globalThis as unknown as { CSS?: unknown }).CSS;
    (globalThis as unknown as { CSS: { supports: (q: string) => boolean } }).CSS = {
      supports: (q: string) => q === "selector(:focus-visible)",
    };

    try {
      render(IconButton, { label: "Play", icon: "play", testid: "play-fv" });
      const button = screen.getByTestId("play-fv");

      // Without :focus-visible (e.g. click or tap focus), no tooltip
      button.matches = (sel: string) => sel !== ":focus-visible";
      await fireEvent.focusIn(button);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

      // With :focus-visible (keyboard focus), tooltip appears
      button.matches = (sel: string) => sel === ":focus-visible";
      await fireEvent.focusIn(button);
      expect(screen.getByRole("tooltip")).toHaveTextContent("Play");
    } finally {
      (globalThis as unknown as { CSS?: unknown }).CSS = origCSS;
    }
  });
});

describe("OverflowMenu", () => {
  it("opens on click, puts destructive items last, and closes on Escape", async () => {
    const remove = vi.fn();
    const rename = vi.fn();
    render(OverflowMenu, {
      label: "More actions",
      testid: "more",
      items: [
        { id: "delete", label: "Delete setlist", danger: true, testid: "delete", onclick: remove },
        { id: "rename", label: "Rename", testid: "rename", onclick: rename },
      ],
    });
    const button = screen.getByTestId("more");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await fireEvent.click(button);
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual(["Rename", "Delete setlist"]);
    expect(items[1]).toHaveClass("danger");
    expect(screen.getByRole("separator")).toBeInTheDocument();
    await fireEvent.keyDown(menu, { key: "ArrowDown" });
    await fireEvent.click(screen.getByTestId("delete"));
    expect(remove).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
