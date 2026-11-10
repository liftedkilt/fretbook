// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keepAwake, screenHeld } from "./wakeLock";

type FakeSentinel = {
  release: ReturnType<typeof vi.fn>;
  addEventListener: (type: "release", listener: () => void) => void;
  drop: () => void;
};

function fakeSentinel(): FakeSentinel {
  let listener = () => {};
  const item: FakeSentinel = {
    release: vi.fn(async () => listener()),
    addEventListener: (_type, next) => {
      listener = next;
    },
    drop: () => listener(),
  };
  return item;
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("keepAwake", () => {
  let sentinels: FakeSentinel[];
  let request: ReturnType<typeof vi.fn>;
  let release: Array<() => void>;

  beforeEach(() => {
    sentinels = [];
    release = [];
    request = vi.fn(async () => {
      const item = fakeSentinel();
      sentinels.push(item);
      return item;
    });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    setVisibility("visible");
  });

  afterEach(async () => {
    for (const let_go of release) let_go();
    await flush();
    Reflect.deleteProperty(navigator, "wakeLock");
  });

  it("takes the screen lock and lets go of it", async () => {
    const done = keepAwake();
    release.push(done);
    await flush();
    expect(request).toHaveBeenCalledWith("screen");
    expect(screenHeld()).toBe(true);
    done();
    await flush();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(screenHeld()).toBe(false);
  });

  it("holds one lock for several callers until the last lets go", async () => {
    const first = keepAwake();
    const second = keepAwake();
    release.push(first, second);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    first();
    first();
    await flush();
    expect(screenHeld()).toBe(true);
    second();
    await flush();
    expect(screenHeld()).toBe(false);
  });

  it("takes the lock again when the page comes back", async () => {
    release.push(keepAwake());
    await flush();
    setVisibility("hidden");
    sentinels[0].drop();
    expect(screenHeld()).toBe(false);
    setVisibility("visible");
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(screenHeld()).toBe(true);
  });

  it("does not ask while the page is hidden, or once nobody needs it", async () => {
    setVisibility("hidden");
    const done = keepAwake();
    release.push(done);
    await flush();
    expect(request).not.toHaveBeenCalled();
    done();
    setVisibility("visible");
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it("gives the lock straight back if everyone let go while it was being taken", async () => {
    const done = keepAwake();
    done();
    await flush();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(screenHeld()).toBe(false);
  });

  it("carries on when the browser refuses or has no wake lock", async () => {
    request.mockRejectedValueOnce(new Error("NotAllowedError"));
    const refused = keepAwake();
    await flush();
    expect(screenHeld()).toBe(false);
    refused();

    Reflect.deleteProperty(navigator, "wakeLock");
    const missing = keepAwake();
    await flush();
    expect(screenHeld()).toBe(false);
    missing();
  });
});
