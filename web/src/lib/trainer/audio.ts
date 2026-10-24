/** Plays the ear-training sounds with plain Web Audio: a soft plucked-sine voice. */

import { midiToFrequency } from "../listen/notes";

let context: AudioContext | null = null;

function audio(): AudioContext {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

function voice(ctx: AudioContext, midi: number, at: number, length: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = midiToFrequency(midi);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.25, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, at + length);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.05);
}

/** Notes one after the other (an interval). Resolves when the last has finished. */
export function playMelodic(notes: readonly number[], gap = 0.8): Promise<void> {
  const ctx = audio();
  const start = ctx.currentTime + 0.05;
  notes.forEach((midi, index) => voice(ctx, midi, start + index * gap, gap * 1.2));
  return new Promise((resolve) => setTimeout(resolve, (notes.length * gap + 0.2) * 1000));
}

/** Notes together (a chord), lightly rolled so each can be heard. */
export function playChord(notes: readonly number[], length = 1.8): Promise<void> {
  const ctx = audio();
  const start = ctx.currentTime + 0.05;
  notes.forEach((midi, index) => voice(ctx, midi, start + index * 0.03, length));
  return new Promise((resolve) => setTimeout(resolve, (length + 0.2) * 1000));
}

/** A single note, for the fretboard trainer's feedback. */
export function playNote(midi: number): void {
  voice(audio(), midi, audio().currentTime + 0.01, 0.9);
}
