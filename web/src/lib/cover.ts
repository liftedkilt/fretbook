/*
 * Generated cover art. A song has no artwork of its own, so its id picks one of
 * a few hand-tuned gradients, and its title gives the monogram. The same song
 * always gets the same cover.
 */

export type CoverPalette = { from: string; via: string; to: string; ink: string };

export const PALETTES: CoverPalette[] = [
  { from: "#ff9a5a", via: "#ff5a6e", to: "#7a2d8f", ink: "#fff6ef" },
  { from: "#ffd36e", via: "#ff8a4c", to: "#c03a52", ink: "#2a1206" },
  { from: "#7ef0d0", via: "#2fa7b8", to: "#253a8f", ink: "#effffb" },
  { from: "#b9a6ff", via: "#7b5cff", to: "#2c1d6e", ink: "#f4f0ff" },
  { from: "#ffb3c7", via: "#e0568f", to: "#5b1e5e", ink: "#fff3f7" },
  { from: "#c6f36b", via: "#4cbf7a", to: "#18534f", ink: "#f4ffe9" },
  { from: "#8fd3ff", via: "#4c7dff", to: "#1f1f6b", ink: "#f0f7ff" },
  { from: "#f5e3c3", via: "#d39a5b", to: "#6b3b1f", ink: "#2a1a0c" },
];

export function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function paletteFor(id: string): CoverPalette {
  return PALETTES[hash(id) % PALETTES.length];
}

export type CoverPattern = {
  shape: "stripes" | "dots" | "rings" | "grid";
  angle: number;
  weight: number;
  cx: number;
  cy: number;
};

/** A texture picked from the id, so songs with the same title and a similar palette still differ. */
export function patternFor(id: string): CoverPattern {
  const seed = hash(`${id}:pattern`);
  const shapes: CoverPattern["shape"][] = ["stripes", "dots", "rings", "grid"];
  return {
    shape: shapes[seed % shapes.length],
    angle: [0, 30, 45, 60, 90, 120, 135, 150][(seed >> 3) % 8],
    weight: 3 + ((seed >> 7) % 5),
    cx: 20 + ((seed >> 11) % 60),
    cy: 20 + ((seed >> 17) % 60),
  };
}

/** One or two letters for the cover: the first letters of the first two words, ignoring a leading "The". */
export function monogram(title: string): string {
  const words = title
    .replace(/^the\s+/i, "")
    .split(/[\s\-_/]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "♪";
  const letters =
    words.length === 1 ? [...words[0]].slice(0, 1) : [[...words[0]][0], [...words[1]][0]];
  return letters.join("").toUpperCase();
}

/** The address of a song's uploaded cover art, resolved against the app's base path, or `undefined` for none. */
export function coverSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return typeof document === "undefined" ? url : new URL(url, document.baseURI).toString();
}
