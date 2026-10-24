import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders paragraphs, emphasis and code", () => {
    expect(renderMarkdown("play **slow** and *clean* with `capo 2`")).toBe(
      "<p>play <strong>slow</strong> and <em>clean</em> with <code>capo 2</code></p>",
    );
  });

  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    expect(renderMarkdown("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  it("renders headings one level down, and lists", () => {
    expect(renderMarkdown("# Intro\n- a\n- b\n\n1. first\n2) second")).toBe(
      "<h3>Intro</h3><ul><li>a</li><li>b</li></ul><ol><li>first</li><li>second</li></ol>",
    );
  });

  it("switches between a bullet and a numbered list", () => {
    expect(renderMarkdown("- a\n1. b")).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
  });

  it("links http and https addresses and nothing else", () => {
    expect(renderMarkdown("[song](https://example.com/a?x=1&y=2)")).toBe(
      '<p><a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">song</a></p>',
    );
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("<a");
    expect(renderMarkdown("[x](data:text/html,hi)")).not.toContain("<a");
  });

  it("escapes HTML so nothing typed becomes markup", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    const link = renderMarkdown('[a"onmouseover="x](https://e.com/"onclick="y)');
    // Quotes in the label and address are escaped, so the tag keeps only its own three attributes.
    expect(link).toMatch(
      /^<p><a href="[^"]*" target="_blank" rel="noopener noreferrer">[^<"]*<\/a><\/p>$/,
    );
  });

  it("does not read emphasis inside code or a link address", () => {
    expect(renderMarkdown("`*a*`")).toBe("<p><code>*a*</code></p>");
    expect(renderMarkdown("[a](https://e.com/*b*)")).toContain('href="https://e.com/*b*"');
  });

  it("gives nothing for empty text and handles Windows line endings", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n\n")).toBe("");
    expect(renderMarkdown("a\r\n\r\nb")).toBe("<p>a</p><p>b</p>");
  });

  it("escapes the characters HTML cares about", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
