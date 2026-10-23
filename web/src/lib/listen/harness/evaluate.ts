import { PitchEngine, type PitchEvent } from "../engine";
import { centsBetween, midiToFrequency } from "../notes";

export interface TruthNote {
  midi: number;
  start: number;
  duration: number;
  legato?: boolean;
}

export interface Report {
  notes: number;
  /** Notes whose steady part was read as the right note within `centsTolerance`. */
  pitchHits: number;
  /** Notes read an octave (or two) off. */
  octaveErrors: number;
  unpitched: number;
  medianAbsCents: number;
  onsetRecall: number;
  onsetPrecision: number;
  attacksFound: number;
  attacksExpected: number;
  falseOnsets: number;
  worst: string[];
}

export interface EvaluateOptions {
  sampleRate: number;
  /** Pass the truth note as the expected note, as wait mode does. */
  useExpected?: boolean;
  centsTolerance?: number;
  /** How far an onset may land from the true attack, seconds. */
  onsetTolerance?: number;
  legatoOnsetTolerance?: number;
  blockSize?: number;
}

/** Run a recording through the engine in worklet-sized blocks. */
export function runEngine(
  samples: Float32Array,
  sampleRate: number,
  blockSize = 128,
  expected?: (time: number) => number | null,
): PitchEvent[] {
  const engine = new PitchEngine({ sampleRate });
  const events: PitchEvent[] = [];
  for (let at = 0; at < samples.length; at += blockSize) {
    const time = at / sampleRate;
    if (expected) engine.setExpectedMidi(expected(time));
    events.push(...engine.process(samples.subarray(at, Math.min(samples.length, at + blockSize)), time));
  }
  return events;
}

export function evaluate(samples: Float32Array, truth: TruthNote[], options: EvaluateOptions): Report {
  const { sampleRate } = options;
  const tolerance = options.centsTolerance ?? 25;
  const sorted = [...truth].sort((a, b) => a.start - b.start);
  const expected = options.useExpected
    ? (time: number) => {
        // Look slightly ahead, as a score cursor would.
        const current = sorted.filter((n) => n.start - 0.05 <= time).pop();
        return current ? current.midi : null;
      }
    : undefined;
  const events = runEngine(samples, sampleRate, options.blockSize ?? 128, expected);

  let pitchHits = 0;
  let octaveErrors = 0;
  let unpitched = 0;
  const errors: number[] = [];
  const worst: string[] = [];
  sorted.forEach((note, index) => {
    const end = Math.min(note.start + note.duration, sorted[index + 1]?.start ?? Infinity);
    // The steady part: after the analysis window has filled with the note, before the damping.
    const from = note.start + 0.12;
    const to = end - 0.03;
    const inside = events.filter((e) => e.time >= from && e.time <= to);
    if (inside.length === 0) return;
    const reference = midiToFrequency(note.midi);
    const voiced = inside.filter((e) => e.frequency !== null);
    if (voiced.length < inside.length / 2) {
      unpitched++;
      worst.push(`midi ${note.midi} @${note.start.toFixed(2)}s: mostly unpitched`);
      return;
    }
    const cents = voiced.map((e) => centsBetween(e.frequency as number, reference)).sort((a, b) => a - b);
    const median = cents[Math.floor(cents.length / 2)];
    errors.push(Math.abs(median));
    if (Math.abs(median) <= tolerance) pitchHits++;
    else {
      const octaves = Math.round(median / 1200);
      if (octaves !== 0 && Math.abs(median - octaves * 1200) <= tolerance) octaveErrors++;
      worst.push(`midi ${note.midi} @${note.start.toFixed(2)}s: ${median.toFixed(0)} cents off`);
    }
  });

  const claimed = events.filter((e) => e.onsetTime !== null).map((e) => e.onsetTime as number);
  const used = new Set<number>();
  let found = 0;
  for (const note of sorted) {
    const window = note.legato ? (options.legatoOnsetTolerance ?? 0.15) : (options.onsetTolerance ?? 0.06);
    let best = -1;
    let bestDelta = Infinity;
    claimed.forEach((time, i) => {
      const delta = Math.abs(time - note.start);
      if (!used.has(i) && delta <= window && delta < bestDelta) {
        best = i;
        bestDelta = delta;
      }
    });
    if (best >= 0) {
      used.add(best);
      found++;
    } else worst.push(`midi ${note.midi} @${note.start.toFixed(2)}s: attack missed`);
  }
  const falseOnsets = claimed.length - used.size;

  errors.sort((a, b) => a - b);
  return {
    notes: sorted.length,
    pitchHits,
    octaveErrors,
    unpitched,
    medianAbsCents: errors.length ? errors[Math.floor(errors.length / 2)] : NaN,
    onsetRecall: sorted.length ? found / sorted.length : 1,
    onsetPrecision: claimed.length ? used.size / claimed.length : 1,
    attacksFound: found,
    attacksExpected: sorted.length,
    falseOnsets,
    worst,
  };
}

export function formatReport(name: string, report: Report): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  return [
    `${name}: ${report.notes} notes`,
    `  pitch    ${report.pitchHits}/${report.notes} within tolerance, median error ${report.medianAbsCents.toFixed(1)} cents, ${report.octaveErrors} octave errors, ${report.unpitched} unpitched`,
    `  onsets   recall ${pct(report.onsetRecall)} (${report.attacksFound}/${report.attacksExpected}), precision ${pct(report.onsetPrecision)}, ${report.falseOnsets} false`,
    ...report.worst.slice(0, 6).map((line) => `  ! ${line}`),
  ].join("\n");
}
