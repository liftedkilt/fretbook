import { describe, expect, it } from "vitest";
import {
  courseTemplate,
  fretboardPitchClasses,
  isYouTube,
  lessonPath,
  lessonTemplate,
  notePitchClass,
  renderMarkdown,
  safeUrl,
  slugify,
  spotsFor,
} from "./lessons";

describe("renderMarkdown", () => {
  it("renders headings, paragraphs and inline formatting", () => {
    const html = renderMarkdown(
      "# Title\n\nSome **bold**, *soft* and `code` text\nover two lines.",
    );
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>soft</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("text over two lines.");
  });

  it("renders lists, quotes and code blocks", () => {
    const html = renderMarkdown(
      "- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```\n<b>x</b>\n```",
    );
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain("<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>");
  });

  it("escapes HTML instead of passing it through", () => {
    const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror="boom()">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("only links to http(s) and relative addresses", () => {
    expect(renderMarkdown("[ok](https://example.test/a?b=1&c=2)")).toContain(
      'href="https://example.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"',
    );
    expect(renderMarkdown("[rel](/songs/abc)")).toContain('href="/songs/abc"');
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "  javascript:x",
    ]) {
      const html = renderMarkdown(`[click](${bad})`);
      expect(html).not.toContain("href");
      expect(html).toContain("click");
    }
  });

  it("cannot break out of an attribute or a tag with quotes", () => {
    const html = renderMarkdown('[x](https://a.test/"onmouseover="alert(1))');
    expect(html).not.toMatch(/onmouseover="/);
    expect(renderMarkdown("`</code><script>`")).not.toContain("<script");
  });

  it("is empty for empty text", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("\n\n")).toBe("");
  });
});

describe("safeUrl", () => {
  it("accepts web and relative links and rejects other schemes", () => {
    expect(safeUrl("https://a.test")).toBe("https://a.test");
    expect(safeUrl("http://a.test")).toBe("http://a.test");
    expect(safeUrl("/songs/1")).toBe("/songs/1");
    expect(safeUrl("#top")).toBe("#top");
    expect(safeUrl("page")).toBe("page");
    expect(safeUrl("mailto:a@b.test")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });
});

describe("fretboard helpers", () => {
  it("reads note names", () => {
    expect(notePitchClass("A")).toBe(9);
    expect(notePitchClass("F#")).toBe(6);
    expect(notePitchClass("Bb")).toBe(10);
    expect(notePitchClass("Cb")).toBe(11);
    expect(notePitchClass("H")).toBeNull();
    expect(notePitchClass("a")).toBeNull();
  });

  it("lights notes, or a scale from a root", () => {
    expect([...fretboardPitchClasses({ notes: "A C E" })].sort((a, b) => a - b)).toEqual([0, 4, 9]);
    expect(
      [...fretboardPitchClasses({ root: "A", scale: "minor-pentatonic" })].sort((a, b) => a - b),
    ).toEqual([0, 2, 4, 7, 9]);
    expect(fretboardPitchClasses({}).size).toBe(0);
    expect(fretboardPitchClasses({ root: "A", scale: "nope" }).size).toBe(0);
  });

  it("finds every spot for the pitch classes on a neck, highest string first", () => {
    // A two-string neck, E4 over E2: an open E on both, and an E again at the 12th fret.
    const spots = spotsFor([64, 40], new Set([4]), 12);
    expect(spots).toEqual([
      { string: 0, fret: 0 },
      { string: 0, fret: 12 },
      { string: 1, fret: 0 },
      { string: 1, fret: 12 },
    ]);
  });
});

describe("small helpers", () => {
  it("builds paths", () => {
    expect(lessonPath("a", "b")).toBe("/lessons/a/b");
  });

  it("recognises YouTube links", () => {
    expect(isYouTube("https://www.youtube.com/watch?v=1")).toBe(true);
    expect(isYouTube("https://youtu.be/1")).toBe(true);
    expect(isYouTube("https://example.test/a.mp4")).toBe(false);
    expect(isYouTube("not a url")).toBe(false);
  });

  it("makes ids from titles", () => {
    expect(slugify("  Em & Am: Your First Chords! ")).toBe("em-am-your-first-chords");
    expect(slugify("Ação Rápida")).toBe("acao-rapida");
    expect(slugify("New")).toBe("new-1");
    expect(slugify("!!!")).toBe("");
    expect(slugify("x".repeat(100)).length).toBe(64);
  });

  it("offers templates with front matter", () => {
    expect(lessonTemplate("Hi")).toMatch(/^---\ntitle: Hi\n/);
    expect(courseTemplate("bass")).toContain("track: bass");
  });
});
