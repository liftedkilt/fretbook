import { readFileSync } from "node:fs";
import path from "node:path";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { fixture } from "./paths";

export type SeededSong = { id: string; title: string };

type SongBody = { id: string; title: string };
type JobBody = {
  status: "queued" | "running" | "done" | "error";
  error: string | null;
  result: { song_id?: string } | null;
};

/**
 * Creates songs through the HTTP API, the way a script or another client would.
 * `request` is any Playwright request context for the server: a plain one in single-user mode,
 * or `page.request` after signing in, which carries the session cookie.
 */
export class Seeder {
  constructor(private readonly request: APIRequestContext) {}

  private async ok<T>(response: APIResponse): Promise<T> {
    if (!response.ok())
      throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
    return (await response.json()) as T;
  }

  private async waitForJob(jobId: string): Promise<string> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const job = await this.ok<JobBody>(await this.request.get(`/api/jobs/${jobId}`));
      if (job.status === "error") throw new Error(`import failed: ${job.error}`);
      if (job.status === "done") {
        if (!job.result?.song_id) throw new Error("import finished without a song");
        return job.result.song_id;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("import did not finish in 20 s");
  }

  /** Upload a fixture file for import (MusicXML, ChordPro, or Fretbook JSON) and wait for the job. */
  async importFile(name: string, mimeType: string): Promise<string> {
    const accepted = await this.ok<{ job_id: string }>(
      await this.request.post("/api/imports/file", {
        multipart: {
          file: { name: path.basename(name), mimeType, buffer: readFileSync(fixture(name)) },
        },
      }),
    );
    return this.waitForJob(accepted.job_id);
  }

  /** A four-bar bass tab from `practice-riff.musicxml`. */
  async musicXmlTab(): Promise<SeededSong> {
    const id = await this.importFile("practice-riff.musicxml", "application/xml");
    return { id, title: "Practice Riff" };
  }

  /** A chord sheet from `sunny-chords.cho`. */
  async chordSheet(): Promise<SeededSong> {
    const id = await this.importFile("sunny-chords.cho", "text/plain");
    return { id, title: "Sunny Day Blues" };
  }

  /** A blank guitar tab or chord sheet made with `POST /api/songs`. */
  async create(body: {
    title: string;
    artist?: string;
    preset?: string;
    chordpro?: string;
  }): Promise<SeededSong> {
    const song = await this.ok<SongBody>(
      await this.request.post("/api/songs", {
        data: { content_kind: body.chordpro === undefined ? "tab" : "chords", ...body },
      }),
    );
    return { id: song.id, title: song.title };
  }

  /** `synced-groove.json` (published sync points, one second per bar) with `click-track.wav` as its audio. */
  async syncedSongWithAudio(): Promise<SeededSong> {
    const id = await this.importFile("synced-groove.json", "application/json");
    await this.ok(
      await this.request.post(`/api/songs/${id}/audio`, {
        multipart: {
          file: {
            name: "click-track.wav",
            mimeType: "audio/wav",
            buffer: readFileSync(fixture("click-track.wav")),
          },
        },
      }),
    );
    return { id, title: "Synced Groove" };
  }

  async list(): Promise<SongBody[]> {
    return (await this.ok<{ items: SongBody[] }>(await this.request.get("/api/songs?limit=200")))
      .items;
  }
}
