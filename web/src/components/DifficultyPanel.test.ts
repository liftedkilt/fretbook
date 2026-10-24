import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import DifficultyPanel from "./DifficultyPanel.svelte";
import type { TrackDifficulty } from "../lib/types";

const factors = (density: number, stretch: number): TrackDifficulty["factors"] => [
  { key: "density", value: density, measure: 5.25 },
  { key: "shifts", value: 0, measure: 0 },
  { key: "stretch", value: stretch, measure: 6 },
  { key: "techniques", value: 0, measure: 0 },
  { key: "chords", value: 0, measure: 0 },
  { key: "rhythm", value: 0, measure: 0 },
];

describe("DifficultyPanel", () => {
  it("shows the preferred track's level and why each track got its own", () => {
    const tracks: TrackDifficulty[] = [
      { track_id: "a", name: "Lead", level: 7.6, factors: factors(0.6, 0.9) },
      { track_id: "b", name: "Bass", level: 2.2, factors: factors(0, 0).map((f) => ({ ...f })) },
    ];
    render(DifficultyPanel, { tracks, preferredId: "a" });
    expect(screen.getByTestId("difficulty-summary")).toHaveTextContent("8 of 10");
    const rows = screen.getAllByTestId("difficulty-track");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Lead");
    expect(rows[0]).toHaveTextContent("up to 6 frets apart in a chord");
    expect(rows[0]).toHaveTextContent("5.3 notes a second");
    // The biggest contributor comes first.
    const order = [...rows[0].querySelectorAll("li[data-testid^='difficulty-factor-']")].map((li) =>
      li.getAttribute("data-testid"),
    );
    expect(order).toEqual(["difficulty-factor-stretch", "difficulty-factor-density"]);
    expect(rows[1]).toHaveTextContent("Nothing here is demanding.");
  });

  it("explains a chord sheet by its chords", () => {
    const tracks: TrackDifficulty[] = [
      {
        track_id: "chords",
        name: "Chords",
        level: 5.4,
        factors: [
          { key: "vocabulary", value: 0.5, measure: 7 },
          { key: "barres", value: 0.4, measure: 2 },
          { key: "extensions", value: 0, measure: 0 },
          { key: "changes", value: 0.3, measure: 1.75 },
        ],
      },
    ];
    render(DifficultyPanel, { tracks, preferredId: "chords", chords: true });
    expect(screen.getByTestId("difficulty-summary")).toHaveTextContent("5 of 10");
    expect(screen.getByTestId("song-difficulty-panel")).toHaveTextContent(
      "Estimated from the chords",
    );
    expect(screen.getByTestId("difficulty-factor-vocabulary")).toHaveTextContent(
      "7 different chords",
    );
    expect(screen.getByTestId("difficulty-factor-barres")).toHaveTextContent("2 barre chords");
    expect(screen.getByTestId("difficulty-factor-changes")).toHaveTextContent(
      "1.8 chord changes per line",
    );
    expect(screen.queryByTestId("difficulty-factor-extensions")).toBeNull();
  });

  it("renders nothing for a song without tracks", () => {
    render(DifficultyPanel, { tracks: [], preferredId: "" });
    expect(screen.queryByTestId("song-difficulty-panel")).toBeNull();
  });
});
