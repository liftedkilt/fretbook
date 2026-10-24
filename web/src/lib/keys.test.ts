import { describe, expect, it } from "vitest";
import { KEYS, keyLabel, keyParts } from "./keys";

const translate = (key: string, params?: Record<string, string | number>) =>
  `${key}:${params?.note}`;

describe("keys", () => {
  it("lists the 24 keys the server accepts", () => {
    expect(KEYS).toHaveLength(24);
    expect(new Set(KEYS).size).toBe(24);
  });

  it("splits a key into its note and mode, with proper accidentals", () => {
    expect(keyParts("C")).toEqual({ note: "C", minor: false });
    expect(keyParts("F#m")).toEqual({ note: "F♯", minor: true });
    expect(keyParts("Bb")).toEqual({ note: "B♭", minor: false });
    expect(keyParts("Bbm")).toEqual({ note: "B♭", minor: true });
    // The B of B major is a note, not a flat sign.
    expect(keyParts("B")).toEqual({ note: "B", minor: false });
    expect(keyParts("Bm")).toEqual({ note: "B", minor: true });
  });

  it("labels a key through the translator", () => {
    expect(keyLabel("Am", translate)).toBe("metadata.keyMinor:A");
    expect(keyLabel("Eb", translate)).toBe("metadata.keyMajor:E♭");
  });
});
