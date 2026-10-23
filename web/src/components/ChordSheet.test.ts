import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ChordSheet from "./ChordSheet.svelte";

describe("ChordSheet", () => {
  it("renders song title, artist, and chords", () => {
    const text = `{title: Wonderwall}
{artist: Oasis}
[Em7]Today is [G]gonna be the day`;

    render(ChordSheet, { props: { text } });

    expect(screen.getByText("Wonderwall")).toBeInTheDocument();
    expect(screen.getByText("Oasis")).toBeDefined();
    expect(screen.getByText("Today is")).toBeDefined();
    expect(screen.getByText("gonna be the day")).toBeDefined();

    const chordElements = screen.getAllByTestId("chord-name");
    const chords = chordElements.map((el) => el.textContent?.trim()).filter(Boolean);
    expect(chords).toEqual(["Em7", "G"]);
  });

  it("transposes chords according to transpose prop", () => {
    const text = `[C] [G] [Am] [F]`;

    render(ChordSheet, { props: { text, transpose: 2 } });

    const chordElements = screen.getAllByTestId("chord-name");
    const chords = chordElements.map((el) => el.textContent?.trim()).filter(Boolean);
    // C transposed +2 is D, G -> A, Am -> Bm, F -> G
    expect(chords).toEqual(["D", "A", "Bm", "G"]);
  });

  it("formats chords with flats when flats is true", () => {
    const text = `[A]`;

    // Transpose A by +1 without flats is A#, with flats is Bb
    render(ChordSheet, { props: { text, transpose: 1, flats: true } });

    const chordElements = screen.getAllByTestId("chord-name");
    const chords = chordElements.map((el) => el.textContent?.trim()).filter(Boolean);
    expect(chords).toEqual(["Bb"]);
  });

  it("renders section labels, comments, and tab sections", () => {
    const text = `{c: Intro}
{soc: Chorus}
[C]Chorus line
{eoc}
{sot}
e|--0--|
{eot}`;

    render(ChordSheet, { props: { text } });

    expect(screen.getByText("Intro")).toBeDefined();
    expect(screen.getByText("Chorus")).toBeDefined();
    expect(screen.getByText("Chorus line")).toBeDefined();
    expect(screen.getByText("e|--0--|")).toBeDefined();
  });
});
