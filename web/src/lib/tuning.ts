const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const PITCH_OFFSETS: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

export function midiToName(midi: number): string {
  const pitch = NAMES[((midi % 12) + 12) % 12];
  return `${pitch}${Math.floor(midi / 12) - 1}`;
}

export function nameToMidi(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/^([a-gA-G])([#b♯♭]?)(-?\d+)?$/);
  if (!match) return null;
  const letter = match[1].toLowerCase();
  const accidental = match[2];
  const octaveStr = match[3];

  const base = PITCH_OFFSETS[letter];
  if (base === undefined) return null;
  let offset = base;
  if (accidental === "#" || accidental === "♯") offset += 1;
  else if (accidental === "b" || accidental === "♭") offset -= 1;

  const octave = octaveStr !== undefined ? parseInt(octaveStr, 10) : 3;
  const midi = (octave + 1) * 12 + offset;
  if (midi < 0 || midi > 127) return null;
  return midi;
}

export function parseCustomTuning(raw: string): number[] | null {
  const tokens = raw.trim().split(/[\s,]+/);
  if (tokens.length === 0 || (tokens.length === 1 && !tokens[0])) return null;
  const result: number[] = [];
  for (const token of tokens) {
    const midi = nameToMidi(token);
    if (midi === null) return null;
    result.push(midi);
  }
  return result.length > 0 ? result : null;
}

export function tuningLabel(midis: number[]): string {
  return midis.map((midi) => midiToName(midi)).join(" ");
}
