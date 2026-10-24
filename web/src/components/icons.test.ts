import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(svelte|ts)$/.test(entry) && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

const iconSource = readFileSync(join(SRC, "components/Icon.svelte"), "utf8");
const defined = new Set(
  [...iconSource.slice(0, iconSource.indexOf("const FILLED")).matchAll(/^ {4}(\w+):/gm)].map(
    (m) => m[1],
  ),
);

describe("icon names", () => {
  it("finds the defined icons", () => {
    expect(defined.has("close")).toBe(true);
    expect(defined.size).toBeGreaterThan(40);
  });

  it("only uses names that exist in PATHS", () => {
    const missing: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      const used = [
        ...text.matchAll(/<Icon\s[^>]*?\bname="([^"{}]+)"/g),
        ...text.matchAll(/\bicon:\s*"([^"]+)"/g),
      ];
      for (const m of used) {
        if (!defined.has(m[1])) missing.push(`${file.slice(SRC.length + 1)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
