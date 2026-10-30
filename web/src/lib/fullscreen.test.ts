// Full screen helpers against a stand-in document, since jsdom has no Fullscreen API.
import { describe, expect, it, vi } from "vitest";

import {
  FULLSCREEN_ATTRIBUTE,
  enterFullscreen,
  exitFullscreen,
  fullscreenScale,
  fullscreenSupported,
  isFullscreen,
  watchFocusMode,
  watchFullscreen,
} from "./fullscreen";

/** A document whose full screen state changes the way a browser's does, with `fullscreenchange`. */
function fakeDocument({ enabled = true, refuse = false } = {}) {
  const events = new EventTarget();
  const attributes = new Map<string, string>();
  const doc = {
    fullscreenEnabled: enabled,
    fullscreenElement: null as unknown,
    documentElement: {
      requestFullscreen: vi.fn(async () => {
        if (refuse) throw new TypeError("not allowed");
        doc.fullscreenElement = doc.documentElement;
        events.dispatchEvent(new Event("fullscreenchange"));
      }),
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
    exitFullscreen: vi.fn(async () => {
      doc.fullscreenElement = null;
      events.dispatchEvent(new Event("fullscreenchange"));
    }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  return { doc: doc as unknown as Document, raw: doc, attributes };
}

describe("fullscreen", () => {
  it("is unsupported when the browser disables it or has no API", () => {
    expect(fullscreenSupported(fakeDocument().doc)).toBe(true);
    expect(fullscreenSupported(fakeDocument({ enabled: false }).doc)).toBe(false);
    const { doc, raw } = fakeDocument();
    (raw.documentElement as { requestFullscreen?: unknown }).requestFullscreen = undefined;
    expect(fullscreenSupported(doc)).toBe(false);
  });

  it("keeps the layout attribute in step, whoever leaves full screen", async () => {
    const { doc, raw, attributes } = fakeDocument();
    const seen: boolean[] = [];
    const stop = watchFullscreen((on) => seen.push(on), doc);
    expect(seen).toEqual([false]);

    expect(await enterFullscreen(doc)).toBe(true);
    expect(isFullscreen(doc)).toBe(true);
    expect(attributes.get(FULLSCREEN_ATTRIBUTE)).toBe("player");

    // The browser's own exit (Esc) goes through the same event.
    raw.fullscreenElement = null;
    doc.dispatchEvent(new Event("fullscreenchange"));
    expect(attributes.has(FULLSCREEN_ATTRIBUTE)).toBe(false);
    expect(seen).toEqual([false, true, false]);

    await enterFullscreen(doc);
    await exitFullscreen(doc);
    expect(attributes.has(FULLSCREEN_ATTRIBUTE)).toBe(false);
    stop();
  });

  it("leaves full screen and drops the attribute when the page goes away", async () => {
    const { doc, raw, attributes } = fakeDocument();
    const stop = watchFullscreen(() => undefined, doc);
    await enterFullscreen(doc);
    stop();
    expect(attributes.has(FULLSCREEN_ATTRIBUTE)).toBe(false);
    expect(raw.exitFullscreen).toHaveBeenCalledOnce();
  });

  it("reports a refusal instead of throwing", async () => {
    const { doc, attributes } = fakeDocument({ refuse: true });
    watchFullscreen(() => undefined, doc);
    expect(await enterFullscreen(doc)).toBe(false);
    expect(attributes.has(FULLSCREEN_ATTRIBUTE)).toBe(false);
    await expect(exitFullscreen(doc)).resolves.toBeUndefined();
  });
});

describe("fullscreenScale", () => {
  it("keeps small windows at full size", () => {
    expect(fullscreenScale(800)).toBe(1);
    expect(fullscreenScale(1100)).toBe(1);
    expect(fullscreenScale(Number.NaN)).toBe(1);
  });

  it("grows with the window and stops at the cap", () => {
    expect(fullscreenScale(1650)).toBe(1.5);
    expect(fullscreenScale(1920)).toBe(1.75);
    expect(fullscreenScale(3840)).toBe(1.75);
  });
});

describe("focus mode", () => {
  it("toggles the layout attribute without the Fullscreen API and leaves on Esc", () => {
    const { doc, attributes } = fakeDocument({ enabled: false });
    const seen: boolean[] = [];
    const focus = watchFocusMode((on) => seen.push(on), doc);
    focus.set(true);
    expect(attributes.get(FULLSCREEN_ATTRIBUTE)).toBe("player");
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(attributes.has(FULLSCREEN_ATTRIBUTE)).toBe(false);
    expect(seen).toEqual([true, false]);
    focus.set(true);
    focus.stop();
    expect(attributes.has(FULLSCREEN_ATTRIBUTE)).toBe(false);
  });
});
