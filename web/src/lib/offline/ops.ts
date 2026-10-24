import type { PracticeSessionDraft } from "../types";

/**
 * A small write made with no network, waiting for one. Unlike an edit to a song these never conflict: the last
 * value wins (sync marks, tags, favourite) or they only add a row (a practice session).
 */
export type Op =
  | { kind: "sync"; songId: string; revision: number; bpm: number; anchors: Record<string, number> }
  | { kind: "tags"; songId: string; tags: string[] }
  | { kind: "favourite"; songId: string; favourite: boolean }
  | { kind: "practice"; session: PracticeSessionDraft };

export interface QueuedOp {
  id: string;
  op: Op;
  queuedAt: string;
  /** `failed`: the server refused it (for example the song was deleted); it stays until dismissed. */
  state: "pending" | "failed";
  message: string;
}

const KEY = "fretbook.offline.ops.v1";

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isOp(value: unknown): value is Op {
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  switch (op.kind) {
    case "sync":
      return (
        typeof op.songId === "string" &&
        typeof op.revision === "number" &&
        typeof op.bpm === "number" &&
        typeof op.anchors === "object" &&
        op.anchors !== null
      );
    case "tags":
      return typeof op.songId === "string" && Array.isArray(op.tags);
    case "favourite":
      return typeof op.songId === "string" && typeof op.favourite === "boolean";
    case "practice":
      return typeof op.session === "object" && op.session !== null;
    default:
      return false;
  }
}

function isQueuedOp(value: unknown): value is QueuedOp {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<QueuedOp>;
  return (
    typeof item.id === "string" &&
    isOp(item.op) &&
    (item.state === "pending" || item.state === "failed")
  );
}

export function readOps(storage: Storage | null = browserStorage()): QueuedOp[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isQueuedOp) : [];
  } catch {
    return [];
  }
}

/** Throws when the browser refuses to store it (private mode, quota): the caller must say it was not kept. */
export function writeOps(ops: QueuedOp[], storage: Storage | null = browserStorage()): void {
  if (!storage) throw new Error("browser storage is not available");
  if (ops.length === 0) storage.removeItem(KEY);
  else storage.setItem(KEY, JSON.stringify(ops));
}

/** The song a coalescing op is about; practice sessions are never replaced by one another. */
function slot(op: Op): string | null {
  return op.kind === "practice" ? null : `${op.kind}:${op.songId}`;
}

/**
 * Add an op after the others. A later sync, tag or favourite change for the same song replaces the earlier one
 * (the last value is what the server should end up with); practice sessions all stay.
 */
export function withOp(ops: QueuedOp[], item: QueuedOp): QueuedOp[] {
  const key = slot(item.op);
  const earlier = key === null ? undefined : ops.find((other) => slot(other.op) === key);
  // A sync keeps the first revision: it is the version the server last agreed on.
  const next: QueuedOp =
    earlier && earlier.op.kind === "sync" && item.op.kind === "sync"
      ? { ...item, op: { ...item.op, revision: earlier.op.revision } }
      : item;
  return [...ops.filter((other) => key === null || slot(other.op) !== key), next];
}

export function newQueuedOp(op: Op): QueuedOp {
  return { id: newOpId(), op, queuedAt: new Date().toISOString(), state: "pending", message: "" };
}

function newOpId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
