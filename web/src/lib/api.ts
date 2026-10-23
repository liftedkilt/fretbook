import type {
  AdminUser as ContractAdminUser,
  ApiToken,
  ApiTokenCreated,
  AsciiTabBody,
  AsciiTabPreview as ContractAsciiTabPreview,
  AudioCalibration as ContractAudioCalibration,
  AudioCalibrationBody as ContractAudioCalibrationBody,
  AutoImportAccepted,
  BulkImportAccepted as ContractBulkImportAccepted,
  ErrorDetail,
  ImportPreview as ContractImportPreview,
  Job as ContractJob,
  JobAccepted,
  Me as ContractMe,
  Meta as ContractMeta,
  SessionsEnded,
  SetlistDetail as ContractSetlistDetail,
  SetlistSummary as ContractSetlistSummary,
  Settings as ContractSettings,
  SongDetail as ContractSongDetail,
  SongPage as ContractSongPage,
  SongSummary as ContractSongSummary,
  SongsMoved,
  SongTags as ContractSongTags,
  TagCount as ContractTagCount,
  TagsAdded,
} from "./api-types";
import { keyed } from "./i18n.svelte";
import { currentPath } from "./router.svelte";
import { songsPath } from "./songQuery";
import type {
  AdminUser,
  AsciiTabPreview,
  AudioCalibration,
  AudioCalibrationBody,
  BulkImportAccepted,
  DuplicateAction,
  ImportPreview,
  Job,
  Keyed,
  Me,
  Meta,
  ScoreDocument,
  Settings,
  SetlistDetail,
  SetlistEntryDraft,
  SetlistSummary,
  SongDetail,
  SongPage,
  SongQuery,
  SongSummary,
  TagCount,
} from "./types";

/** Flat contract responses must be usable as the UI models in `./types`. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `From` is only checked by the constraint
type AssertAssignable<From extends To, To> = true;
type _matchesContract = [
  AssertAssignable<ContractMe, Me>,
  AssertAssignable<ContractMeta, Meta>,
  AssertAssignable<ContractSettings, Settings>,
  AssertAssignable<ContractSongSummary, SongSummary>,
  AssertAssignable<ContractSongPage, SongPage>,
  AssertAssignable<ContractTagCount, TagCount>,
  AssertAssignable<ContractImportPreview, ImportPreview>,
  AssertAssignable<ContractAdminUser, AdminUser>,
  AssertAssignable<ContractAudioCalibration, AudioCalibration>,
  AssertAssignable<ContractAudioCalibrationBody, AudioCalibrationBody>,
  AssertAssignable<ContractSetlistSummary, SetlistSummary>,
  AssertAssignable<ContractSetlistDetail, SetlistDetail>,
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

  constructor(
    status: number,
    message: string,
    key = "",
    params: Record<string, string | number> = {},
  ) {
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
    if (
      detail &&
      typeof detail === "object" &&
      !Array.isArray(detail) &&
      "message" in detail &&
      "key" in detail
    ) {
      const item = detail as ErrorDetail;
      const params = (item.params ?? {}) as Keyed["params"];
      return new ApiError(
        response.status,
        keyed({ key: item.key, message: item.message, params }),
        item.key,
        params,
      );
    }
    if (typeof detail === "string") return new ApiError(response.status, detail);
    if (Array.isArray(detail)) {
      const text = detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            const loc = Array.isArray(item.loc)
              ? item.loc.filter((part: unknown) => part !== "body").join(".")
              : "";
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

/** Where a signed-out browser goes to sign in, returning to the current page afterwards. */
export function loginUrl(): string {
  return `${apiUrl("/auth/login")}?next=${encodeURIComponent(currentPath().slice(1) + location.search)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    const error = await toError(response);
    // Only OIDC mode answers 401: the session ended, so sign in again.
    if (error.status === 401 && error.key === "auth.required") location.assign(loginUrl());
    throw error;
  }
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

export function listCalibrations(): Promise<AudioCalibration[]> {
  return request<ContractAudioCalibration[]>("/api/me/calibrations");
}

export function getCalibration(
  outputDevice = "default",
  inputDevice = "default",
): Promise<AudioCalibration | null> {
  const params = new URLSearchParams({ output_device: outputDevice, input_device: inputDevice });
  return request<ContractAudioCalibration | null>(`/api/me/calibration?${params.toString()}`);
}

export function saveCalibration(body: AudioCalibrationBody): Promise<AudioCalibration> {
  return request<ContractAudioCalibration>("/api/me/calibration", json("PUT", body));
}

export function deleteCalibration(
  outputDevice = "default",
  inputDevice = "default",
): Promise<void> {
  const params = new URLSearchParams({ output_device: outputDevice, input_device: inputDevice });
  return request<void>(`/api/me/calibration?${params.toString()}`, { method: "DELETE" });
}

/** One page of the library. */
export function listSongs(query: SongQuery = {}): Promise<SongPage> {
  return request<ContractSongPage>(songsPath(query));
}

/** Record that the song was opened, for the "last opened" sort. */
export function markSongOpened(id: string): Promise<void> {
  return request(`/api/songs/${id}/opened`, { method: "POST" });
}

/** Every tag on the caller's songs with its song count, most used first. */
export function listTags(): Promise<TagCount[]> {
  return request<ContractTagCount[]>("/api/tags");
}

/** Replace the song's tags. Resolves to the tags as stored: trimmed, without repeats, sorted. */
export async function setSongTags(id: string, tags: string[]): Promise<string[]> {
  const body = await request<ContractSongTags>(`/api/songs/${id}/tags`, json("PUT", { tags }));
  return body.tags;
}

/** Add tags to many songs at once. Resolves to how many songs were updated. */
export async function addTags(songIds: string[], tags: string[]): Promise<number> {
  const body = await request<TagsAdded>("/api/tags/add", json("POST", { song_ids: songIds, tags }));
  return body.updated;
}

/** The caller's personal API tokens, newest first. Never includes the secrets. */
export function listApiTokens(): Promise<ApiToken[]> {
  return request<ApiToken[]>("/api/tokens");
}

/** Make a token. The `token` secret is in this response only. */
export function createApiToken(
  name: string,
  expiresInDays: number | null,
): Promise<ApiTokenCreated> {
  return request<ApiTokenCreated>(
    "/api/tokens",
    json("POST", { name, expires_in_days: expiresInDays }),
  );
}

export function revokeApiToken(id: string): Promise<void> {
  return request<void>(`/api/tokens/${id}`, { method: "DELETE" });
}

export async function setFavourite(id: string, favourite: boolean): Promise<boolean> {
  const body = await request<{ favourite: boolean }>(
    `/api/songs/${id}/favourite`,
    json("PUT", { favourite }),
  );
  return body.favourite;
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
  return view(
    request<ContractSongDetail>("/api/songs", json("POST", { content_kind: "tab", ...body })),
  );
}

/** `chordpro` may be ChordPro or a pasted chords-over-lyrics sheet; the server converts. */
export function createChordSheet(body: {
  title: string;
  artist: string;
  chordpro: string;
}): Promise<SongDetail> {
  return view(
    request<ContractSongDetail>("/api/songs", json("POST", { content_kind: "chords", ...body })),
  );
}

/** Rejected with a 409 `song.conflict` when the song changed since `revision`. */
export function updateSong(
  id: string,
  body: {
    title: string;
    artist: string;
    revision: number;
    document?: ScoreDocument;
    chordpro?: string;
  },
): Promise<SongDetail> {
  return view(request<ContractSongDetail>(`/api/songs/${id}`, json("PUT", body)));
}

export function patchSync(
  id: string,
  body: { bpm: number; anchors: Record<string, number> },
): Promise<SongDetail> {
  return view(request<ContractSongDetail>(`/api/songs/${id}/sync`, json("PATCH", body)));
}

export function deleteSong(id: string): Promise<void> {
  return request(`/api/songs/${id}`, { method: "DELETE" });
}

export function listSetlists(): Promise<SetlistSummary[]> {
  return request<ContractSetlistSummary[]>("/api/setlists");
}

export function getSetlist(id: string): Promise<SetlistDetail> {
  return request<ContractSetlistDetail>(`/api/setlists/${id}`);
}

export function createSetlist(name: string): Promise<SetlistDetail> {
  return request<ContractSetlistDetail>("/api/setlists", json("POST", { name }));
}

export function renameSetlist(id: string, name: string): Promise<SetlistDetail> {
  return request<ContractSetlistDetail>(`/api/setlists/${id}`, json("PATCH", { name }));
}

/** Save the whole running order: the list sent is the list kept. */
export function saveSetlistEntries(
  id: string,
  entries: SetlistEntryDraft[],
): Promise<SetlistDetail> {
  return request<ContractSetlistDetail>(`/api/setlists/${id}/entries`, json("PUT", { entries }));
}

export function deleteSetlist(id: string): Promise<void> {
  return request(`/api/setlists/${id}`, { method: "DELETE" });
}

export function uploadAudio(id: string, file: File): Promise<SongDetail> {
  const data = new FormData();
  data.append("file", file);
  return view(
    request<ContractSongDetail>(`/api/songs/${id}/audio`, { method: "POST", body: data }),
  );
}

export function previewImport(url: string): Promise<ImportPreview> {
  return request<ContractImportPreview>("/api/imports/preview", json("POST", { url }));
}

export function importUrl(
  url: string,
  videoId: string,
  partIds?: number[] | null,
): Promise<JobAccepted> {
  const body: { url: string; video_id: string | null; part_ids?: number[] } = {
    url,
    video_id: videoId || null,
  };
  if (partIds && partIds.length) body.part_ids = partIds;
  return request<JobAccepted>("/api/imports", json("POST", body));
}

export function importFile(file: File): Promise<JobAccepted> {
  const data = new FormData();
  data.append("file", file);
  return request<JobAccepted>("/api/imports/file", { method: "POST", body: data });
}

/** Queue an import of whatever was dropped, pasted or linked. Send exactly one of `file`, `text` or `url`. */
export function importAuto(input: {
  file?: File;
  text?: string;
  url?: string;
}): Promise<AutoImportAccepted> {
  const data = new FormData();
  if (input.file) data.append("file", input.file);
  if (input.text) data.append("text", input.text);
  if (input.url) data.append("url", input.url);
  return request<AutoImportAccepted>("/api/imports/auto", { method: "POST", body: data });
}

/** Queue a restore of a library archive into the signed-in user's library. */
export function importLibrary(file: File, mode: "skip" | "copy"): Promise<JobAccepted> {
  const data = new FormData();
  data.append("file", file);
  data.append("mode", mode);
  return request<JobAccepted>("/api/library/import", { method: "POST", body: data });
}

/** Convert pasted tab (or chords over lyrics) without saving it. */
export function previewAsciiTab(
  body: AsciiTabBody,
  signal?: AbortSignal,
): Promise<AsciiTabPreview> {
  return view(
    request<ContractAsciiTabPreview>("/api/imports/ascii-tab/preview", {
      ...json("POST", body),
      signal,
    }),
  );
}

/** Save pasted tab as a song. Chords over lyrics are saved as a chord sheet. */
export function importAsciiTab(body: AsciiTabBody): Promise<SongDetail> {
  return view(request<ContractSongDetail>("/api/imports/ascii-tab", json("POST", body)));
}

export function importDocument(body: {
  title: string;
  artist: string;
  source_kind: string;
  document: ScoreDocument;
  on_duplicate?: DuplicateAction;
  tags?: string[];
}): Promise<SongDetail> {
  return view(request<ContractSongDetail>("/api/songs/import-document", json("POST", body)));
}

export function importBulk(
  files: File[],
  duplicates: DuplicateAction = "skip",
  tags?: string,
): Promise<BulkImportAccepted> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  form.set("duplicates", duplicates);
  if (tags) form.set("tags", tags);
  return request<ContractBulkImportAccepted>("/api/imports/bulk", {
    method: "POST",
    body: form,
  });
}

export function listJobs(status?: "queued" | "running" | "done" | "error"): Promise<Job[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return view(request<ContractJob[]>(`/api/jobs${query}`));
}

export function getJob(id: string): Promise<Job> {
  return view(request<ContractJob>(`/api/jobs/${id}`));
}

export function retryJob(id: string): Promise<JobAccepted> {
  return request<JobAccepted>(`/api/jobs/${id}/retry`, { method: "POST" });
}

export function dismissJob(id: string): Promise<void> {
  return request<void>(`/api/jobs/${id}`, { method: "DELETE" });
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

export function listUsers(): Promise<AdminUser[]> {
  return request<ContractAdminUser[]>("/api/admin/users");
}

export function signOutUser(id: string): Promise<SessionsEnded> {
  return request(`/api/admin/users/${id}/sign-out`, { method: "POST" });
}

/** Moves the single-user library into the signed-in admin's own. */
export function adoptLocal(): Promise<SongsMoved> {
  return request("/api/admin/adopt-local", { method: "POST" });
}
