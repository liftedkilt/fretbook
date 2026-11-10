/**
 * Keeps the screen on while the player needs it (playing, wait mode, stage mode, auto-scroll).
 *
 * A phone on a music stand otherwise dims and locks mid-song, because nobody touches it. The Screen
 * Wake Lock API is only available on HTTPS pages (or `localhost`); where it is missing or refused
 * (battery saver), nothing happens. The browser drops the lock when the page is hidden, so it is
 * taken again when the page comes back.
 */

type Sentinel = {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
};
type WakeLockApi = { request(type: "screen"): Promise<Sentinel> };

let holders = 0;
let sentinel: Sentinel | null = null;
let pending = false;
let watching = false;

function api(): WakeLockApi | null {
  const found = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return found && typeof found.request === "function" ? found : null;
}

async function acquire(): Promise<void> {
  const lock = api();
  if (!lock || sentinel || pending || holders === 0 || document.visibilityState !== "visible")
    return;
  pending = true;
  try {
    const taken = await lock.request("screen");
    taken.addEventListener("release", () => {
      if (sentinel === taken) sentinel = null;
    });
    // Everyone let go while the request was on its way.
    if (holders === 0) void taken.release().catch(() => {});
    else sentinel = taken;
  } catch {
    /* refused: the screen follows the device's own timeout */
  } finally {
    pending = false;
  }
}

function onVisible(): void {
  if (document.visibilityState === "visible") void acquire();
}

/**
 * Ask for the screen to stay on. Returns the function that lets go; the screen may sleep again once
 * every caller has let go. Safe to return from a Svelte `$effect`.
 */
export function keepAwake(): () => void {
  holders += 1;
  if (!watching) {
    watching = true;
    document.addEventListener("visibilitychange", onVisible);
  }
  void acquire();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders -= 1;
    if (holders > 0) return;
    const current = sentinel;
    sentinel = null;
    if (current) void current.release().catch(() => {});
  };
}

/** For tests: whether a lock is held right now. */
export function screenHeld(): boolean {
  return sentinel !== null;
}
