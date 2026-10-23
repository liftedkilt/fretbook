import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { distDir, pythonCommand, repoRoot } from "./paths";

export type RunningServer = {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  url: string;
  port: number;
  dataDir: string;
  stop: () => Promise<void>;
};

/** Ask the OS for a port nothing is listening on. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(
  url: string,
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `fretbook exited with code ${child.exitCode} before it was ready:\n${output()}`,
      );
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`fretbook did not answer ${url}/api/health within 30 s:\n${output()}`);
}

/**
 * Start `python -m fretbook` on a free port with an empty temporary data directory, serving the built web app.
 * `port` pins the port (from `freePort()`, when something else must know it first); `env` overrides or adds
 * FRETBOOK_* variables, such as the OIDC settings.
 */
export async function startServer(
  options: { port?: number; env?: Record<string, string> } = {},
): Promise<RunningServer> {
  if (process.env.FRETBOOK_TEST_URL) {
    const url = process.env.FRETBOOK_TEST_URL.replace(/\/$/, "");
    const parsed = new URL(url);
    const port = Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    return {
      url,
      port,
      dataDir: "",
      stop: async () => {},
    };
  }
  if (!existsSync(path.join(distDir, "index.html"))) {
    throw new Error(
      "web/dist is missing. Run `npm run build` in web/ before the e2e tests (`npm run e2e` does).",
    );
  }
  const port = options.port ?? (await freePort());
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "fretbook-e2e-"));
  const url = `http://127.0.0.1:${port}`;
  let log = "";
  const child = spawn(pythonCommand(), ["-m", "fretbook"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      FRETBOOK_HOST: "127.0.0.1",
      FRETBOOK_PORT: String(port),
      FRETBOOK_DATA_DIR: dataDir,
      FRETBOOK_STATIC_DIR: distDir,
      // The repo's `songs/` folder is for a developer's own library; tests start from an empty one.
      FRETBOOK_LEGACY_SONGS_DIR: "",
      FRETBOOK_DOWNLOAD_AUDIO: "0",
      FRETBOOK_AUTH_MODE: "single",
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));

  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    }
    await rm(dataDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(url, child, () => log);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, port, dataDir, stop };
}
