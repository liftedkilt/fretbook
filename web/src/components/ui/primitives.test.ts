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
