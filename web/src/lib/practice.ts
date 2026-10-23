import type { Bar } from "./types";

/*
 * Practice controls: the metronome, the count-in, and the mixer. The settings
 * are remembered per song in this browser. The click schedule is plain
 * arithmetic over the bar starts so it follows tempo and time-signature
 * changes, and sync marks when a recording sets the pace.
 */

export interface TrackMix {
  volume: number;
  mute: boolean;
  solo: boolean;
}

export type CountInBars = 0 | 1 | 2;

export interface PracticeSettings {
  metronome: { on: boolean; volume: number };
  countIn: { bars: CountInBars; beforeLoops: boolean };
  mix: {
    /** The recording's volume. */
    audio: number;
    /** The built-in synth's volume (used when the song has no recording). */
    synth: number;
    tracks: Record<string, TrackMix>;
  };
}

export interface Click {
  /** Seconds, on the clock the caller passed in. */
  time: number;
  accent: boolean;
}

const KEY_PREFIX = "fretbook.practice.";

export function defaultTrackMix(): TrackMix {
  return { volume: 1, mute: false, solo: false };
}

export function defaultPractice(): PracticeSettings {
  return {
    metronome: { on: false, volume: 0.7 },
    countIn: { bars: 0, beforeLoops: false },
    mix: { audio: 1, synth: 1, tracks: {} },
  };
}

export function clamp01(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads stored settings, keeping every valid field and defaulting the rest. */
export function parsePractice(raw: unknown): PracticeSettings {
  const result = defaultPractice();
  if (!isRecord(raw)) return result;
  const { metronome, countIn, mix } = raw;
  if (isRecord(metronome)) {
    result.metronome.on = metronome.on === true;
    result.metronome.volume = clamp01(metronome.volume, result.metronome.volume);
  }
  if (isRecord(countIn)) {
    if (countIn.bars === 1 || countIn.bars === 2) result.countIn.bars = countIn.bars;
    result.countIn.beforeLoops = countIn.beforeLoops === true;
  }
  if (isRecord(mix)) {
    result.mix.audio = clamp01(mix.audio, 1);
    result.mix.synth = clamp01(mix.synth, 1);
    if (isRecord(mix.tracks)) {
      for (const [id, value] of Object.entries(mix.tracks)) {
        if (!isRecord(value)) continue;
        result.mix.tracks[id] = {
          volume: clamp01(value.volume, 1),
          mute: value.mute === true,
          solo: value.solo === true,
        };
      }
    }
  }
  return result;
}

export function loadPractice(songId: string): PracticeSettings {
  try {
    const raw =
      typeof localStorage === "undefined" ? null : localStorage.getItem(KEY_PREFIX + songId);
    return parsePractice(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultPractice();
  }
}

export function savePractice(songId: string, settings: PracticeSettings): void {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(KEY_PREFIX + songId, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota: the settings just do not stick.
  }
}

export function nextCountIn(bars: CountInBars): CountInBars {
  return bars === 0 ? 1 : bars === 1 ? 2 : 0;
}

/** A track's mix, with defaults for one that was never touched. */
export function trackMix(settings: PracticeSettings, id: string): TrackMix {
  return settings.mix.tracks[id] ?? defaultTrackMix();
}

/** The beats of one bar, spread evenly between its start and end, with the first accented. */
export function barClicks(start: number, end: number, beats: number): Click[] {
  const count = Math.max(1, Math.floor(beats));
  const step = (end - start) / count;
  return Array.from({ length: count }, (_, beat) => ({
    time: start + beat * step,
    accent: beat === 0,
  }));
}

/**
 * Metronome clicks with `from <= time < to`. `starts` has one more entry than
 * `bars` (the end of the last bar), as `songStarts` returns it.
 */
export function clicksBetween(
  starts: number[],
  bars: Pick<Bar, "signature">[],
  from: number,
  to: number,
): Click[] {
  const result: Click[] = [];
  for (let index = 0; index < bars.length && index + 1 < starts.length; index += 1) {
    if (starts[index + 1] <= from) continue;
    if (starts[index] >= to) break;
    for (const click of barClicks(starts[index], starts[index + 1], bars[index].signature[0])) {
      if (click.time >= from && click.time < to) result.push(click);
    }
  }
  return result;
}

/** Clicks for `bars` empty bars of `barSeconds` each, from time 0, and when the music starts. */
export function countInClicks(
  signature: [number, number],
  barSeconds: number,
  bars: number,
): { clicks: Click[]; duration: number } {
  const clicks: Click[] = [];
  for (let bar = 0; bar < bars; bar += 1)
    clicks.push(...barClicks(bar * barSeconds, (bar + 1) * barSeconds, signature[0]));
  return { clicks, duration: bars * barSeconds };
}

/**
 * Hands out each metronome click once. Call `due` often with the media clock;
 * it returns the clicks that fall inside the look-ahead window, as delays in
 * wall-clock seconds (media time runs `rate` times faster than the wall clock).
 */
export class ClickScheduler {
  private last = -Infinity;

  /** Forget what was handed out: after a seek, a loop jump, a pause, or a rate change. */
  reset(): void {
    this.last = -Infinity;
  }

  due(
    starts: number[],
    bars: Pick<Bar, "signature">[],
    now: number,
    rate: number,
    lookahead: number,
  ): { delay: number; accent: boolean }[] {
    const from = Math.max(now, this.last);
    const to = now + lookahead * rate;
    const picked = clicksBetween(starts, bars, from, to).filter((click) => click.time > this.last);
    if (picked.length) this.last = picked[picked.length - 1].time;
    // A click this close to `from` would already be late, but it is better than a dropped beat.
    return picked.map((click) => ({
      delay: Math.max(0, (click.time - now) / rate),
      accent: click.accent,
    }));
  }
}

type PitchHints = HTMLAudioElement & {
  webkitPreservesPitch?: boolean;
  mozPreservesPitch?: boolean;
};

/**
 * Slowing an `<audio>` element keeps its pitch only while `preservesPitch` is on.
 * It is the default in current browsers; older Firefox and Safari use prefixed names.
 */
export function preservePitch(audio: HTMLAudioElement): void {
  const element = audio as PitchHints;
  element.preservesPitch = true;
  if ("webkitPreservesPitch" in element) element.webkitPreservesPitch = true;
  if ("mozPreservesPitch" in element) element.mozPreservesPitch = true;
}
