import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { defaultPractice } from "../lib/practice";
import FretboardPanel from "./FretboardPanel.svelte";

describe("FretboardPanel", () => {
  it("edits the options and saves them", async () => {
    const practice = defaultPractice();
    practice.fretboard.label = "intervals";
    const onchange = vi.fn();
    render(FretboardPanel, { props: { practice, onchange } });

    await fireEvent.click(screen.getByTestId("fretboard-on"));
    expect(practice.fretboard.on).toBe(true);
    await fireEvent.click(screen.getByTestId("fretboard-left"));
    expect(practice.fretboard.leftHanded).toBe(true);
    await fireEvent.change(screen.getByTestId("fretboard-label"), { target: { value: "frets" } });
    expect(practice.fretboard.label).toBe("frets");
    await fireEvent.change(screen.getByTestId("fretboard-root"), { target: { value: "7" } });
    expect(practice.fretboard.root).toBe(7);
    expect(onchange).toHaveBeenCalledTimes(4);
  });
});
