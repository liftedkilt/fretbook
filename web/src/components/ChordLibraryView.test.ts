import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChordLibraryView from "./ChordLibraryView.svelte";

const strum = vi.hoisted(() => vi.fn());
vi.mock("../lib/chords/strum", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chords/strum")>()),
  playStrum: strum,
}));

describe("ChordLibraryView", () => {
  beforeEach(() => {
    localStorage.clear();
    strum.mockClear();
  });

  it("shows voicings for the searched chord", async () => {
    render(ChordLibraryView);
    expect(screen.getAllByTestId("chord-voicing").length).toBeGreaterThan(3);

    await fireEvent.input(screen.getByTestId("chord-search"), { target: { value: "Am7" } });
    expect(screen.getAllByTestId("chord-voicing").length).toBeGreaterThan(3);
    expect(screen.getAllByText("Am7").length).toBeGreaterThan(0);
  });

  it("builds the name from root and quality buttons", async () => {
    render(ChordLibraryView);
    await fireEvent.click(screen.getByTestId("chord-root-F#"));
    expect(screen.getByTestId("chord-search")).toHaveValue("F#");
    await fireEvent.click(screen.getByTestId("chord-quality-m7"));
    expect(screen.getByTestId("chord-search")).toHaveValue("F#m7");
    await fireEvent.click(screen.getByTestId("chord-root-Bb"));
    expect(screen.getByTestId("chord-search")).toHaveValue("Bbm7");
    await fireEvent.click(screen.getByTestId("chord-quality-maj"));
    expect(screen.getByTestId("chord-search")).toHaveValue("Bb");
  });

  it("explains an unknown or empty search", async () => {
    render(ChordLibraryView);
    const search = screen.getByTestId("chord-search");
    await fireEvent.input(search, { target: { value: "Hm" } });
    expect(screen.getByTestId("chord-unknown")).toBeInTheDocument();
    await fireEvent.input(search, { target: { value: "" } });
    expect(screen.getByTestId("chord-empty")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("chord-quality-dim"));
    expect(search).toHaveValue("Cdim");
  });

  it("strums the voicing for the selected tuning, and remembers the setup", async () => {
    render(ChordLibraryView);
    await fireEvent.change(screen.getByTestId("chord-instrument"), {
      target: { value: "ukulele" },
    });
    expect(JSON.parse(localStorage.getItem("fretbook.chordSetup")!)).toEqual({
      instrument: "ukulele",
      tuning: "standard",
    });
    await fireEvent.click(screen.getAllByTestId("voicing-play")[0]);
    expect(strum).toHaveBeenCalledTimes(1);
    const notes = strum.mock.calls[0][0] as { midi: number }[];
    expect(notes.map((note) => note.midi)).toEqual([67, 60, 64, 72]);

    await fireEvent.change(screen.getByTestId("chord-tuning"), { target: { value: "lowG" } });
    expect(JSON.parse(localStorage.getItem("fretbook.chordSetup")!).tuning).toBe("lowG");
  });

  it("starts from the setup it remembered", () => {
    localStorage.setItem(
      "fretbook.chordSetup",
      JSON.stringify({ instrument: "bass4", tuning: "dropD" }),
    );
    render(ChordLibraryView);
    expect(screen.getByTestId("chord-instrument")).toHaveValue("bass4");
    expect(screen.getByTestId("chord-tuning")).toHaveValue("dropD");
  });
});
