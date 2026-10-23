import { afterEach, describe, expect, it, vi } from "vitest";

import { Clicker } from "./clicker";

function fakeContext() {
  const oscillators: { frequency: { value: number }; start: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    state: "suspended",
    currentTime: 10,
    destination: {},
    resume: vi.fn(),
    close: vi.fn(),
    createOscillator: () => {
      const node = {
        type: "",
        frequency: { value: 0 },
        connect: (next: unknown) => next,
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(node);
      return node;
    },
    createGain: () => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: (next: unknown) => next,
    }),
  };
  return { context, oscillators };
}

afterEach(() => vi.unstubAllGlobals());

describe("Clicker", () => {
  it("schedules accented clicks higher and later than now", () => {
    const { context, oscillators } = fakeContext();
    vi.stubGlobal("AudioContext", function () {
      return context;
    });
    const clicker = new Clicker();
    clicker.unlock();
    expect(context.resume).toHaveBeenCalled();
    clicker.click(0.5, true, 1);
    clicker.click(0, false, 1);
    clicker.click(0, false, 0);
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0].frequency.value).toBeGreaterThan(oscillators[1].frequency.value);
    expect(oscillators[0].start).toHaveBeenCalledWith(10.5);
    clicker.close();
    expect(context.close).toHaveBeenCalled();
  });

  it("does nothing where there is no Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    const clicker = new Clicker();
    expect(() => {
      clicker.unlock();
      clicker.click(0, true, 1);
      clicker.close();
    }).not.toThrow();
  });
});
