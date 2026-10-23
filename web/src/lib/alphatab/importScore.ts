import * as alphaTab from "@coderline/alphatab";

import { t } from "../i18n.svelte";
import type {
  Bar,
  Beat,
  GraceKind,
  HarmonicKind,
  Note,
  ScoreDocument,
  SlideKind,
  Track,
  TrackBar,
} from "../types";

/**
 * alphaTab's model to a Fretbook document (Guitar Pro import).
 *
 * - alphaTab's `note.string` is 1 on the lowest string; our index 0 is the
 *   highest. `staff.tuning[0]` is already the highest string.
 * - alphaTab ticks are 960 per quarter, the same as ours.
 * - Master bars become song-level bars; each track keeps all its voices.
 */

const { GraceType, HarmonicType, SlideInType, SlideOutType, VibratoType } = alphaTab.model;

function slide(note: alphaTab.model.Note): SlideKind | null {
  switch (note.slideOutType) {
    case SlideOutType.Shift:
      return "shift";
    case SlideOutType.Legato:
      return "legato";
    case SlideOutType.OutUp:
      return "out_up";
    case SlideOutType.OutDown:
      return "out_down";
  }
  if (note.slideInType === SlideInType.IntoFromBelow) return "in_below";
  if (note.slideInType === SlideInType.IntoFromAbove) return "in_above";
  return null;
}

function harmonic(note: alphaTab.model.Note): HarmonicKind | null {
  switch (note.harmonicType) {
    case HarmonicType.Natural:
      return "natural";
    case HarmonicType.Artificial:
      return "artificial";
    case HarmonicType.Pinch:
      return "pinch";
    case HarmonicType.Tap:
      return "tap";
    case HarmonicType.Semi:
      return "semi";
  }
  return null;
}

function grace(beat: alphaTab.model.Beat): GraceKind | null {
  switch (beat.graceType) {
    case GraceType.OnBeat:
      return "on_beat";
    case GraceType.BeforeBeat:
      return "before_beat";
    case GraceType.BendGrace:
      return "bend";
  }
  return null;
}

function bendSemitones(note: alphaTab.model.Note): number | null {
  const points = note.bendPoints ?? [];
  if (!note.hasBend || points.length === 0) return null;
  // Bend values are quarter tones.
  const peak = Math.max(...points.map((point) => point.value)) / 2;
  return peak > 0 ? Math.min(4, peak) : null;
}

function convertNote(note: alphaTab.model.Note, strings: number): Note | null {
  if (!note.isStringed) return null;
  const index = strings - note.string;
  if (index < 0 || index >= strings) return null;
  return {
    string: index,
    fret: Math.max(0, Math.min(99, note.fret)),
    dead: note.isDead,
    tie: note.isTieDestination,
    ghost: note.isGhost,
    hammer: note.isHammerPullOrigin,
    slide: slide(note),
    vibrato: note.vibrato !== VibratoType.None,
    harmonic: harmonic(note),
    bend: bendSemitones(note),
    palm_mute: note.isPalmMute,
    let_ring: note.isLetRing,
    staccato: note.isStaccato,
    extras: {},
  };
}

function convertBeat(beat: alphaTab.model.Beat, strings: number): Beat {
  const kind = grace(beat);
  const notes = beat.isRest
    ? []
    : beat.notes
        .map((note) => convertNote(note, strings))
        .filter((note): note is Note => note !== null);
  return {
    position: Math.max(0, kind ? beat.displayStart : beat.playbackStart),
    duration: Math.max(1, kind ? beat.displayDuration : beat.playbackDuration),
    notes,
    grace: kind,
    tuplet: beat.hasTuplet ? beat.tupletNumerator : null,
    extras: {},
  };
}

function convertBars(score: alphaTab.model.Score): { bpm: number; bars: Bar[] } {
  let bpm = score.tempo || 120;
  const bars = score.masterBars.map((master, index): Bar => {
    const tempo = (master.tempoAutomations ?? []).find((mark) => mark.value > 0)?.value ?? null;
    if (index === 0 && tempo) bpm = tempo;
    const endings: number[] = [];
    for (let ending = 0; ending < 8; ending += 1) {
      if (master.alternateEndings & (1 << ending)) endings.push(ending + 1);
    }
    return {
      signature: [master.timeSignatureNumerator || 4, master.timeSignatureDenominator || 4],
      tempo: index > 0 ? tempo : null,
      repeat_start: master.isRepeatStart,
      repeat_end: master.isRepeatEnd ? Math.max(2, master.repeatCount) : 0,
      alternate_endings: endings,
      section: master.section?.text || null,
      extras: {},
    };
  });
  return { bpm, bars };
}

export function scoreToDocument(score: alphaTab.model.Score): {
  title: string;
  artist: string;
  document: ScoreDocument;
} {
  const { bpm, bars } = convertBars(score);
  const tracks: Track[] = [];
  score.tracks.forEach((source, index) => {
    if (source.isPercussion) return;
    const staff = source.staves.find((item) => item.tuning.length > 0 && !item.isPercussion);
    if (!staff) return;
    const tuning = [...staff.tuning];
    const trackBars: TrackBar[] = bars.map((_, barIndex) => {
      const bar = staff.bars[barIndex];
      const voices = (bar?.voices ?? [])
        .map((voice) => ({
          beats: voice.beats
            .filter((beat) => !(beat.isEmpty && beat.notes.length === 0))
            .map((beat) => convertBeat(beat, tuning.length)),
        }))
        .filter(
          (voice, voiceIndex) =>
            voiceIndex === 0 || voice.beats.some((beat) => beat.notes.length > 0),
        );
      return { voices: voices.length ? voices : [{ beats: [] }], extras: {} };
    });
    tracks.push({
      id: `trk_gp_${index}`,
      name: source.name || t("editor.untitledTrack", { number: index + 1 }),
      instrument: instrumentName(source.playbackInfo.program, tuning.length),
      capo: staff.capo || 0,
      tuning_midi: tuning,
      preferred: false,
      bars: trackBars,
    });
  });
  if (!tracks.length) throw new Error(t("import.noFrettedTracks"));
  return {
    title: score.title || t("library.untitled"),
    artist: score.artist || "",
    document: { version: 1, bpm, bars, tracks, sync: { video_id: null, points: [], anchors: {} } },
  };
}

/** Mark the first track of the preferred family (bass or guitar) as preferred. */
export function choosePreferred(document: ScoreDocument, family: "bass" | "guitar" | null): void {
  const index = family
    ? document.tracks.findIndex(
        (track) => track.instrument.includes("bass") === (family === "bass"),
      )
    : -1;
  document.tracks.forEach((track, position) => {
    track.preferred = position === (index >= 0 ? index : 0);
  });
}

function instrumentName(program: number, strings: number): string {
  // General MIDI: 24–25 acoustic guitar, 26–31 electric, 32–39 bass.
  if (program >= 32 && program <= 39) return "bass-guitar";
  if (program === 24 || program === 25) return "acoustic-guitar";
  if (program >= 26 && program <= 31) return "guitar";
  if (strings <= 5) return "bass-guitar";
  return "guitar";
}

export function documentFromGuitarPro(data: Uint8Array, family: "bass" | "guitar" | null = null) {
  const parsed = scoreToDocument(alphaTab.importer.ScoreLoader.loadScoreFromBytes(data));
  choosePreferred(parsed.document, family);
  return parsed;
}
