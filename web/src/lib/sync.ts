import type { SyncMap } from "./types";

/** Same piecewise-linear map as `fretbook.score.sync.measure_starts`. */
export function measureStarts(
  measureCount: number,
  bpm: number,
  anchors: Record<number, number>,
): number[] {
  if (measureCount < 0) throw new Error("measure_count must be >= 0");
  if (bpm <= 0) throw new Error("bpm must be positive");
  const bar = 240 / bpm;
  const ordered = Object.keys(anchors)
    .map(Number)
    .sort((left, right) => left - right);
  const starts = new Array<number>(measureCount + 1);
  if (ordered.length === 0) {
    for (let index = 0; index <= measureCount; index += 1) starts[index] = index * bar;
    return starts;
  }
  const at = (index: number) => anchors[index];
  const last = ordered[ordered.length - 1];
  for (let index = 0; index <= measureCount; index += 1) {
    if (index <= ordered[0]) {
      starts[index] = at(ordered[0]) - (ordered[0] - index) * bar;
    } else if (index >= last) {
      const step =
        ordered.length > 1
          ? (at(last) - at(ordered[ordered.length - 2])) / (last - ordered[ordered.length - 2])
          : bar;
      starts[index] = at(last) + (index - last) * step;
    } else {
      let cursor = 0;
      while (ordered[cursor + 1] <= index) cursor += 1;
      const left = ordered[cursor];
      const right = ordered[cursor + 1];
      const fraction = (index - left) / (right - left);
      starts[index] = at(left) + fraction * (at(right) - at(left));
    }
  }
  return starts;
}

export function measureAt(starts: number[], timeSeconds: number): number {
  const count = starts.length - 1;
  if (count <= 0 || timeSeconds < starts[0]) return -1;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= timeSeconds) low = mid;
    else high = mid - 1;
  }
  if (timeSeconds >= starts[count]) return count;
  return low;
}

/** User taps win. Otherwise published points line the measures up. */
export function playbackAnchors(sync: SyncMap, measureCount: number): Record<number, number> {
  const anchors: Record<number, number> = {};
  for (const [key, value] of Object.entries(sync.anchors)) anchors[Number(key)] = Number(value);
  if (Object.keys(anchors).length > 0) return anchors;
  sync.points.forEach((point, index) => {
    if (index < measureCount) anchors[index] = point;
  });
  return anchors;
}

export interface FlatSyncPoint {
  barIndex: number;
  barPosition: number;
  barOccurence: number;
  millisecondOffset: number;
}

export function flatSyncPoints(starts: number[]): { points: FlatSyncPoint[]; shiftMs: number } {
  const milliseconds = starts.map((start) => Math.round(start * 1000));
  const shiftMs = milliseconds[0] < 0 ? -milliseconds[0] : 0;
  const count = milliseconds.length - 1;
  const points: FlatSyncPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    points.push({
      barIndex: index,
      barPosition: 0,
      barOccurence: 0,
      millisecondOffset: milliseconds[index] + shiftMs,
    });
  }
  if (count > 0) {
    let end = milliseconds[count] + shiftMs;
    const last = milliseconds[count - 1] + shiftMs;
    if (end <= last) end = last + 1;
    points.push({
      barIndex: count - 1,
      barPosition: 1,
      barOccurence: 0,
      millisecondOffset: end,
    });
  }
  return { points, shiftMs };
}
