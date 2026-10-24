import { newQueuedOp, readOps, withOp, writeOps, type Op, type QueuedOp } from "./ops";
import { readQueue, withEdit, writeQueue, type QueuedEdit } from "./queue";

/** The edits waiting to be sent, kept in step with browser storage. */
export const queue = $state<{ edits: QueuedEdit[] }>({ edits: readQueue() });

function commit(next: QueuedEdit[]): void {
  writeQueue(next);
  queue.edits = next;
}

/** Throws when the edit could not be stored, so the editor can say it was not kept. */
export function queueEdit(edit: QueuedEdit): void {
  commit(withEdit($state.snapshot(queue.edits), edit));
}

export function markEdit(songId: string, state: QueuedEdit["state"], message = ""): void {
  commit(
    $state
      .snapshot(queue.edits)
      .map((edit) => (edit.songId === songId ? { ...edit, state, message } : edit)),
  );
}

export function dropEdit(songId: string): void {
  commit($state.snapshot(queue.edits).filter((edit) => edit.songId !== songId));
}

export function reloadQueue(): void {
  queue.edits = readQueue();
  opsQueue.ops = readOps();
}

// --- small writes made offline (sync marks, tags, favourites, practice sessions) -------------------------------

export const opsQueue = $state<{ ops: QueuedOp[] }>({ ops: readOps() });

function commitOps(next: QueuedOp[]): void {
  writeOps(next);
  opsQueue.ops = next;
}

/** Throws when the op could not be stored, so the caller can say it was not kept. */
export function queueOp(op: Op): void {
  commitOps(withOp($state.snapshot(opsQueue.ops), newQueuedOp(op)));
}

export function markOp(id: string, state: QueuedOp["state"], message = ""): void {
  commitOps(
    $state
      .snapshot(opsQueue.ops)
      .map((item) => (item.id === id ? { ...item, state, message } : item)),
  );
}

export function dropOp(id: string): void {
  commitOps($state.snapshot(opsQueue.ops).filter((item) => item.id !== id));
}
