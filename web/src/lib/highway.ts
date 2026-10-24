import { barTicks } from "./durations";
import { pitchClassName } from "./fretboard";
import { playedBars } from "./playback";
import { measureStarts, playedSeconds, songStarts } from "./sync";
import type { HarmonicKind, Note, ScoreDocument, SlideKind, Track } from "./types";

/*
 * Yousician-style scrolling note highway: pure timeline builder, chord naming,
 * viewport windowing, wait-mode / scored-play gem state resolution, and 2D
 * Canvas frame renderer.
 */

export type GemState = "default" | "waiting" | "hit" | "missed" | "early" | "late" | "wrong";

export type TechniqueKind =
  "hammer" | "pull" | "slide" | "bend" | "palm_mute" | "vibrato" | "harmonic";

export interface TechniqueGlyph {
  kind: TechniqueKind;
  label: string;
}

export interface HighwayGem {
  /** Played bar index (0-based). */
  bar: number;
  /** Ticks from the start of the bar. */
  position: number;
  /** Duration in ticks, including tied notes on the same string. */
  duration: number;
  /** 0 is the highest string. */
  string: number;
  /** Fret number (counts from the capo). */
  fret: number;
  /** MIDI pitch (tuning_midi[string] + capo + fret). */
  midi: number;
  /** Start time in seconds on the playback clock. */
  time: number;
  /** End of sustain in seconds on the playback clock. */
  endTime: number;
  /** Text drawn inside the gem ("3", "X", "(5)"). */
  label: string;
  dead: boolean;
  ghost: boolean;
  hammer: boolean;
  /** Fret of the next note on the same string for hammer/pull/slide connectors. */
  targetFret: number | null;
  /** Time in seconds of the next note on the same string. */
  targetTime: number | null;
  slide: SlideKind | null;
  vibrato: boolean;
  harmonic: HarmonicKind | null;
  bend: number | null;
  palmMute: boolean;
  letRing: boolean;
  staccato: boolean;
  techniques: TechniqueGlyph[];
}

export interface HighwayChord {
  bar: number;
  position: number;
  time: number;
  endTime: number;
  /** Chord name shown above the chord block (e.g. "Em", "G", "D5"). */
  name: string;
  /** Highest string index (smallest number) in the chord. */
  topString: number;
  /** Lowest string index (largest number) in the chord. */
  bottomString: number;
  midis: number[];
}

export interface HighwayBeat {
  bar: number;
  /** 0-based beat index in the bar; 0 is the bar line (downbeat). */
  beat: number;
  time: number;
  isDownbeat: boolean;
}

export interface HighwayBar {
  /** Played bar index (0-based). */
  bar: number;
  /** Written bar index (0-based). */
  writtenBar: number;
  /** 1-based bar number for display. */
  number: number;
  startTime: number;
  endTime: number;
  ticks: number;
  signature: [number, number];
  section: string | null;
  beats: HighwayBeat[];
}

export interface HighwayTimeline {
  tuning: number[];
  capo: number;
  stringNames: string[];
  starts: number[];
  bars: HighwayBar[];
  gems: HighwayGem[];
  chords: HighwayChord[];
  totalDuration: number;
}

export interface HighwaySectionInfo {
  name: string;
  bar: number;
  time: number;
}

export interface HighwayVisibleWindow {
  bars: HighwayBar[];
  gems: HighwayGem[];
  chords: HighwayChord[];
  currentSection: string | null;
  upcomingSection: HighwaySectionInfo | null;
}

/** Distinct per-string colours (highest string 0 first, up to 8 strings). */
export const STRING_COLORS: readonly string[] = [
  "#b56bff", // String 1 (high e / G): violet
  "#47c97e", // String 2 (B / D): emerald
  "#ff9240", // String 3 (G / A): orange
  "#3ea8ff", // String 4 (D / E): sky blue
  "#ffd147", // String 5 (A / B): gold
  "#ff5470", // String 6 (Low E): crimson
  "#2dd4bf", // String 7: teal
  "#f472b6", // String 8: rose
];

export function stringColor(stringIndex: number): string {
  return STRING_COLORS[Math.max(0, stringIndex) % STRING_COLORS.length];
}

/** Key for a beat (`bar:position`) or a single string gem (`bar:position:string`). */
export function gemKey(bar: number, position: number, string?: number): string {
  return string === undefined ? `${bar}:${position}` : `${bar}:${position}:${string}`;
}

/**
 * Start time of each played bar, followed by the end time of the song.
 * With a recording, sync marks pin the bars; with the synth, bars follow their written tempos.
 */
export function highwayStarts(document: ScoreDocument, hasAudio: boolean): number[] {
  if (hasAudio) return songStarts(document);
  const lengths = playedSeconds(document);
  return lengths.length > 0 ? measureStarts(lengths, {}) : [0];
}

/** Converts a played bar index and tick offset into seconds on the playback clock. */
export function timeAtBarPosition(
  starts: readonly number[],
  bar: number,
  position: number,
  ticksInBar: number,
): number {
  const barCount = starts.length - 1;
  if (barCount <= 0) return 0;
  if (bar < 0) return starts[0];
  if (bar >= barCount) return starts[barCount];
  const start = starts[bar];
  const end = starts[bar + 1];
  if (ticksInBar <= 0 || end <= start) return start;
  const fraction = Math.min(1, Math.max(0, position / ticksInBar));
  return start + fraction * (end - start);
}

/** Formats a bend in semitones as steps ("½", "1", "1½", "2"). */
export function formatBendSemitones(semitones: number): string {
  const halfSteps = Math.max(1, Math.round(semitones));
  const whole = Math.floor(halfSteps / 2);
  const rem = halfSteps % 2;
  if (whole === 0) return "½";
  return rem === 1 ? `${whole}½` : String(whole);
}

/** Builds the technique glyphs shown on or around a note gem. */
export function buildTechniqueGlyphs(
  note: Pick<Note, "fret" | "hammer" | "slide" | "bend" | "palm_mute" | "vibrato" | "harmonic">,
  targetFret: number | null = null,
): TechniqueGlyph[] {
  const glyphs: TechniqueGlyph[] = [];
  if (note.hammer) {
    if (targetFret !== null && targetFret > note.fret) {
      glyphs.push({ kind: "hammer", label: "H" });
    } else if (targetFret !== null && targetFret < note.fret) {
      glyphs.push({ kind: "pull", label: "P" });
    } else {
      glyphs.push({ kind: "hammer", label: "H/P" });
    }
  }
  if (note.slide) {
    const down =
      note.slide === "in_above" ||
      note.slide === "out_down" ||
      (targetFret !== null && targetFret < note.fret);
    glyphs.push({ kind: "slide", label: down ? "\\" : "/" });
  }
  if (typeof note.bend === "number" && note.bend > 0) {
    glyphs.push({ kind: "bend", label: `⤴${formatBendSemitones(note.bend)}` });
  }
  if (note.palm_mute) {
    glyphs.push({ kind: "palm_mute", label: "PM" });
  }
  if (note.vibrato) {
    glyphs.push({ kind: "vibrato", label: "~" });
  }
  if (note.harmonic) {
    glyphs.push({ kind: "harmonic", label: "◇" });
  }
  return glyphs;
}

const CHORD_PATTERNS: readonly { intervals: readonly number[]; suffix: string }[] = [
  { intervals: [0, 7], suffix: "5" },
  { intervals: [0, 4, 7], suffix: "" },
  { intervals: [0, 3, 7], suffix: "m" },
  { intervals: [0, 4, 7, 10], suffix: "7" },
  { intervals: [0, 4, 10], suffix: "7" },
  { intervals: [0, 4, 7, 11], suffix: "maj7" },
  { intervals: [0, 4, 11], suffix: "maj7" },
  { intervals: [0, 3, 7, 10], suffix: "m7" },
  { intervals: [0, 3, 10], suffix: "m7" },
  { intervals: [0, 5, 7], suffix: "sus4" },
  { intervals: [0, 2, 7], suffix: "sus2" },
  { intervals: [0, 3, 6], suffix: "dim" },
  { intervals: [0, 4, 8], suffix: "aug" },
  { intervals: [0, 3, 6, 10], suffix: "m7b5" },
  { intervals: [0, 3, 6, 9], suffix: "dim7" },
  { intervals: [0, 4, 7, 9], suffix: "6" },
  { intervals: [0, 3, 7, 9], suffix: "m6" },
  { intervals: [0, 2, 4, 7], suffix: "add9" },
  { intervals: [0, 2, 3, 7], suffix: "m(add9)" },
  { intervals: [0, 2, 4, 7, 10], suffix: "9" },
  { intervals: [0, 2, 3, 7, 10], suffix: "m9" },
  { intervals: [0, 4], suffix: "" },
  { intervals: [0, 3], suffix: "m" },
];

function matchesIntervals(
  pitchClasses: readonly number[],
  root: number,
  target: readonly number[],
): boolean {
  if (pitchClasses.length !== target.length) return false;
  const rel = new Set(pitchClasses.map((pc) => (((pc - root) % 12) + 12) % 12));
  return target.every((interval) => rel.has(interval));
}

/**
 * Names a chord from its MIDI notes (e.g. "Em", "G", "D5", "Am7", "C/G").
 * Returns "" when fewer than two pitched notes are given.
 */
export function identifyChord(midis: readonly number[]): string {
  if (midis.length < 2) return "";
  const sorted = [...midis].sort((a, b) => a - b);
  const bassPc = ((sorted[0] % 12) + 12) % 12;
  const uniquePcs = [...new Set(sorted.map((m) => ((m % 12) + 12) % 12))];
  if (uniquePcs.length === 1) {
    return pitchClassName(bassPc);
  }
  // Test the bass note as the root first.
  for (const pattern of CHORD_PATTERNS) {
    if (matchesIntervals(uniquePcs, bassPc, pattern.intervals)) {
      return `${pitchClassName(bassPc)}${pattern.suffix}`;
    }
  }
  // Test inversions for 3+ pitch classes.
  if (uniquePcs.length >= 3) {
    for (const rootPc of uniquePcs) {
      if (rootPc === bassPc) continue;
      for (const pattern of CHORD_PATTERNS) {
        if (
          pattern.intervals.length >= 3 &&
          matchesIntervals(uniquePcs, rootPc, pattern.intervals)
        ) {
          return `${pitchClassName(rootPc)}${pattern.suffix}/${pitchClassName(bassPc)}`;
        }
      }
    }
  }
  return pitchClassName(bassPc);
}

/**
 * Compiles the played bars, beats, sections, note gems, sustain tails, technique
 * connectors, and chord blocks for a track.
 */
export function buildHighwayTimeline(
  document: ScoreDocument,
  track: Track,
  hasAudio = false,
): HighwayTimeline {
  const order = playedBars(document.bars);
  const starts = highwayStarts(document, hasAudio);
  const stringNames = track.tuning_midi.map((midi) => pitchClassName(midi + track.capo));
  const bars: HighwayBar[] = [];
  const gems: HighwayGem[] = [];
  const chords: HighwayChord[] = [];

  // Track the most recent gem on each string so tied notes extend its tail and
  // hammer/pull/slides know their target fret and time.
  const lastGemByString = new Map<number, HighwayGem>();

  order.forEach((written, played) => {
    const barDoc = document.bars[written];
    if (!barDoc) return;
    const ticks = barTicks(barDoc.signature);
    const startTime = starts[played] ?? 0;
    const endTime = starts[played + 1] ?? startTime;
    const beatsCount = Math.max(1, barDoc.signature[0]);
    const beats: HighwayBeat[] = Array.from({ length: beatsCount }, (_, beat) => ({
      bar: played,
      beat,
      time: startTime + (beat / beatsCount) * (endTime - startTime),
      isDownbeat: beat === 0,
    }));

    bars.push({
      bar: played,
      writtenBar: written,
      number: played + 1,
      startTime,
      endTime,
      ticks,
      signature: barDoc.signature,
      section: barDoc.section ?? null,
      beats,
    });

    // Collect beats across voices in this bar, sorted by position.
    const byPosition = new Map<
      number,
      { duration: number; notes: Note[]; explicitChord: string | null }
    >();
    const trackBar = track.bars[written];
    for (const voice of trackBar?.voices ?? []) {
      for (const beat of voice.beats) {
        if (beat.grace || beat.notes.length === 0) continue;
        const entry = byPosition.get(beat.position) ?? {
          duration: beat.duration,
          notes: [],
          explicitChord:
            typeof beat.extras?.chord === "string" && beat.extras.chord.trim()
              ? beat.extras.chord.trim()
              : null,
        };
        entry.duration = Math.max(entry.duration, beat.duration);
        for (const note of beat.notes) {
          if (!entry.notes.some((item) => item.string === note.string)) {
            entry.notes.push(note);
          }
        }
        byPosition.set(beat.position, entry);
      }
    }

    const sortedPositions = [...byPosition.entries()].sort((a, b) => a[0] - b[0]);
    for (const [position, beatData] of sortedPositions) {
      const attackTime = timeAtBarPosition(starts, played, position, ticks);
      const effectiveTicks = beatData.duration;
      const rawEndTime = timeAtBarPosition(starts, played, position + effectiveTicks, ticks);

      // Sort notes from highest string (0) to lowest string.
      const sortedNotes = [...beatData.notes].sort((a, b) => a.string - b.string);
      const attackedMidis: number[] = [];
      let topString = Infinity;
      let bottomString = -Infinity;
      let chordEndTime = rawEndTime;

      for (const note of sortedNotes) {
        const midi = (track.tuning_midi[note.string] ?? 0) + track.capo + note.fret;
        const prev = lastGemByString.get(note.string);

        // If this note is tied to the previous note on the same string, extend the previous tail.
        if (note.tie && prev && Math.abs(prev.endTime - attackTime) < 0.05) {
          prev.duration += effectiveTicks;
          prev.endTime = Math.max(prev.endTime, rawEndTime);
          if (note.vibrato) prev.vibrato = true;
          if (note.bend && (!prev.bend || note.bend > prev.bend)) prev.bend = note.bend;
          prev.techniques = buildTechniqueGlyphs(
            {
              fret: prev.fret,
              hammer: prev.hammer,
              slide: prev.slide,
              bend: prev.bend,
              palm_mute: prev.palmMute,
              vibrato: prev.vibrato,
              harmonic: prev.harmonic,
            },
            prev.targetFret,
          );
          continue;
        }

        // Link previous gem on this string if it had hammer-on/pull-off or shift/legato slide.
        if (
          prev &&
          (prev.hammer || prev.slide === "shift" || prev.slide === "legato") &&
          Math.abs(prev.endTime - attackTime) < 0.05
        ) {
          prev.targetFret = note.fret;
          prev.targetTime = attackTime;
          prev.techniques = buildTechniqueGlyphs(
            {
              fret: prev.fret,
              hammer: prev.hammer,
              slide: prev.slide,
              bend: prev.bend,
              palm_mute: prev.palmMute,
              vibrato: prev.vibrato,
              harmonic: prev.harmonic,
            },
            note.fret,
          );
        }

        const dead = Boolean(note.dead);
        const ghost = Boolean(note.ghost);
        const staccato = Boolean(note.staccato);
        const noteEndTime = dead
          ? attackTime
          : staccato
            ? attackTime + (rawEndTime - attackTime) * 0.5
            : rawEndTime;
        const label = dead ? "X" : ghost ? `(${note.fret})` : String(note.fret);

        const gem: HighwayGem = {
          bar: played,
          position,
          duration: effectiveTicks,
          string: note.string,
          fret: note.fret,
          midi,
          time: attackTime,
          endTime: noteEndTime,
          label,
          dead,
          ghost,
          hammer: Boolean(note.hammer),
          targetFret: null,
          targetTime: null,
          slide: note.slide ?? null,
          vibrato: Boolean(note.vibrato),
          harmonic: note.harmonic ?? null,
          bend: note.bend ?? null,
          palmMute: Boolean(note.palm_mute),
          letRing: Boolean(note.let_ring),
          staccato,
          techniques: buildTechniqueGlyphs(note, null),
        };

        gems.push(gem);
        lastGemByString.set(note.string, gem);

        if (!dead) {
          attackedMidis.push(midi);
          topString = Math.min(topString, note.string);
          bottomString = Math.max(bottomString, note.string);
          chordEndTime = Math.max(chordEndTime, noteEndTime);
        }
      }

      if (attackedMidis.length >= 2) {
        const name = beatData.explicitChord ?? identifyChord(attackedMidis);
        if (name) {
          chords.push({
            bar: played,
            position,
            time: attackTime,
            endTime: chordEndTime,
            name,
            topString,
            bottomString,
            midis: attackedMidis,
          });
        }
      }
    }
  });

  const totalDuration = starts.length > 0 ? starts[starts.length - 1] : 0;
  return {
    tuning: [...track.tuning_midi],
    capo: track.capo,
    stringNames,
    starts,
    bars,
    gems,
    chords,
    totalDuration,
  };
}

/**
 * Resolves the display state of a gem for Wait Mode and Scored Play.
 * Checks per-note key (`bar:position:string`) first, then per-beat key (`bar:position`),
 * then `waitingAt`.
 */
export function resolveGemState(
  gem: Pick<HighwayGem, "bar" | "position" | "string">,
  grades?: ReadonlyMap<string, GemState> | Record<string, GemState>,
  waitingAt?: { bar: number; position: number } | null,
): GemState {
  if (grades) {
    const noteKey = gemKey(gem.bar, gem.position, gem.string);
    const beatKey = gemKey(gem.bar, gem.position);
    if (grades instanceof Map) {
      const byNote = grades.get(noteKey);
      if (byNote) return byNote;
      const byBeat = grades.get(beatKey);
      if (byBeat) return byBeat;
    } else {
      const record = grades as Record<string, GemState | undefined>;
      if (record[noteKey]) return record[noteKey];
      if (record[beatKey]) return record[beatKey];
    }
  }
  if (waitingAt && waitingAt.bar === gem.bar && waitingAt.position === gem.position) {
    return "waiting";
  }
  return "default";
}

/**
 * Slices the bars, gems, and chords that overlap `[currentTime - pastSeconds, currentTime + lookaheadSeconds]`,
 * and finds the active and next upcoming section labels.
 */
export function visibleWindow(
  timeline: HighwayTimeline,
  currentTime: number,
  pastSeconds = 0.6,
  lookaheadSeconds = 4.0,
): HighwayVisibleWindow {
  const minTime = currentTime - pastSeconds;
  const maxTime = currentTime + lookaheadSeconds;

  // Binary search for the first bar whose endTime >= minTime.
  let barLow = 0;
  let barHigh = timeline.bars.length - 1;
  let firstBar = timeline.bars.length;
  while (barLow <= barHigh) {
    const mid = (barLow + barHigh) >> 1;
    if (timeline.bars[mid].endTime >= minTime) {
      firstBar = mid;
      barHigh = mid - 1;
    } else {
      barLow = mid + 1;
    }
  }

  const bars: HighwayBar[] = [];
  for (let i = firstBar; i < timeline.bars.length; i += 1) {
    const bar = timeline.bars[i];
    if (bar.startTime > maxTime) break;
    bars.push(bar);
  }

  // Binary search for the first chord whose endTime >= minTime.
  let chordLow = 0;
  let chordHigh = timeline.chords.length - 1;
  let firstChord = timeline.chords.length;
  while (chordLow <= chordHigh) {
    const mid = (chordLow + chordHigh) >> 1;
    if (timeline.chords[mid].endTime >= minTime) {
      firstChord = mid;
      chordHigh = mid - 1;
    } else {
      chordLow = mid + 1;
    }
  }

  const chords: HighwayChord[] = [];
  for (let i = firstChord; i < timeline.chords.length; i += 1) {
    const chord = timeline.chords[i];
    if (chord.time > maxTime) break;
    chords.push(chord);
  }

  // Gems are ordered by attack time; a long sustain from an earlier bar can still be visible,
  // so scan from the start of the first visible bar (or earlier if a sustain bridges across).
  const firstVisibleBarIndex = bars.length > 0 ? bars[0].bar : -1;
  let gemLow = 0;
  let gemHigh = timeline.gems.length - 1;
  let firstGem = timeline.gems.length;
  while (gemLow <= gemHigh) {
    const mid = (gemLow + gemHigh) >> 1;
    const gem = timeline.gems[mid];
    if (
      gem.endTime >= minTime ||
      (firstVisibleBarIndex >= 0 && gem.bar >= Math.max(0, firstVisibleBarIndex - 1))
    ) {
      firstGem = mid;
      gemHigh = mid - 1;
    } else {
      gemLow = mid + 1;
    }
  }

  const gems: HighwayGem[] = [];
  for (let i = firstGem; i < timeline.gems.length; i += 1) {
    const gem = timeline.gems[i];
    if (gem.time > maxTime) break;
    const reach = Math.max(gem.endTime, gem.targetTime ?? gem.endTime);
    if (reach >= minTime) gems.push(gem);
  }

  let currentSection: string | null = null;
  let upcomingSection: HighwaySectionInfo | null = null;
  for (const bar of timeline.bars) {
    if (!bar.section) continue;
    if (bar.startTime <= currentTime + 0.001) {
      currentSection = bar.section;
    } else if (!upcomingSection) {
      upcomingSection = { name: bar.section, bar: bar.bar, time: bar.startTime };
      break;
    }
  }

  return { bars, gems, chords, currentSection, upcomingSection };
}

/** Subset of CanvasRenderingContext2D used by `drawHighway`, so tests can pass a lightweight spy. */
export interface HighwayCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  roundRect?(x: number, y: number, w: number, h: number, radii?: number | readonly number[]): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  setLineDash(segments: readonly number[]): void;
}

export interface DrawHighwayOptions {
  timeline: HighwayTimeline;
  currentTime: number;
  width: number;
  height: number;
  pastSeconds?: number;
  lookaheadSeconds?: number;
  loopA?: number | null;
  loopB?: number | null;
  grades?: ReadonlyMap<string, GemState> | Record<string, GemState>;
  waitingAt?: { bar: number; position: number } | null;
}

export interface HighwayLayout {
  width: number;
  height: number;
  headerHeight: number;
  topY: number;
  bottomY: number;
  laneGap: number;
  hitX: number;
  pxPerSecond: number;
  pastSeconds: number;
  lookaheadSeconds: number;
}

export function computeHighwayLayout(
  width: number,
  height: number,
  stringCount: number,
  pastSeconds = 0.6,
  lookaheadSeconds = 4.0,
): HighwayLayout {
  const safeWidth = Math.max(240, width);
  const safeHeight = Math.max(160, height);
  const headerHeight = 36;
  const topY = headerHeight + 24;
  const bottomY = safeHeight - 24;
  const count = Math.max(1, stringCount);
  const laneGap = count > 1 ? (bottomY - topY) / (count - 1) : 0;
  const hitX = Math.max(76, Math.min(160, Math.round(safeWidth * 0.18)));
  const pxPerSecond = (safeWidth - hitX) / Math.max(0.5, lookaheadSeconds);
  return {
    width: safeWidth,
    height: safeHeight,
    headerHeight,
    topY,
    bottomY,
    laneGap,
    hitX,
    pxPerSecond,
    pastSeconds,
    lookaheadSeconds,
  };
}

export function timeToX(layout: HighwayLayout, time: number, currentTime: number): number {
  return layout.hitX + (time - currentTime) * layout.pxPerSecond;
}

export function xToTime(layout: HighwayLayout, x: number, currentTime: number): number {
  return currentTime + (x - layout.hitX) / layout.pxPerSecond;
}

export function laneY(layout: HighwayLayout, stringIndex: number): number {
  return layout.topY + stringIndex * layout.laneGap;
}

function drawRoundedRect(
  ctx: HighwayCanvasContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(x + radius, y + h);
  ctx.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + radius);
  ctx.arc(x + radius, y + radius, radius, Math.PI, (Math.PI * 3) / 2);
  ctx.closePath();
}

function stateColors(
  state: GemState,
  stringIndex: number,
): { fill: string; border: string; tail: string; text: string } {
  const base = stringColor(stringIndex);
  switch (state) {
    case "hit":
      return {
        fill: "#22b573",
        border: "#8ef5c4",
        tail: "rgba(46, 213, 140, 0.55)",
        text: "#ffffff",
      };
    case "missed":
      return {
        fill: "#b83b48",
        border: "#ff8a95",
        tail: "rgba(224, 82, 96, 0.35)",
        text: "rgba(255, 255, 255, 0.85)",
      };
    case "wrong":
      return {
        fill: "#8a4bd6",
        border: "#d2b0ff",
        tail: "rgba(160, 100, 235, 0.4)",
        text: "#ffffff",
      };
    case "waiting":
      return {
        fill: "#ff7a50",
        border: "#ffe082",
        tail: "rgba(255, 122, 80, 0.6)",
        text: "#ffffff",
      };
    case "early":
    case "late":
      return {
        fill: "#d99426",
        border: "#ffe08a",
        tail: "rgba(255, 198, 92, 0.5)",
        text: "#ffffff",
      };
    default:
      return {
        fill: base,
        border: "rgba(255, 255, 255, 0.88)",
        tail: `${base}77`,
        text: "#ffffff",
      };
  }
}

/**
 * Renders one 60fps frame of the scrolling note highway onto `ctx`.
 */
export function drawHighway(ctx: HighwayCanvasContext, options: DrawHighwayOptions): void {
  const {
    timeline,
    currentTime,
    width,
    height,
    pastSeconds = 0.6,
    lookaheadSeconds = 4.0,
    loopA = null,
    loopB = null,
    grades,
    waitingAt = null,
  } = options;

  const stringCount = Math.max(1, timeline.tuning.length);
  const layout = computeHighwayLayout(width, height, stringCount, pastSeconds, lookaheadSeconds);
  const windowData = visibleWindow(timeline, currentTime, pastSeconds, lookaheadSeconds);

  ctx.save();
  ctx.clearRect(0, 0, layout.width, layout.height);

  // 1. Stage background & top rail.
  ctx.fillStyle = "#121018";
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#191622";
  ctx.fillRect(0, 0, layout.width, layout.headerHeight);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, layout.headerHeight);
  ctx.lineTo(layout.width, layout.headerHeight);
  ctx.stroke();

  // 2. Loop A–B highlight, bar lines, beat lines, bar numbers, and section flags.
  for (const bar of windowData.bars) {
    const barX = timeToX(layout, bar.startTime, currentTime);
    const barEndX = timeToX(layout, bar.endTime, currentTime);

    if (loopA !== null && loopB !== null && bar.bar >= loopA && bar.bar <= loopB) {
      const left = Math.max(0, barX);
      const right = Math.min(layout.width, barEndX);
      if (right > left) {
        ctx.fillStyle = "rgba(255, 122, 80, 0.08)";
        ctx.fillRect(left, layout.headerHeight, right - left, layout.height - layout.headerHeight);
      }
    }

    for (const beat of bar.beats) {
      const bx = timeToX(layout, beat.time, currentTime);
      if (bx < 0 || bx > layout.width) continue;
      ctx.beginPath();
      ctx.strokeStyle = beat.isDownbeat ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = beat.isDownbeat ? 1.5 : 1;
      ctx.moveTo(bx, beat.isDownbeat ? layout.headerHeight : layout.topY - 8);
      ctx.lineTo(bx, layout.bottomY + 8);
      ctx.stroke();
    }

    // Bar number in header rail.
    if (barX >= 48 && barX <= layout.width - 16) {
      ctx.fillStyle = "rgba(244, 241, 236, 0.55)";
      ctx.font = "600 11px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(bar.number), barX + 5, layout.headerHeight / 2);
    }

    // Upcoming section pill in header rail.
    if (bar.section && barX >= 48 && barX <= layout.width - 24) {
      const label = bar.section;
      const badgeW = Math.max(44, label.length * 7 + 16);
      const badgeX = barX + 24;
      const badgeY = 6;
      ctx.fillStyle = "rgba(255, 122, 80, 0.22)";
      ctx.strokeStyle = "rgba(255, 122, 80, 0.65)";
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, badgeX, badgeY, badgeW, 22, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ff9b78";
      ctx.font = "600 11px 'Inter', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, badgeX + badgeW / 2, badgeY + 11);
    }
  }

  // 3. Chord blocks with chord names.
  for (const chord of windowData.chords) {
    const cx = timeToX(layout, chord.time, currentTime);
    if (cx < 32 || cx > layout.width + 24) continue;
    const topY = laneY(layout, chord.topString) - 18;
    const bottomY = laneY(layout, chord.bottomString) + 18;
    const blockW = 42;
    const blockH = Math.max(36, bottomY - topY);

    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1.25;
    drawRoundedRect(ctx, cx - blockW / 2, topY, blockW, blockH, 10);
    ctx.fill();
    ctx.stroke();

    // Chord name pill above the chord block.
    const pillW = Math.max(32, chord.name.length * 7.5 + 12);
    const pillH = 18;
    const pillY = Math.max(layout.headerHeight + 3, topY - pillH - 3);
    ctx.fillStyle = "#262235";
    ctx.strokeStyle = "rgba(255, 155, 120, 0.6)";
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, cx - pillW / 2, pillY, pillW, pillH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ff9b78";
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(chord.name, cx, pillY + pillH / 2);
  }

  // 4. Horizontal string lanes.
  for (let s = 0; s < stringCount; s += 1) {
    const y = laneY(layout, s);
    const gauge = 1.4 + (s / Math.max(1, stringCount - 1)) * 2.0;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = gauge;
    ctx.moveTo(46, y);
    ctx.lineTo(layout.width, y);
    ctx.stroke();
  }

  // 5. Hit line (strike zone) and target receivers per string.
  const waitingNow = waitingAt !== null;
  ctx.save();
  ctx.strokeStyle = waitingNow ? "#ffc65c" : "#ff7a50";
  ctx.lineWidth = waitingNow ? 3.5 : 2.5;
  ctx.shadowColor = waitingNow ? "rgba(255, 198, 92, 0.8)" : "rgba(255, 122, 80, 0.7)";
  ctx.shadowBlur = waitingNow ? 14 : 10;
  ctx.beginPath();
  ctx.moveTo(layout.hitX, layout.headerHeight + 4);
  ctx.lineTo(layout.hitX, layout.height - 6);
  ctx.stroke();
  ctx.restore();

  for (let s = 0; s < stringCount; s += 1) {
    const y = laneY(layout, s);
    ctx.beginPath();
    ctx.strokeStyle = stringColor(s);
    ctx.fillStyle = "#17151e";
    ctx.lineWidth = 2;
    ctx.arc(layout.hitX, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // 6. Sustain tails and technique connectors (drawn behind note gems).
  for (const gem of windowData.gems) {
    const gx = timeToX(layout, gem.time, currentTime);
    const endX = timeToX(layout, gem.endTime, currentTime);
    const y = laneY(layout, gem.string);
    const state = resolveGemState(gem, grades, waitingAt);
    const colors = stateColors(state, gem.string);

    // Sustain tail.
    if (!gem.dead && endX > gx + 14) {
      const tailStart = Math.max(46, gx);
      const tailEnd = Math.min(layout.width, endX);
      if (tailEnd > tailStart) {
        const tailH = 8;
        ctx.fillStyle = colors.tail;
        drawRoundedRect(ctx, tailStart, y - tailH / 2, tailEnd - tailStart, tailH, 4);
        ctx.fill();

        if (gem.vibrato) {
          ctx.beginPath();
          ctx.strokeStyle = colors.border;
          ctx.lineWidth = 1.5;
          const step = 6;
          for (let vx = tailStart + 12; vx < tailEnd - 4; vx += step) {
            const offset = ((Math.floor((vx - tailStart) / step) % 2) * 2 - 1) * 3;
            if (vx === tailStart + 12) ctx.moveTo(vx, y);
            ctx.lineTo(vx + step / 2, y + offset);
          }
          ctx.stroke();
        }

        if (gem.bend && gem.bend > 0) {
          ctx.beginPath();
          ctx.strokeStyle = colors.border;
          ctx.lineWidth = 2;
          ctx.moveTo(tailStart + 10, y);
          ctx.quadraticCurveTo(
            (tailStart + tailEnd) / 2,
            y - Math.min(18, gem.bend * 5),
            tailEnd,
            y - Math.min(16, gem.bend * 4),
          );
          ctx.stroke();
        }
      }
    }

    // Hammer/pull slur arc or slide connector to the next note on the same string.
    if (gem.targetTime !== null) {
      const tx = timeToX(layout, gem.targetTime, currentTime);
      if (tx > gx + 8) {
        if (gem.hammer) {
          ctx.beginPath();
          ctx.strokeStyle = colors.border;
          ctx.lineWidth = 1.75;
          ctx.moveTo(gx + 10, y - 10);
          ctx.quadraticCurveTo((gx + tx) / 2, y - 24, tx - 10, y - 10);
          ctx.stroke();
        }
        if (gem.slide === "shift" || gem.slide === "legato") {
          const slope = gem.targetFret !== null && gem.targetFret < gem.fret ? 6 : -6;
          ctx.beginPath();
          ctx.strokeStyle = colors.border;
          ctx.lineWidth = 2;
          ctx.moveTo(gx + 14, y - slope);
          ctx.lineTo(tx - 14, y + slope);
          ctx.stroke();
        }
      }
    }
  }

  // 7. Note gems with fret numbers and technique glyphs.
  for (const gem of windowData.gems) {
    const gx = timeToX(layout, gem.time, currentTime);
    if (gx < 34 || gx > layout.width + 24) continue;
    const y = laneY(layout, gem.string);
    const state = resolveGemState(gem, grades, waitingAt);
    const colors = stateColors(state, gem.string);
    const activeNow =
      state === "waiting" ||
      (gem.time <= currentTime + 0.04 && Math.max(gem.endTime, gem.time + 0.12) >= currentTime);

    const gemW = gem.label.length >= 3 ? 38 : gem.label.length === 2 ? 32 : 28;
    const gemH = 24;

    ctx.save();
    if (activeNow) {
      ctx.shadowColor = colors.fill;
      ctx.shadowBlur = 12;
    }
    if (state === "missed") {
      ctx.globalAlpha = 0.65;
    }

    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = activeNow ? "#ffffff" : colors.border;
    ctx.lineWidth = activeNow ? 2.4 : 1.5;
    if (gem.ghost) ctx.setLineDash([3, 2]);
    drawRoundedRect(ctx, gx - gemW / 2, y - gemH / 2, gemW, gemH, 8);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Fret number or X inside the gem.
    ctx.fillStyle = colors.text;
    ctx.font = "700 13px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(gem.label, gx, y + 0.5);

    // Technique glyph badges above/below the gem.
    if (gem.techniques.length > 0) {
      const badgeText = gem.techniques.map((item) => item.label).join(" ");
      ctx.fillStyle = "rgba(244, 241, 236, 0.92)";
      ctx.font = "700 10px 'Inter', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(badgeText, gx, y - gemH / 2 - 2);
    }
    ctx.restore();
  }

  // 8. Left string-tuning gutter (drawn on top so scrolling gems tuck behind the nut labels).
  ctx.fillStyle = "#171520";
  ctx.fillRect(0, layout.headerHeight + 1, 46, layout.height - layout.headerHeight - 1);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(46, layout.headerHeight);
  ctx.lineTo(46, layout.height);
  ctx.stroke();

  for (let s = 0; s < stringCount; s += 1) {
    const y = laneY(layout, s);
    const color = stringColor(s);
    const name = timeline.stringNames[s] ?? String(s + 1);
    ctx.fillStyle = `${color}28`;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 8, y - 11, 30, 22, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f4f1ec";
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 23, y + 0.5);
  }

  ctx.restore();
}
