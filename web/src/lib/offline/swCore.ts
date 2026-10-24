/*
 * The service worker's decisions, kept apart from `src/sw.ts` so they run under Vitest: which requests the
 * worker answers, from where, and what it does when the network is gone. Everything it touches (fetch, the
 * Cache API, the scope) arrives through `WorkerEnv`.
 */

export const SHELL_CACHE_PREFIX = "fretbook-shell-";
/** Song and setlist documents, audio and library lists. Outlives app updates; the page fills and clears it. */
export const DATA_CACHE = "fretbook-data";

/** Past this long without an answer, a request that has a saved copy is answered from the copy. */
export const NETWORK_TIMEOUT_MS = 4000;

export type Route = "skip" | "asset" | "navigate" | "pinned" | "audio" | "runtime";

export interface CacheLike {
  match(
    request: Request | string,
    options?: { ignoreSearch?: boolean },
  ): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface WorkerEnv {
  fetch: (request: Request) => Promise<Response>;
  caches: CacheStorageLike;
  /** The worker's scope, which is the app's base path, e.g. `https://host/` or `https://host/fretbook/`. */
  scope: URL;
  /** Names the shell cache, so a new build precaches into a fresh one. */
  version: string;
  /** Build output, relative to the scope. */
  precache: readonly string[];
  timeoutMs?: number;
}

const PINNED = /^api\/(songs|setlists)\/[^/]+$/;
const AUDIO = /^api\/songs\/[^/]+\/audio$/;
const RUNTIME = /^api\/(songs|setlists|meta|me|tags)$/;

/** The path below the scope, or null for a URL outside the app. */
export function relativePath(url: URL, scope: URL): string | null {
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  return url.pathname.slice(scope.pathname.length);
}

export function classify(
  request: Pick<Request, "method" | "mode" | "url">,
  scope: URL,
  assets: ReadonlySet<string>,
): Route {
  if (request.method !== "GET") return "skip";
  const rel = relativePath(new URL(request.url), scope);
  if (rel === null) return "skip";
  // Sign-in and sign-out must always reach the server.
  if (rel.startsWith("auth/")) return "skip";
  if (rel.startsWith("api/")) {
    if (AUDIO.test(rel)) return "audio";
    if (PINNED.test(rel)) return "pinned";
    if (RUNTIME.test(rel)) return "runtime";
    return "skip";
  }
  if (assets.has(rel)) return "asset";
  return request.mode === "navigate" ? "navigate" : "skip";
}

/** The answer when the network is down and nothing was saved. The page shows `errors.offline.unavailable`. */
export function offlineResponse(): Response {
  return new Response(
    JSON.stringify({
      detail: {
        key: "offline.unavailable",
        message: "You are offline and this is not saved on this device.",
        params: {},
      },
    }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
}

export type ByteRange = { start: number; end: number };

/** `null`: no usable single range, so send everything. `"unsatisfiable"`: answer 416. */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | null | "unsatisfiable" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/**
 * Cache storage keeps whole responses and ignores `Range`. Media elements ask for ranges (Safari insists on a 206),
 * so slice the saved copy.
 */
export async function rangeResponse(saved: Response, header: string | null): Promise<Response> {
  const body = await saved.arrayBuffer();
  const type = saved.headers.get("Content-Type") ?? "application/octet-stream";
  const range = parseRange(header, body.byteLength);
  if (range === "unsatisfiable")
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${body.byteLength}` },
    });
  if (range === null)
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(body.byteLength),
        "Accept-Ranges": "bytes",
      },
    });
  const slice = body.slice(range.start, range.end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Length": String(slice.byteLength),
      "Content-Range": `bytes ${range.start}-${range.end}/${body.byteLength}`,
      "Accept-Ranges": "bytes",
    },
  });
}

function withTimeout<T>(work: Promise<T>, ms: number | null): Promise<T> {
  if (ms === null) return work;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isHtml(response: Response): boolean {
  return (response.headers.get("Content-Type") ?? "").includes("text/html");
}

export function createWorker(env: WorkerEnv) {
  const assets = new Set(env.precache);
  const shellName = SHELL_CACHE_PREFIX + env.version;
  const shellKey = env.scope.href;
  const timeoutMs = env.timeoutMs ?? NETWORK_TIMEOUT_MS;

  async function precacheOne(cache: CacheLike, href: string): Promise<void> {
    const response = await env.fetch(new Request(href, { cache: "reload" }));
    if (!response.ok) throw new Error(`precache ${href}: HTTP ${response.status}`);
    await cache.put(href, response);
  }

  /** Save the app shell and build output. Rejecting leaves the old worker in charge, and the next load retries. */
  async function install(): Promise<void> {
    const cache = await env.caches.open(shellName);
    const shell = await env.fetch(new Request(shellKey, { cache: "reload" }));
    // Behind an auth proxy a signed-out browser is redirected to the sign-in page, which is not the app.
    if (!shell.ok || shell.redirected || !isHtml(shell))
      throw new Error("the app shell was not served");
    await cache.put(shellKey, shell);
    const queue = [...assets];
    const lanes = Array.from({ length: 6 }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift())
        await precacheOne(cache, new URL(next, env.scope).href);
    });
    await Promise.all(lanes);
  }

  async function activate(): Promise<void> {
    for (const name of await env.caches.keys())
      if (name.startsWith(SHELL_CACHE_PREFIX) && name !== shellName) await env.caches.delete(name);
  }

  async function assetResponse(request: Request): Promise<Response> {
    const shell = await env.caches.open(shellName);
    const saved = await shell.match(request.url, { ignoreSearch: true });
    return saved ?? env.fetch(request);
  }

  async function navigationResponse(request: Request): Promise<Response> {
    const shell = await env.caches.open(shellName);
    const saved = await shell.match(shellKey);
    try {
      const response = await withTimeout(env.fetch(request), saved ? timeoutMs : null);
      // Keep the shell current, but never a redirect to a sign-in page.
      if (response.ok && !response.redirected && isHtml(response))
        await shell.put(shellKey, response.clone());
      return response;
    } catch (error) {
      if (saved) return saved;
      throw error;
    }
  }

  /** Network first. `keep` decides whether a fresh answer replaces the saved one. */
  async function networkFirst(
    request: Request,
    keep: (saved: Response | undefined) => boolean,
  ): Promise<Response> {
    const data = await env.caches.open(DATA_CACHE);
    const saved = await data.match(request.url);
    try {
      const response = await withTimeout(env.fetch(request), saved ? timeoutMs : null);
      if (response.ok && keep(saved)) await data.put(request.url, response.clone());
      // A song deleted elsewhere should not linger on this device.
      if (response.status === 404 && saved) await data.delete(request.url);
      return response;
    } catch {
      return saved ?? offlineResponse();
    }
  }

  async function audioResponse(request: Request): Promise<Response | null> {
    const data = await env.caches.open(DATA_CACHE);
    const saved = await data.match(request.url);
    // Not saved: let the browser stream it, ranges and all.
    if (!saved) return null;
    return rangeResponse(saved, request.headers.get("Range"));
  }

  /** The response to give `request`, or null to leave it to the browser. */
  function handle(request: Request): Promise<Response | null> | null {
    switch (classify(request, env.scope, assets)) {
      case "asset":
        return assetResponse(request);
      case "navigate":
        return navigationResponse(request);
      case "pinned":
        // Only refresh a document that was saved on purpose; the rest of the library is not kept.
        return networkFirst(request, (saved) => saved !== undefined);
      case "runtime":
        return networkFirst(request, () => true);
      case "audio":
        return audioResponse(request);
      default:
        return null;
    }
  }

  return { install, activate, handle };
}
