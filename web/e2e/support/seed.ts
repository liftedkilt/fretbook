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

  /** A generated 240 bpm bass tab (one second a bar), long enough to scroll the score. */
  async longBassTab(bars: number): Promise<SeededSong> {
    const title = "Long Groove";
    const document = {
      version: 1,
      bpm: 240,
      bars: Array.from({ length: bars }, () => ({ signature: [4, 4] })),
      sync: { video_id: null, points: [], anchors: {} },
      tracks: [
        {
          id: "trk_bass",
          name: "Bass",
          instrument: "bass-guitar",
          capo: 0,
          tuning_midi: [43, 38, 33, 28],
          preferred: true,
          bars: Array.from({ length: bars }, (_, bar) => ({
            voices: [
              {
                beats: [0, 1, 2, 3].map((beat) => ({
                  position: beat * 960,
                  duration: 960,
                  notes: [{ string: 3, fret: (bar + beat) % 12 }],
                })),
              },
            ],
          })),
        },
      ],
    };
    const accepted = await this.ok<{ job_id: string }>(
      await this.request.post("/api/imports/file", {
        multipart: {
          file: {
            name: "long-groove.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({ title, content_kind: "tab", document })),
          },
        },
      }),
    );
    return { id: await this.waitForJob(accepted.job_id), title };
  }

  /** A two-beat guitar tab: a C major chord, then a G major chord (`chords-played.wav` strums both). */
  async chordTab(): Promise<SeededSong> {
    const title = "Two Chords";
    const beat = (position: number, frets: number[]) => ({
      position,
      duration: 1920,
      // Strings are numbered from the highest (0 = high E); a null fret is not played.
      notes: frets.flatMap((fret, string) => (fret < 0 ? [] : [{ string, fret }])),
    });
    const document = {
      version: 1,
      bpm: 60,
      bars: [{ signature: [4, 4] }],
      sync: { video_id: null, points: [], anchors: {} },
      tracks: [
        {
          id: "trk_guitar",
          name: "Guitar",
          instrument: "guitar",
          capo: 0,
          tuning_midi: [64, 59, 55, 50, 45, 40],
          preferred: true,
          bars: [
            {
              voices: [
                {
                  beats: [beat(0, [0, 1, 0, 2, 3, -1]), beat(1920, [3, 0, 0, 0, 2, 3])],
                },
              ],
            },
          ],
        },
      ],
    };
    const accepted = await this.ok<{ job_id: string }>(
      await this.request.post("/api/imports/file", {
        multipart: {
          file: {
            name: "two-chords.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({ title, content_kind: "tab", document })),
          },
        },
      }),
    );
    return { id: await this.waitForJob(accepted.job_id), title };
  }

  /** A guitar tab whose first bar has a tempo, a section name, and let ring. */
  async effectLabelTab(): Promise<SeededSong> {
    const title = "Label Spacing";
    const chord = (position: number, frets: number[]) => ({
      position,
      duration: 960,
      notes: frets.map((fret, string) => ({ string, fret, let_ring: true })),
    });
    const bar = () => ({
      voices: [
        {
          beats: [
            chord(0, [1, 0, 2, 3]),
            chord(960, [1, 0, 2, 3]),
            chord(1920, [0, 0, 2, 3]),
            chord(2880, [0, 0, 2, 3]),
          ],
        },
      ],
    });
    const document = {
      version: 1,
      bpm: 92,
      bars: [
        { signature: [4, 4], section: "Intro" },
        { signature: [4, 4] },
        { signature: [4, 4] },
        { signature: [4, 4], section: "Verse" },
      ],
      sync: { video_id: null, points: [], anchors: {} },
      tracks: [
        {
          id: "trk_guitar",
          name: "Steel Guitar",
          instrument: "electric-guitar",
          capo: 0,
          tuning_midi: [64, 59, 55, 50, 45, 40],
          preferred: true,
          bars: [bar(), bar(), bar(), bar()],
        },
      ],
    };
    const accepted = await this.ok<{ job_id: string }>(
      await this.request.post("/api/imports/file", {
        multipart: {
          file: {
            name: "label-spacing.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({ title, content_kind: "tab", document })),
          },
        },
      }),
    );
    return { id: await this.waitForJob(accepted.job_id), title };
  }

  async list(): Promise<SongBody[]> {
    return (await this.ok<{ items: SongBody[] }>(await this.request.get("/api/songs?limit=200")))
      .items;
  }
}
