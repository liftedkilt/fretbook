import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const appCss = readFileSync(join(SRC, "app.css"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(css|svelte)$/.test(entry.name) ? [path] : [];
  });
}

const sources = sourceFiles(SRC).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

const TOKENS = [
  "--sp-1",
  "--sp-2",
  "--sp-3",
  "--sp-4",
  "--sp-5",
  "--sp-6",
  "--sp-7",
  "--sp-8",
  "--r-xs",
  "--r-sm",
  "--r-md",
  "--r-lg",
  "--r-pill",
  "--fs-display",
  "--fs-title",
  "--fs-h2",
  "--fs-h3",
  "--fs-body",
  "--fs-sm",
  "--fs-xs",
  "--fs-eyebrow",
  "--fs-hero-num",
  "--grade-hit",
  "--grade-early",
  "--grade-late",
  "--grade-miss",
  "--heat-0",
  "--heat-1",
  "--heat-2",
  "--heat-3",
  "--heat-4",
  "--page-narrow",
  "--page",
  "--page-wide",
];

describe("design tokens", () => {
  it("defines the spacing, radius, type, grade, heat and page tokens", () => {
    for (const token of TOKENS) {
      expect(appCss, token).toContain(`${token}:`);
    }
  });

  it("drops the tools-page aliases and the extra radius", () => {
    expect(appCss).not.toMatch(/--border\s*:/);
    expect(appCss).not.toMatch(/--radius\s*:/);
    expect(appCss).not.toMatch(/--radius-lg\s*:/);
    expect(appCss).not.toMatch(/--r-xl\s*:/);
    for (const { path, text } of sources) {
      expect(text, path).not.toContain("var(--border");
      expect(text, path).not.toContain("var(--radius");
      expect(text, path).not.toContain("var(--r-xl");
    }
  });

  it("keeps raw px out of border-radius in app.css", () => {
    const values = [...appCss.matchAll(/border-radius:\s*([^;]+)/g)].map((match) => match[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      const withoutTokens = value.replace(/var\(--[a-z0-9-]+\)/g, "");
      expect(withoutTokens, value).not.toMatch(/\d+px/);
    }
  });
});
