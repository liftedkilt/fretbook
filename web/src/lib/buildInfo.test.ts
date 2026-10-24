import { describe, expect, it } from "vitest";
import { nodeVersion } from "./buildInfo";

describe("buildInfo", () => {
  it("is a string, empty when the build did not inject a Node version", () => {
    expect(typeof nodeVersion).toBe("string");
  });
});
