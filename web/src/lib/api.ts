import { keyed } from "./i18n.svelte";
import type { Job, Keyed, Me, Meta, ScoreDocument, Settings, SongDetail, SongSummary } from "./types";

export class ApiError extends Error {
  status: number;
  key: string;
  params: Record<string, string | number>;

  constructor(status: number, message: string, key = "", params: Record<string, string | number> = {}) {
    super(message);
    this.status = status;
    this.key = key;
    this.params = params;
  }
}

export function apiUrl(path: string): string {
  return new URL(path.replace(/^\//, ""), document.baseURI).toString();
}

async function toError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail) && "message" in detail) {
      const item = detail as Keyed;
      return new ApiError(response.status, keyed(item), item.key, item.params ?? {});
    }
    if (typeof detail === "string") return new ApiError(response.status, detail);
    if (Array.isArray(detail)) {
      const text = detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            const loc = Array.isArray(item.loc) ? item.loc.filter((part: unknown) => part !== "body").join(".") : "";
            return loc ? `${loc}: ${String(item.msg)}` : String(item.msg);
          }
          return JSON.stringify(item);
        })
        .join("; ");
      return new ApiError(response.status, text, "request.invalid");
    }
  } catch {
    /* response was not JSON */
  }
  return new ApiError(response.status, response.statusText || `HTTP ${response.status}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function getMeta(): Promise<Meta> {
  return request("/api/meta");
}

export function getMe(): Promise<Me> {
  return request("/api/me");
}

export function saveSettings(settings: Settings): Promise<Settings> {
  return request("/api/me/settings", json("PUT", settings));
}

export function listSongs(): Promise<SongSummary[]> {
  return request("/api/songs");
}

export function getSong(id: string): Promise<SongDetail> {
  return request(`/api/songs/${id}`);
}

export function createTab(body: {
  title: string;
  artist: string;
  preset: string;
  bpm: number;
  measures: number;
  signature: [number, number];
}): Promise<SongDetail> {
  return request("/api/songs", json("POST", { content_kind: "tab", ...body }));
}

/** `chordpro` may be ChordPro or a pasted chords-over-lyrics sheet; the server converts. */
export function createChordSheet(body: { title: string; artist: string; chordpro: string }): Promise<SongDetail> {
  return request("/api/songs", json("POST", { content_kind: "chords", ...body }));
}

/** Rejected with a 409 `song.conflict` when the song changed since `revision`. */
export function updateSong(
  id: string,
  body: { title: string; artist: string; revision: number; document?: ScoreDocument; chordpro?: string },
): Promise<SongDetail> {
  return request(`/api/songs/${id}`, json("PUT", body));
}

export function patchSync(id: string, body: { bpm: number; anchors: Record<string, number> }): Promise<SongDetail> {
  return request(`/api/songs/${id}/sync`, json("PATCH", body));
}

export function deleteSong(id: string): Promise<void> {
  return request(`/api/songs/${id}`, { method: "DELETE" });
}

export function uploadAudio(id: string, file: File): Promise<SongDetail> {
  const data = new FormData();
  data.append("file", file);
  return request(`/api/songs/${id}/audio`, { method: "POST", body: data });
}

export function importUrl(url: string, videoId: string): Promise<{ job_id: string }> {
  return request("/api/imports", json("POST", { url, video_id: videoId || null }));
}

export function importFile(file: File): Promise<{ job_id: string }> {
  const data = new FormData();
  data.append("file", file);
  return request("/api/imports/file", { method: "POST", body: data });
}

export function importDocument(body: {
  title: string;
  artist: string;
  source_kind: string;
  document: ScoreDocument;
}): Promise<SongDetail> {
  return request("/api/songs/import-document", json("POST", body));
}

export function getJob(id: string): Promise<Job> {
  return request(`/api/jobs/${id}`);
}

export async function waitForJob(id: string, onProgress?: (job: Job) => void): Promise<Job> {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const job = await getJob(id);
    if (job.status === "done" || job.status === "error") return job;
    onProgress?.(job);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new ApiError(408, "import timed out", "job.timeout");
}
