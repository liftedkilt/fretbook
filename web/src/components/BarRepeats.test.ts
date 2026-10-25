import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import type { Bar } from "../lib/types";
import BarRepeats from "./BarRepeats.svelte";

describe("BarRepeats", () => {
  it("edits repeat start and repeat end count", async () => {
    const bar: Bar = {
      signature: [4, 4],
      repeat_start: false,
      repeat_end: 0,
      alternate_endings: [],
      directions: [],
    };
    render(BarRepeats, { props: { bar } });

    const startCheckbox = screen.getByTestId("repeat-start");
    expect(startCheckbox.closest("label")).toHaveClass("switch");
    await fireEvent.click(startCheckbox);
    expect(bar.repeat_start).toBe(true);

    const endInput = screen.getByTestId("repeat-end");
    await fireEvent.change(endInput, { target: { value: "3" } });
    expect(bar.repeat_end).toBe(3);

    await fireEvent.change(endInput, { target: { value: "" } });
    expect(bar.repeat_end).toBe(0);
  });

  it("edits alternate endings (voltas)", async () => {
    const bar: Bar = {
      signature: [4, 4],
      alternate_endings: [],
    };
    render(BarRepeats, { props: { bar } });

    const voltaInput = screen.getByTestId("repeat-volta");
    await fireEvent.change(voltaInput, { target: { value: "1, 2" } });
    expect(bar.alternate_endings).toEqual([1, 2]);
  });

  it("adds and removes direction marks", async () => {
    const bar: Bar = {
      signature: [4, 4],
      directions: [],
    };
    render(BarRepeats, { props: { bar } });

    const select = screen.getByTestId("repeat-direction");
    await fireEvent.change(select, { target: { value: "segno" } });
    expect(bar.directions).toContain("segno");

    const removeBtn = screen.getByRole("button", { name: /segno/i });
    await fireEvent.click(removeBtn);
    expect(bar.directions).not.toContain("segno");
  });
});
