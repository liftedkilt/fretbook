import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EDITOR_DURATIONS } from "./durations";
import { DIRECTIONS } from "./playback";

// Read with fs, not `import.meta.glob(..., { query: "?raw" })`: Vitest's v8 coverage strips the query from
// module ids, so a `?raw` copy of a file (one `export default "<source>"` statement) can replace the real
// module's transform when coverage is remapped, which randomly drops that file's coverage.
const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const sources: Record<string, string> = Object.fromEntries(
  sourceFiles(SRC).map((path) => [path, readFileSync(path, "utf8")]),
);

const localeFiles = import.meta.glob<Record<string, unknown>>("../locales/*.json", {
  eager: true,
  import: "default",
});

function messageKeys(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return prefix ? [prefix] : [];
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  const record = node as Record<string, unknown>;
  if (typeof record.other === "string") return prefix ? [prefix] : [];
  return Object.entries(record).flatMap(([key, value]) =>
    messageKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

function has(catalog: unknown, key: string): boolean {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") return true;
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as { other?: unknown }).other === "string"
  );
}

function nodeAt(catalog: unknown, key: string): unknown {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function placeholders(node: unknown): string[] {
  const texts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (value && typeof value === "object")
      for (const child of Object.values(value)) walk(child);
  };
  walk(node);
  return [
    ...new Set(
      texts.flatMap((text) => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1])),
    ),
  ].sort();
}

function nearestEach(source: string, index: number, variable: string): string[] | null {
  const pattern = new RegExp(
    `\\{#each\\s+\\[([^\\]]+)\\]\\s+as\\s+(?:const\\s+as\\s+)?${variable}\\b`,
    "g",
  );
  let items: string[] | null = null;
  for (const match of source.matchAll(pattern)) {
    if (match.index !== undefined && match.index < index) {
      items = [...match[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((item) => item[1]);
    }
  }
  return items;
}

/** Keys passed to `t()` / `tOr()`, including `{#each}` lists interpolated into a template key. */
function usedKeys(): string[] {
  const keys = new Set<string>();
  for (const source of Object.values(sources)) {
    for (const match of source.matchAll(/\b(?:t|tOr)\(\s*["']([a-zA-Z0-9_.]+)["']/g))
      keys.add(match[1]);
    for (const match of source.matchAll(/labelKey:\s*["']([a-zA-Z0-9_.]+)["']/g))
      keys.add(match[1]);
    for (const match of source.matchAll(
      /\b(?:t|tOr)\(\s*`([a-zA-Z0-9_.]*)\$\{([A-Za-z_][A-Za-z0-9_.]*)\}`/g,
    )) {
      const prefix = match[1];
      const variable = match[2];
      if (prefix === "durations." && variable === "option.key") {
        for (const option of EDITOR_DURATIONS) keys.add(`durations.${option.key}`);
        continue;
      }
      if (prefix === "repeats.direction." && variable === "kind") {
        for (const direction of DIRECTIONS) keys.add(`repeats.direction.${direction}`);
        continue;
      }
      const items = nearestEach(source, match.index ?? 0, variable);
      if (!items?.length) throw new Error(`unresolved translation ${prefix}\${${variable}}`);
      for (const item of items) keys.add(`${prefix}${item}`);
    }
  }
  return [...keys];
}

describe("locale catalogs", () => {
  const files = Object.entries(localeFiles).map(([path, catalog]) => ({
    tag: path.match(/([^/]+)\.json$/)?.[1] ?? path,
    catalog,
  }));
  const english = files.find((file) => file.tag === "en");
  const used = usedKeys();

  it("registers every locale file in the switcher", () => {
    const i18n = Object.entries(sources).find(([path]) => path.endsWith("i18n.svelte.ts"))?.[1];
    expect(i18n).toBeTruthy();
    expect(files.map((file) => file.tag).sort()).toEqual(["en", "pt-BR"]);
    for (const file of files) {
      expect(i18n).toContain(`locales/${file.tag}.json`);
      expect(i18n).toMatch(new RegExp(`id:\\s*["']${file.tag}["']`));
    }
  });

  it("has every key the UI passes to t() in every locale", () => {
    expect(used.length).toBeGreaterThan(50);
    const missing = files.flatMap((file) =>
      used.filter((key) => !has(file.catalog, key)).map((key) => `${file.tag}: ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it("gives every locale the same keys and placeholders", () => {
    expect(english).toBeTruthy();
    const reference = messageKeys(english?.catalog).sort();
    expect(reference.length).toBeGreaterThan(used.length);
    const mismatches: string[] = [];
    for (const file of files) {
      const keys = messageKeys(file.catalog).sort();
      if (keys.join("\n") !== reference.join("\n")) {
        const missing = reference.filter((key) => !keys.includes(key));
        const extra = keys.filter((key) => !reference.includes(key));
        mismatches.push(`${file.tag} missing [${missing.join(", ")}] extra [${extra.join(", ")}]`);
      }
      for (const key of reference) {
        const left = placeholders(nodeAt(english?.catalog, key)).join(",");
        const right = placeholders(nodeAt(file.catalog, key)).join(",");
        if (left !== right) mismatches.push(`${file.tag} ${key}: {${left}} vs {${right}}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
