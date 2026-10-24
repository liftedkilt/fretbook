import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSavedChannel, getSavedDevice, saveChannel, saveDevice } from "./devicePrefs";

describe("device preferences", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });

  it("defaults to the default device and the first channel", () => {
    expect(getSavedDevice()).toBe("");
    expect(getSavedChannel("scarlett")).toBe(0);
  });

  it("remembers the channel per device", () => {
    saveDevice("scarlett");
    saveChannel("scarlett", 1);
    saveChannel("mic", 0);
    expect(getSavedDevice()).toBe("scarlett");
    expect(getSavedChannel("scarlett")).toBe(1);
    expect(getSavedChannel("mic")).toBe(0);
  });

  it("ignores corrupt stored values", () => {
    localStorage.setItem("fretbook.listen.channels", "{nope");
    expect(getSavedChannel("scarlett")).toBe(0);
    localStorage.setItem("fretbook.listen.channels", JSON.stringify({ scarlett: -2 }));
    expect(getSavedChannel("scarlett")).toBe(0);
  });
});
