import { describe, expect, it, vi } from "vitest";

import { DRIFT_SEEK_SECONDS, planFollow, SynthFollower, type SynthPlayer } from "./synthFollow";

const base = { target: 10, synthAt: 10, playing: true, rate: 1, synthBar: 2, recordingBar: 2 };

describe("planFollow", () => {
  it("leaves a synth that is on time alone", () => {
    expect(planFollow(base)).toEqual({ play: true, speed: 1, seekTo: null });
  });

  it("tolerates a small drift while playing but seeks past the limit", () => {
    expect(planFollow({ ...base, synthAt: 10 + DRIFT_SEEK_SECONDS - 0.01 }).seekTo).toBeNull();
    expect(planFollow({ ...base, synthAt: 10.5 }).seekTo).toBe(10);
    expect(planFollow({ ...base, synthAt: 9.5 }).seekTo).toBe(10);
  });

  it("parks on the exact spot while paused", () => {
    expect(planFollow({ ...base, playing: false, synthAt: 10.05 })).toEqual({
      play: false,
      speed: 1,
      seekTo: 10,
    });
  });

  it("follows a recording that plays a bar faster or slower than written", () => {
    expect(planFollow({ ...base, synthBar: 2, recordingBar: 2.5 }).speed).toBeCloseTo(0.8);
    expect(planFollow({ ...base, synthBar: 2, recordingBar: 1.6 }).speed).toBeCloseTo(1.25);
  });

  it("scales by the recording's playback rate", () => {
    expect(planFollow({ ...base, rate: 0.5 }).speed).toBe(0.5);
  });

  it("clamps absurd ratios and ignores bars with no length", () => {
    expect(planFollow({ ...base, synthBar: 100, recordingBar: 1 }).speed).toBe(4);
    expect(planFollow({ ...base, synthBar: 0.01, recordingBar: 10 }).speed).toBe(0.25);
    expect(planFollow({ ...base, recordingBar: 0 }).speed).toBe(1);
  });
});

function fakePlayer() {
  const player: SynthPlayer = {
    timePosition: 0,
    playbackSpeed: 1,
    masterVolume: 1,
    metronomeVolume: 1,
    play: vi.fn(() => true),
    pause: vi.fn(),
  };
  return player;
}

describe("SynthFollower", () => {
  it("silences the synth's own metronome: the page's clicks keep time", () => {
    const player = fakePlayer();
    new SynthFollower(player);
    expect(player.metronomeVolume).toBe(0);
  });

  it("starts and stops with the recording, once per change", () => {
    const player = fakePlayer();
    const follower = new SynthFollower(player);
    follower.apply({ play: true, speed: 1, seekTo: null });
    follower.apply({ play: true, speed: 1, seekTo: null });
    expect(player.play).toHaveBeenCalledTimes(1);
    follower.apply({ play: false, speed: 1, seekTo: null });
    follower.apply({ play: false, speed: 1, seekTo: null });
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(follower.isSounding).toBe(false);
  });

  it("seeks in milliseconds and sets the speed", () => {
    const player = fakePlayer();
    const follower = new SynthFollower(player);
    follower.apply({ play: false, speed: 0.8, seekTo: 12.5 });
    expect(player.timePosition).toBe(12500);
    expect(player.playbackSpeed).toBe(0.8);
    expect(follower.position).toBe(12.5);
  });
});
