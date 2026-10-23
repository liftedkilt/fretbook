import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GuitarProWorkerPool, parseGuitarProWithWorker } from "./gpWorkerPool";

const root = process.cwd().endsWith("/web") ? resolve(process.cwd(), "..") : process.cwd();
const corpus = join(root, "tests/fixtures/corpus/");

function load(path: string): Uint8Array {
  return new Uint8Array(readFileSync(corpus + path));
}

describe("GuitarProWorkerPool", () => {
  it("parses a Guitar Pro file using fallback", async () => {
    const bytes = load("gp/riff.gp5");
    const result = await parseGuitarProWithWorker(bytes, "bass");
    expect(result.document).toBeDefined();
    expect(result.document.bars.length).toBeGreaterThan(0);
    expect(result.document.tracks.length).toBeGreaterThan(0);
  });

  it("handles bounded concurrency queue", async () => {
    const pool = new GuitarProWorkerPool(2);
    const bytes = load("gp/riff.gp5");

    const promises = [
      pool.parse(bytes, "bass"),
      pool.parse(bytes.buffer as ArrayBuffer, "bass"),
      pool.parse(bytes, "bass"),
      pool.parse(bytes, "bass"),
    ];

    const results = await Promise.all(promises);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.document).toBeDefined();
    }
  });

  describe("when Worker is supported", () => {
    class FakeWorker {
      static instances: FakeWorker[] = [];
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: ((err: unknown) => void) | null = null;
      lastMessage!: { id: string; buffer: ArrayBuffer; family: "bass" | "guitar" | null };
      terminated = false;

      constructor(
        public url: URL | string,
        public options?: WorkerOptions,
      ) {
        FakeWorker.instances.push(this);
      }

      postMessage(data: { id: string; buffer: ArrayBuffer; family: "bass" | "guitar" | null }) {
        this.lastMessage = data;
      }

      terminate() {
        this.terminated = true;
      }
    }

    const originalWorker = globalThis.Worker;

    beforeEach(() => {
      FakeWorker.instances = [];
      globalThis.Worker = FakeWorker as unknown as typeof Worker;
    });

    afterEach(() => {
      if (originalWorker) {
        globalThis.Worker = originalWorker;
      } else {
        delete (globalThis as Record<string, unknown>).Worker;
      }
    });

    it("delegates to Web Worker and resolves successfully", async () => {
      const pool = new GuitarProWorkerPool(2);
      const parsePromise = pool.parse(new ArrayBuffer(10), "guitar");

      expect(FakeWorker.instances).toHaveLength(1);
      const worker = FakeWorker.instances[0];
      expect(worker.lastMessage?.family).toBe("guitar");

      const fakeResult = {
        title: "Worker Title",
        artist: "Worker Artist",
        document: {
          bars: [],
          tracks: [],
          bpm: 120,
          version: 1,
          sync: { video_id: null, points: [], anchors: {} },
        },
      };

      worker.onmessage?.({
        data: { id: worker.lastMessage!.id, ok: true, result: fakeResult },
      } as MessageEvent);

      const res = await parsePromise;
      expect(res.title).toBe("Worker Title");
      expect(worker.terminated).toBe(true);
    });

    it("handles worker error response (ok: false)", async () => {
      const pool = new GuitarProWorkerPool(2);
      const parsePromise = pool.parse(new ArrayBuffer(10), "bass");

      const worker = FakeWorker.instances[0];
      worker.onmessage?.({
        data: { id: worker.lastMessage!.id, ok: false, error: "Parsing corrupt data" },
      } as MessageEvent);

      await expect(parsePromise).rejects.toThrow("Parsing corrupt data");
      expect(worker.terminated).toBe(true);
    });

    it("handles worker onerror event", async () => {
      const pool = new GuitarProWorkerPool(2);
      const parsePromise = pool.parse(new ArrayBuffer(10), "bass");

      const worker = FakeWorker.instances[0];
      worker.onerror?.(new Error("Worker thread failed"));

      await expect(parsePromise).rejects.toThrow("Worker thread failed");
      expect(worker.terminated).toBe(true);
    });

    it("queues requests when concurrency limit is reached", async () => {
      const pool = new GuitarProWorkerPool(1);
      const p1 = pool.parse(new ArrayBuffer(10), "bass");
      const p2 = pool.parse(new ArrayBuffer(10), "guitar");

      expect(FakeWorker.instances).toHaveLength(1);
      const w1 = FakeWorker.instances[0];

      const fakeResult = {
        title: "T",
        artist: "A",
        document: {
          bars: [],
          tracks: [],
          bpm: 120,
          version: 1,
          sync: { video_id: null, points: [], anchors: {} },
        },
      };

      // Resolve w1
      w1.onmessage?.({
        data: { id: w1.lastMessage!.id, ok: true, result: fakeResult },
      } as MessageEvent);
      await p1;

      // Now second worker is spawned
      expect(FakeWorker.instances).toHaveLength(2);
      const w2 = FakeWorker.instances[1];
      w2.onmessage?.({
        data: { id: w2.lastMessage!.id, ok: true, result: fakeResult },
      } as MessageEvent);
      await p2;
    });
  });
});
