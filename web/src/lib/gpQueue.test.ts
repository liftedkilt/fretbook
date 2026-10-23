import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gpQueue } from "./gpQueue";

const root = process.cwd().endsWith("/web") ? resolve(process.cwd(), "..") : process.cwd();
const corpus = join(root, "tests/fixtures/corpus/");

function load(path: string): Uint8Array {
  return new Uint8Array(readFileSync(corpus + path));
}

describe("gpQueue", () => {
  it("parses Guitar Pro files via queue", async () => {
    const bytes = load("gp/riff.gp5");
    const result = await gpQueue.parse(bytes.buffer as ArrayBuffer, "bass");
    expect(result.document).toBeDefined();
    expect(result.document.bars.length).toBeGreaterThan(0);
  });

  it("handles concurrent requests within limits", async () => {
    const bytes = load("gp/riff.gp4");
    const promises = Array.from({ length: 5 }, () =>
      gpQueue.parse(bytes.slice().buffer as ArrayBuffer, "bass"),
    );
    const results = await Promise.all(promises);
    expect(results.length).toBe(5);
    for (const res of results) {
      expect(res.document.bars.length).toBeGreaterThan(0);
    }
  });

  it("handles parse error gracefully", async () => {
    const badBytes = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(gpQueue.parse(badBytes.buffer as ArrayBuffer, "bass")).rejects.toThrow();
  });

  it("parses File objects via parseFile", async () => {
    const bytes = load("gp/riff.gp5");
    const file = new File([bytes.buffer as ArrayBuffer], "riff.gp5");
    const result = await gpQueue.parseFile(file, "bass");
    expect(result.document).toBeDefined();
    expect(result.document.bars.length).toBeGreaterThan(0);
  });
});
