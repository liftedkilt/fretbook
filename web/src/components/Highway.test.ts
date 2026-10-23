import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import Highway from "./Highway.svelte";
import type { ScoreDocument, Track } from "../lib/types";

const track: Track = {
  id: "bass",
  name: "Bass",
  instrument: "bass-guitar",
  capo: 0,
  tuning_midi: [43, 38, 33, 28],
  preferred: true,
  bars: [
    {
      voices: [
        {
          beats: [
            {
              position: 0,
              duration: 960,
              notes: [
                { string: 3, fret: 0 },
                { string: 2, fret: 2 },
              ],
            },
            {
              position: 960,
              duration: 960,
              notes: [{ string: 3, fret: 3, hammer: true }],
            },
          ],
        },
      ],
    },
    {
      voices: [
        {
          beats: [
            {
              position: 0,
              duration: 960,
              notes: [{ string: 2, fret: 5 }],
            },
          ],
        },
      ],
    },
  ],
};

const scoreDoc: ScoreDocument = {
  version: 1,
  bpm: 120,
  bars: [
    { signature: [4, 4], section: "Intro" },
    { signature: [4, 4], section: "Verse" },
  ],
  tracks: [track],
  sync: {
    video_id: null,
    points: [],
    anchors: {},
    keyed_by: "played",
  },
};

describe("Highway component", () => {
  it("renders the canvas, current and upcoming sections, active chord, and note summary", () => {
    render(Highway, {
      props: {
        document: scoreDoc,
        track,
        currentTime: 0,
        grades: { "0:0": "hit", "0:960": "missed" },
      },
    });

    const highway = screen.getByTestId("highway");
    expect(highway).toHaveAttribute("data-gem-count", "4");
    expect(highway).toHaveAttribute("data-chord-count", "1");
    expect(highway).toHaveAttribute("data-hit-count", "2");
    expect(highway).toHaveAttribute("data-missed-count", "1");
    expect(screen.getByTestId("highway-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("highway-section").textContent).toContain("Intro");
    expect(screen.getByTestId("highway-upcoming-section").textContent).toContain("Verse");
    expect(screen.getByTestId("highway-chord").textContent).toContain("E5");
    expect(screen.getByTestId("highway-summary").textContent).toContain("string 4, fret 0");
  });

  it("seeks to the clicked bar when the canvas is clicked", async () => {
    const onseek = vi.fn();
    render(Highway, {
      props: {
        document: scoreDoc,
        track,
        currentTime: 0,
        onseek,
      },
    });

    const canvas = screen.getByTestId("highway-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 960,
      bottom: 260,
      width: 960,
      height: 260,
      toJSON: () => ({}),
    });

    // Click far to the right (around 2.5 seconds into the song, in bar 1).
    await fireEvent.click(canvas, { clientX: 680 });
    expect(onseek).toHaveBeenCalledWith(1);
  });
});
