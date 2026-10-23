import { afterEach, describe, expect, it, vi } from "vitest";
import { asciiTabBody, debounced, type AsciiTabForm } from "./asciiTab";

const form: AsciiTabForm = {
  text: "e|-0-|",
  title: " Riff ",
  artist: "",
  grid: 8,
  bpm: null,
  numerator: 4,
  denominator: 4,
};

describe("asciiTabBody", () => {
  it("builds the request and trims the names", () => {
    expect(asciiTabBody(form)).toEqual({
      text: "e|-0-|",
      title: "Riff",
      artist: "",
      grid: 8,
      signature: [4, 4],
      bpm: null,
    });
  });

  it("sends nothing for blank text", () => {
    expect(asciiTabBody({ ...form, text: "  \n " })).toBeNull();
  });

  it("keeps a valid tempo and drops an invalid one", () => {
    expect(asciiTabBody({ ...form, bpm: 96 })?.bpm).toBe(96);
    expect(asciiTabBody({ ...form, bpm: 0 })?.bpm).toBeNull();
    expect(asciiTabBody({ ...form, bpm: 400 })?.bpm).toBeNull();
    expect(asciiTabBody({ ...form, bpm: Number.NaN })?.bpm).toBeNull();
  });

  it("waits for a valid time signature", () => {
    expect(asciiTabBody({ ...form, numerator: 0 })).toBeNull();
    expect(asciiTabBody({ ...form, numerator: 33 })).toBeNull();
    expect(asciiTabBody({ ...form, numerator: 2.5 })).toBeNull();
    expect(asciiTabBody({ ...form, denominator: 3 })).toBeNull();
    expect(asciiTabBody({ ...form, numerator: 6, denominator: 8 })?.signature).toEqual([6, 8]);
  });
});

describe("debounced", () => {
  afterEach(() => vi.useRealTimers());

  it("runs once with the last arguments", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const { call } = debounced(action, 100);
    call(1);
    call(2);
    vi.advanceTimersByTime(99);
    expect(action).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledWith(2);
  });

  it("can be cancelled", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const { call, cancel } = debounced(action, 100);
    call();
    cancel();
    vi.advanceTimersByTime(500);
    expect(action).not.toHaveBeenCalled();
  });
});
