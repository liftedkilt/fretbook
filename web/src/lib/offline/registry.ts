/** What was made available offline on purpose, so the UI can show it without asking the Cache API. */
export interface SavedSong {
  title: string;
  savedAt: string;
  /** Why it is kept: `"song"` when saved by itself, `"setlist:<id>"` for each saved setlist that has it. */
  via: string[];
}

export interface SavedSetlist {
  name: string;
  savedAt: string;
  songIds: string[];
}

export interface Registry {
  songs: Record<string, SavedSong>;
  setlists: Record<string, SavedSetlist>;
}

const KEY = "fretbook.offline.saved.v1";

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function emptyRegistry(): Registry {
  return { songs: {}, setlists: {} };
}

export function readRegistry(storage: Storage | null = browserStorage()): Registry {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? "null") as Partial<Registry> | null;
    if (!parsed || typeof parsed.songs !== "object" || typeof parsed.setlists !== "object")
      return emptyRegistry();
    return { songs: parsed.songs ?? {}, setlists: parsed.setlists ?? {} };
  } catch {
    return emptyRegistry();
  }
}

export function writeRegistry(
  registry: Registry,
  storage: Storage | null = browserStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(registry));
  } catch {
    /* the files are still saved; only the list of them is lost */
  }
}

export function withSong(registry: Registry, id: string, title: string, via: string): Registry {
  const known = registry.songs[id];
  const reasons = new Set(known?.via ?? []);
  reasons.add(via);
  return {
    ...registry,
    songs: {
      ...registry.songs,
      [id]: { title, savedAt: known?.savedAt ?? new Date().toISOString(), via: [...reasons] },
    },
  };
}

/** Drop one reason for keeping a song. `dropped` is true when it has no reason left, so its files can go. */
export function withoutVia(
  registry: Registry,
  id: string,
  via: string,
): { registry: Registry; dropped: boolean } {
  const known = registry.songs[id];
  if (!known) return { registry, dropped: false };
  const via2 = known.via.filter((item) => item !== via);
  const songs = { ...registry.songs };
  if (via2.length === 0) delete songs[id];
  else songs[id] = { ...known, via: via2 };
  return { registry: { ...registry, songs }, dropped: via2.length === 0 };
}

export function withSetlist(
  registry: Registry,
  id: string,
  name: string,
  songIds: string[],
): Registry {
  const known = registry.setlists[id];
  return {
    ...registry,
    setlists: {
      ...registry.setlists,
      [id]: { name, savedAt: known?.savedAt ?? new Date().toISOString(), songIds },
    },
  };
}

export function withoutSetlist(registry: Registry, id: string): Registry {
  const setlists = { ...registry.setlists };
  delete setlists[id];
  return { ...registry, setlists };
}
