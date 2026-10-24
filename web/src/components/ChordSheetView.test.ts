import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SongDetail } from "../lib/types";
import ChordSheetView from "./ChordSheetView.svelte";

const pdf = vi.hoisted(() => vi.fn());
const strum = vi.hoisted(() => vi.fn());
vi.mock("../lib/export/pdf", () => ({ downloadChordSheetPdf: pdf }));
vi.mock("../lib/chords/strum", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chords/strum")>()),
  playStrum: strum,
}));

function song(chordpro: string): SongDetail {
  return { id: "s1", title: "Two Chords", artist: "Ada", chordpro } as unknown as SongDetail;
}

const names = () => screen.getAllByTestId("strip-chord-name").map((node) => node.textContent);

describe("ChordSheetView diagram strip", () => {
  beforeEach(() => {
    localStorage.clear();
    pdf.mockReset();
    strum.mockReset();
  });

  it("shows the chords of the sheet, following transpose", async () => {
    render(ChordSheetView, { props: { song: song("[C]Hello [G]world [C]again [N.C.]") } });
    expect(names()).toEqual(["C", "G"]);
    await fireEvent.click(screen.getByTestId("transpose-up"));
    await fireEvent.click(screen.getByTestId("transpose-up"));
    expect(names()).toEqual(["D", "A"]);
  });

  it("is absent when there is nothing to draw", () => {
    render(ChordSheetView, { props: { song: song("Just words\n[N.C.]") } });
    expect(screen.queryByTestId("chord-diagrams")).toBeNull();
  });

  it("remembers the voicing per song", async () => {
    const first = render(ChordSheetView, { props: { song: song("[C]Hello") } });
    expect(screen.getByTestId("voicing-count").textContent).toBe("1 of 6");
    await fireEvent.click(screen.getByTestId("voicing-next"));
    expect(screen.getByTestId("voicing-count").textContent).toBe("2 of 6");
    const stored = JSON.parse(localStorage.getItem("fretbook.chordChoice.s1")!);
    expect(Object.keys(stored.voicings)).toEqual(["C"]);
    first.unmount();

    render(ChordSheetView, { props: { song: song("[C]Hello") } });
    expect(screen.getByTestId("voicing-count").textContent).toBe("2 of 6");
  });

  it("switches instrument and notes the capo", async () => {
    render(ChordSheetView, { props: { song: song("{capo: 3}\n[C]Hello") } });
    expect(screen.getByTestId("chord-capo")).toBeInTheDocument();
    await fireEvent.change(screen.getByTestId("chord-instrument"), {
      target: { value: "ukulele" },
    });
    expect(JSON.parse(localStorage.getItem("fretbook.chordChoice.s1")!)).toMatchObject({
      instrument: "ukulele",
      tuning: "standard",
    });
    await fireEvent.change(screen.getByTestId("chord-tuning"), { target: { value: "lowG" } });
    await fireEvent.click(screen.getByTestId("voicing-play"));
    const notes = strum.mock.calls[0][0] as { midi: number }[];
    // C on a low-G ukulele (open 0003) with a capo on 3: G A… every string three frets higher.
    expect(notes.map((note) => note.midi)).toEqual([58, 63, 67, 75]);
  });

  it("uses a {define:} from the song and sends the diagrams to the PDF", async () => {
    render(ChordSheetView, {
      props: { song: song("{define: Am7 base-fret 1 frets x 0 2 0 1 0}\n[Am7]Hello") },
    });
    expect(screen.getByText("From this song")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("export-menu"));
    await fireEvent.click(screen.getByTestId("export-pdf"));
    await waitFor(() => expect(pdf).toHaveBeenCalledTimes(1));
    const { diagrams } = pdf.mock.calls[0][0];
    expect(diagrams.strings).toBe(6);
    expect(diagrams.chords).toHaveLength(1);
    expect(diagrams.chords[0].name).toBe("Am7");
    expect(diagrams.chords[0].voicing.frets).toEqual([null, 0, 2, 0, 1, 0]);
  });
});
