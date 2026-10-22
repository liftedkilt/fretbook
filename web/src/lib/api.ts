import type { Job, Meta, ScoreDocument, SongDetail, SongSummary } from "./types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function apiUrl(path: string): string {
  return new URL(path.replace(/^\//, ""), document.baseURI).toString();
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) return String(item.msg);
          return JSON.stringify(item);
        })
        .join("; ");
    }
  } catch {
    /* response was not JSON */
  }
  return response.statusText || `HTTP ${response.status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getMeta(): Promise<Meta> {
  return request("/api/meta");
}

export function listSongs(): Promise<SongSummary[]> {
  return request("/api/songs");
}

export function getSong(id: string): Promise<SongDetail> {
  return request(`/api/songs/${id}`);
}

export function createSong(body: {
  title: string;
  artist: string;
  preset: string;
  bpm: number;
  measures: number;
  signature: [number, number];
}): Promise<SongDetail> {
  return request("/api/songs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateSong(
  id: string,
  body: { title: string; artist: string; document: ScoreDocument },
): Promise<SongDetail> {
  return request(`/api/songs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patchSync(
  id: string,
  body: { bpm: number; anchors: Record<string, number> },
): Promise<SongDetail> {
  return request(`/api/songs/${id}/sync`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  return request("/api/imports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, video_id: videoId || null }),
  });
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
  return request("/api/songs/import-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getJob(id: string): Promise<Job> {
  return request(`/api/jobs/${id}`);
}

export async function waitForJob(id: string): Promise<Job> {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const job = await getJob(id);
    if (job.status === "done" || job.status === "error") return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new ApiError(408, "import timed out");
}
