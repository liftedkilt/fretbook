import type { ScoreDocument } from "../types";

/** What `PUT /api/songs/{id}` takes. */
export interface EditBody {
  title: string;
  artist: string;
  revision: number;
  document?: ScoreDocument;
  chordpro?: string;
}

/**
 * An edit made with no network, waiting for one. `pending` is waiting to be sent; `conflict` means the song changed
 * on the server since `body.revision`; `failed` means the server refused it for another reason.
 */
export interface QueuedEdit {
  songId: string;
  title: string;
  body: EditBody;
  queuedAt: string;
  state: "pending" | "conflict" | "failed";
  message: string;
}

const KEY = "fretbook.offline.queue.v1";

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isEdit(value: unknown): value is QueuedEdit {
  if (!value || typeof value !== "object") return false;
  const edit = value as Partial<QueuedEdit>;
  return (
    typeof edit.songId === "string" &&
    typeof edit.body === "object" &&
    edit.body !== null &&
    typeof edit.body.revision === "number" &&
    (edit.state === "pending" || edit.state === "conflict" || edit.state === "failed")
  );
}

export function readQueue(storage: Storage | null = browserStorage()): QueuedEdit[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEdit) : [];
  } catch {
    return [];
  }
}

/** Throws when the browser refuses to store it (private mode, quota): the caller must say the edit was not kept. */
export function writeQueue(edits: QueuedEdit[], storage: Storage | null = browserStorage()): void {
  if (!storage) throw new Error("browser storage is not available");
  if (edits.length === 0) storage.removeItem(KEY);
  else storage.setItem(KEY, JSON.stringify(edits));
}

/**
 * Add an edit, replacing an earlier one for the same song. The earlier edit's revision stays: it is the version the
 * server last agreed on, whatever the later edits were made on top of.
 */
export function withEdit(edits: QueuedEdit[], edit: QueuedEdit): QueuedEdit[] {
  const earlier = edits.find((item) => item.songId === edit.songId);
  const next: QueuedEdit = earlier
    ? { ...edit, body: { ...edit.body, revision: earlier.body.revision } }
    : edit;
  return [...edits.filter((item) => item.songId !== edit.songId), next];
}
