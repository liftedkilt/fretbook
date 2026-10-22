import * as alphaTab from "@coderline/alphatab";

import type { Beat, Note, ScoreDocument, Track } from "../types";

const QUARTER = 960;

/**
 * alphaTab's `note.string` is 1 on the lowest string. Our index 0 is the
 * highest, matching Songsterr and `tuning_midi`. `staff.tuning[0]` is the
 * top tab line, so it is copied as-is.
 */
export function scoreToDocument(score: alphaTab.model.Score): {
  title: string;
  artist: string;
  document: ScoreDocument;
} {
  const tracks: Track[] = [];
  score.tracks.forEach((source, index) => {
    if (source.isPercussion) return;
    const staff = source.staves.find((item) => item.tuning.length > 0 && !item.isPercussion);
    if (!staff) return;
    const tuning = [...staff.tuning];
    const measures = staff.bars.map((bar, barIndex) => {
      const master = score.masterBars[barIndex];
      const signature: [number, number] = [
        master?.timeSignatureNumerator || 4,
        master?.timeSignatureDenominator || 4,
      ];
      const beats: Beat[] = [];
      for (const beat of bar.voices[0]?.beats ?? []) {
        if (beat.isEmpty && beat.notes.length === 0) continue;
        const grace = beat.graceType !== alphaTab.model.GraceType.None;
        const notes: Note[] = [];
        for (const note of beat.notes) {
          if (!note.isStringed) continue;
          const stringIndex = tuning.length - note.string;
          if (stringIndex < 0 || stringIndex >= tuning.length) continue;
          notes.push({
            string: stringIndex,
            fret: note.fret,
            dead: note.isDead,
            tie: note.isTieDestination,
            extras: {},
          });
        }
        const quarters = Math.max(beat.playbackDuration, beat.displayDuration) / QUARTER;
        beats.push({
          position: Math.max(0, (grace ? beat.displayStart : beat.playbackStart) / QUARTER),
          duration: Math.max(0.01, Math.round(quarters * 10000) / 10000),
          notes,
          rest: notes.length === 0 || beat.isRest,
          extras: grace ? { graceNote: alphaTab.model.GraceType[beat.graceType] } : {},
        });
      }
      return {
        signature,
        extras: {},
        voices: [{ beats }],
      };
    });
    const program = source.playbackInfo.program;
    tracks.push({
      id: `trk_gp_${index}`,
      name: source.name || `Track ${index + 1}`,
      instrument: instrumentName(program, tuning.length),
      capo: staff.capo || 0,
      tuning_midi: tuning,
      preferred: false,
      measures: measures.length ? measures : [{ signature: [4, 4], extras: {}, voices: [{ beats: [] }] }],
    });
  });
  if (!tracks.length) throw new Error("no fretted tracks in this file");
  tracks[0].preferred = true;
  const tempos = score.masterBars.flatMap((bar, index) =>
    (bar.tempoAutomations ?? [])
      .filter((mark) => mark.value > 0)
      .map((mark) => ({ bpm: mark.value, measure: index })),
  );
  const bpm = tempos[0]?.bpm || score.tempo || 120;
  return {
    title: score.title || "Untitled",
    artist: score.artist || "",
    document: {
      version: 1,
      bpm,
      tempos: tempos.length ? tempos : [{ bpm, measure: 0 }],
      tracks,
      sync: { video_id: null, points: [], anchors: {} },
    },
  };
}

function instrumentName(program: number, strings: number): string {
  if (program >= 32 && program <= 39) return "bass-guitar";
  if (program === 25) return "acoustic-guitar";
  if (strings <= 5) return "bass-guitar";
  return "guitar";
}

export function documentFromGuitarPro(data: Uint8Array): ReturnType<typeof scoreToDocument> {
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(data);
  return scoreToDocument(score);
}
