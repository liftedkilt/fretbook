import type { Bar, DirectionKind } from "./types";

/*
 * Playback order: which written bars are played, and in what order. The same
 * algorithm as `fretbook/score/playback.py` (both tested on
 * `tests/fixtures/playback-order.json`), which follows alphaTab's synth
 * (`MidiPlaybackController`) so the order here is the order the player hears.
 * Sync marks are keyed by the position in this list, the played bar index.
 */

/** Every direction, targets first, in the order the editor offers them. */
export const DIRECTIONS: DirectionKind[] = [
  "segno",
  "segno_segno",
  "coda",
  "double_coda",
  "fine",
  "da_coda",
  "da_double_coda",
  "da_capo",
  "da_capo_al_coda",
  "da_capo_al_double_coda",
  "da_capo_al_fine",
  "dal_segno",
  "dal_segno_al_coda",
  "dal_segno_al_double_coda",
  "dal_segno_al_fine",
  "dal_segno_segno",
  "dal_segno_segno_al_coda",
  "dal_segno_segno_al_double_coda",
  "dal_segno_segno_al_fine",
];

/** A song cannot expand past this many bars; nested repeats would multiply into millions. */
export const MAX_PLAYED_BARS = 10_000;

type RepeatFields = Pick<Bar, "repeat_start" | "repeat_end" | "alternate_endings" | "directions">;

interface Group {
  opening: number;
  closings: number[];
  closed: boolean;
}

interface Repeat {
  group: Group;
  opening: number;
  iterations: number[];
  closingIndex: number;
}

// Jump directions and the state the pass enters after the jump.
const DA_CAPO: [string, number][] = [
  ["da_capo", 1],
  ["da_capo_al_coda", 2],
  ["da_capo_al_double_coda", 3],
  ["da_capo_al_fine", 4],
];
const DAL_SEGNO: [string, number][] = [
  ["dal_segno", 1],
  ["dal_segno_al_coda", 2],
  ["dal_segno_al_double_coda", 3],
  ["dal_segno_al_fine", 4],
];
const DAL_SEGNO_SEGNO: [string, number][] = [
  ["dal_segno_segno", 1],
  ["dal_segno_segno_al_coda", 2],
  ["dal_segno_segno_al_double_coda", 3],
  ["dal_segno_segno_al_fine", 4],
];
const AFTER_JUMP = 1;
const TO_CODA = 2;
const TO_DOUBLE_CODA = 3;
const TO_FINE = 4;

/** Assign every bar to a repeat group, as alphaTab's `Score._addMasterBarToRepeatGroups` does. */
function groupsOf(bars: readonly RepeatFields[]): Group[] {
  const owners: Group[] = [];
  const opened: Group[] = [];
  let properlyOpened = 0;
  let current: Group | null = null;
  bars.forEach((bar, index) => {
    if (bar.repeat_start) {
      if (current?.closed) {
        opened.pop();
        properlyOpened -= 1;
      }
      current = { opening: -1, closings: [], closed: false };
      opened.push(current);
      properlyOpened += 1;
    } else if (!current) {
      current = { opening: -1, closings: [], closed: false };
      opened.push(current);
    }
    if (current.opening < 0) current.opening = index;
    owners.push(current);
    if ((bar.repeat_end ?? 0) > 0) {
      current.closings.push(index);
      current.closed = true;
      if (properlyOpened > 1) {
        opened.pop();
        properlyOpened -= 1;
        current = opened.length > 0 ? opened[opened.length - 1] : null;
      }
    }
  });
  return owners;
}

function endingsMask(bar: RepeatFields): number {
  let mask = 0;
  for (const ending of bar.alternate_endings ?? []) {
    if (ending >= 1 && ending <= 31) mask |= 1 << (ending - 1);
  }
  return mask;
}

/** Written bar index of each played bar, in playing order. */
export function playedBars(bars: readonly RepeatFields[]): number[] {
  const count = bars.length;
  const owners = groupsOf(bars);
  const has = bars.map((bar) => new Set<string>(bar.directions ?? []));
  const endings = bars.map(endingsMask);

  const find = (target: string, start: number, backwardsFirst: boolean): number => {
    const forwards = (): number => {
      for (let index = start; index < count; index += 1) if (has[index].has(target)) return index;
      return -1;
    };
    const backwards = (): number => {
      for (let index = start; index >= 0; index -= 1) if (has[index].has(target)) return index;
      return -1;
    };
    const first = backwardsFirst ? backwards() : forwards();
    return first >= 0 ? first : backwardsFirst ? forwards() : backwards();
  };

  const jump = (directions: Set<string>, index: number): [number, number] => {
    const tables: [[string, number][], string | null][] = [
      [DA_CAPO, null],
      [DAL_SEGNO, "segno"],
      [DAL_SEGNO_SEGNO, "segno_segno"],
    ];
    for (const [names, target] of tables) {
      for (const [name, after] of names) {
        if (!directions.has(name)) continue;
        const destination = target === null ? 0 : find(target, index, true);
        if (destination >= 0) return [destination, after];
      }
    }
    return [-1, 0];
  };

  const played: number[] = [];
  let stack: Repeat[] = [];
  let onStack = new Set<Group>();
  let previousEndings = 0;
  let state = 0;
  let index = 0;

  while (index < count && played.length < MAX_PLAYED_BARS) {
    // Does this bar play on the current pass?
    let shouldPlay = true;
    if (state === 0) {
      let barEndings = endings[index] || previousEndings;
      const group = owners[index];
      if (index === group.opening && group.closed && !onStack.has(group)) {
        stack.push({
          group,
          opening: index,
          iterations: group.closings.map(() => 0),
          closingIndex: 0,
        });
        onStack.add(group);
        previousEndings = 0;
        barEndings = endings[index];
      }
      if (stack.length > 0 && barEndings) {
        const repeat = stack[stack.length - 1];
        previousEndings = barEndings;
        shouldPlay = (barEndings & (1 << repeat.iterations[repeat.closingIndex])) !== 0;
      }
    }
    if (shouldPlay) played.push(index);

    // Where does playback go next?
    const directions = has[index];
    if (directions.size > 0 && state === 0) {
      const [destination, after] = jump(directions, index);
      if (destination >= 0) {
        index = destination;
        state = after;
        stack = [];
        onStack = new Set();
        previousEndings = 0;
        continue;
      }
    } else if (directions.size > 0 && state !== AFTER_JUMP) {
      if (state === TO_CODA && directions.has("da_coda")) {
        const destination = find("coda", index, false);
        if (destination >= 0) {
          index = destination;
          state = 0;
          continue;
        }
      } else if (state === TO_DOUBLE_CODA && directions.has("da_double_coda")) {
        const destination = find("double_coda", index, false);
        if (destination >= 0) {
          index = destination;
          state = 0;
          continue;
        }
      } else if (state === TO_FINE && directions.has("fine")) {
        break;
      }
      index += 1;
      continue;
    }
    if (state !== 0) {
      index += 1;
      continue;
    }

    // Plain repeats.
    const extra = (bars[index].repeat_end ?? 0) - 1;
    if (stack.length > 0 && extra > 0) {
      const repeat = stack[stack.length - 1];
      if (repeat.iterations[repeat.closingIndex] < extra) {
        index = repeat.opening;
        repeat.iterations[repeat.closingIndex] += 1;
        for (let earlier = 0; earlier < repeat.closingIndex; earlier += 1)
          repeat.iterations[earlier] = 0;
        repeat.closingIndex = 0;
        previousEndings = 0;
      } else if (repeat.closingIndex < repeat.group.closings.length - 1) {
        repeat.closingIndex += 1;
        index += 1;
      } else {
        stack.pop();
        onStack.delete(repeat.group);
        index += 1;
      }
    } else {
      index += 1;
    }
  }
  return played;
}

/** For each played bar, how many times its written bar was played before it. */
export function occurrences(order: readonly number[]): number[] {
  const seen = new Map<number, number>();
  return order.map((written) => {
    const times = seen.get(written) ?? 0;
    seen.set(written, times + 1);
    return times;
  });
}

/** Played index of the first play of each written bar; the played count where it is never played. */
export function firstPlayed(order: readonly number[], writtenCount: number): number[] {
  const first = new Array<number>(writtenCount).fill(order.length);
  for (let position = order.length - 1; position >= 0; position -= 1)
    first[order[position]] = position;
  return first;
}

/**
 * Played index for an event on written bar `written`, given the played bar we were last on
 * (`current`, or -1): stay if it is the same bar, else the next play of it, wrapping to the start.
 */
export function followPlayed(order: readonly number[], written: number, current: number): number {
  if (order[current] === written) return current;
  for (let index = Math.max(0, current + 1); index < order.length; index += 1)
    if (order[index] === written) return index;
  return order.indexOf(written);
}
