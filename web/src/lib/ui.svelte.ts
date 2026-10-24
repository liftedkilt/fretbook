import {
  getMe,
  getMeta,
  isOfflineError,
  listSongs,
  listTags,
  saveSettings,
  setFavourite,
} from "./api";
import { levelQuery } from "./difficulty";
import type {
  InstrumentPreset,
  LibraryCounts,
  LibraryFilter,
  LibraryLevel,
  LibrarySort,
  Me,
  SongQuery,
  SongSummary,
  SortOrder,
  TagCount,
  YtDlpStatus,
} from "./types";

/*
 * State shared by the app shell and the pages: the library list (the sidebar
 * shows counts), the instrument presets and default, the library filter and
 * search, which sheet is open, the colour theme, and who is signed in.
 */

export type { LibraryFilter };
export type Theme = "system" | "dark" | "light";
export type Sheet = "" | "add" | "settings" | "tuner" | "calibration";
export type PlayerView = "tab" | "highway" | "split";

export const PLAYER_VIEWS: readonly PlayerView[] = ["tab", "highway", "split"];

/** What the song page hands the tuner: the track's strings (highest first) and capo. */
export interface TunerRequest {
  tuning: number[];
  capo: number;
}

const THEME_KEY = "fretbook.theme";
const NOTATION_KEY = "fretbook.notation";
const VIEW_KEY = "fretbook.playerView";
const SORT_KEY = "fretbook.librarySort";

/** Songs per request. The library shows more through "Load more". */
export const PAGE_SIZE = 48;

const SORTS: LibrarySort[] = ["title", "artist", "added", "updated", "opened", "difficulty"];

/** The order each sort starts in: newest first for dates, A to Z for text, easiest first for difficulty. */
export function defaultOrder(sort: LibrarySort): SortOrder {
  return sort === "title" || sort === "artist" || sort === "difficulty" ? "asc" : "desc";
}

function storedSort(): { sort: LibrarySort; order: SortOrder } {
  const fallback = { sort: "updated" as LibrarySort, order: defaultOrder("updated") };
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SORT_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as { sort?: unknown; order?: unknown };
    const sort = SORTS.find((item) => item === value.sort);
    if (!sort) return fallback;
    return {
      sort,
      order: value.order === "asc" || value.order === "desc" ? value.order : defaultOrder(sort),
    };
  } catch {
    return fallback;
  }
}

function storedTheme(): Theme {
  try {
    const value = typeof localStorage === "undefined" ? null : localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "light" ? value : "system";
  } catch {
    return "system";
  }
}

function storedNotation(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(NOTATION_KEY) === "1";
  } catch {
    return false;
  }
}

export function storedPlayerView(userId?: string | null): PlayerView {
  try {
    if (typeof localStorage === "undefined") return "tab";
    const perUser = userId ? localStorage.getItem(`${VIEW_KEY}.${userId}`) : null;
    const raw = perUser ?? localStorage.getItem(VIEW_KEY);
    return PLAYER_VIEWS.includes(raw as PlayerView) ? (raw as PlayerView) : "tab";
  } catch {
    return "tab";
  }
}

const initialSort = storedSort();

export const ui = $state({
  /** The caller. `authenticated` is false in single-user mode, where there is no sign-in. */
  me: null as Me | null,
  /** The loaded pages of the library for the current search, filter and sort. */
  songs: [] as SongSummary[],
  /** Songs matching the search and filter, including the ones not loaded yet. */
  total: 0,
  nextCursor: null as string | null,
  counts: { all: 0, bass: 0, electric: 0, acoustic: 0, chords: 0, favourites: 0 } as LibraryCounts,
  /** The last few edited songs, for the sidebar. */
  recent: [] as SongSummary[],
  /** A few starred songs, for the sidebar. */
  favourites: [] as SongSummary[],
  /** Every tag in the library with its song count, for the filter chips and tag suggestions. */
  tagList: [] as TagCount[],
  /** Tags the library is filtered by. A song needs all of them. */
  tags: [] as string[],
  /** Show only starred songs. */
  favouritesOnly: false,
  /** Keep only tabs in a difficulty band. */
  level: "all" as LibraryLevel,
  loaded: false,
  loadingMore: false,
  sort: initialSort.sort,
  order: initialSort.order,
  presets: [] as InstrumentPreset[],
  ytdlp: null as YtDlpStatus | null,
  /** A read-only public demo: hide what would change the library. */
  demoMode: false,
  version: null as string | null,
  commit: null as string | null,
  defaultInstrument: "bass-4",
  filter: "all" as LibraryFilter,
  search: "",
  sheet: "" as Sheet,
  /** Set when the tuner opens from a song, so it can preload that song's tuning. */
  tunerRequest: null as TunerRequest | null,
  theme: storedTheme(),
  /** Standard notation above the tab. Off by default: most players only read the tab. */
  notation: storedNotation(),
  /** Tab, scrolling note highway, or split view on the song page. */
  playerView: storedPlayerView(),
  error: "",
});

export function countFor(filter: LibraryFilter | "favourites"): number {
  return ui.counts[filter];
}

function currentQuery(): SongQuery {
  return {
    q: ui.search.trim(),
    sort: ui.sort,
    order: ui.order,
    instrument: ui.filter,
    tag: [...ui.tags],
    favourite: ui.favouritesOnly,
    ...levelQuery(ui.level),
    limit: PAGE_SIZE,
  };
}

function queryKey(query: SongQuery): string {
  return JSON.stringify(query);
}

let requestSeq = 0;
let loadedKey = "";

/** Fetch the first page for the current search, filter and sort. A slower, older response never replaces a newer one. */
export async function loadLibrary({ force = false } = {}): Promise<void> {
  const query = currentQuery();
  const key = queryKey(query);
  if (!force && key === loadedKey) return;
  const seq = ++requestSeq;
  const page = await listSongs(query);
  if (seq !== requestSeq) return;
  loadedKey = key;
  ui.songs = page.items;
  ui.total = page.total;
  ui.nextCursor = page.next_cursor;
  ui.counts = page.counts;
  ui.loaded = true;
}

export async function loadMore(): Promise<void> {
  const cursor = ui.nextCursor;
  if (!cursor || ui.loadingMore) return;
  const seq = requestSeq;
  ui.loadingMore = true;
  try {
    const page = await listSongs({ ...currentQuery(), cursor });
    if (seq !== requestSeq) return;
    const known = ui.songs.map((song) => song.id);
    ui.songs = [...ui.songs, ...page.items.filter((song) => !known.includes(song.id))];
    ui.total = page.total;
    ui.nextCursor = page.next_cursor;
    ui.counts = page.counts;
  } finally {
    ui.loadingMore = false;
  }
}

/** Reload the library and the sidebar after the set of songs, their tags or their stars changed. */
export async function refreshSongs(): Promise<void> {
  const [, recent, favourites, tagList] = await Promise.all([
    loadLibrary({ force: true }),
    listSongs({ sort: "updated", order: "desc", limit: 5 }),
    listSongs({ sort: "title", favourite: true, limit: 8 }),
    listTags(),
  ]);
  ui.recent = recent.items;
  ui.favourites = favourites.items;
  ui.tagList = tagList;
  // A tag that no song has any more cannot filter anything.
  const known = tagList.map((item) => item.tag.toLowerCase());
  const kept = ui.tags.filter((tag) => known.includes(tag.toLowerCase()));
  if (kept.length !== ui.tags.length) ui.tags = kept;
}

/** Star or unstar a song, then refresh the library and the sidebar. */
export async function starSong(id: string, favourite: boolean): Promise<void> {
  await setFavourite(id, favourite);
  // Offline the change is queued; the lists are refreshed when it is sent.
  await refreshSongs().catch((error: unknown) => {
    if (!isOfflineError(error)) throw error;
  });
}

/** Add or remove a tag from the library filter. */
export function toggleTagFilter(tag: string): void {
  const lower = tag.toLowerCase();
  ui.tags = ui.tags.some((item) => item.toLowerCase() === lower)
    ? ui.tags.filter((item) => item.toLowerCase() !== lower)
    : [...ui.tags, tag];
}

/** Remember the sort. Without an order, the sort starts in its natural one. */
export function setSort(sort: LibrarySort, order: SortOrder = defaultOrder(sort)): void {
  ui.sort = sort;
  ui.order = order;
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify({ sort, order }));
  } catch {
    /* storage may be unavailable */
  }
}

let metaLoaded = false;

export async function loadMeta(): Promise<void> {
  if (metaLoaded) return;
  const [meta, me] = await Promise.all([getMeta(), getMe()]);
  ui.me = me;
  ui.presets = meta.instruments;
  ui.ytdlp = meta.ytdlp;
  ui.demoMode = meta.demo_mode ?? false;
  ui.version = meta.version;
  ui.commit = meta.commit;
  ui.defaultInstrument = me.settings.default_instrument;
  ui.playerView = storedPlayerView(me.user_id);
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

/** Open the tuner, optionally preloaded with a song's tuning and capo. */
export function openTuner(request: TunerRequest | null = null): void {
  ui.tunerRequest = request;
  ui.sheet = "tuner";
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
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "light" ? "#f6f3ee" : "#0c0b10");
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

export function setNotation(show: boolean): void {
  ui.notation = show;
  try {
    if (show) localStorage.setItem(NOTATION_KEY, "1");
    else localStorage.removeItem(NOTATION_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

export function setPlayerView(view: PlayerView): void {
  ui.playerView = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
    if (ui.me?.user_id) localStorage.setItem(`${VIEW_KEY}.${ui.me.user_id}`, view);
  } catch {
    /* storage may be unavailable */
  }
}

if (typeof window !== "undefined") {
  applyTheme();
  window
    .matchMedia?.("(prefers-color-scheme: light)")
    .addEventListener?.("change", () => applyTheme());
}
