/**
 * Stems: the parts of a recording (bass, guitar, ...) that a worker cut out with Demucs. The player keeps its
 * own `<audio>` element as the clock; a `StemPlayer` plays one extra element per stem alongside it and the
 * recording itself goes quiet, so the mixer can mute the bass or solo the guitar.
 */

export type StemName = "bass" | "drums" | "guitar" | "piano" | "vocals" | "other";

/** The order the mixer lists stems in, instruments a bassist or guitarist plays along with first. */
export const STEM_ORDER: StemName[] = ["bass", "guitar", "drums", "piano", "vocals", "other"];

export interface StemMix {
  volume: number;
  mute: boolean;
  solo: boolean;
}

export type StemMixes = Partial<Record<StemName, StemMix>>;

export interface StemSource {
  name: StemName;
  url: string;
}

/** A stem's mix, with defaults for one that was never touched. */
export function stemMix(mixes: StemMixes, name: StemName): StemMix {
  return mixes[name] ?? { volume: 1, mute: false, solo: false };
}

/** Stems in mixer order; ones this build does not know are dropped. */
export function orderStems<T extends { name: string }>(stems: T[]): T[] {
  return STEM_ORDER.flatMap((name) => stems.filter((stem) => stem.name === name));
}

/**
 * The volume each stem plays at. A soloed stem silences the ones that are not soloed (like the track mixer);
 * a muted stem is silent even when soloed. `master` is the recording's volume slider.
 */
export function stemGains(
  names: StemName[],
  mixes: StemMixes,
  master: number,
): Record<StemName, number> {
  const anySolo = names.some((name) => stemMix(mixes, name).solo);
  const gains = {} as Record<StemName, number>;
  for (const name of names) {
    const mix = stemMix(mixes, name);
    const audible = !mix.mute && (!anySolo || mix.solo);
    gains[name] = audible ? clamp01(mix.volume) * clamp01(master) : 0;
  }
  return gains;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Past this many seconds apart, a stem is moved back to the recording's position. */
export const DRIFT_SECONDS = 0.08;

const KEY_PREFIX = "fretbook.stems.";

export function parseStemMixes(raw: unknown): StemMixes {
  const out: StemMixes = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const name of STEM_ORDER) {
    const value = (raw as Record<string, unknown>)[name];
    if (typeof value !== "object" || value === null) continue;
    const { volume, mute, solo } = value as Record<string, unknown>;
    out[name] = {
      volume: typeof volume === "number" ? clamp01(volume) : 1,
      mute: mute === true,
      solo: solo === true,
    };
  }
  return out;
}

export function loadStemMixes(songId: string): StemMixes {
  try {
    const raw =
      typeof localStorage === "undefined" ? null : localStorage.getItem(KEY_PREFIX + songId);
    return parseStemMixes(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

export function saveStemMixes(songId: string, mixes: StemMixes): void {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(KEY_PREFIX + songId, JSON.stringify(mixes));
  } catch {
    // Private mode or a full quota: the mix just does not stick.
  }
}

const FOLLOWED = [
  "play",
  "pause",
  "seeking",
  "seeked",
  "ratechange",
  "timeupdate",
  "ended",
] as const;

/** Plays the stems in step with the recording's `<audio>` element, which stays the clock. */
export class StemPlayer {
  private readonly elements = new Map<StemName, HTMLAudioElement>();
  private readonly savedVolume: number;
  private mixes: StemMixes = {};
  private master = 1;
  private readonly follow = (event: Event) => this.onMaster(event.type);

  constructor(
    private readonly clock: HTMLAudioElement,
    sources: StemSource[],
    make: (url: string) => HTMLAudioElement = (url) => new Audio(url),
  ) {
    this.savedVolume = clock.volume;
    for (const source of sources) {
      const element = make(source.url);
      element.preload = "auto";
      const pitch = element as HTMLAudioElement & { preservesPitch?: boolean };
      pitch.preservesPitch = true;
      this.elements.set(source.name, element);
    }
    for (const name of FOLLOWED) clock.addEventListener(name, this.follow);
    this.apply();
    this.onMaster("seeked");
    if (!clock.paused) this.onMaster("play");
  }

  get names(): StemName[] {
    return [...this.elements.keys()];
  }

  /** Set the mixer and the recording's volume slider; the recording itself is silenced while stems play. */
  setMix(mixes: StemMixes, master: number): void {
    this.mixes = mixes;
    this.master = master;
    this.apply();
  }

  private apply(): void {
    this.clock.volume = 0;
    const gains = stemGains(this.names, this.mixes, this.master);
    for (const [name, element] of this.elements) element.volume = gains[name];
  }

  private onMaster(type: string): void {
    const time = this.clock.currentTime;
    for (const element of this.elements.values()) {
      if (type === "ratechange") element.playbackRate = this.clock.playbackRate;
      if (type === "pause" || type === "ended") element.pause();
      if (type === "seeking" || type === "seeked" || type === "pause" || type === "ended") {
        if (Math.abs(element.currentTime - time) > 0.001) element.currentTime = time;
      }
      if (type === "play") {
        element.playbackRate = this.clock.playbackRate;
        element.currentTime = time;
        void element.play().catch(() => undefined);
      }
      if (type === "timeupdate" && !this.clock.paused) {
        if (Math.abs(element.currentTime - time) > DRIFT_SECONDS) element.currentTime = time;
        if (element.paused) void element.play().catch(() => undefined);
      }
    }
  }

  /** Stop the stems and give the recording its volume back. */
  dispose(): void {
    for (const name of FOLLOWED) this.clock.removeEventListener(name, this.follow);
    for (const element of this.elements.values()) {
      element.pause();
      element.removeAttribute("src");
      element.load?.();
    }
    this.elements.clear();
    this.clock.volume = this.savedVolume;
  }
}
