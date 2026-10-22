import { describe, expect, it } from "vitest";

import { instrumentFamily, instrumentLabel } from "./instruments";

describe("instrument filters", () => {
  it("sorts bass, acoustic, and electric names", () => {
    expect(instrumentFamily("bass-guitar")).toBe("bass");
    expect(instrumentFamily("Electric Bass (finger)")).toBe("bass");
    expect(instrumentFamily("acoustic-guitar")).toBe("acoustic");
    expect(instrumentFamily("Acoustic Guitar (steel)")).toBe("acoustic");
    expect(instrumentFamily("guitar")).toBe("electric");
    expect(instrumentFamily("Distortion Guitar")).toBe("electric");
    expect(instrumentFamily("Banjo")).toBe("other");
  });

  it("labels the families and leaves unknown names alone", () => {
    expect(instrumentLabel("bass-guitar")).toBe("Bass");
    expect(instrumentLabel("acoustic-guitar")).toBe("Acoustic guitar");
    expect(instrumentLabel("guitar")).toBe("Electric guitar");
    expect(instrumentLabel("Banjo")).toBe("Banjo");
  });
});
