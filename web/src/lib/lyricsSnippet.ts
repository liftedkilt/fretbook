/**
 * Split a library search's lyrics snippet into plain and matched runs.
 *
 * The server marks each matched word with U+0002 before and U+0003 after it. The runs are
 * rendered as text nodes, never as HTML, because the lyrics are user text.
 */

export interface SnippetPart {
  text: string;
  hit: boolean;
}

const START = "\u0002";
const END = "\u0003";

export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let hit = false;
  let text = "";
  const flush = () => {
    if (text) parts.push({ text, hit });
    text = "";
  };
  for (const char of snippet) {
    if (char === START || char === END) {
      flush();
      hit = char === START;
    } else text += char;
  }
  flush();
  return parts;
}
