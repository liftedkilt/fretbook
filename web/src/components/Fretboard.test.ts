import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

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
});
