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
}
