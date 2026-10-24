/**
 * A recording plays through alphaTab's external-media mode, whose stand-in synth makes no sound.
 * To hear the score's tracks next to it, a second, hidden alphaTab player plays them and follows
 * the `<audio>` element: the recording stays the one clock, and the synth is nudged back to it.
 */

/** A drift smaller than this is left to the speed adjustment; a bigger one is a seek. */
export const DRIFT_SEEK_SECONDS = 0.12;

/** What the synth does to keep up with the recording at one moment. */
export interface FollowPlan {
  /** Whether the synth should be sounding. */
  play: boolean;
  /** Synth playback speed: how fast the written score moves per second of recording. */
  speed: number;
  /** Where to jump to in synth seconds, or null when the synth is close enough. */
  seekTo: number | null;
}

export interface FollowInput {
  /** Where the recording is, as a position on the written score's own clock (seconds). */
  target: number;
  /** Where the synth is (seconds). */
  synthAt: number;
  /** Whether the recording is playing. */
  playing: boolean;
  /** The recording's playback rate. */
  rate: number;
  /** Synth seconds the current bar lasts at the written tempo. */
  synthBar: number;
  /** Recording seconds the current bar lasts. */
  recordingBar: number;
}

const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

export function planFollow(input: FollowInput): FollowPlan {
  const { target, synthAt, playing, rate, synthBar, recordingBar } = input;
  // A bar the recording plays faster than written needs the synth sped up by the same factor.
  const ratio = recordingBar > 0 && synthBar > 0 ? synthBar / recordingBar : 1;
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, ratio * rate));
  const drift = Math.abs(synthAt - target);
  // Paused, the synth sits exactly on the target so that starting it is instant.
  const limit = playing ? DRIFT_SEEK_SECONDS : 0.02;
  return { play: playing, speed, seekTo: drift > limit ? target : null };
}

/** The part of alphaTab's player that the follower drives. */
export interface SynthPlayer {
  /** Milliseconds. */
  timePosition: number;
  playbackSpeed: number;
  masterVolume: number;
  metronomeVolume: number;
  play(): boolean;
  pause(): void;
}

export class SynthFollower {
  private sounding = false;

  constructor(private readonly player: SynthPlayer) {
    player.metronomeVolume = 0;
  }

  /** Applies one step of `planFollow`. */
  apply(plan: FollowPlan): void {
    if (this.player.playbackSpeed !== plan.speed) this.player.playbackSpeed = plan.speed;
    if (plan.seekTo !== null) this.player.timePosition = plan.seekTo * 1000;
    if (plan.play && !this.sounding) {
      this.sounding = true;
      this.player.play();
    } else if (!plan.play && this.sounding) {
      this.sounding = false;
      this.player.pause();
    }
  }

  /** Forgets that the synth was sounding, for when the underlying player was stopped from outside. */
  reset(): void {
    this.sounding = false;
  }

  get isSounding(): boolean {
    return this.sounding;
  }

  get position(): number {
    return this.player.timePosition / 1000;
  }
}
