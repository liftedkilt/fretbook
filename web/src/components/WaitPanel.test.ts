import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { defaultPractice } from "../lib/practice";
import WaitPanel from "./WaitPanel.svelte";

function props(extra: Partial<Parameters<typeof render<typeof WaitPanel>>[1]> = {}) {
  return {
    practice: defaultPractice(),
    on: false,
    available: true,
    error: "",
    onchange: vi.fn(),
    ontoggle: vi.fn(),
    ...extra,
  };
}

describe("WaitPanel", () => {
  it("switches wait mode on and edits the options", async () => {
    const given = props();
    render(WaitPanel, { props: given });

    await fireEvent.click(screen.getByTestId("wait-toggle"));
    expect(given.ontoggle).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByTestId("wait-any-octave"));
    expect(given.practice.wait.anyOctave).toBe(false);
    await fireEvent.click(screen.getByTestId("wait-silent"));
    expect(given.practice.wait.silent).toBe(true);
    await fireEvent.change(screen.getByTestId("wait-hint-seconds"), { target: { value: "8" } });
    expect(given.practice.wait.hintSeconds).toBe(8);
    await fireEvent.change(screen.getByTestId("wait-hint-seconds"), { target: { value: "99" } });
    expect(given.practice.wait.hintSeconds).toBe(8);
    expect(given.onchange).toHaveBeenCalledTimes(4);
  });

  it("switches the chord check on and off", async () => {
    const given = props();
    render(WaitPanel, { props: given });
    expect(given.practice.wait.chords).toBe(true);
    await fireEvent.click(screen.getByTestId("wait-chords"));
    expect(given.practice.wait.chords).toBe(false);
    expect(given.onchange).toHaveBeenCalledOnce();
  });

  it("explains why it is off while a recording is attached", () => {
    render(WaitPanel, { props: props({ available: false }) });
    expect(screen.getByTestId("wait-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("wait-toggle")).toBeNull();
  });

  it("shows why the microphone did not open", () => {
    render(WaitPanel, { props: props({ error: "Microphone access was blocked." }) });
    expect(screen.getByTestId("wait-error").textContent).toContain("blocked");
  });
});
