import { documentFromGuitarPro } from "./alphatab/importScore";
import type { GpWorkerRequest, GpWorkerResponse } from "./gpWorker";

export interface ParsedGuitarPro {
  title: string;
  artist: string;
  document: ReturnType<typeof documentFromGuitarPro>["document"];
}

interface PendingTask {
  id: string;
  buffer: ArrayBuffer;
  family: "bass" | "guitar" | null;
  resolve: (value: ParsedGuitarPro) => void;
  reject: (reason?: unknown) => void;
}

export class GuitarProWorkerPool {
  private maxConcurrency: number;
  private activeWorkers = 0;
  private queue: PendingTask[] = [];
  private taskCounter = 0;

  constructor(maxConcurrency = 2) {
    this.maxConcurrency = maxConcurrency;
  }

  public async parse(
    data: Uint8Array | ArrayBuffer,
    family: "bass" | "guitar" | null = null,
  ): Promise<ParsedGuitarPro> {
    const buffer =
      data instanceof Uint8Array
        ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
        : (data as ArrayBuffer);

    // Direct fallback for test environments or environments without Worker support
    if (typeof Worker === "undefined") {
      return documentFromGuitarPro(new Uint8Array(buffer), family);
    }

    return new Promise<ParsedGuitarPro>((resolve, reject) => {
      const task: PendingTask = {
        id: `gp-task-${++this.taskCounter}`,
        buffer,
        family,
        resolve,
        reject,
      };
      this.queue.push(task);
      this.processNext();
    });
  }

  private processNext(): void {
    if (this.activeWorkers >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeWorkers++;
    const worker = new Worker(new URL("./gpWorker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (event: MessageEvent<GpWorkerResponse>) => {
      const msg = event.data;
      if (msg.id === task.id) {
        worker.terminate();
        this.activeWorkers--;
        if (msg.ok) {
          task.resolve(msg.result);
        } else {
          task.reject(new Error(msg.error));
        }
        this.processNext();
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      this.activeWorkers--;
      task.reject(err);
      this.processNext();
    };

    const req: GpWorkerRequest = {
      id: task.id,
      buffer: task.buffer,
      family: task.family,
    };
    worker.postMessage(req, [task.buffer]);
  }
}

export const gpWorkerPool = new GuitarProWorkerPool(2);

export async function parseGuitarProWithWorker(
  data: Uint8Array | ArrayBuffer,
  family: "bass" | "guitar" | null = null,
): Promise<ParsedGuitarPro> {
  return gpWorkerPool.parse(data, family);
}
