import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

type Call = { url: string; init?: RequestInit };

let calls: Call[] = [];
let respond: (call: Call) => Response;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  calls = [];
  respond = () => reply({ ok: true });
  vi.stubGlobal("document", { baseURI: "http://fretbook.test/app/" });
  vi.stubGlobal("location", { pathname: "/app/songs", search: "", assign: vi.fn() });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("request wrappers", () => {
  const file = new File(["x"], "a.txt");
  const cases: [string, () => Promise<unknown>, string, string][] = [
    ["getMeta", () => api.getMeta(), "GET", "api/meta"],
    ["getMe", () => api.getMe(), "GET", "api/me"],
    ["saveSettings", () => api.saveSettings({} as never), "PUT", "api/me/settings"],
    ["markSongOpened", () => api.markSongOpened("s1"), "POST", "api/songs/s1/opened"],
    ["getSong", () => api.getSong("s1"), "GET", "api/songs/s1"],
    ["listApiTokens", () => api.listApiTokens(), "GET", "api/tokens"],
    ["createApiToken", () => api.createApiToken("nightly", 30), "POST", "api/tokens"],
    ["revokeApiToken", () => api.revokeApiToken("t1"), "DELETE", "api/tokens/t1"],
    [
      "createTab",
      () =>
        api.createTab({
          title: "t",
          artist: "a",
          preset: "p",
          bpm: 90,
          measures: 4,
          signature: [4, 4],
        }),
      "POST",
      "api/songs",
    ],
    [
      "createChordSheet",
      () => api.createChordSheet({ title: "t", artist: "a", chordpro: "[C]x" }),
      "POST",
      "api/songs",
    ],
    [
      "updateSong",
      () => api.updateSong("s1", { title: "t", artist: "a", revision: 1 }),
      "PUT",
      "api/songs/s1",
    ],
    [
      "patchSync",
      () => api.patchSync("s1", { bpm: 90, anchors: {} }),
      "PATCH",
      "api/songs/s1/sync",
    ],
    ["deleteSong", () => api.deleteSong("s1"), "DELETE", "api/songs/s1"],
    ["uploadAudio", () => api.uploadAudio("s1", file), "POST", "api/songs/s1/audio"],
    ["previewImport", () => api.previewImport("http://x"), "POST", "api/imports/preview"],
    ["importFile", () => api.importFile(file), "POST", "api/imports/file"],
    ["importAuto", () => api.importAuto({ file, text: "t", url: "u" }), "POST", "api/imports/auto"],
    ["importLibrary", () => api.importLibrary(file, "skip"), "POST", "api/library/import"],
    [
      "previewAsciiTab",
      () => api.previewAsciiTab({ text: "t" } as never),
      "POST",
      "api/imports/ascii-tab/preview",
    ],
    [
      "importAsciiTab",
      () => api.importAsciiTab({ text: "t" } as never),
      "POST",
      "api/imports/ascii-tab",
    ],
    [
      "importDocument",
      () =>
        api.importDocument({ title: "t", artist: "a", source_kind: "gp", document: {} as never }),
      "POST",
      "api/songs/import-document",
    ],
    ["listJobs", () => api.listJobs(), "GET", "api/jobs"],
    ["getJob", () => api.getJob("j1"), "GET", "api/jobs/j1"],
    ["retryJob", () => api.retryJob("j1"), "POST", "api/jobs/j1/retry"],
    ["listUsers", () => api.listUsers(), "GET", "api/admin/users"],
    ["signOutUser", () => api.signOutUser("u1"), "POST", "api/admin/users/u1/sign-out"],
    ["adoptLocal", () => api.adoptLocal(), "POST", "api/admin/adopt-local"],
  ];

  it.each(cases)("%s calls the right route", async (_name, call, method, path) => {
    await call();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`http://fretbook.test/app/${path}`);
    expect(calls[0].init?.method ?? "GET").toBe(method);
  });

  it("sends a JSON body with a content type", async () => {
    await api.patchSync("s1", { bpm: 90, anchors: { "0": 1 } });
    expect(calls[0].init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ bpm: 90, anchors: { "0": 1 } });
  });

  it("filters jobs by status and lists songs through the query builder", async () => {
    await api.listJobs("error");
    await api.listSongs({});
    expect(calls[0].url).toBe("http://fretbook.test/app/api/jobs?status=error");
    expect(calls[1].url).toContain("api/songs");
  });

  it("builds multipart bodies for uploads and automatic imports", async () => {
    await api.importAuto({ text: "pasted" });
    const form = calls[0].init?.body as FormData;
    expect(form.get("text")).toBe("pasted");
    expect(form.get("file")).toBeNull();
    await api.importLibrary(new File(["z"], "lib.zip"), "copy");
    expect((calls[1].init?.body as FormData).get("mode")).toBe("copy");
  });

  it("sends the video id and chosen parts when importing a link", async () => {
    await api.importUrl("http://x", "vid", [1, 2]);
    await api.importUrl("http://x", "");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      url: "http://x",
      video_id: "vid",
      part_ids: [1, 2],
    });
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ url: "http://x", video_id: null });
  });

  it("returns undefined for a 204", async () => {
    respond = () => new Response(null, { status: 204 });
    await expect(api.dismissJob("j1")).resolves.toBeUndefined();
    expect(calls[0].init?.method).toBe("DELETE");
  });
});

describe("errors", () => {
  it("builds the sign-in address from the current page", () => {
    vi.stubGlobal("location", { pathname: "/app/songs", search: "?q=1", assign: vi.fn() });
    expect(api.loginUrl()).toBe("http://fretbook.test/app/auth/login?next=songs%3Fq%3D1");
  });

  it("keeps the server's error key and parameters", async () => {
    respond = () =>
      reply({ detail: { key: "song.conflict", message: "changed", params: { n: 2 } } }, 409);
    const error = (await api.getSong("s1").catch((e: unknown) => e)) as api.ApiError;
    expect(error).toBeInstanceOf(api.ApiError);
    expect(error.status).toBe(409);
    expect(error.key).toBe("song.conflict");
    expect(error.params).toEqual({ n: 2 });
  });

  it("uses a plain string detail as the message", async () => {
    respond = () => reply({ detail: "nope" }, 400);
    const error = (await api.getMe().catch((e: unknown) => e)) as api.ApiError;
    expect(error.message).toBe("nope");
    expect(error.key).toBe("");
  });

  it("joins validation errors with their location", async () => {
    respond = () =>
      reply({ detail: [{ loc: ["body", "title"], msg: "required" }, { msg: "bad" }, "odd"] }, 422);
    const error = (await api.getMe().catch((e: unknown) => e)) as api.ApiError;
    expect(error.key).toBe("request.invalid");
    expect(error.message).toBe('title: required; bad; "odd"');
  });

  it("falls back to the status text when the body is not JSON", async () => {
    respond = () => new Response("<html>", { status: 502, statusText: "Bad Gateway" });
    const error = (await api.getMe().catch((e: unknown) => e)) as api.ApiError;
    expect(error.status).toBe(502);
    expect(error.message).toBe("Bad Gateway");
  });

  it("sends a signed-out browser to sign in", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/app/songs", search: "", assign });
    respond = () => reply({ detail: { key: "auth.required", message: "sign in" } }, 401);
    await expect(api.getMe()).rejects.toBeInstanceOf(api.ApiError);
    expect(assign).toHaveBeenCalledOnce();
  });
});

describe("waitForJob", () => {
  it("reports progress until the job finishes", async () => {
    vi.useFakeTimers();
    const states = ["queued", "running", "done"];
    respond = () => reply({ id: "j1", status: states.shift() });
    const seen: string[] = [];
    const waiting = api.waitForJob("j1", (job) => seen.push(job.status));
    await vi.runAllTimersAsync();
    expect((await waiting).status).toBe("done");
    expect(seen).toEqual(["queued", "running"]);
  });

  it("gives up when the job never finishes", async () => {
    vi.useFakeTimers();
    respond = () => reply({ id: "j1", status: "running" });
    const waiting = api.waitForJob("j1").catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(((await waiting) as api.ApiError).key).toBe("job.timeout");
  });
});
