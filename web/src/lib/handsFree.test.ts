import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  autoScrollSpeed,
  DEFAULT_PEDALS,
  FALLBACK_SECONDS,
  handsFree,
  isTyping,
  loadPedals,
  pageDelta,
  parseDuration,
  pedalAction,
  resetPedals,
  setPedal,
  setStage,
  stepScrollFactor,
} from "./handsFree.svelte";

const plain = { ctrlKey: false, metaKey: false, altKey: false };

describe("pedalAction", () => {
  it("maps the default pedal keys and leaves the arrows alone", () => {
    expect(pedalAction({ key: "PageDown", ...plain }, DEFAULT_PEDALS)).toBe("nextPage");
    expect(pedalAction({ key: "PageUp", ...plain }, DEFAULT_PEDALS)).toBe("previousPage");
    expect(pedalAction({ key: "ArrowRight", ...plain }, DEFAULT_PEDALS)).toBeNull();
    expect(pedalAction({ key: "a", ...plain }, DEFAULT_PEDALS)).toBeNull();
  });

  it("ignores a key pressed with a modifier", () => {
    expect(pedalAction({ key: "PageDown", ...plain, altKey: true }, DEFAULT_PEDALS)).toBeNull();
    expect(pedalAction({ key: "PageDown", ...plain, ctrlKey: true }, DEFAULT_PEDALS)).toBeNull();
  });

  it("follows a reassigned key", () => {
    const map = { ...DEFAULT_PEDALS, ArrowRight: "nextSong" as const };
    expect(pedalAction({ key: "ArrowRight", ...plain }, map)).toBe("nextSong");
  });
});

describe("stored settings", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      clear: () => store.clear(),
    });
    resetPedals();
    localStorage.clear();
  });

  it("saves a pedal choice and reads it back", () => {
    setPedal("ArrowLeft", "loop");
    expect(handsFree.pedals.ArrowLeft).toBe("loop");
    expect(loadPedals().ArrowLeft).toBe("loop");
    expect(loadPedals().PageDown).toBe("nextPage");
  });

  it("drops unknown keys and actions from a damaged value", () => {
    localStorage.setItem("fretbook.pedals", JSON.stringify({ PageDown: "explode", Q: "toggle" }));
    expect(loadPedals()).toEqual(DEFAULT_PEDALS);
    localStorage.setItem("fretbook.pedals", "{nope");
    expect(loadPedals()).toEqual(DEFAULT_PEDALS);
  });

  it("remembers stage mode and the scroll speed step", () => {
    setStage(true);
    expect(localStorage.getItem("fretbook.stage")).toBe("1");
    setStage(false);
    expect(handsFree.stage).toBe(false);
    handsFree.scrollFactor = 1;
    stepScrollFactor(1);
    expect(handsFree.scrollFactor).toBe(1.25);
    stepScrollFactor(-1);
    stepScrollFactor(-1);
    stepScrollFactor(-1);
    stepScrollFactor(-1);
    expect(handsFree.scrollFactor).toBe(0.5);
    expect(localStorage.getItem("fretbook.autoscrollSpeed")).toBe("0.5");
  });
});

describe("scrolling", () => {
  it("pages by most of a screen in either direction", () => {
    expect(pageDelta(1000, 1)).toBe(850);
    expect(pageDelta(1000, -1)).toBe(-850);
  });

  it("reads a duration as minutes and seconds or seconds", () => {
    expect(parseDuration("3:45")).toBe(225);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("0:00")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });

  it("derives the speed from the duration, then the tempo, then a typical length", () => {
    expect(autoScrollSpeed({ distance: 2000, duration: 200 })).toBe(10);
    // 30 lines of 8 beats at 120 bpm last 120 s.
    expect(autoScrollSpeed({ distance: 1200, bpm: 120, lines: 30 })).toBe(10);
    expect(autoScrollSpeed({ distance: FALLBACK_SECONDS })).toBe(1);
    expect(autoScrollSpeed({ distance: 2000, duration: 200, factor: 2 })).toBe(20);
    expect(autoScrollSpeed({ distance: -5, duration: 200 })).toBe(0);
  });
});

describe("isTyping", () => {
  it("is true in a field and false elsewhere", () => {
    expect(isTyping({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(
      true,
    );
    expect(isTyping({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
