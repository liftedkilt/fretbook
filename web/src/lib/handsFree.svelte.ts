/*
 * Hands-free playing: page-turner pedals (they send ordinary keys), auto-scroll
 * for chord sheets, and the large-print stage mode. The pedal map and stage
 * mode are per device, so they live in localStorage, not on the server.
 */

export const PEDAL_ACTIONS = [
  "default",
  "nextPage",
  "previousPage",
  "toggle",
  "loop",
  "nextSong",
  "previousSong",
] as const;
export type PedalAction = (typeof PEDAL_ACTIONS)[number];

/** The keys a pedal can send. Space is left out: it already plays and pauses. */
export const PEDAL_KEYS = ["PageDown", "PageUp", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"];

export type PedalMap = Record<string, PedalAction>;

/** `default` leaves a key to what it already does (the arrows step a bar in the tab player). */
export const DEFAULT_PEDALS: PedalMap = {
  PageDown: "nextPage",
  PageUp: "previousPage",
  ArrowDown: "default",
  ArrowUp: "default",
  ArrowRight: "default",
  ArrowLeft: "default",
};

/** How much larger the score is drawn in stage mode. */
export const STAGE_SCALE = 1.5;

const PEDALS_KEY = "fretbook.pedals";
const STAGE_KEY = "fretbook.stage";
const SCROLL_KEY = "fretbook.autoscrollSpeed";

export const SCROLL_FACTORS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function read(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or full storage: the choice lasts until the page closes.
  }
}

/** The stored map, with anything unknown or missing replaced by its default. */
export function loadPedals(): PedalMap {
  const map = { ...DEFAULT_PEDALS };
  try {
    const raw = read(PEDALS_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const key of PEDAL_KEYS) {
      const action = PEDAL_ACTIONS.find((item) => item === stored[key]);
      if (action) map[key] = action;
    }
  } catch {
    // A damaged value falls back to the defaults.
  }
  return map;
}

export const handsFree = $state({
  pedals: loadPedals(),
  stage: read(STAGE_KEY) === "1",
  /** Multiplier on the derived auto-scroll speed. */
  scrollFactor: storedFactor(),
});

export function setPedal(key: string, action: PedalAction) {
  handsFree.pedals = { ...handsFree.pedals, [key]: action };
  write(PEDALS_KEY, JSON.stringify(handsFree.pedals));
}

export function resetPedals() {
  handsFree.pedals = { ...DEFAULT_PEDALS };
  write(PEDALS_KEY, JSON.stringify(handsFree.pedals));
}

export function setStage(on: boolean) {
  handsFree.stage = on;
  write(STAGE_KEY, on ? "1" : "0");
}

/** The pedal action a key press asks for, or null when it is not a pedal key or keeps its default. */
export function pedalAction(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  map: PedalMap = handsFree.pedals,
): Exclude<PedalAction, "default"> | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const action = map[event.key];
  return action && action !== "default" ? action : null;
}

/** Whether the key press happened while typing, when a pedal key must stay a text key. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element && (/INPUT|TEXTAREA|SELECT/.test(element.tagName) || !!element.isContentEditable)
  );
}

/** How far one pedal press scrolls: most of a screen, keeping the last line in view. */
export function pageDelta(viewHeight: number, direction: 1 | -1): number {
  return direction * Math.round(viewHeight * 0.85);
}

function storedFactor(): number {
  const value = Number(read(SCROLL_KEY));
  return SCROLL_FACTORS.includes(value) ? value : 1;
}

export function stepScrollFactor(direction: 1 | -1) {
  const at = SCROLL_FACTORS.indexOf(handsFree.scrollFactor);
  const next = SCROLL_FACTORS[Math.min(SCROLL_FACTORS.length - 1, Math.max(0, at + direction))];
  handsFree.scrollFactor = next;
  write(SCROLL_KEY, String(next));
}

/** A ChordPro `{duration: 3:45}` (or plain seconds) in seconds, or null. */
export function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return seconds > 0 ? seconds : null;
}

/** Beats a printed line is taken to last when only the tempo is known: two bars of 4/4. */
export const BEATS_PER_LINE = 8;
/** The song length assumed when neither a duration nor a tempo is known. */
export const FALLBACK_SECONDS = 210;

/**
 * Pixels per second to reach the end of a page of `distance` pixels as the song
 * ends: from the duration if the sheet gives one, else from the tempo and the
 * number of lines, else from a typical song length.
 */
export function autoScrollSpeed(options: {
  distance: number;
  duration?: number | null;
  bpm?: number | null;
  lines?: number;
  factor?: number;
}): number {
  const { distance, duration, bpm, lines = 0, factor = 1 } = options;
  let seconds = FALLBACK_SECONDS;
  if (duration && duration > 0) seconds = duration;
  else if (bpm && bpm > 0 && lines > 0) seconds = (lines * BEATS_PER_LINE * 60) / bpm;
  return (Math.max(0, distance) / seconds) * factor;
}
