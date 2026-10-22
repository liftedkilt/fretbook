import type {
  ErrorDetail,
  ImportPreview as ContractImportPreview,
  Job as ContractJob,
  JobAccepted,
  Me as ContractMe,
  Meta as ContractMeta,
  Settings as ContractSettings,
  SongDetail as ContractSongDetail,
  SongSummary as ContractSongSummary,
} from "./api-types";
import { keyed } from "./i18n.svelte";
import type { ImportPreview, Job, Keyed, Me, Meta, ScoreDocument, Settings, SongDetail, SongSummary } from "./types";

/** Flat contract responses must be usable as the UI models in `./types`. */
type AssertAssignable<From extends To, To> = true;
type _matchesContract = [
  AssertAssignable<ContractMe, Me>,
  AssertAssignable<ContractMeta, Meta>,
  AssertAssignable<ContractSettings, Settings>,
  AssertAssignable<ContractSongSummary, SongSummary>,
  AssertAssignable<ContractImportPreview, ImportPreview>,
];

// Score documents and jobs are parsed as the contract types, then viewed through
// `./types`. Nested score fields with defaults are optional in OpenAPI and required
// on the hand-written model, so those two are not the same type.
function view<Ui>(body: Promise<unknown>): Promise<Ui> {
  return body as Promise<Ui>;
}

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
    if (detail && typeof detail === "object" && !Array.isArray(detail) && "message" in detail && "key" in detail) {
      const item = detail as ErrorDetail;
      const params = (item.params ?? {}) as Keyed["params"];
      return new ApiError(response.status, keyed({ key: item.key, message: item.message, params }), item.key, params);
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
  return request<ContractMeta>("/api/meta");
}

export function getMe(): Promise<Me> {
  return request<ContractMe>("/api/me");
}

export function saveSettings(settings: Settings): Promise<Settings> {
  return request<ContractSettings>("/api/me/settings", json("PUT", settings));
}

export function listSongs(): Promise<SongSummary[]> {
  return request<ContractSongSummary[]>("/api/songs");
}

export function getSong(id: string): Promise<SongDetail> {
  return view(request<ContractSongDetail>(`/api/songs/${id}`));
}

export function createTab(body: {
  title: string;
  artist: string;
  preset: string;
  bpm: number;
  measures: number;
  signature: [number, number];
}): Promise<SongDetail> {
  return view(request<ContractSongDetail>("/api/songs", json("POST", { content_kind: "tab", ...body })));
}

/** `chordpro` may be ChordPro or a pasted chords-over-lyrics sheet; the server converts. */
export function createChordSheet(body: { title: string; artist: string; chordpro: string }): Promise<SongDetail> {
  return view(request<ContractSongDetail>("/api/songs", json("POST", { content_kind: "chords", ...body })));
}

/** Rejected with a 409 `song.conflict` when the song changed since `revision`. */
export function updateSong(
  id: string,
  body: { title: string; artist: string; revision: number; document?: ScoreDocument; chordpro?: string },
): Promise<SongDetail> {
  return view(request<ContractSongDetail>(`/api/songs/${id}`, json("PUT", body)));
}

export function patchSync(id: string, body: { bpm: number; anchors: Record<string, number> }): Promise<SongDetail> {
  return view(request<ContractSongDetail>(`/api/songs/${id}/sync`, json("PATCH", body)));
}

export function deleteSong(id: string): Promise<void> {
  return request(`/api/songs/${id}`, { method: "DELETE" });
}

export function uploadAudio(id: string, file: File): Promise<SongDetail> {
  const data = new FormData();
  data.append("file", file);
  return view(request<ContractSongDetail>(`/api/songs/${id}/audio`, { method: "POST", body: data }));
}

export function previewImport(url: string): Promise<ImportPreview> {
  return request<ContractImportPreview>("/api/imports/preview", json("POST", { url }));
}

export function importUrl(url: string, videoId: string, partIds?: number[] | null): Promise<JobAccepted> {
  const body: { url: string; video_id: string | null; part_ids?: number[] } = { url, video_id: videoId || null };
  if (partIds && partIds.length) body.part_ids = partIds;
  return request<JobAccepted>("/api/imports", json("POST", body));
}

export function importFile(file: File): Promise<JobAccepted> {
  const data = new FormData();
  data.append("file", file);
  return request<JobAccepted>("/api/imports/file", { method: "POST", body: data });
}

export function importDocument(body: {
  title: string;
  artist: string;
  source_kind: string;
  document: ScoreDocument;
}): Promise<SongDetail> {
  return view(request<ContractSongDetail>("/api/songs/import-document", json("POST", body)));
}

export function getJob(id: string): Promise<Job> {
  return view(request<ContractJob>(`/api/jobs/${id}`));
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
