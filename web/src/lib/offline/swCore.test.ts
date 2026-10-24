import { describe, expect, it, vi } from "vitest";

import {
  classify,
  createWorker,
  DATA_CACHE,
  offlineResponse,
  parseRange,
  rangeResponse,
  SHELL_CACHE_PREFIX,
  type CacheLike,
  type CacheStorageLike,
} from "./swCore";

const scope = new URL("https://band.example/fretbook/");
const assets = new Set(["assets/app.js", "soundfont/sonivox.sf2"]);

const req = (path: string, init: { method?: string; mode?: string; range?: string } = {}) =>
  ({
    method: init.method ?? "GET",
    mode: init.mode ?? "cors",
    url: new URL(path, scope).href,
    headers: new Headers(init.range ? { Range: init.range } : {}),
  }) as unknown as Request;

class FakeCache implements CacheLike {
  entries = new Map<string, Response>();
  async match(request: Request | string, options?: { ignoreSearch?: boolean }) {
    let key = typeof request === "string" ? request : request.url;
    if (options?.ignoreSearch) key = key.split("?")[0];
    return this.entries.get(key)?.clone();
  }
  async put(request: Request | string, response: Response) {
    this.entries.set(typeof request === "string" ? request : request.url, response);
  }
  async delete(request: Request | string) {
    return this.entries.delete(typeof request === "string" ? request : request.url);
  }
}

class FakeStorage implements CacheStorageLike {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

const html = (body = "<html></html>") =>
  new Response(body, { headers: { "Content-Type": "text/html" } });

function setup(fetcher: (request: Request) => Promise<Response>, timeoutMs = 20) {
  const storage = new FakeStorage();
  const worker = createWorker({
    fetch: fetcher,
    caches: storage,
    scope,
    version: "v2",
    precache: [...assets],
    timeoutMs,
  });
  return { storage, worker };
}

describe("classify", () => {
  it("sorts requests by what the worker does with them", () => {
    const route = (path: string, init?: Parameters<typeof req>[1]) =>
      classify(req(path, init), scope, assets);
    expect(route("assets/app.js")).toBe("asset");
    expect(route("songs/abc", { mode: "navigate" })).toBe("navigate");
    expect(route("api/songs/abc")).toBe("pinned");
    expect(route("api/setlists/xyz")).toBe("pinned");
    expect(route("api/songs/abc/audio")).toBe("audio");
    expect(route("api/songs")).toBe("runtime");
    expect(route("api/setlists")).toBe("runtime");
    expect(route("api/meta")).toBe("runtime");
  });

  it("leaves sign-in, writes, other API routes and other sites alone", () => {
    expect(classify(req("auth/login", { mode: "navigate" }), scope, assets)).toBe("skip");
    expect(classify(req("api/songs/abc", { method: "PUT" }), scope, assets)).toBe("skip");
    expect(classify(req("api/jobs"), scope, assets)).toBe("skip");
    expect(classify(req("api/admin/users"), scope, assets)).toBe("skip");
    expect(classify(req("elsewhere.json"), scope, assets)).toBe("skip");
    const other = { ...req("x"), url: "https://other.example/fretbook/api/songs" } as Request;
    expect(classify(other, scope, assets)).toBe("skip");
    const outside = {
      ...req("x"),
      url: "https://band.example/other/",
      mode: "navigate",
    } as Request;
    expect(classify(outside, scope, assets)).toBe("skip");
  });
});

describe("byte ranges", () => {
  it("parses single ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=0-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });

  it("sends everything for no range or one it cannot read, and refuses an impossible one", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=9-3", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
  });

  it("answers 206 with the slice, 200 for the whole, 416 when out of range", async () => {
    const saved = () =>
      new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    const part = await rangeResponse(saved(), "bytes=2-4");
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(part.headers.get("Content-Type")).toBe("audio/mpeg");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4]);
    const whole = await rangeResponse(saved(), null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Content-Length")).toBe("10");
    const bad = await rangeResponse(saved(), "bytes=50-");
    expect(bad.status).toBe(416);
    expect(bad.headers.get("Content-Range")).toBe("bytes */10");
  });
});

describe("install and activate", () => {
  it("precaches the shell and every listed file, and drops older builds", async () => {
    const fetched: string[] = [];
    const { storage, worker } = setup(async (request) => {
      fetched.push(request.url);
      return request.url === scope.href ? html() : new Response("file");
    });
    await storage.open(`${SHELL_CACHE_PREFIX}v1`);
    await storage.open(DATA_CACHE);
    await worker.install();
    expect(fetched.sort()).toEqual(
      [scope.href, ...[...assets].map((path) => new URL(path, scope).href)].sort(),
    );
    const shell = await storage.open(`${SHELL_CACHE_PREFIX}v2`);
    expect(await shell.match(scope.href)).toBeDefined();
    expect(await shell.match(new URL("assets/app.js", scope).href)).toBeDefined();
    await worker.activate();
    expect(await storage.keys()).toEqual([DATA_CACHE, `${SHELL_CACHE_PREFIX}v2`]);
  });

  it("refuses to install when the shell is really a sign-in page or a file is missing", async () => {
    const signIn = html("<form></form>");
    Object.defineProperty(signIn, "redirected", { value: true });
    await expect(setup(async () => signIn).worker.install()).rejects.toThrow("shell");
    const missing = setup(async (request) =>
      request.url === scope.href ? html() : new Response("no", { status: 404 }),
    );
    await expect(missing.worker.install()).rejects.toThrow("404");
    const text = setup(async () => new Response("plain"));
    await expect(text.worker.install()).rejects.toThrow("shell");
  });
});

describe("handle", () => {
  it("returns null for requests it does not own", () => {
    const { worker } = setup(async () => new Response("x"));
    expect(worker.handle(req("auth/login", { mode: "navigate" }))).toBeNull();
    expect(worker.handle(req("api/songs/a", { method: "DELETE" }))).toBeNull();
  });

  it("serves build files from the shell cache and falls back to the network", async () => {
    const fetcher = vi.fn(async () => new Response("from network"));
    const { storage, worker } = setup(fetcher);
    await (
      await storage.open(`${SHELL_CACHE_PREFIX}v2`)
    ).put(new URL("assets/app.js", scope).href, new Response("cached"));
    const hit = await worker.handle(req("assets/app.js?v=1"));
    expect(await hit!.text()).toBe("cached");
    expect(fetcher).not.toHaveBeenCalled();
    const miss = await worker.handle(req("soundfont/sonivox.sf2"));
    expect(await miss!.text()).toBe("from network");
  });

  it("navigations go to the network first and keep the shell fresh", async () => {
    const { storage, worker } = setup(async () => html("<p>new</p>"));
    const shell = await storage.open(`${SHELL_CACHE_PREFIX}v2`);
    await shell.put(scope.href, html("<p>old</p>"));
    const answer = await worker.handle(req("songs/abc", { mode: "navigate" }));
    expect(await answer!.text()).toBe("<p>new</p>");
    expect(await (await shell.match(scope.href))!.text()).toBe("<p>new</p>");
  });

  it("navigations fall back to the saved shell offline, or when the network is slow", async () => {
    const offline = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    await (
      await offline.storage.open(`${SHELL_CACHE_PREFIX}v2`)
    ).put(scope.href, html("<p>shell</p>"));
    const answer = await offline.worker.handle(req("songs/abc", { mode: "navigate" }));
    expect(await answer!.text()).toBe("<p>shell</p>");

    const slow = setup(() => new Promise<Response>(() => {}));
    await (
      await slow.storage.open(`${SHELL_CACHE_PREFIX}v2`)
    ).put(scope.href, html("<p>shell</p>"));
    const waited = await slow.worker.handle(req("", { mode: "navigate" }));
    expect(await waited!.text()).toBe("<p>shell</p>");
  });

  it("navigations with nothing saved report the failure, and a sign-in redirect is never saved as the shell", async () => {
    const none = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(none.worker.handle(req("x", { mode: "navigate" }))).rejects.toThrow("Failed");
    const redirected = html("<form></form>");
    Object.defineProperty(redirected, "redirected", { value: true });
    const { storage, worker } = setup(async () => redirected);
    await (await storage.open(`${SHELL_CACHE_PREFIX}v2`)).put(scope.href, html("<p>shell</p>"));
    await worker.handle(req("x", { mode: "navigate" }));
    const shell = await storage.open(`${SHELL_CACHE_PREFIX}v2`);
    expect(await (await shell.match(scope.href))!.text()).toBe("<p>shell</p>");
  });

  it("refreshes a song that was saved on purpose, but does not keep one that was not", async () => {
    let body = "v1";
    const { storage, worker } = setup(async () => new Response(body));
    const data = await storage.open(DATA_CACHE);
    const href = new URL("api/songs/abc", scope).href;
    await worker.handle(req("api/songs/abc"));
    expect(await data.match(href)).toBeUndefined();
    await data.put(href, new Response("v0"));
    body = "v2";
    await worker.handle(req("api/songs/abc"));
    expect(await (await data.match(href))!.text()).toBe("v2");
  });

  it("answers a saved song when the network is gone, and says so for one that is not saved", async () => {
    const down = async () => {
      throw new TypeError("Failed to fetch");
    };
    const { storage, worker } = setup(down);
    const data = await storage.open(DATA_CACHE);
    await data.put(new URL("api/songs/abc", scope).href, new Response('{"id":"abc"}'));
    const saved = await worker.handle(req("api/songs/abc"));
    expect(await saved!.json()).toEqual({ id: "abc" });
    const missing = await worker.handle(req("api/songs/other"));
    expect(missing!.status).toBe(503);
    expect(((await missing!.json()) as { detail: { key: string } }).detail.key).toBe(
      "offline.unavailable",
    );
  });

  it("forgets a saved song the server says is gone, but passes other errors through", async () => {
    let status = 404;
    const { storage, worker } = setup(async () => new Response("no", { status }));
    const data = await storage.open(DATA_CACHE);
    const href = new URL("api/songs/abc", scope).href;
    await data.put(href, new Response("kept"));
    status = 500;
    expect((await worker.handle(req("api/songs/abc")))!.status).toBe(500);
    expect(await data.match(href)).toBeDefined();
    status = 404;
    expect((await worker.handle(req("api/songs/abc")))!.status).toBe(404);
    expect(await data.match(href)).toBeUndefined();
  });

  it("keeps library lists as it goes and serves them offline", async () => {
    let up = true;
    const { worker } = setup(async () => {
      if (!up) throw new TypeError("Failed to fetch");
      return new Response('{"items":[]}');
    });
    await worker.handle(req("api/songs?q=a"));
    up = false;
    const answer = await worker.handle(req("api/songs?q=a"));
    expect(await answer!.json()).toEqual({ items: [] });
    expect((await worker.handle(req("api/songs?q=b")))!.status).toBe(503);
  });

  it("serves saved audio by range, and leaves unsaved audio to the browser", async () => {
    const { storage, worker } = setup(async () => new Response("unused"));
    const data = await storage.open(DATA_CACHE);
    expect(worker.handle(req("api/songs/abc/audio"))).not.toBeNull();
    expect(await worker.handle(req("api/songs/abc/audio"))).toBeNull();
    await data.put(
      new URL("api/songs/abc/audio", scope).href,
      new Response("0123456789", { headers: { "Content-Type": "audio/mpeg" } }),
    );
    const part = await worker.handle(req("api/songs/abc/audio", { range: "bytes=0-3" }));
    expect(part!.status).toBe(206);
    expect(await part!.text()).toBe("0123");
  });
});

describe("offlineResponse", () => {
  it("is a keyed 503 the page can translate", async () => {
    const response = offlineResponse();
    expect(response.status).toBe(503);
    expect(((await response.json()) as { detail: { key: string } }).detail.key).toBe(
      "offline.unavailable",
    );
  });
});
