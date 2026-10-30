import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetPedals, setPedal, setStage } from "../lib/handsFree.svelte";
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

  it("applies a capo suggestion to the sheet and diagrams, and undoes it", async () => {
    render(ChordSheetView, { props: { song: song("[Bb]Hello [Eb]world [F]again [Gm]now") } });
    expect(names()).toEqual(["Bb", "Eb", "F", "Gm"]);
    await fireEvent.click(screen.getByTestId("capo-apply-3"));
    expect(names()).toEqual(["G", "C", "D", "Em"]);
    expect(screen.getAllByTestId("chord-name").map((node) => node.textContent)).toEqual([
      "G",
      "C",
      "D",
      "Em",
    ]);
    expect(screen.getByTestId("chord-capo")).toBeInTheDocument();
    expect(screen.getByTestId("capo-applied")).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("capo-undo"));
    expect(names()).toEqual(["Bb", "Eb", "F", "Gm"]);
    expect(screen.queryByTestId("chord-capo")).toBeNull();
  });

  it("replaces the sheet's own capo, and keeps following transpose", async () => {
    // Bb Eb F Gm with capo 1 sound as B E F# G#m; capo 4 turns them into G C D Em.
    render(ChordSheetView, {
      props: { song: song("{capo: 1}\n[Bb]Hello [Eb]world [F]again [Gm]now") },
    });
    expect(names()).toEqual(["Bb", "Eb", "F", "Gm"]);
    await fireEvent.click(screen.getByTestId("capo-apply-4"));
    expect(names()).toEqual(["G", "C", "D", "Em"]);
    await fireEvent.click(screen.getByTestId("transpose-up"));
    expect(names()).toEqual(["Ab", "Db", "D#", "Fm"]);
    await fireEvent.click(screen.getByTestId("capo-undo"));
    expect(names()).toEqual(["B", "E", "F#", "G#m"]);
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
    await fireEvent.click(screen.getByTestId("song-more"));
    await fireEvent.click(screen.getByTestId("export-open"));
    await fireEvent.click(screen.getByTestId("export-pdf"));
    await waitFor(() => expect(pdf).toHaveBeenCalledTimes(1));
    const { diagrams } = pdf.mock.calls[0][0];
    expect(diagrams.strings).toBe(6);
    expect(diagrams.chords).toHaveLength(1);
    expect(diagrams.chords[0].name).toBe("Am7");
    expect(diagrams.chords[0].voicing.frets).toEqual([null, 0, 2, 0, 1, 0]);
  });
});

describe("ChordSheetView hands-free", () => {
  beforeEach(() => {
    localStorage.clear();
    resetPedals();
    setStage(false);
    window.scrollBy = vi.fn();
  });

  it("turns the page on a page-turner key and ignores it while typing", async () => {
    render(ChordSheetView, { props: { song: song("[C]Hello") } });
    await fireEvent.keyDown(document.body, { key: "PageDown" });
    expect(window.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ top: expect.any(Number) }),
    );
    const top = vi.mocked(window.scrollBy).mock.calls[0][0] as ScrollToOptions;
    expect(top.top).toBeGreaterThan(0);
    await fireEvent.keyDown(document.body, { key: "PageUp" });
    expect((vi.mocked(window.scrollBy).mock.calls[1][0] as ScrollToOptions).top).toBeLessThan(0);
    const field = document.createElement("input");
    document.body.append(field);
    vi.mocked(window.scrollBy).mockClear();
    await fireEvent.keyDown(field, { key: "PageDown" });
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("starts and stops the auto-scroll from the button or a pedal mapped to play", async () => {
    render(ChordSheetView, { props: { song: song("{duration: 3:00}\n[C]Hello") } });
    const button = screen.getByTestId("autoscroll");
    expect(button).toHaveAttribute("aria-pressed", "false");
    await fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    await fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    setPedal("ArrowRight", "toggle");
    await fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await fireEvent.click(button);
  });

  it("changes the scroll speed and switches stage mode", async () => {
    render(ChordSheetView, { props: { song: song("[C]Hello") } });
    expect(screen.getByTestId("autoscroll-speed")).toHaveTextContent("1×");
    await fireEvent.click(screen.getByTestId("autoscroll-faster"));
    expect(screen.getByTestId("autoscroll-speed")).toHaveTextContent("1.25×");
    await fireEvent.click(screen.getByTestId("autoscroll-slower"));
    expect(screen.getByTestId("autoscroll-speed")).toHaveTextContent("1×");
    const toggle = screen.getByTestId("stage-toggle");
    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".chords-page")).toHaveClass("stage");
    expect(localStorage.getItem("fretbook.stage")).toBe("1");
    expect(toggle).toHaveTextContent("Exit stage mode");
  });

  it("leaves stage mode with Escape", async () => {
    render(ChordSheetView, { props: { song: song("[C]Hello") } });
    await fireEvent.click(screen.getByTestId("stage-toggle"));
    expect(document.querySelector(".chords-page")).toHaveClass("stage");
    await fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.querySelector(".chords-page")).not.toHaveClass("stage");
    expect(localStorage.getItem("fretbook.stage")).toBe("0");
  });
});

describe("ChordSheetView on a phone", () => {
  beforeEach(() => {
    localStorage.clear();
    setStage(false);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("collapses the chord diagrams until asked", async () => {
    render(ChordSheetView, { props: { song: song("[C]Hello [G]world") } });
    const toggle = screen.getByTestId("chord-diagrams-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("chord-strip")).toBeNull();
    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(names()).toEqual(["C", "G"]);
  });

  it("keeps play, speed and transpose in one row and the rest in the more menu", async () => {
    render(ChordSheetView, { props: { song: song("[C]Hello [G]world") } });
    const dock = screen.getByRole("toolbar");
    expect(dock).toHaveClass("phone");
    for (const id of ["autoscroll", "autoscroll-faster", "transpose-up", "chords-more"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("stage-toggle")).toBeNull();
    await fireEvent.click(screen.getByTestId("chords-more"));
    await fireEvent.click(screen.getByTestId("stage-toggle"));
    expect(document.querySelector(".chords-page")).toHaveClass("stage");
    await fireEvent.click(screen.getByTestId("chords-more"));
    await fireEvent.click(screen.getByTestId("chords-flats"));
    await fireEvent.click(screen.getByTestId("chords-more"));
    expect(screen.getByTestId("chords-flats")).toHaveTextContent("Flats");
  });
});
