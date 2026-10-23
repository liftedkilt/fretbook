import { gpWorkerPool, type ParsedGuitarPro } from "./gpWorkerPool";

export type ParsedGpResult = ParsedGuitarPro;
export const MAX_GP_CONCURRENCY = 2;

export const gpQueue = {
  parse(buffer: ArrayBuffer, family: "bass" | "guitar" | null = null): Promise<ParsedGpResult> {
    return gpWorkerPool.parse(buffer, family);
  },
  async parseFile(file: File, family: "bass" | "guitar" | null = null): Promise<ParsedGpResult> {
    const buffer = await file.arrayBuffer();
    return gpWorkerPool.parse(buffer, family);
  },
};
