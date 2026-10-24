/** Musical keys as the server names them: `C`, `F#`, `Bb` for major and a trailing `m` for minor. */

export const MAJOR_KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;
export const MINOR_KEYS = [
  "Cm",
  "C#m",
  "Dm",
  "D#m",
  "Em",
  "Fm",
  "F#m",
  "Gm",
  "G#m",
  "Am",
  "Bbm",
  "Bm",
] as const;
export const KEYS: readonly string[] = [...MAJOR_KEYS, ...MINOR_KEYS];

/** The note of a key written with ♯ and ♭, and whether the key is minor. */
export function keyParts(key: string): { note: string; minor: boolean } {
  const minor = key.endsWith("m");
  const note = (minor ? key.slice(0, -1) : key).replace("#", "♯").replace(/(?<=.)b/, "♭");
  return { note, minor };
}

/** "C major" or "F♯ minor", in the user's language: `translate` is `t`. */
export function keyLabel(
  key: string,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  const { note, minor } = keyParts(key);
  return translate(minor ? "metadata.keyMinor" : "metadata.keyMajor", { note });
}
