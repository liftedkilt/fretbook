import type * as alphaTab from "@coderline/alphatab";

/** Maps alphaTab's external-media clock onto an `<audio>` element. */
export class AudioMedia implements alphaTab.synth.IExternalMediaHandler {
  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly shiftMs: () => number,
  ) {}

  get backingTrackDuration(): number {
    const duration = this.audio.duration;
    if (!Number.isFinite(duration)) return 0;
    return duration * 1000 + this.shiftMs();
  }

  get playbackRate(): number {
    return this.audio.playbackRate;
  }

  set playbackRate(value: number) {
    this.audio.playbackRate = value;
  }

  get masterVolume(): number {
    return this.audio.volume;
  }

  set masterVolume(value: number) {
    this.audio.volume = value;
  }

  seekTo(time: number): void {
    const next = Math.max(0, (time - this.shiftMs()) / 1000);
    if (Math.abs(this.audio.currentTime - next) > 0.03) this.audio.currentTime = next;
  }

  play(): void {
    void this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }
}
