/*
 * A small Markdown renderer for a song's personal notes. The text is HTML-escaped first and only then turned into
 * markup, so the result is safe to insert with `{@html}`: nothing a person types can add a tag or an attribute.
 * Supported: headings (#, ##, ###), paragraphs, bullet and numbered lists, **bold**, *italic*, `code`, and links to
 * http(s) addresses. Everything else is shown as typed.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g;

function inline(source: string): string {
  const spans: string[] = [];
  // Code spans and links are lifted out first so their contents are not read as emphasis.
  let text = escapeHtml(source).replace(/`([^`\n]+)`/g, (_, code: string) => {
    spans.push(`<code>${code}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });
  text = text.replace(LINK, (_, label: string, href: string) => {
    spans.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    return `\u0000${spans.length - 1}\u0000`;
  });
  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => spans[Number(index)]);
}

/** HTML for the notes. Empty text gives an empty string. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list)
      html.push(
        `<${list.tag}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${list.tag}>`,
      );
    list = null;
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      // Notes sit under the page's own headings, so # becomes h3.
      const level = heading[1].length + 2;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(inline((bullet ?? numbered)![1]));
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return html.join("");
}
