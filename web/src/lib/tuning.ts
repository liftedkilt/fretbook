const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToName(midi: number): string {
  const pitch = NAMES[((midi % 12) + 12) % 12];
  return `${pitch}${Math.floor(midi / 12) - 1}`;
}

export function tuningLabel(midis: number[]): string {
  return midis.map((midi) => midiToName(midi)).join(" ");
}
