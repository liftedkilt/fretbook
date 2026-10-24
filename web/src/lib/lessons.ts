import type { FretNote } from "./fretboard";

/** Where a lesson page lives. Ids are lowercase words, so they never need escaping. */
export function lessonPath(course: string, lesson: string): string {
  return `/lessons/${course}/${lesson}`;
}

export function coursePath(course: string): string {
  return `/lessons/${course}`;
}

/** The learning tracks, in the order they are listed. */
export const TRACKS = [
  { id: "guitar", labelKey: "lessons.track.guitar" },
  { id: "bass", labelKey: "lessons.track.bass" },
] as const;

export function trackLabelKey(track: string): string {
  return (TRACKS.find((item) => item.id === track) ?? TRACKS[0]).labelKey;
}

// -- Markdown ---------------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A link target we are willing to put in `href`: http(s), or a relative address. Never a script. */
export function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // No scheme before the first path, query or fragment character means it is relative.
  if (/^[^:/?#]*([/?#]|$)/.test(trimmed) && !/^\s*$/.test(trimmed)) return trimmed;
  return null;
}

function spans(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, label: string, target: string) => {
      const href = safeUrl(target.replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
      if (href === null) return label;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
}

function inline(text: string): string {
  return text
    .split(/(`[^`\n]+`)/)
    .map((part, index) =>
      index % 2 ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : spans(escapeHtml(part)),
    )
    .join("");
}

/**
 * A small Markdown subset to HTML: headings, paragraphs, bullet and numbered lists, quotes, code
 * blocks, **bold**, *italic*, `code` and links. Every character is escaped before any markup is
 * added, and links are limited to http(s) and relative addresses, so lesson text from a pack can
 * not inject script.
 */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flush = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
    if (list) {
      html.push(
        `<${list.tag}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${list.tag}>`,
      );
      list = null;
    }
    if (quote.length) html.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].startsWith(fence[1])) code.push(lines[index++]);
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || number) {
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flush();
      if (paragraph.length || quote.length) flush();
      list ??= { tag, items: [] };
      list.items.push(inline((bullet ?? number)![1]));
      continue;
    }
    const quoted = /^>\s?(.*)$/.exec(line);
    if (quoted) {
      if (paragraph.length || list) flush();
      quote.push(quoted[1]);
      continue;
    }
    if (list || quote.length) flush();
    paragraph.push(line.trim());
  }
  flush();
  return html.join("\n");
}

// -- Fretboard blocks -------------------------------------------------------------------------

const NOTE_NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Pitch class (0 to 11) of a note name such as `F#` or `Bb`, or null for anything else. */
export function notePitchClass(name: string): number | null {
  const match = /^([A-G])([#b]?)$/.exec(name);
  if (!match) return null;
  const shift = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return (NOTE_NAMES[match[1]] + shift + 12) % 12;
}

export const SCALE_STEPS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  "major-pentatonic": [0, 2, 4, 7, 9],
  "minor-pentatonic": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

/** The pitch classes a fretboard block lights: its `notes`, or the `scale` from its `root`. */
export function fretboardPitchClasses(params: Record<string, string>): Set<number> {
  const found = new Set<number>();
  if (params.notes) {
    for (const name of params.notes.split(/\s+/)) {
      const pc = notePitchClass(name);
      if (pc !== null) found.add(pc);
    }
  } else if (params.scale && params.root) {
    const root = notePitchClass(params.root);
    for (const step of SCALE_STEPS[params.scale] ?? [])
      if (root !== null) found.add((root + step) % 12);
  }
  return found;
}

/**
 * Every spot on the neck that sounds one of the pitch classes. `tuning` is the open-string pitches,
 * highest string first, as the fretboard diagram takes it.
 */
export function spotsFor(tuning: number[], pitchClasses: Set<number>, frets = 12): FretNote[] {
  const spots: FretNote[] = [];
  tuning.forEach((open, string) => {
    for (let fret = 0; fret <= frets; fret++) {
      if (pitchClasses.has((open + fret) % 12)) spots.push({ string, fret });
    }
  });
  return spots;
}

/** The lesson text's blocks that can be a link out to YouTube rather than a player. */
export function isYouTube(src: string): boolean {
  try {
    const host = new URL(src).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com";
  } catch {
    return false;
  }
}

/** A starting file for a new lesson or course, so the front matter is there to edit. */
export function lessonTemplate(title = ""): string {
  return `---\ntitle: ${title}\nsummary: \nlevel: \norder: 1\n---\nWrite the lesson here.\n`;
}

export function courseTemplate(track: "guitar" | "bass" = "guitar"): string {
  return `---\ntitle: \ntrack: ${track}\nsummary: \nlevels:\n  - basics: Basics\n---\n`;
}

/** A lesson or course id from a title: lowercase words joined by dashes. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug === "new" || slug === "edit" ? `${slug}-1` : slug;
}
