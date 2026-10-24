import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ToolsView from "./ToolsView.svelte";

describe("ToolsView", () => {
  it("renders the tools page with cards for Tuner and Metronome", () => {
    render(ToolsView);

    expect(screen.getByTestId("tools-view")).toBeInTheDocument();
    expect(screen.getByTestId("tool-card-tuner")).toBeInTheDocument();
    expect(screen.getByTestId("tool-card-metronome")).toBeInTheDocument();

    const tunerCard = screen.getByTestId("tool-card-tuner");
    expect(tunerCard).toHaveAttribute("href", "/tools/tuner");

    const metronomeCard = screen.getByTestId("tool-card-metronome");
    expect(metronomeCard).toHaveAttribute("href", "/tools/metronome");

    expect(screen.getByTestId("tool-card-chords")).toHaveAttribute("href", "/tools/chords");
  });
});
