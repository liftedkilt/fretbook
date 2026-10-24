import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { defaultPractice } from "../lib/practice";
import LoopPanel from "./LoopPanel.svelte";

describe("LoopPanel", () => {
  it("renders loop buttons and triggers onsetloop and onclearloop", async () => {
    const practice = defaultPractice();
    const onsetloop = vi.fn();
    const onclearloop = vi.fn();
    const onchange = vi.fn();
    const onjump = vi.fn();

    render(LoopPanel, {
      props: {
        practice,
        loopA: null,
        loopB: null,
        onsetloop,
        onclearloop,
        onchange,
        onjump,
      },
    });

    await fireEvent.click(screen.getByTestId("player-loop-a"));
    expect(onsetloop).toHaveBeenCalledWith("a");

    await fireEvent.click(screen.getByTestId("player-loop-b"));
    expect(onsetloop).toHaveBeenCalledWith("b");

    expect(screen.getByTestId("player-clear-loop")).toBeDisabled();
  });

  it("allows saving a named loop and jumping to it", async () => {
    const practice = defaultPractice();
    const onsetloop = vi.fn();
    const onclearloop = vi.fn();
    const onchange = vi.fn();
    const onjump = vi.fn();

    render(LoopPanel, {
      props: {
        practice,
        loopA: 4,
        loopB: 8,
        onsetloop,
        onclearloop,
        onchange,
        onjump,
      },
    });

    expect(screen.getByTestId("current-loop-range")).toHaveTextContent("A5–B9");
    const nameInput = screen.getByTestId("save-loop-name");
    await fireEvent.input(nameInput, { target: { value: "Solo riff" } });

    await fireEvent.click(screen.getByTestId("save-loop-button"));

    expect(practice.loops).toHaveLength(1);
    expect(practice.loops[0].name).toBe("Solo riff");
    expect(practice.loops[0].a).toBe(4);
    expect(practice.loops[0].b).toBe(8);
    expect(onchange).toHaveBeenCalled();
    expect(onjump).toHaveBeenCalledWith(practice.loops[0]);
  });

  it("renders saved loops, handles jump and delete", async () => {
    const practice = defaultPractice();
    practice.loops = [{ id: "loop-1", name: "Solo", a: 10, b: 20, highestSpeed: 0.9 }];
    const onsetloop = vi.fn();
    const onclearloop = vi.fn();
    const onchange = vi.fn();
    const onjump = vi.fn();

    render(LoopPanel, {
      props: {
        practice,
        loopA: 10,
        loopB: 20,
        onsetloop,
        onclearloop,
        onchange,
        onjump,
      },
    });

    expect(screen.getByTestId("saved-loop-loop-1")).toBeInTheDocument();
    expect(screen.getByTestId("saved-loop-speed-loop-1")).toHaveTextContent("90%");

    await fireEvent.click(screen.getByTestId("jump-loop-loop-1"));
    expect(onjump).toHaveBeenCalledWith(practice.loops[0]);

    await fireEvent.click(screen.getByTestId("delete-loop-loop-1"));
    expect(practice.loops).toHaveLength(0);
    expect(onchange).toHaveBeenCalled();
  });

  it("edits speed trainer settings and displays status", async () => {
    let practice = defaultPractice();
    const onsetloop = vi.fn();
    const onclearloop = vi.fn();
    const onchange = vi.fn();
    const onjump = vi.fn();

    const { rerender } = render(LoopPanel, {
      props: {
        practice,
        loopA: 0,
        loopB: 4,
        speedTrainerRunning: true,
        speedTrainerPercent: 75,
        speedTrainerPass: 2,
        onsetloop,
        onclearloop,
        onchange,
        onjump,
      },
    });

    const toggle = screen.getByTestId("speed-trainer-toggle");
    await fireEvent.click(toggle);
    expect(practice.speedTrainer.enabled).toBe(true);
    expect(onchange).toHaveBeenCalled();

    practice = {
      ...practice,
      speedTrainer: { ...practice.speedTrainer },
    };
    rerender({
      practice,
      loopA: 0,
      loopB: 4,
      speedTrainerRunning: true,
      speedTrainerPercent: 75,
      speedTrainerPass: 2,
      onsetloop,
      onclearloop,
      onchange,
      onjump,
    });

    const startInput = screen.getByTestId("speed-trainer-start");
    await fireEvent.change(startInput, { target: { value: "70" } });
    expect(practice.speedTrainer.startPercent).toBe(70);

    const targetInput = screen.getByTestId("speed-trainer-target");
    await fireEvent.change(targetInput, { target: { value: "110" } });
    expect(practice.speedTrainer.targetPercent).toBe(110);

    const stepInput = screen.getByTestId("speed-trainer-step");
    await fireEvent.change(stepInput, { target: { value: "10" } });
    expect(practice.speedTrainer.stepPercent).toBe(10);

    const passesInput = screen.getByTestId("speed-trainer-passes");
    await fireEvent.change(passesInput, { target: { value: "3" } });
    expect(practice.speedTrainer.passesPerStep).toBe(3);

    expect(screen.getByTestId("speed-trainer-status")).toBeInTheDocument();
  });
});
