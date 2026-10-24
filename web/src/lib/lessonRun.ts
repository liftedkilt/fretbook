import type { LessonPassCondition, LessonProgressBody } from "./api-types";

/*
 * Playing a song for a lesson: the lesson is named in the song's address (`?lesson=<course>/<lesson>`), and the
 * player reports a scored or wait-mode result straight to it. Everything here is plain functions, so the rules
 * for what is reported are tested without a browser.
 */

/** The server refuses a tempo above this in a lesson result. */
export const MAX_PASS_BPM = 400;

export interface LessonRef {
  course: string;
  lesson: string;
}

const ID = /^[a-z0-9-]{1,64}$/;

/** The lesson named by a song address's query string, or null when there is none or it is not a lesson id pair. */
export function parseLessonParam(search: string): LessonRef | null {
  const value = new URLSearchParams(search).get("lesson");
  if (!value) return null;
  const [course, lesson, ...rest] = value.split("/");
  if (rest.length || !ID.test(course ?? "") || !ID.test(lesson ?? "")) return null;
  return { course, lesson };
}

/** The query string that makes a song page report to the lesson. */
export function lessonQuery(ref: LessonRef): string {
  return `?lesson=${ref.course}/${ref.lesson}`;
}

/** The song page that reports to the lesson. */
export function lessonSongPath(songId: string, ref: LessonRef): string {
  return `/songs/${encodeURIComponent(songId)}${lessonQuery(ref)}`;
}

/** A freshly imported song's page, reporting to the lesson; any other path is returned unchanged. */
export function withLesson(path: string, ref: LessonRef): string {
  const match = /^\/songs\/([^/?]+)$/.exec(path);
  return match ? lessonSongPath(decodeURIComponent(match[1]), ref) : path;
}

const PICK_PREFIX = "fretbook.lessonSong";

function pickKey(userId: string | null | undefined, ref: LessonRef): string {
  return `${PICK_PREFIX}.${userId || "local"}.${ref.course}/${ref.lesson}`;
}

/** The song this learner last picked for the lesson, or "" (storage can be missing or blocked). */
export function recallLessonSong(userId: string | null | undefined, ref: LessonRef): string {
  try {
    return localStorage.getItem(pickKey(userId, ref)) ?? "";
  } catch {
    return "";
  }
}

/** Remember the song picked for the lesson, per user on this device; an empty id forgets it. */
export function rememberLessonSong(
  userId: string | null | undefined,
  ref: LessonRef,
  songId: string,
): void {
  try {
    if (songId) localStorage.setItem(pickKey(userId, ref), songId);
    else localStorage.removeItem(pickKey(userId, ref));
  } catch {
    // Not being able to remember a pick must not get in the way of playing.
  }
}

export type LessonRun =
  | {
      kind: "scored";
      /** Percent of notes hit, 0 to 100. */
      accuracy: number;
      /** The song's written tempo. */
      songBpm: number;
      /** Playback speed as a ratio. */
      rate: number;
      /** The pass covered the whole song: no loop, no starting part way through. */
      wholeSong: boolean;
    }
  | { kind: "wait" };

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * What to post to the lesson for a finished run, or null when the run does not count towards it: the lesson has
 * no pass condition, is checked against a library song's practice log instead, wants the other kind of run, or the
 * scored run left out part of the song. Tempo is the song's tempo times the playback speed, as in the practice log.
 */
export function lessonResult(
  condition: Pick<LessonPassCondition, "type" | "song"> | null,
  run: LessonRun,
): LessonProgressBody | null {
  if (!condition || condition.song) return null;
  if (run.kind === "wait") {
    return condition.type === "wait" ? { wait_completed: true, completed: false } : null;
  }
  if (condition.type !== "score" || !run.wholeSong) return null;
  const body: LessonProgressBody = {
    score: Math.min(100, Math.max(0, round1(run.accuracy))),
    completed: false,
    wait_completed: false,
  };
  const bpm = round1(run.songBpm * run.rate);
  if (bpm > 0 && bpm <= MAX_PASS_BPM) body.bpm = bpm;
  return body;
}
