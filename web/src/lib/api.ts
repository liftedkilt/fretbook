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
  ConvertBody,
  ConvertReport,
  ErrorDetail,
  ImportPreview as ContractImportPreview,
  Job as ContractJob,
  JobAccepted,
  MidiInspection,
  Me as ContractMe,
  Meta as ContractMeta,
  PracticeExerciseBody as ContractPracticeExerciseBody,
  PracticeGoal as ContractPracticeGoal,
  PracticeSession as ContractPracticeSession,
  PracticeSessionBody as ContractPracticeSessionBody,
  PracticeStats as ContractPracticeStats,
  Recommendations as ContractRecommendations,
  SessionsEnded,
  SetlistDetail as ContractSetlistDetail,
  SetlistSummary as ContractSetlistSummary,
  Settings as ContractSettings,
  StemList as ContractStemList,
  SongDetail as ContractSongDetail,
  SongPractice as ContractSongPractice,
  SongPage as ContractSongPage,
  SongSummary as ContractSongSummary,
  SongsMoved,
  SongTags as ContractSongTags,
  TagCount as ContractTagCount,
  TagsAdded,
  TagsChanged,
} from "./api-types";
import { keyed } from "./i18n.svelte";
import type { EditBase } from "./offline/merge";
import { dropEdit, queue, queueEdit, queueOp } from "./offline/queueState.svelte";
import { refreshSavedSong } from "./offline/store";
import type { MidiImportOptions } from "./midiImport";
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
  PracticeExerciseDraft,
  PracticeGoal,
  PracticeSession,
  PracticeSessionDraft,
  PracticeStats,
  Recommendations,
  ScoreDocument,
  Settings,
  SetlistDetail,
  SetlistEntryDraft,
  SetlistSummary,
  SongDetail,
  SongPage,
  SongQuery,
  SongPractice,
  SongSummary,
  TagCount,
  Track,
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
  AssertAssignable<ContractPracticeSession, PracticeSession>,
  AssertAssignable<ContractPracticeStats, PracticeStats>,
  AssertAssignable<ContractPracticeGoal, PracticeGoal>,
  AssertAssignable<ContractRecommendations, Recommendations>,
  AssertAssignable<ContractSongPractice, SongPractice>,
  // The draft is what the browser sends, so it must fit the request body.
  AssertAssignable<PracticeSessionDraft, ContractPracticeSessionBody>,
  AssertAssignable<PracticeExerciseDraft, ContractPracticeExerciseBody>,
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
export async function putSongTags(id: string, tags: string[]): Promise<string[]> {
  const body = await request<ContractSongTags>(`/api/songs/${id}/tags`, json("PUT", { tags }));
  return body.tags;
}

/** Like `putSongTags`, but with no network the change is queued and the tags are answered as asked for. */
export async function setSongTags(id: string, tags: string[]): Promise<string[]> {
  try {
    return await putSongTags(id, tags);
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    queueOp({ kind: "tags", songId: id, tags });
    return tags;
  }
}

/** Rename a tag on every song, or merge it into the tag that already has the new name. Resolves to the songs changed. */
export async function renameTag(tag: string, name: string): Promise<number> {
  const body = await request<TagsChanged>(
    `/api/tags/${encodeURIComponent(tag)}`,
    json("PATCH", { name }),
  );
  return body.updated;
}

/** Remove a tag from every song. Resolves to the songs changed. */
export async function deleteTag(tag: string): Promise<number> {
  const body = await request<TagsChanged>(`/api/tags/${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });
  return body.updated;
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

export async function putFavourite(id: string, favourite: boolean): Promise<boolean> {
  const body = await request<{ favourite: boolean }>(
    `/api/songs/${id}/favourite`,
    json("PUT", { favourite }),
  );
  return body.favourite;
}

/** Like `putFavourite`, but with no network the change is queued and answered as asked for. */
export async function setFavourite(id: string, favourite: boolean): Promise<boolean> {
  try {
    return await putFavourite(id, favourite);
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    queueOp({ kind: "favourite", songId: id, favourite });
    return favourite;
  }
}

/** The last version of each song this page saw, so an edit made offline can answer with the song it changed. */
const lastSeen = new Map<string, SongDetail>();

export async function getSong(id: string): Promise<SongDetail> {
  const song = await view<SongDetail>(request<ContractSongDetail>(`/api/songs/${id}`));
  lastSeen.set(id, song);
  return song;
}

/** A failed fetch (no network) or the service worker's answer for something it never saved. */
export function isOfflineError(error: unknown): boolean {
  return (
    error instanceof TypeError || (error instanceof ApiError && error.key === "offline.unavailable")
  );
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

type SongEdit = {
  title: string;
  artist: string;
  revision: number;
  document?: ScoreDocument;
  chordpro?: string;
};

/**
 * Revisions an open editor may still hold for a song, and the one they became when a queued edit was sent. Without
 * this the editor's next save would be refused as a conflict with the edit it made itself.
 */
const rebased = new Map<string, Map<number, number>>();

export function noteRebase(id: string, from: number, to: number): void {
  if (from === to) return;
  const known = rebased.get(id) ?? new Map<number, number>();
  known.set(from, to);
  rebased.set(id, known);
}

function currentRevision(id: string, revision: number): number {
  const known = rebased.get(id);
  let next = revision;
  for (let hops = 0; known?.has(next) && hops < 100; hops += 1) next = known.get(next)!;
  return next;
}

/** Send an edit now, with no offline fallback. Rejected with a 409 `song.conflict` when the song changed since `revision`. */
export async function putSong(id: string, body: SongEdit): Promise<SongDetail> {
  const saved = await view<SongDetail>(
    request<ContractSongDetail>(`/api/songs/${id}`, json("PUT", body)),
  );
  // Every save carries the whole song, so it replaces an edit still waiting to be sent.
  if (queue.edits.some((edit) => edit.songId === id)) dropEdit(id);
  lastSeen.set(id, saved);
  await refreshSavedSong(saved).catch(() => undefined);
  return saved;
}

/**
 * Save an edit. With no network the edit is queued on this device and answered as the song would look once saved
 * (same revision); `flushQueue` in `offline/offline.svelte.ts` sends it later under the usual revision rules.
 * Rejected with a 409 `song.conflict` when the song changed since `revision`.
 */
export async function updateSong(id: string, edit: SongEdit, base?: EditBase): Promise<SongDetail> {
  const body = { ...edit, revision: currentRevision(id, edit.revision) };
  try {
    return await putSong(id, body);
  } catch (error) {
    const seen = lastSeen.get(id);
    if (!isOfflineError(error) || !seen) throw error;
    queueEdit({
      songId: id,
      title: body.title,
      body,
      queuedAt: new Date().toISOString(),
      base,
      state: "pending",
      message: "",
    });
    const queued: SongDetail = {
      ...seen,
      title: body.title,
      artist: body.artist,
      document: body.document ?? seen.document,
      chordpro: body.chordpro ?? seen.chordpro,
    };
    lastSeen.set(id, queued);
    await refreshSavedSong(queued).catch(() => undefined);
    return queued;
  }
}

/** A conversion: the track as it would be saved, what changed, and the saved song for `add` and `replace`. */
export interface ConvertOutcome {
  track: Track;
  report: ConvertReport;
  song: SongDetail | null;
}

/** Transpose, retune or convert a track. A `preview` saves nothing; `add` and `replace` need the loaded revision. */
export function convertTrack(id: string, body: ConvertBody): Promise<ConvertOutcome> {
  return view(request<unknown>(`/api/songs/${id}/convert`, json("POST", body)));
}

/** Queue an estimate of the bar marks from the song's audio; wait for the job and read `result.autosync`. */
export function startAutoSync(id: string): Promise<JobAccepted> {
  return request<JobAccepted>(`/api/songs/${id}/autosync`, { method: "POST" });
}

/** The stems stored for a song, and whether a worker that can make them is running. */
export function getStems(id: string): Promise<ContractStemList> {
  return request<ContractStemList>(`/api/songs/${id}/stems`);
}

/** Queue a separation into stems; wait for the job, then read `getStems`. A new run replaces the old stems. */
export function startStems(
  id: string,
  model: "htdemucs_6s" | "htdemucs" = "htdemucs_6s",
): Promise<JobAccepted> {
  return request<JobAccepted>(`/api/songs/${id}/stems`, json("POST", { model }));
}

export function deleteStems(id: string): Promise<void> {
  return request(`/api/songs/${id}/stems`, { method: "DELETE" });
}

export async function sendSync(
  id: string,
  body: { bpm: number; anchors: Record<string, number> },
): Promise<SongDetail> {
  const saved = await view<SongDetail>(
    request<ContractSongDetail>(`/api/songs/${id}/sync`, json("PATCH", body)),
  );
  lastSeen.set(id, saved);
  return saved;
}

/**
 * Save sync marks and BPM. With no network (and a song this page loaded) the change is queued and answered as the
 * song would look once saved; `flushOps` sends it later.
 */
export async function patchSync(
  id: string,
  body: { bpm: number; anchors: Record<string, number> },
): Promise<SongDetail> {
  try {
    return await sendSync(id, body);
  } catch (error) {
    const seen = lastSeen.get(id);
    if (!isOfflineError(error) || !seen) throw error;
    queueOp({ kind: "sync", songId: id, revision: seen.revision, ...body });
    const queued: SongDetail = {
      ...seen,
      document: seen.document && {
        ...seen.document,
        bpm: body.bpm,
        sync: { ...seen.document.sync, anchors: body.anchors },
      },
    };
    lastSeen.set(id, queued);
    await refreshSavedSong(queued).catch(() => undefined);
    return queued;
  }
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

/** Append one song to the end of a setlist. */
export function addSetlistEntry(id: string, songId: string): Promise<SetlistDetail> {
  return request<ContractSetlistDetail>(
    `/api/setlists/${id}/entries`,
    json("POST", { song_id: songId, note: "", transpose: 0 }),
  );
}

export function deleteSetlist(id: string): Promise<void> {
  return request(`/api/setlists/${id}`, { method: "DELETE" });
}

/**
 * Add a session to the practice log. Best effort: a failure is swallowed, because losing a
 * minute of log must never get in the way of playing. `keepalive` lets the request outlive the page.
 */
export async function postPracticeSession(
  session: PracticeSessionDraft,
  keepalive = false,
): Promise<void> {
  await request<ContractPracticeSession>("/api/practice/sessions", {
    ...json("POST", session),
    keepalive,
  });
}

/** With no network the session is kept on this device and added to the log when the connection returns. */
export async function recordPracticeSession(
  session: PracticeSessionDraft,
  keepalive = false,
): Promise<void> {
  try {
    await postPracticeSession(session, keepalive);
  } catch (error) {
    if (!isOfflineError(error)) return;
    try {
      queueOp({ kind: "practice", session });
    } catch {
      /* storage is full or blocked: the log is a convenience */
    }
  }
}

/** Add a finished trainer game to the practice log. Best effort, like `recordPracticeSession`. */
export async function recordPracticeExercise(exercise: PracticeExerciseDraft): Promise<void> {
  try {
    await request("/api/practice/exercises", json("POST", exercise));
  } catch {
    /* the log is a convenience */
  }
}

export function getPracticeStats(today: string): Promise<PracticeStats> {
  return request<ContractPracticeStats>(`/api/practice/stats?today=${encodeURIComponent(today)}`);
}

export function getRecommendations(today: string): Promise<Recommendations> {
  return request<ContractRecommendations>(
    `/api/practice/recommendations?today=${encodeURIComponent(today)}`,
  );
}

export function savePracticeGoal(goal: PracticeGoal): Promise<PracticeGoal> {
  return request<ContractPracticeGoal>("/api/practice/goal", json("PUT", goal));
}

export function getSongPractice(id: string): Promise<SongPractice> {
  return request<ContractSongPractice>(`/api/songs/${id}/practice`);
}

export function uploadAudio(id: string, file: File): Promise<SongDetail> {
  const data = new FormData();
  data.append("file", file);
  return view(
    request<ContractSongDetail>(`/api/songs/${id}/audio`, { method: "POST", body: data }),
  );
}

/** Queue a download of a YouTube video's audio that replaces the song's audio; wait for the job, then read the song. */
export function attachYouTubeAudio(id: string, url: string): Promise<JobAccepted> {
  return request<JobAccepted>(`/api/songs/${id}/audio/youtube`, json("POST", { url }));
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

/** List the parts of a MIDI file (name, range, suggested instrument) without saving anything. */
export function inspectMidi(file: File): Promise<MidiInspection> {
  const data = new FormData();
  data.append("file", file);
  return request<MidiInspection>("/api/imports/midi/inspect", { method: "POST", body: data });
}

/** Queue the import of a MIDI file with the chosen parts, instruments, capo and grid. */
export function importMidi(file: File, options: MidiImportOptions): Promise<JobAccepted> {
  const data = new FormData();
  data.append("file", file);
  data.append("options", JSON.stringify(options));
  return request<JobAccepted>("/api/imports/midi", { method: "POST", body: data });
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
