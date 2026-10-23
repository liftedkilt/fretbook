import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StandaloneTunerView from "./StandaloneTunerView.svelte";

vi.mock("../lib/listen", async () => {
  return {
    ListenError: class ListenError extends Error {
      constructor(readonly problem: string) {
        super(problem);
      }
    },
    describeProblem: (problem: string) => `problem:${problem}`,
    startListening: vi.fn().mockResolvedValue({ stop: vi.fn() }),
  };
});

describe("StandaloneTunerView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the standalone tuner with instrument and tuning pickers", async () => {
    render(StandaloneTunerView);

    expect(screen.getByTestId("standalone-tuner-view")).toBeInTheDocument();
    expect(screen.getByTestId("tool-back")).toHaveAttribute("href", "/tools");

    const instSelect = screen.getByTestId("tuner-instrument") as HTMLSelectElement;
    expect(instSelect.value).toBe("guitar6");

    const tuneSelect = screen.getByTestId("tuner-tuning") as HTMLSelectElement;
    expect(tuneSelect.value).toBe("standard");

    expect(screen.getByTestId("tuner-string-5")).toHaveTextContent("E2");
    expect(screen.getByTestId("tuner-string-0")).toHaveTextContent("E4");
  });

  it("updates strings when switching instruments", async () => {
    render(StandaloneTunerView);

    const instSelect = screen.getByTestId("tuner-instrument") as HTMLSelectElement;
    await fireEvent.change(instSelect, { target: { value: "bass4" } });

    expect(screen.getByTestId("tuner-string-3")).toHaveTextContent("E1");
    expect(screen.queryByTestId("tuner-string-4")).not.toBeInTheDocument();

    const tuneSelect = screen.getByTestId("tuner-tuning") as HTMLSelectElement;
    await fireEvent.change(tuneSelect, { target: { value: "dropD" } });
    expect(screen.getByTestId("tuner-string-3")).toHaveTextContent("D1");
  });

  it("supports custom tuning input", async () => {
    render(StandaloneTunerView);

    const tuneSelect = screen.getByTestId("tuner-tuning") as HTMLSelectElement;
    await fireEvent.change(tuneSelect, { target: { value: "custom" } });

    const customInput = screen.getByTestId("tuner-custom-tuning") as HTMLInputElement;
    expect(customInput).toBeInTheDocument();

    await fireEvent.input(customInput, { target: { value: "D4 A3 G3 D3 A2 D2" } });
    expect(screen.getByTestId("tuner-string-5")).toHaveTextContent("D2");
    expect(screen.getByTestId("tuner-string-0")).toHaveTextContent("D4");
  });

  it("hides tuning picker in chromatic mode", async () => {
    render(StandaloneTunerView);

    const instSelect = screen.getByTestId("tuner-instrument") as HTMLSelectElement;
    await fireEvent.change(instSelect, { target: { value: "chromatic" } });

    expect(screen.queryByTestId("tuner-tuning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tuner-strings")).not.toBeInTheDocument();
  });
});
