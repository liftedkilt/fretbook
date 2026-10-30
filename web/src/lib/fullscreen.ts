/**
 * Full screen for the song page.
 *
 * The whole document goes full screen, so sheets, menus and toasts rendered outside the player
 * still show. While it is on, `<html data-fullscreen="player">` switches app.css to a layout with
 * only the score and the dock. The attribute follows `fullscreenchange`, so Esc and the browser's
 * own exit restore the page too.
 */

export const FULLSCREEN_ATTRIBUTE = "data-fullscreen";

/** False where the page cannot go full screen, for example iPhone Safari (see `watchFocusMode`). */
export function fullscreenSupported(doc: Document = document): boolean {
  return (
    Boolean(doc.fullscreenEnabled) && typeof doc.documentElement.requestFullscreen === "function"
  );
}

export function isFullscreen(doc: Document = document): boolean {
  return doc.fullscreenElement != null;
}

/** Resolves to false when the browser refuses (for example a permissions policy). */
export async function enterFullscreen(doc: Document = document): Promise<boolean> {
  if (!fullscreenSupported(doc)) return false;
  try {
    await doc.documentElement.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(doc: Document = document): Promise<void> {
  if (!isFullscreen(doc)) return;
  try {
    await doc.exitFullscreen();
  } catch {
    // Already left, for example by Esc while the call was pending.
  }
}

/**
 * Keep the layout attribute and `onchange` in step with the document's full screen state.
 * Returns a cleanup that removes the listener, exits full screen and drops the attribute.
 */
export function watchFullscreen(
  onchange: (on: boolean) => void,
  doc: Document = document,
): () => void {
  const sync = () => {
    const on = isFullscreen(doc);
    if (on) doc.documentElement.setAttribute(FULLSCREEN_ATTRIBUTE, "player");
    else doc.documentElement.removeAttribute(FULLSCREEN_ATTRIBUTE);
    onchange(on);
  };
  doc.addEventListener("fullscreenchange", sync);
  sync();
  return () => {
    doc.removeEventListener("fullscreenchange", sync);
    doc.documentElement.removeAttribute(FULLSCREEN_ATTRIBUTE);
    void exitFullscreen(doc);
  };
}

/** The widest score alphaTab draws at scale 1 before it wraps bars at a comfortable size. */
const BASE_WIDTH = 1100;
const MAX_FULLSCREEN_SCALE = 1.75;

/** How large to draw the score in full screen so it fills a window of `width` pixels. */
export function fullscreenScale(width: number): number {
  if (!Number.isFinite(width) || width <= BASE_WIDTH) return 1;
  const scale = Math.min(MAX_FULLSCREEN_SCALE, width / BASE_WIDTH);
  return Math.round(scale * 20) / 20;
}

/**
 * Focus mode: the same chrome-free layout without the Fullscreen API, for browsers that have none
 * (iPhone Safari). Only the attribute changes, so the page keeps the browser's own bars. Esc leaves
 * it. Returns a cleanup that drops the attribute and the listener.
 */
export function watchFocusMode(
  onchange: (on: boolean) => void,
  doc: Document = document,
): { set: (on: boolean) => void; stop: () => void } {
  let on = false;
  const set = (value: boolean) => {
    on = value;
    if (on) doc.documentElement.setAttribute(FULLSCREEN_ATTRIBUTE, "player");
    else doc.documentElement.removeAttribute(FULLSCREEN_ATTRIBUTE);
    onchange(on);
  };
  const onKey = (event: Event) => {
    if (on && (event as KeyboardEvent).key === "Escape") set(false);
  };
  doc.addEventListener("keydown", onKey);
  return {
    set,
    stop: () => {
      doc.removeEventListener("keydown", onKey);
      doc.documentElement.removeAttribute(FULLSCREEN_ATTRIBUTE);
    },
  };
}

/** True while the chrome-free layout is on, whether by the Fullscreen API or by focus mode. */
export function layoutFocused(doc: Document = document): boolean {
  return doc.documentElement.hasAttribute(FULLSCREEN_ATTRIBUTE);
}
