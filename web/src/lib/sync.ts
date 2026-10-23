import { barTicks, TICKS_PER_QUARTER } from "./durations";
import { occurrences, playedBars } from "./playback";
import type { Bar, ScoreDocument, SyncMap } from "./types";

/*
 * Same piecewise-linear bar timing as `fretbook/score/sync.py`: anchors pin bar
 * starts; bars between anchors are spread by their natural length.
 */

/** Natural length of each bar in seconds, from its signature and the tempo in force. */
export function barSeconds(document: ScoreDocument): number[] {
  let tempo = document.bpm;
  return document.bars.map((bar, index) => {
    if (index > 0 && bar.tempo) tempo = bar.tempo;
    return (barTicks(bar.signature) / TICKS_PER_QUARTER) * (60 / tempo);
  });
}

/**
 * Length in seconds of each *played* bar: the written bars expanded through repeats and jumps.
 * The tempo in force follows the playing order, and bar 0 always restarts at the opening tempo.
 */
export function playedSeconds(document: ScoreDocument): number[] {
  let tempo = document.bpm;
  return playedBars(document.bars).map((index) => {
    const bar = document.bars[index];
    if (index === 0) tempo = document.bpm;
    else if (bar.tempo) tempo = bar.tempo;
    return (barTicks(bar.signature) / TICKS_PER_QUARTER) * (60 / tempo);
  });
}

export function measureStarts(barLengths: number[], anchors: Record<number, number>): number[] {
  if (barLengths.some((length) => length <= 0)) throw new Error("bar lengths must be positive");
  const count = barLengths.length;
  const natural = [0];
  for (const length of barLengths) natural.push(natural[natural.length - 1] + length);
  const ordered = Object.keys(anchors)
    .map(Number)
    .filter((index) => index >= 0 && index <= count)
    .sort((left, right) => left - right);
  if (ordered.length === 0) return natural;
  const at = (index: number) => Number(anchors[index]);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const previous = ordered[ordered.length - 2];
  const tailScale =
    ordered.length > 1 ? (at(last) - at(previous)) / (natural[last] - natural[previous]) : 1;
  const starts = new Array<number>(count + 1);
  let cursor = 0;
  for (let index = 0; index <= count; index += 1) {
    if (index <= first) {
      starts[index] = at(first) - (natural[first] - natural[index]);
    } else if (index >= last) {
      starts[index] = at(last) + tailScale * (natural[index] - natural[last]);
    } else {
      while (ordered[cursor + 1] <= index) cursor += 1;
      const left = ordered[cursor];
      const right = ordered[cursor + 1];
      const fraction = (natural[index] - natural[left]) / (natural[right] - natural[left]);
      starts[index] = at(left) + fraction * (at(right) - at(left));
    }
  }
  return starts;
}

export function measureAt(starts: number[], timeSeconds: number): number {
  const count = starts.length - 1;
  if (count <= 0 || timeSeconds < starts[0]) return -1;
  if (timeSeconds >= starts[count]) return count;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= timeSeconds) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Published points as anchors, skipping bars the source had no time for. */
export function pointAnchors(sync: SyncMap, barCount: number): Record<string, number> {
  const anchors: Record<string, number> = {};
  sync.points.forEach((point, index) => {
    if (point != null && index < barCount) anchors[String(index)] = point;
  });
  return anchors;
}

/** User taps win. Otherwise published points line the bars up. */
export function playbackAnchors(sync: SyncMap, barCount: number): Record<number, number> {
  const source = Object.keys(sync.anchors).length > 0 ? sync.anchors : pointAnchors(sync, barCount);
  const anchors: Record<number, number> = {};
  for (const [key, value] of Object.entries(source)) anchors[Number(key)] = Number(value);
  return anchors;
}

/** Start time of each played bar, then the end of the song. */
export function songStarts(document: ScoreDocument): number[] {
  const seconds = playedSeconds(document);
  return measureStarts(seconds, playbackAnchors(document.sync, seconds.length));
}

/**
 * Pin `bar` to `seconds` and move every later anchor by the same amount, so a
 * section that slipped (a source that plays bars the tab does not have) is put
 * right with one tap. `starts` are the bar starts in force before the change.
 */
export function moveAnchor(
  anchors: Record<string, number>,
  starts: number[],
  bar: number,
  seconds: number,
): Record<string, number> {
  const delta = seconds - starts[bar];
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(anchors)) {
    next[key] = Number(key) > bar ? Number((value + delta).toFixed(3)) : value;
  }
  next[String(bar)] = Number(seconds.toFixed(3));
  return next;
}

/**
 * Re-key sync marks after the editor inserts or removes bars or changes repeats.
 * `origin[i]` is the written bar index the current bar `i` came from, or null for a new bar.
 * `before` and `after` are the written bars the marks were keyed against and the bars now; a mark
 * follows the same pass (occurrence) of the same bar.
 */
export function remapSync(
  sync: SyncMap,
  origin: (number | null)[],
  before?: readonly Bar[],
  after?: readonly Bar[],
): SyncMap {
  if (!before || !after) {
    const anchors: Record<string, number> = {};
    origin.forEach((source, index) => {
      if (source != null && sync.anchors[String(source)] != null)
        anchors[String(index)] = sync.anchors[String(source)];
    });
    return {
      video_id: sync.video_id,
      points: sync.points.length
        ? origin.map((source) => (source != null ? (sync.points[source] ?? null) : null))
        : [],
      anchors,
      keyed_by: sync.keyed_by ?? "played",
    };
  }
  const oldOrder = playedBars(before);
  const newOrder = playedBars(after);
  const oldSlots = new Map<string, number>();
  const oldPass = occurrences(oldOrder);
  oldOrder.forEach((written, played) => oldSlots.set(`${written}:${oldPass[played]}`, played));
  const newPass = occurrences(newOrder);
  const source = newOrder.map((written, played) => {
    const from = origin[written];
    return from == null ? null : (oldSlots.get(`${from}:${newPass[played]}`) ?? null);
  });
  const anchors: Record<string, number> = {};
  source.forEach((from, index) => {
    if (from != null && sync.anchors[String(from)] != null)
      anchors[String(index)] = sync.anchors[String(from)];
  });
  return {
    video_id: sync.video_id,
    points: sync.points.length
      ? source.map((from) => (from != null ? (sync.points[from] ?? null) : null))
      : [],
    anchors,
    keyed_by: "played",
  };
}

export interface FlatSyncPoint {
  barIndex: number;
  barPosition: number;
  barOccurence: number;
  millisecondOffset: number;
}

/**
 * Flat sync points for alphaTab: one per played bar, each naming the written bar and which pass
 * of it (`barOccurence`) it is, so a repeated bar gets a time for every pass.
 * `starts` are the played bar starts then the end; `order` is the written bar of each played bar.
 */
export function flatSyncPoints(
  starts: number[],
  order?: readonly number[],
): { points: FlatSyncPoint[]; shiftMs: number } {
  const milliseconds = starts.map((start) => Math.round(start * 1000));
  const shiftMs = milliseconds[0] < 0 ? -milliseconds[0] : 0;
  const count = milliseconds.length - 1;
  const resolvedOrder = order ?? Array.from({ length: Math.max(0, count) }, (_, i) => i);
  const pass = occurrences(resolvedOrder);
  const points: FlatSyncPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    points.push({
      barIndex: resolvedOrder[index],
      barPosition: 0,
      barOccurence: pass[index],
      millisecondOffset: milliseconds[index] + shiftMs,
    });
  }
  if (count > 0) {
    let end = milliseconds[count] + shiftMs;
    const last = milliseconds[count - 1] + shiftMs;
    if (end <= last) end = last + 1;
    points.push({
      barIndex: resolvedOrder[count - 1],
      barPosition: 1,
      barOccurence: pass[count - 1],
      millisecondOffset: end,
    });
  }
  return { points, shiftMs };
}
