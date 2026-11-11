/*
 * The player's keyboard shortcuts, in one table that drives both the key
 * handler and the `?` help overlay, so the two cannot drift apart.
 */

export type ShortcutAction =
  | "toggle"
  | "previousBar"
  | "nextBar"
  | "tap"
  | "metronome"
  | "countIn"
  | "muteTrack"
  | "soloTrack"
  | "volumeDown"
  | "volumeUp"
  | "slower"
  | "faster"
  | "help";

export interface Shortcut {
  action: ShortcutAction;
  /** `KeyboardEvent.key` values that trigger it. */
  keys: string[];
  /** What the overlay shows. */
  label: string;
  /** Locale key for what it does. */
  labelKey: string;
}

export const SHORTCUTS: Shortcut[] = [
  { action: "toggle", keys: [" "], label: "Space", labelKey: "shortcuts.toggle" },
  { action: "previousBar", keys: ["ArrowLeft"], label: "←", labelKey: "shortcuts.previousBar" },
  { action: "nextBar", keys: ["ArrowRight"], label: "→", labelKey: "shortcuts.nextBar" },
  { action: "tap", keys: ["t", "T"], label: "T", labelKey: "shortcuts.tap" },
  { action: "metronome", keys: ["m", "M"], label: "M", labelKey: "shortcuts.metronome" },
  { action: "countIn", keys: ["c", "C"], label: "C", labelKey: "shortcuts.countIn" },
  { action: "muteTrack", keys: ["x", "X"], label: "X", labelKey: "shortcuts.muteTrack" },
  { action: "soloTrack", keys: ["s", "S"], label: "S", labelKey: "shortcuts.soloTrack" },
  { action: "volumeDown", keys: ["-", "_"], label: "−", labelKey: "shortcuts.volumeDown" },
  { action: "volumeUp", keys: ["+", "="], label: "+", labelKey: "shortcuts.volumeUp" },
  { action: "slower", keys: ["[", "{"], label: "[", labelKey: "shortcuts.slower" },
  { action: "faster", keys: ["]", "}"], label: "]", labelKey: "shortcuts.faster" },
  { action: "help", keys: ["?"], label: "?", labelKey: "shortcuts.help" },
];

/** The action for a key press, or null when it is not ours (or a modifier is held). */
export function shortcutFor(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return SHORTCUTS.find((item) => item.keys.includes(event.key))?.action ?? null;
}

/** The editors' undo and redo keys. They use Ctrl (Cmd on a Mac), so they live apart from the player's. */
export type EditorShortcutAction = "undo" | "redo";

export interface EditorShortcut {
  action: EditorShortcutAction;
  label: string;
  labelKey: string;
}

export const EDITOR_SHORTCUTS: EditorShortcut[] = [
  { action: "undo", label: "Ctrl/⌘ Z", labelKey: "editHistory.undo" },
  { action: "redo", label: "Ctrl/⌘ Shift Z · Ctrl Y", labelKey: "editHistory.redo" },
];

/** Undo or redo for a key press in an editor, or null. */
export function editorShortcutFor(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): EditorShortcutAction | null {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}

const NOT_TEXT = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"];

/**
 * Whether undo keys pressed in `target` belong to the browser: true in a text
 * field with its own undo, unless the field opts in to the editor's history
 * with `data-edit-history`.
 */
export function ownsUndo(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-edit-history]")) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !NOT_TEXT.includes(target.type);
  return target instanceof HTMLElement && target.isContentEditable === true;
}

export const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

/** The next slower or faster speed in the list, or the same one at either end. */
export function stepRate(current: number, direction: 1 | -1): number {
  if (direction > 0) return RATES.find((rate) => rate > current + 1e-9) ?? RATES[RATES.length - 1];
  return [...RATES].reverse().find((rate) => rate < current - 1e-9) ?? RATES[0];
}
