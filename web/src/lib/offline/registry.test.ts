import { describe, expect, it } from "vitest";

import {
  emptyRegistry,
  readRegistry,
  withoutSetlist,
  withoutVia,
  withSetlist,
  withSong,
  writeRegistry,
} from "./registry";

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("registry", () => {
  it("keeps a song while any reason for it is left", () => {
    let registry = withSong(emptyRegistry(), "a", "Song", "song");
    registry = withSong(registry, "a", "Song", "setlist:1");
    expect(registry.songs.a.via).toEqual(["song", "setlist:1"]);
    const first = withoutVia(registry, "a", "song");
    expect(first.dropped).toBe(false);
    const second = withoutVia(first.registry, "a", "setlist:1");
    expect(second.dropped).toBe(true);
    expect(second.registry.songs).toEqual({});
  });

  it("does not drop a song it never saved, and keeps the first save time", () => {
    const registry = emptyRegistry();
    expect(withoutVia(registry, "zzz", "song")).toEqual({ registry, dropped: false });
    const first = withSong(registry, "a", "Song", "song");
    const again = withSong(first, "a", "Renamed", "song");
    expect(again.songs.a.savedAt).toBe(first.songs.a.savedAt);
    expect(again.songs.a.title).toBe("Renamed");
  });

  it("tracks setlists", () => {
    const registry = withSetlist(emptyRegistry(), "s", "Gig", ["a", "b"]);
    expect(registry.setlists.s.songIds).toEqual(["a", "b"]);
    expect(withSetlist(registry, "s", "Gig 2", ["a"]).setlists.s.savedAt).toBe(
      registry.setlists.s.savedAt,
    );
    expect(withoutSetlist(registry, "s").setlists).toEqual({});
  });

  it("round-trips through storage and survives garbage", () => {
    const storage = memory();
    expect(readRegistry(storage)).toEqual(emptyRegistry());
    const registry = withSong(emptyRegistry(), "a", "Song", "song");
    writeRegistry(registry, storage);
    expect(readRegistry(storage)).toEqual(registry);
    storage.setItem("fretbook.offline.saved.v1", "{bad");
    expect(readRegistry(storage)).toEqual(emptyRegistry());
    storage.setItem("fretbook.offline.saved.v1", '{"songs":1}');
    expect(readRegistry(storage)).toEqual(emptyRegistry());
    expect(readRegistry(null)).toEqual(emptyRegistry());
    expect(() => writeRegistry(registry, null)).not.toThrow();
  });
});
