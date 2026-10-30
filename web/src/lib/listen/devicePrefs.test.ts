import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocalCalibration } from "./calibration";
import {
  getSavedA4,
  getSavedChannel,
  getSavedDevice,
  getStoredCalibration,
  saveA4,
  saveChannel,
  saveDevice,
  saveOutput,
} from "./devicePrefs";

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

  it("persists one A4, clamped, defaulting to 440", () => {
    expect(getSavedA4()).toBe(440);
    saveA4(432);
    expect(getSavedA4()).toBe(432);
    saveA4(500);
    expect(getSavedA4()).toBe(446);
  });

  it("reads the calibration pair the player stored, else default:default", () => {
    expect(getStoredCalibration()).toBeNull();
    setLocalCalibration("default", "default", 90);
    expect(getStoredCalibration("scarlett")).toBe(90);
    setLocalCalibration("bt", "scarlett", 180);
    saveOutput("bt");
    expect(getStoredCalibration("scarlett")).toBe(180);
    expect(getStoredCalibration("other")).toBe(90);
  });
});
