import { describe, expect, it } from "vitest";

import type { YtDlpStatus } from "./types";
import { ytdlpHealth } from "./ytdlp";

const base: YtDlpStatus = {
  version: "2026.10.21",
  released: "2026-10-21",
  age_days: 2,
  stale: false,
  auto_update: false,
  cookies: false,
};

describe("ytdlpHealth", () => {
  it("is unknown without a status or a release date", () => {
    expect(ytdlpHealth(null)).toBe("unknown");
    expect(ytdlpHealth({ ...base, version: null, released: null, age_days: null })).toBe("unknown");
  });

  it("is fresh for a recent release", () => {
    expect(ytdlpHealth(base)).toBe("fresh");
  });

  it("is stale when the server says so", () => {
    expect(ytdlpHealth({ ...base, age_days: 45, stale: true })).toBe("stale");
  });
});
