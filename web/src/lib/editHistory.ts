/*
 * Undo and redo for the editors: a list of snapshots of the editable state,
 * with a pointer to the one on screen. Each snapshot carries `meta`, where the
 * change was made (a bar, a cursor), so undo and redo can put the user back there.
 *
 * A change recorded with the same `group` as the step before it, within
 * `groupMs`, is folded into that step: a burst of typing in one cell is one step.
 */

export interface HistoryOptions {
  /** The most steps kept, not counting the starting state. */
  limit?: number;
  /** How long a pause ends a group of edits, in milliseconds. */
  groupMs?: number;
}

export interface RecordOptions {
  /** Edits with the same group key in a row, close in time, become one step. */
  group?: string | null;
  /** The time of the edit, in milliseconds (defaults to `Date.now()`). */
  at?: number;
}

export interface HistoryStep<T, M> {
  state: T;
  /** Where the undone or redone change was made. */
  meta: M;
}

// The state is kept only as its JSON: that is both the copy and what changes are compared by.
// Snapshots are plain data, so nothing is lost.
interface Entry<M> {
  key: string;
  meta: M;
  group: string | null;
  at: number;
}

export const HISTORY_LIMIT = 100;
export const GROUP_MS = 1000;

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class EditHistory<T, M = null> {
  private entries: Entry<M>[];
  private index = 0;
  private readonly limit: number;
  private readonly groupMs: number;

  constructor(initial: T, meta: M, options: HistoryOptions = {}) {
    this.limit = Math.max(1, options.limit ?? HISTORY_LIMIT);
    this.groupMs = options.groupMs ?? GROUP_MS;
    this.entries = [this.entry(initial, meta, null, 0)];
  }

  private entry(state: T, meta: M, group: string | null, at: number): Entry<M> {
    return { key: JSON.stringify(state), meta: copy(meta), group, at };
  }

  private stateAt(index: number): T {
    return JSON.parse(this.entries[index].key) as T;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  /** The state on screen, as last recorded or restored. */
  get present(): T {
    return this.stateAt(this.index);
  }

  /** Whether `state` is the state on screen. */
  matches(state: T): boolean {
    return JSON.stringify(state) === this.entries[this.index].key;
  }

  /**
   * Record the state after a change. Returns false when nothing changed. A new
   * change drops the steps that could have been redone.
   */
  record(state: T, meta: M, options: RecordOptions = {}): boolean {
    if (this.matches(state)) return false;
    const group = options.group ?? null;
    const at = options.at ?? Date.now();
    const last = this.entries[this.index];
    this.entries.length = this.index + 1;
    if (group !== null && this.index > 0 && last.group === group && at - last.at <= this.groupMs) {
      const merged = this.entry(state, meta, group, at);
      // A burst that ends where it started (typed, then deleted) is no step at all.
      if (merged.key === this.entries[this.index - 1].key) {
        this.entries.length = this.index;
        this.index -= 1;
      } else this.entries[this.index] = merged;
      return true;
    }
    this.entries.push(this.entry(state, meta, group, at));
    this.index += 1;
    if (this.entries.length > this.limit + 1) {
      this.entries.splice(0, this.entries.length - this.limit - 1);
      this.index = this.entries.length - 1;
    }
    return true;
  }

  /** End the current group, so the next edit is its own step even in the same cell. */
  seal(): void {
    this.entries[this.index].group = null;
  }

  /** Step back. Returns the earlier state and where the undone change was made. */
  undo(): HistoryStep<T, M> | null {
    if (!this.canUndo) return null;
    const undone = this.entries[this.index];
    this.index -= 1;
    this.seal();
    return { state: this.present, meta: copy(undone.meta) };
  }

  /** Step forward again. Returns the later state and where that change was made. */
  redo(): HistoryStep<T, M> | null {
    if (!this.canRedo) return null;
    this.index += 1;
    const redone = this.entries[this.index];
    this.seal();
    return { state: this.present, meta: copy(redone.meta) };
  }

  /** Change every snapshot in place (for example, when a save re-bases them). Not a step. */
  rewrite(change: (state: T) => T): void {
    this.entries = this.entries.map((item, index) =>
      this.entry(change(this.stateAt(index)), item.meta, item.group, item.at),
    );
  }

  /** Put `state` in place of the one on screen without adding a step (a save that tidied it). */
  replace(state: T, meta: M): void {
    const current = this.entries[this.index];
    this.entries[this.index] = this.entry(state, meta, null, current.at);
  }

  /** Forget every step and start again from `state`. */
  reset(state: T, meta: M): void {
    this.entries = [this.entry(state, meta, null, 0)];
    this.index = 0;
  }
}

/**
 * Where to put the text cursor after the text changed from `before` to `after`:
 * the end of the changed part, in `after`.
 */
export function cursorAfterChange(before: string, after: string): number {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < shortest - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end += 1;
  return after.length - end;
}
