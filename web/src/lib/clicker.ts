/** Metronome and count-in clicks from the Web Audio API, scheduled ahead on the audio clock. */
export class Clicker {
  private context: AudioContext | null = null;

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor =
      typeof AudioContext === "undefined"
        ? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : AudioContext;
    if (!Ctor) return null;
    this.context = new Ctor();
    return this.context;
  }

  /** Call from a click or key press: browsers keep an audio context suspended until then. */
  unlock(): void {
    const context = this.ensure();
    if (context && context.state === "suspended") void context.resume();
  }

  /** Plays one click `delay` seconds from now. */
  click(delay: number, accent: boolean, volume: number): void {
    const context = this.ensure();
    if (!context || volume <= 0) return;
    const start = context.currentTime + Math.max(0, delay);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = accent ? 1600 : 1100;
    const peak = volume * (accent ? 0.6 : 0.4);
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.06);
  }

  close(): void {
    void this.context?.close();
    this.context = null;
  }
}
