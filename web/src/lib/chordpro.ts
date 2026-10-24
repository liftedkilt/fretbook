/**
 * A small ChordPro reader for chord sheets (lyrics with chords over them).
 *
 * The server stores ChordPro text and converts pasted "chords over lyrics"
 * sheets into it (`fretbook/chords/chordpro.py`). This module only reads it
 * for display and transposes chords.
 */

export interface Segment {
  chord: string | null;
  text: string;
}

export type Line =
  | { kind: "lyrics"; segments: Segment[] }
  | { kind: "comment"; text: string }
  | { kind: "section"; label: string }
  | { kind: "tab"; text: string }
  | { kind: "empty" };

export interface Block {
  /** "verse", "chorus", "bridge", "tab", or "" outside a section. */
  kind: string;
  label: string;
  lines: Line[];
}

/** A fingering from a `{define:}` directive. `frets` run from the lowest string to the highest. */
export interface ChordDefine {
  name: string;
  /** The fret the first position row sits on (1 means the nut), as written in the directive. */
  baseFret: number;
  /** Absolute fret per string, lowest string first. `null` is a muted string. */
  frets: (number | null)[];
}

export interface Sheet {
  meta: Record<string, string>;
  blocks: Block[];
  /** `{define:}` fingerings by chord name, the first definition of a name winning. */
  defines: Record<string, ChordDefine>;
}

const DIRECTIVE = /^\s*\{\s*([A-Za-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/;
const ALIASES: Record<string, string> = {
  t: "title",
  st: "subtitle",
  c: "comment",
  ci: "comment",
  cb: "comment",
  comment_italic: "comment",
  comment_box: "comment",
  soc: "start_of_chorus",
  eoc: "end_of_chorus",
  sov: "start_of_verse",
  eov: "end_of_verse",
  sob: "start_of_bridge",
  eob: "end_of_bridge",
  sot: "start_of_tab",
  eot: "end_of_tab",
};
const META = new Set([
  "title",
  "subtitle",
  "artist",
  "key",
  "capo",
  "tempo",
  "duration",
  "composer",
  "album",
  "year",
]);

export function parseLyrics(line: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /\[([^\]]*)\]/g;
  let last = 0;
  let chord: string | null = null;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    const text = line.slice(last, match.index);
    if (text || chord !== null) segments.push({ chord, text });
    chord = match[1].trim() || null;
    last = match.index + match[0].length;
  }
  const tail = line.slice(last);
  if (tail || chord !== null || segments.length === 0) segments.push({ chord, text: tail });
  return segments;
}

/**
 * Read the value of `{define: Am base-fret 1 frets x 0 2 2 1 0 fingers …}`, and the older
 * `{define: Am 1 x 0 2 2 1 0}`. Fret numbers count from `base-fret`; 0 is an open string and
 * `x`, `X` or `-` a muted one. `copy`, `display` and `diagram` forms are not fingerings.
 */
export function parseDefine(value: string): ChordDefine | null {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const name = tokens.shift();
  if (!name || !CHORD.test(name)) return null;
  let baseFret = 1;
  let rest: string[];
  const framesAt = tokens.findIndex((token) => token.toLowerCase() === "frets");
  if (framesAt >= 0) {
    const baseAt = tokens.findIndex((token) => token.toLowerCase() === "base-fret");
    if (baseAt >= 0 && baseAt < framesAt) baseFret = Number(tokens[baseAt + 1]);
    rest = tokens.slice(framesAt + 1);
    const stop = rest.findIndex((token) => /^[A-Za-z]{2,}/.test(token) && !/^x+$/i.test(token));
    if (stop >= 0) rest = rest.slice(0, stop);
  } else {
    baseFret = Number(tokens.shift());
    rest = tokens;
  }
  if (!Number.isInteger(baseFret) || baseFret < 1 || baseFret > 24) return null;
  if (rest.length < 3 || rest.length > 12) return null;
  const frets: (number | null)[] = [];
  for (const token of rest) {
    if (/^[xX-]$/.test(token)) frets.push(null);
    else if (/^\d{1,2}$/.test(token)) {
      const fret = Number(token);
      frets.push(fret === 0 ? 0 : baseFret + fret - 1);
    } else return null;
  }
  return { name, baseFret, frets };
}

export function parse(text: string): Sheet {
  const defines: Record<string, ChordDefine> = {};
  const meta: Record<string, string> = {};
  const blocks: Block[] = [{ kind: "", label: "", lines: [] }];
  let current = blocks[0];
  const open = (kind: string, label: string) => {
    current = { kind, label, lines: [] };
    blocks.push(current);
  };
  const close = () => {
    current = { kind: "", label: "", lines: [] };
    blocks.push(current);
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const directive = DIRECTIVE.exec(raw);
    if (directive) {
      const name = ALIASES[directive[1].toLowerCase()] ?? directive[1].toLowerCase();
      const value = (directive[2] ?? "").trim();
      if (name === "define") {
        const define = parseDefine(value);
        if (define && !(define.name in defines)) defines[define.name] = define;
      } else if (META.has(name)) {
        if (!(name in meta)) meta[name] = value;
      } else if (name === "comment") {
        current.lines.push({ kind: "comment", text: value });
      } else if (name.startsWith("start_of_")) {
        open(name.slice("start_of_".length), value);
      } else if (name.startsWith("end_of_")) {
        close();
      } else if (name === "chorus") {
        // An empty label is the repeat-chorus marker; the view names it in the reader's language.
        current.lines.push({ kind: "section", label: value });
      }
      continue;
    }
    if (current.kind === "tab") {
      current.lines.push({ kind: "tab", text: raw });
    } else if (raw.trim() === "") {
      current.lines.push({ kind: "empty" });
    } else if (raw.trimStart().startsWith("#")) {
      continue;
    } else {
      current.lines.push({ kind: "lyrics", segments: parseLyrics(raw) });
    }
  }
  if (!meta.artist && meta.subtitle) meta.artist = meta.subtitle;
  const kept = blocks.filter(
    (block) => block.label || block.lines.some((line) => line.kind !== "empty"),
  );
  return { meta, blocks: kept, defines };
}

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
export const PITCH: Record<string, number> = Object.fromEntries([
  ...SHARPS.map((name, index) => [name, index]),
  ...FLATS.map((name, index) => [name, index]),
  ["Cb", 11],
  ["Fb", 4],
  ["E#", 5],
  ["B#", 0],
]);
export const CHORD = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/;

function shift(note: string, semitones: number, flats: boolean): string {
  const pitch = PITCH[note];
  if (pitch === undefined) return note;
  const names = flats ? FLATS : SHARPS;
  return names[(((pitch + semitones) % 12) + 12) % 12];
}

/** Transpose a chord symbol. Unrecognized symbols (N.C., x2) are returned unchanged. */
export function transposeChord(chord: string, semitones: number, flats = false): string {
  if (!semitones) return chord;
  const match = CHORD.exec(chord);
  if (!match) return chord;
  const [, root, quality, bass] = match;
  const useFlats = flats || root.includes("b");
  return `${shift(root, semitones, useFlats)}${quality}${bass ? `/${shift(bass, semitones, useFlats)}` : ""}`;
}
