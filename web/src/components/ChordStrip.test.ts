import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { buildEntries } from "../lib/chords/entries";
import { physicalTuning } from "../lib/chords/voicings";
import ChordStrip from "./ChordStrip.svelte";

const tuning = physicalTuning([64, 59, 55, 50, 45, 40]);

describe("ChordStrip", () => {
  it("draws a diagram per chord and steps through voicings", async () => {
    const entries = buildEntries(["C", "G"], tuning, true, {}, {});
    const onpick = vi.fn();
    const onplay = vi.fn();
    render(ChordStrip, { props: { entries, strings: 6, onpick, onplay } });

    expect(screen.getAllByTestId("chord-card")).toHaveLength(2);
    expect(screen.getAllByTestId("strip-chord-name").map((node) => node.textContent)).toEqual([
      "C",
      "G",
    ]);
    expect(screen.getAllByRole("img")).toHaveLength(2);

    await fireEvent.click(screen.getAllByTestId("voicing-next")[0]);
    expect(onpick).toHaveBeenLastCalledWith("C", 1);
    await fireEvent.click(screen.getAllByTestId("voicing-prev")[0]);
    expect(onpick).toHaveBeenLastCalledWith("C", entries[0].voicings.length - 1);
    await fireEvent.click(screen.getAllByTestId("voicing-play")[1]);
    expect(onplay).toHaveBeenCalledWith(entries[1]);
  });

  it("says when a chord has no shape and marks a song's own define", () => {
    const defined = buildEntries(
      ["Am7"],
      tuning,
      true,
      { Am7: { name: "Am7", baseFret: 1, frets: [null, 0, 2, 0, 1, 0] } },
      {},
    );
    const none = buildEntries(["C"], [40, 45], true, {}, {});
    render(ChordStrip, {
      props: { entries: [...defined, ...none], strings: 6, onpick: vi.fn(), onplay: vi.fn() },
    });
    expect(screen.getByText("From this song")).toBeInTheDocument();
    expect(screen.getByText("No shape for this tuning")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});
