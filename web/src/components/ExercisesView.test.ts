import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstrumentPreset } from "../lib/types";
import { ui } from "../lib/ui.svelte";
import ExercisesView from "./ExercisesView.svelte";

const api = vi.hoisted(() => ({ importDocument: vi.fn() }));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  importDocument: api.importDocument,
}));
const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("../lib/router.svelte", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/router.svelte")>()),
  navigate: router.navigate,
}));
const PRESETS: InstrumentPreset[] = [
  {
    id: "bass-4",
    label_key: "instrument.bass4",
    label: "4-string bass",
    instrument: "bass-guitar",
    name: "Bass",
    tuning_midi: [43, 38, 33, 28],
    string_count: 4,
    family: "bass",
  },
  {
    id: "guitar-6",
    label_key: "instrument.guitar6",
    label: "6-string guitar",
    instrument: "guitar",
    name: "Guitar",
    tuning_midi: [64, 59, 55, 50, 45, 40],
    string_count: 6,
    family: "guitar",
  },
];

describe("ExercisesView", () => {
  beforeEach(() => {
    api.importDocument.mockReset();
    router.navigate.mockReset();
    ui.presets = PRESETS;
    ui.defaultInstrument = "guitar-6";
  });

  it("generates a scale and saves it to the library", async () => {
    api.importDocument.mockResolvedValue({ id: "song-1" });
    render(ExercisesView);
    expect(screen.getByTestId("exercise-title")).toHaveTextContent(
      "A minor pentatonic, from fret 5",
    );

    await fireEvent.change(screen.getByTestId("exercise-scale"), { target: { value: "major" } });
    expect(screen.getByTestId("exercise-title")).toHaveTextContent("A major, from fret 5");
    expect(screen.getByTestId("exercise-save")).toHaveClass("primary");

    await fireEvent.click(screen.getByTestId("exercise-save"));
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith("/songs/song-1"));
    const body = api.importDocument.mock.calls[0][0];
    expect(body.title).toBe("A major, from fret 5");
    expect(body.tags).toEqual(["exercise"]);
    expect(body.document.tracks[0].tuning_midi).toEqual([64, 59, 55, 50, 45, 40]);
  });

  it("loads a preset drill into the form", async () => {
    render(ExercisesView);
    await fireEvent.click(screen.getByTestId("exercise-preset-openChordChanges"));
    expect(screen.getByTestId("exercise-kind-changes")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("exercise-chords")).toHaveValue("G C D Em");
    expect(screen.getByTestId("exercise-bpm")).toHaveValue(70);
    expect(screen.getByTestId("exercise-title")).toHaveTextContent("Chord changes: G – C – D – Em");
  });

  it("switches between exercise types", async () => {
    render(ExercisesView);
    await fireEvent.click(screen.getByTestId("exercise-kind-spider"));
    expect(screen.getByTestId("exercise-pattern")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("exercise-kind-bass"));
    await fireEvent.input(screen.getByTestId("exercise-chords"), { target: { value: "E7 A7 B7" } });
    expect(screen.getByTestId("exercise-title")).toHaveTextContent(
      "Root-fifth-octave: E7 – A7 – B7",
    );
    await fireEvent.click(screen.getByTestId("exercise-kind-arpeggio"));
    await fireEvent.input(screen.getByTestId("exercise-chord"), { target: { value: "Cmaj7" } });
    expect(screen.getByTestId("exercise-title")).toHaveTextContent("Cmaj7 arpeggio");
  });

  it("explains a chord it cannot read and hides save", async () => {
    render(ExercisesView);
    await fireEvent.click(screen.getByTestId("exercise-kind-arpeggio"));
    await fireEvent.input(screen.getByTestId("exercise-chord"), { target: { value: "H" } });
    expect(screen.getByTestId("exercise-error")).toHaveTextContent('"H" is not a chord');
    expect(screen.queryByTestId("exercise-save")).toBeNull();
  });

  it("offers only drills that suit the instrument", async () => {
    render(ExercisesView);
    expect(screen.getByTestId("exercise-preset-folkStrum")).toBeInTheDocument();
    await fireEvent.change(screen.getByTestId("exercise-instrument"), {
      target: { value: "bass-4" },
    });
    expect(screen.queryByTestId("exercise-preset-folkStrum")).toBeNull();
    expect(screen.getByTestId("exercise-preset-walkingBlues")).toBeInTheDocument();
  });

  it("shows a save failure", async () => {
    api.importDocument.mockRejectedValue(new Error("boom"));
    render(ExercisesView);
    await fireEvent.click(screen.getByTestId("exercise-save"));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
