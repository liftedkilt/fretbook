import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository root (this file is web/e2e/support/paths.ts). */
export const repoRoot = path.resolve(here, "../../..");
export const distDir = path.join(repoRoot, "web", "dist");
export const fixturesDir = path.join(repoRoot, "tests", "fixtures", "e2e");

export function fixture(name: string): string {
  return path.join(fixturesDir, name);
}

/** The Python that runs `python -m fretbook`: $FRETBOOK_E2E_PYTHON, else the repo's .venv, else `python3` on PATH. */
export function pythonCommand(): string {
  if (process.env.FRETBOOK_E2E_PYTHON) return process.env.FRETBOOK_E2E_PYTHON;
  const venv = path.join(repoRoot, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}
