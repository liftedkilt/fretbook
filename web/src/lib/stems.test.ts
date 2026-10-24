import { describe, expect, it, vi } from "vitest";

import {
  DRIFT_SECONDS,
  loadStemMixes,
  orderStems,
  parseStemMixes,
  saveStemMixes,
  stemGains,
  stemMix,
  StemPlayer,
  type StemName,
} from "./stems";

const all: StemName[] = ["bass", "guitar", "drums"];

describe("stemGains", () => {
  it("plays every stem at its own volume times the master", () => {
    expect(stemGains(all, { bass: { volume: 0.5, mute: false, solo: false } }, 0.5)).toEqual({
      bass: 0.25,
      guitar: 0.5,
      drums: 0.5,
    });
  });

  it("silences a muted stem", () => {
    const gains = stemGains(all, { bass: { volume: 1, mute: true, solo: false } }, 1);
    expect(gains).toEqual({ bass: 0, guitar: 1, drums: 1 });
  });

  it("lets only the soloed stems through, unless one is also muted", () => {
    const solo = { volume: 1, mute: false, solo: true };
    expect(stemGains(all, { guitar: solo }, 1)).toEqual({ bass: 0, guitar: 1, drums: 0 });
    expect(stemGains(all, { guitar: { ...solo, mute: true } }, 1)).toEqual({
      bass: 0,
      guitar: 0,
      drums: 0,
    });
  });

  it("ignores a solo on a stem the song does not have", () => {
    expect(stemGains(["bass"], { guitar: { volume: 1, mute: false, solo: true } }, 1)).toEqual({
      bass: 1,
    });
  });

  it("keeps volumes in range", () => {
    const loud = { volume: 9, mute: false, solo: false };
    expect(stemGains(["bass"], { bass: loud }, 3).bass).toBe(1);
    expect(stemGains(["bass"], { bass: loud }, Number.NaN).bass).toBe(0);
  });
});

describe("stem lists and saved mixes", () => {
  it("orders stems for the mixer and drops unknown ones", () => {
    const ordered = orderStems([{ name: "vocals" }, { name: "kazoo" }, { name: "bass" }]);
    expect(ordered.map((stem) => stem.name)).toEqual(["bass", "vocals"]);
  });

  it("defaults an untouched stem", () => {
    expect(stemMix({}, "bass")).toEqual({ volume: 1, mute: false, solo: false });
  });

  it("parses what was saved and ignores junk", () => {
    expect(parseStemMixes(null)).toEqual({});
    expect(parseStemMixes({ bass: { volume: 0.4, mute: true }, guitar: 7, kazoo: {} })).toEqual({
      bass: { volume: 0.4, mute: true, solo: false },
    });
  });

  it("remembers a mix per song and survives broken storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    saveStemMixes("s1", { bass: { volume: 0.2, mute: false, solo: true } });
    expect(loadStemMixes("s1").bass?.solo).toBe(true);
    expect(loadStemMixes("other")).toEqual({});
    localStorage.setItem("fretbook.stems.bad", "{nope");
    expect(loadStemMixes("bad")).toEqual({});
    vi.unstubAllGlobals();
    expect(loadStemMixes("s1")).toEqual({});
  });
});

class FakeAudio extends EventTarget {
  paused = true;
  currentTime = 0;
  playbackRate = 1;
  volume = 1;
  preload = "";
  src = "";
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn();
}

function setup() {
  const clock = new FakeAudio();
  clock.volume = 0.8;
  const made = new Map<string, FakeAudio>();
  const player = new StemPlayer(
    clock as unknown as HTMLAudioElement,
    [
      { name: "bass", url: "b.mp3" },
      { name: "guitar", url: "g.mp3" },
    ],
    (url) => {
      const element = new FakeAudio();
      made.set(url, element);
      return element as unknown as HTMLAudioElement;
    },
  );
  return { clock, player, bass: made.get("b.mp3")!, guitar: made.get("g.mp3")! };
}

describe("StemPlayer", () => {
  it("silences the recording and plays the stems with the mix", () => {
    const { clock, player, bass, guitar } = setup();
    expect(clock.volume).toBe(0);
    player.setMix({ bass: { volume: 1, mute: true, solo: false } }, 0.5);
    expect(bass.volume).toBe(0);
    expect(guitar.volume).toBe(0.5);
  });

  it("follows the recording's play, seek, rate and pause", () => {
    const { clock, bass, guitar } = setup();
    clock.currentTime = 12;
    clock.playbackRate = 0.75;
    clock.paused = false;
    clock.dispatchEvent(new Event("play"));
    for (const stem of [bass, guitar]) {
      expect(stem.play).toHaveBeenCalled();
      expect(stem.currentTime).toBe(12);
      expect(stem.playbackRate).toBe(0.75);
    }
    clock.currentTime = 30;
    clock.dispatchEvent(new Event("seeking"));
    expect(bass.currentTime).toBe(30);
    clock.playbackRate = 1;
    clock.dispatchEvent(new Event("ratechange"));
    expect(guitar.playbackRate).toBe(1);
    clock.paused = true;
    clock.dispatchEvent(new Event("pause"));
    expect(bass.pause).toHaveBeenCalled();
  });

  it("pulls a stem back when it drifts, and leaves a close one alone", () => {
    const { clock, bass } = setup();
    clock.paused = false;
    clock.currentTime = 5;
    bass.currentTime = 5 + DRIFT_SECONDS / 2;
    clock.dispatchEvent(new Event("timeupdate"));
    expect(bass.currentTime).toBe(5 + DRIFT_SECONDS / 2);
    bass.currentTime = 5.5;
    clock.dispatchEvent(new Event("timeupdate"));
    expect(bass.currentTime).toBe(5);
  });

  it("gives the recording its volume back when disposed", () => {
    const { clock, player, bass } = setup();
    player.dispose();
    expect(clock.volume).toBe(0.8);
    expect(bass.pause).toHaveBeenCalled();
    clock.currentTime = 99;
    clock.dispatchEvent(new Event("seeking"));
    expect(bass.currentTime).not.toBe(99);
  });
});
