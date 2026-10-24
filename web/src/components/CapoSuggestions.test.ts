import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import CapoSuggestions from "./CapoSuggestions.svelte";

describe("CapoSuggestions", () => {
  it("suggests a capo that turns barre chords into open shapes", () => {
    render(CapoSuggestions, { props: { chords: ["Bb", "Eb", "F", "Gm"], capo: 0, flats: false } });
    expect(screen.getByTestId("capo-option-3")).toHaveTextContent("Capo 3: play G, C, D, Em");
  });

  it("says so when the chords are already easy", () => {
    render(CapoSuggestions, { props: { chords: ["G", "C", "D"], capo: 0, flats: false } });
    expect(screen.getByTestId("capo-none")).toBeInTheDocument();
  });

  it("works from the sounding chords when the sheet already has a capo", () => {
    // G, C, D, Em with capo 3 sound as Bb, Eb, F, Gm; the shapes are already open, so there is nothing better.
    render(CapoSuggestions, { props: { chords: ["G", "C", "D", "Em"], capo: 3, flats: false } });
    expect(screen.queryByTestId("capo-option-3")).toBeNull();
    expect(screen.getByTestId("capo-none")).toBeInTheDocument();
  });

  it("applies a suggestion and offers an undo once one is applied", async () => {
    const onapply = vi.fn();
    const onundo = vi.fn();
    const view = render(CapoSuggestions, {
      props: { chords: ["Bb", "Eb", "F", "Gm"], capo: 0, flats: false, onapply, onundo },
    });
    expect(screen.queryByTestId("capo-undo")).toBeNull();
    await fireEvent.click(screen.getByTestId("capo-apply-3"));
    expect(onapply).toHaveBeenCalledWith(3);
    await view.rerender({ applied: true });
    await fireEvent.click(screen.getByTestId("capo-undo"));
    expect(onundo).toHaveBeenCalled();
  });

  it("renders nothing without chords", () => {
    render(CapoSuggestions, { props: { chords: [], capo: 0, flats: false } });
    expect(screen.queryByTestId("capo-suggestions")).toBeNull();
  });
});
