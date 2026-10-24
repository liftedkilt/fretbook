import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it } from "vitest";

import { handsFree, resetPedals } from "../lib/handsFree.svelte";
import PedalSettings from "./PedalSettings.svelte";

describe("PedalSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    resetPedals();
  });

  it("reassigns a key, remembers it, and restores the defaults", async () => {
    render(PedalSettings);
    const select = screen.getByTestId("pedal-ArrowRight") as HTMLSelectElement;
    expect(select.value).toBe("default");
    await fireEvent.change(select, { target: { value: "nextSong" } });
    expect(handsFree.pedals.ArrowRight).toBe("nextSong");
    expect(JSON.parse(localStorage.getItem("fretbook.pedals") ?? "{}").ArrowRight).toBe("nextSong");
    await fireEvent.click(screen.getByTestId("pedal-reset"));
    expect(handsFree.pedals.ArrowRight).toBe("default");
    expect(select.value).toBe("default");
  });
});
