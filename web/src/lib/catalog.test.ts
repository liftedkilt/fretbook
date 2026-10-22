import { describe, expect, it } from "vitest";

import en from "../locales/en.json";

const sources = import.meta.glob<string>(["../**/*.svelte", "../**/*.ts", "!../**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function has(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || (typeof node === "object" && node !== null && "other" in node);
}

describe("English catalog", () => {
  it("has every key the UI passes to t()", () => {
    const keys = new Set<string>();
    for (const source of Object.values(sources)) {
      for (const match of source.matchAll(/\bt\("([a-zA-Z.]+)"/g)) keys.add(match[1]);
    }
    expect(keys.size).toBeGreaterThan(50);
    expect([...keys].filter((key) => !has(key))).toEqual([]);
  });
});
