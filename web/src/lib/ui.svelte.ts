import { getMe, getMeta, listSongs, saveSettings } from "./api";
import { instrumentFamily, type InstrumentFilter } from "./instruments";
import type { InstrumentPreset, SongSummary } from "./types";

/*
 * State shared by the app shell and the pages: the library list (the sidebar
 * shows counts), the instrument presets and default, the library filter and
 * search, which sheet is open, and the colour theme.
 */

export type LibraryFilter = "all" | InstrumentFilter | "chords";
export type Theme = "system" | "dark" | "light";
export type Sheet = "" | "add" | "settings";

const THEME_KEY = "fretbook.theme";

function storedTheme(): Theme {
  try {
    const value = typeof localStorage === "undefined" ? null : localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "light" ? value : "system";
  } catch {
    return "system";
  }
}

export const ui = $state({
  songs: [] as SongSummary[],
  loaded: false,
  presets: [] as InstrumentPreset[],
  defaultInstrument: "bass-4",
  filter: "all" as LibraryFilter,
  search: "",
  sheet: "" as Sheet,
  theme: storedTheme(),
  error: "",
});

export function matchesFilter(song: SongSummary, filter: LibraryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "chords") return song.content_kind === "chords";
  return song.content_kind === "tab" && instrumentFamily(song.preferred_instrument) === filter;
}

export function countFor(filter: LibraryFilter): number {
  return ui.songs.filter((song) => matchesFilter(song, filter)).length;
}

export async function refreshSongs(): Promise<void> {
  ui.songs = await listSongs();
  ui.loaded = true;
}

let metaLoaded = false;

export async function loadMeta(): Promise<void> {
  if (metaLoaded) return;
  const [meta, me] = await Promise.all([getMeta(), getMe()]);
  ui.presets = meta.instruments;
  ui.defaultInstrument = me.settings.default_instrument;
  metaLoaded = true;
}

export async function setDefaultInstrument(next: string): Promise<void> {
  ui.defaultInstrument = (await saveSettings({ default_instrument: next })).default_instrument;
}

/** The instrument family of the default preset: which Songsterr and Guitar Pro parts start selected. */
export function defaultFamily(): InstrumentPreset["family"] {
  return ui.presets.find((item) => item.id === ui.defaultInstrument)?.family ?? "bass";
}

export function openSheet(sheet: Sheet): void {
  ui.sheet = sheet;
}

export function closeSheet(): void {
  ui.sheet = "";
}

function resolvedTheme(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  if (typeof matchMedia === "undefined") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(): void {
  if (typeof document === "undefined") return;
  const resolved = resolvedTheme(ui.theme);
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f6f3ee" : "#0c0b10");
}

export function setTheme(theme: Theme): void {
  ui.theme = theme;
  applyTheme();
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage may be unavailable */
  }
}

if (typeof window !== "undefined") {
  applyTheme();
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => applyTheme());
}
