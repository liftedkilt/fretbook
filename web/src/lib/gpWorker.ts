import { documentFromGuitarPro } from "./alphatab/importScore";

export interface GpWorkerRequest {
  id: string;
  buffer: ArrayBuffer;
  family: "bass" | "guitar" | null;
}

export interface GpWorkerSuccess {
  id: string;
  ok: true;
  result: ReturnType<typeof documentFromGuitarPro>;
}

export interface GpWorkerFailure {
  id: string;
  ok: false;
  error: string;
}

export type GpWorkerResponse = GpWorkerSuccess | GpWorkerFailure;

self.onmessage = (event: MessageEvent<GpWorkerRequest>) => {
  const { id, buffer, family } = event.data;
  try {
    const bytes = new Uint8Array(buffer);
    const parsed = documentFromGuitarPro(bytes, family);
    const response: GpWorkerSuccess = { id, ok: true, result: parsed };
    self.postMessage(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const response: GpWorkerFailure = { id, ok: false, error: message };
    self.postMessage(response);
  }
};
