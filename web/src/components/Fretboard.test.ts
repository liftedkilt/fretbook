import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import Fretboard from "./Fretboard.svelte";

const BASS = [43, 38, 33, 28];

describe("Fretboard", () => {
  it("lights the current notes and fades the next ones", () => {
    render(Fretboard, {
      props: {
        tuning: BASS,
        current: [{ string: 3, fret: 3 }],
        next: [
          { notes: [{ string: 2, fret: 2 }], rank: 1 },
          { notes: [{ string: 3, fret: 3 }], rank: 2 },
        ],
        label: "names",
      },
    });
    expect(screen.getAllByTestId("fretboard-now")).toHaveLength(1);
    // The note that is already lit is not drawn again as an upcoming one.
    const next = screen.getAllByTestId("fretboard-next");
    expect(next).toHaveLength(1);
    expect(next[0].getAttribute("data-rank")).toBe("1");
    expect(screen.getByTestId("fretboard-now").textContent).toContain("G");
    expect(screen.getByTestId("fretboard-summary").textContent).toContain("string 4, fret 3");
  });

  it("draws one line per string for any tuning", () => {
    const { container } = render(Fretboard, {
      props: { tuning: [64, 59, 55, 50, 45, 40, 35, 30] },
    });
    expect(container.querySelectorAll("line.string")).toHaveLength(8);
  });

  it("shows intervals, fret numbers or nothing", () => {
    const props = { tuning: BASS, current: [{ string: 3, fret: 3 }], root: 4 };
    const intervals = render(Fretboard, { props: { ...props, label: "intervals" } });
    expect(screen.getByTestId("fretboard-now").textContent).toContain("b3");
    intervals.unmount();
    const frets = render(Fretboard, { props: { ...props, label: "frets" } });
    expect(screen.getByTestId("fretboard-now").textContent).toContain("3");
    frets.unmount();
    render(Fretboard, { props: { ...props, label: "none" } });
    expect(screen.getByTestId("fretboard-now").querySelector("text")).toBeNull();
  });

  it("mirrors the neck for left-handed players", () => {
    const props = { tuning: BASS, current: [{ string: 3, fret: 5 }] };
    const right = render(Fretboard, { props });
    const rightX = Number(
      screen.getByTestId("fretboard-now").querySelector("circle")?.getAttribute("cx"),
    );
    right.unmount();
    render(Fretboard, { props: { ...props, leftHanded: true } });
    const leftX = Number(
      screen.getByTestId("fretboard-now").querySelector("circle")?.getAttribute("cx"),
    );
    expect(rightX + leftX).toBeCloseTo(1000);
  });

  it("says when there is a capo and when nothing sounds yet", () => {
    render(Fretboard, { props: { tuning: BASS, capo: 2 } });
    expect(screen.getByTestId("fretboard-capo").textContent).toContain("2");
    expect(screen.getByTestId("fretboard-summary").textContent).toBe("Waiting for the first note");
  });

  it("reports the tapped note when it is given a handler, and has no tap targets otherwise", async () => {
    const onselect = vi.fn();
    const { unmount } = render(Fretboard, { props: { tuning: BASS, frets: 12, onselect } });
    await fireEvent.click(screen.getByTestId("fret-tap-2-5"));
    expect(onselect).toHaveBeenCalledWith({ string: 2, fret: 5 });
    await fireEvent.keyDown(screen.getByTestId("fret-tap-0-0"), { key: "Enter" });
    expect(onselect).toHaveBeenLastCalledWith({ string: 0, fret: 0 });
    expect(screen.queryByTestId("fret-tap-3-12")).not.toBeNull();
    unmount();
    render(Fretboard, { props: { tuning: BASS } });
    expect(screen.queryByTestId("fret-tap-0-0")).toBeNull();
  });
});

describe("Fretboard tone", () => {
  it("tags the lit note with the tone wait mode gives it", () => {
    render(Fretboard, {
      props: { tuning: BASS, current: [{ string: 3, fret: 0 }], tone: "hit" },
    });
    expect(screen.getByTestId("fretboard-now").getAttribute("data-tone")).toBe("hit");
  });
});
