// Splitting the server's marked lyrics snippet into runs for the library cards.
import { describe, expect, it } from "vitest";

import { snippetParts } from "./lyricsSnippet";

describe("snippetParts", () => {
  it("splits matched words from the text around them", () => {
    expect(snippetParts("Take me down to the \u0002paradise\u0003 \u0002city\u0003")).toEqual([
      { text: "Take me down to the ", hit: false },
      { text: "paradise", hit: true },
      { text: " ", hit: false },
      { text: "city", hit: true },
    ]);
  });

  it("keeps markup as text and tolerates a missing end marker", () => {
    expect(snippetParts("<b>x</b> \u0002word")).toEqual([
      { text: "<b>x</b> ", hit: false },
      { text: "word", hit: true },
    ]);
    expect(snippetParts("")).toEqual([]);
  });
});
