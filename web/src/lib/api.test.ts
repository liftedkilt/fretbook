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
    ["getLlmStatus", () => api.getLlmStatus(), "GET", "api/llm"],
    ["saveOwnLlmKey", () => api.saveOwnLlmKey("sk-12345678"), "PUT", "api/llm/key"],
    ["removeOwnLlmKey", () => api.removeOwnLlmKey(), "DELETE", "api/llm/key"],
    ["getLlmSettings", () => api.getLlmSettings(), "GET", "api/admin/llm"],
    ["saveLlmSettings", () => api.saveLlmSettings({} as never), "PUT", "api/admin/llm"],
    ["listLlmUsers", () => api.listLlmUsers(), "GET", "api/admin/llm/users"],
    ["saveLlmUser", () => api.saveLlmUser("u1", {} as never), "PUT", "api/admin/llm/users/u1"],
    ["listLlmUsage", () => api.listLlmUsage(), "GET", "api/admin/llm/usage?limit=50"],
    ["listLlmNotices", () => api.listLlmNotices(), "GET", "api/admin/llm/notices"],
    ["clearLlmNotices", () => api.clearLlmNotices(), "DELETE", "api/admin/llm/notices"],
    ["listCalibrations", () => api.listCalibrations(), "GET", "api/me/calibrations"],
    [
      "getCalibration",
      () => api.getCalibration("out", "in"),
      "GET",
      "api/me/calibration?output_device=out&input_device=in",
    ],
    [
      "saveCalibration",
      () =>
        api.saveCalibration({
          output_device: "default",
          input_device: "default",
          offset_ms: 40,
          jitter_ms: 2,
        } as never),
      "PUT",
      "api/me/calibration",
    ],
    [
      "deleteCalibration",
      () => api.deleteCalibration(),
      "DELETE",
      "api/me/calibration?output_device=default&input_device=default",
    ],
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
    [
      "attachYouTubeAudio",
      () => api.attachYouTubeAudio("s1", "https://youtu.be/dQw4w9WgXcQ"),
      "POST",
      "api/songs/s1/audio/youtube",
    ],
    ["previewImport", () => api.previewImport("http://x"), "POST", "api/imports/preview"],
    ["importFile", () => api.importFile(file), "POST", "api/imports/file"],
    ["importAuto", () => api.importAuto({ file, text: "t", url: "u" }), "POST", "api/imports/auto"],
    ["inspectMidi", () => api.inspectMidi(file), "POST", "api/imports/midi/inspect"],
    [
      "convertTrack",
      () =>
        api.convertTrack("s1", {
          track_id: "t1",
          mode: "preview",
          semitones: 2,
          keep: "pitch",
          reduce: "all",
        }),
      "POST",
      "api/songs/s1/convert",
    ],
    [
      "importMidi",
      () => api.importMidi(file, { tracks: ["1:0"], presets: {}, capo: 0, grid: 16 }),
      "POST",
      "api/imports/midi",
    ],
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
    ["listSetlists", () => api.listSetlists(), "GET", "api/setlists"],
    ["getSetlist", () => api.getSetlist("l1"), "GET", "api/setlists/l1"],
    ["createSetlist", () => api.createSetlist("Gig"), "POST", "api/setlists"],
    ["renameSetlist", () => api.renameSetlist("l1", "Gig"), "PATCH", "api/setlists/l1"],
    [
      "saveSetlistEntries",
      () => api.saveSetlistEntries("l1", [{ song_id: "s1", note: "", transpose: 0 }]),
      "PUT",
      "api/setlists/l1/entries",
    ],
    ["addSetlistEntry", () => api.addSetlistEntry("l1", "s1"), "POST", "api/setlists/l1/entries"],
    ["deleteSetlist", () => api.deleteSetlist("l1"), "DELETE", "api/setlists/l1"],
    ["listJobs", () => api.listJobs(), "GET", "api/jobs"],
    ["getJob", () => api.getJob("j1"), "GET", "api/jobs/j1"],
    ["retryJob", () => api.retryJob("j1"), "POST", "api/jobs/j1/retry"],
    ["listUsers", () => api.listUsers(), "GET", "api/admin/users"],
    ["signOutUser", () => api.signOutUser("u1"), "POST", "api/admin/users/u1/sign-out"],
    ["revokeUserTokens", () => api.revokeUserTokens("u1"), "DELETE", "api/admin/users/u1/tokens"],
    ["adoptLocal", () => api.adoptLocal(), "POST", "api/admin/adopt-local"],
    ["listLibraries", () => api.listLibraries(), "GET", "api/libraries"],
    ["createBand", () => api.createBand("Tuesday"), "POST", "api/libraries"],
    ["renameBand", () => api.renameBand("b1", "Wednesday"), "PATCH", "api/libraries/b1"],
    ["deleteBand", () => api.deleteBand("b1"), "DELETE", "api/libraries/b1"],
    ["listMembers", () => api.listMembers("b1"), "GET", "api/libraries/b1/members"],
    ["addMember", () => api.addMember("b1", "a@b.c", "view"), "POST", "api/libraries/b1/members"],
    [
      "setMemberRole",
      () => api.setMemberRole("b1", "u1", "edit"),
      "PATCH",
      "api/libraries/b1/members/u1",
    ],
    ["removeMember", () => api.removeMember("b1", "u1"), "DELETE", "api/libraries/b1/members/u1"],
    ["copySongTo", () => api.copySongTo("s1", "b1"), "POST", "api/songs/s1/copy"],
    ["moveSongTo", () => api.moveSongTo("s1", "b1"), "POST", "api/songs/s1/move"],
    ["listShares", () => api.listShares("s1"), "GET", "api/songs/s1/shares"],
    ["createShare", () => api.createShare("s1", 7), "POST", "api/songs/s1/shares"],
    ["revokeShare", () => api.revokeShare("s1", "sh1"), "DELETE", "api/songs/s1/shares/sh1"],
    ["getSharedSong", () => api.getSharedSong("sh_abc"), "GET", "api/share/sh_abc"],
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

describe("practice log", () => {
  const draft = {
    song_id: "s1",
    day: "2026-03-10",
    duration_seconds: 60,
    track_id: "t1",
    loop_name: "",
    loop_start: null,
    loop_end: null,
    speed: 1,
    mode: "free" as const,
    score: null,
  };

  it("posts a session, with keepalive when the page is going away", async () => {
    await api.recordPracticeSession(draft, true);
    expect(calls[0].url).toBe("http://fretbook.test/app/api/practice/sessions");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.keepalive).toBe(true);
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      song_id: "s1",
      day: "2026-03-10",
    });
  });

  it("never throws when the log cannot be written", async () => {
    respond = () => reply({ detail: "down" }, 500);
    await expect(api.recordPracticeSession(draft)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(api.recordPracticeSession(draft)).resolves.toBeUndefined();
  });

  it("reads the dashboard for the player's day, saves the goal and reads a song's history", async () => {
    await api.getPracticeStats("2026-03-10");
    expect(calls[0].url).toBe("http://fretbook.test/app/api/practice/stats?today=2026-03-10");
    await api.savePracticeGoal({ daily_minutes: 20, weekly_summary: false });
    expect(calls[1].url).toBe("http://fretbook.test/app/api/practice/goal");
    expect(calls[1].init?.method).toBe("PUT");
    await api.getSongPractice("s1");
    expect(calls[2].url).toBe("http://fretbook.test/app/api/songs/s1/practice");
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

  it("does not send a public share visitor to sign in", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/app/share/sh_abc", search: "", assign });
    respond = () => reply({ detail: { key: "share.notFound", message: "missing" } }, 404);
    await expect(api.getSharedSong("sh_a/b")).rejects.toMatchObject({ key: "share.notFound" });
    expect(calls[0].url).toBe("http://fretbook.test/app/api/share/sh_a%2Fb");
    expect(assign).not.toHaveBeenCalled();
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

describe("transcription", () => {
  it("asks whether a worker can transcribe and queues a job with the chosen options", async () => {
    respond = (call) =>
      call.init?.method === "POST" ? reply({ job_id: "j9" }, 202) : reply({ available: true });
    expect(await api.getTranscribeInfo("s1")).toEqual({ available: true });
    expect(await api.startTranscribe("s1", { stem: "bass", grid: 8 })).toEqual({ job_id: "j9" });
    const post = calls.at(-1)!;
    expect(post.url).toContain("/api/songs/s1/transcribe");
    expect(JSON.parse(String(post.init?.body))).toEqual({ stem: "bass", grid: 8 });
  });
});
