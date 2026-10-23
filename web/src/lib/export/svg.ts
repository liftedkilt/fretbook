/**
 * Draw the subset of SVG that alphaTab's SVG engine emits: groups with
 * translate/rotate, filled rectangles, straight and cubic paths, and text.
 * Music glyphs are private-use characters in the Bravura font (the `.at`
 * class). They are drawn as vector outlines, because embedding Bravura's
 * CFF subset produces a font ordinary PDF viewers reject. Other text is
 * Arial or Georgia, which the PDF maps to the standard Helvetica and Times fonts.
 */

import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  degrees,
  rgb,
  type RGB,
} from "pdf-lib";

/** alphaTab's default engraving size for the `.at` music font (`musicFontSize`). */
const MUSIC_FONT_PX = 36;

export interface MusicGlyph {
  advanceWidth: number;
  /** SVG path in font units, y-up. Empty when the glyph has no outline. */
  path: string;
}

/** Bravura, used only for glyph outlines. Nothing from the font file is embedded. */
export interface MusicFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  glyph(codePoint: number): MusicGlyph;
}

export interface PdfFonts {
  music: MusicFont | null;
  helvetica: PDFFont;
  helveticaBold: PDFFont;
  helveticaOblique: PDFFont;
  helveticaBoldOblique: PDFFont;
  times: PDFFont;
  timesBold: PDFFont;
  timesItalic: PDFFont;
  timesBoldItalic: PDFFont;
}

export function openMusicFont(bravura: Uint8Array): MusicFont {
  const font = fontkit.create(bravura);
  const cache = new Map<number, MusicGlyph>();
  return {
    unitsPerEm: font.unitsPerEm || 1000,
    ascent: font.ascent,
    descent: font.descent,
    glyph(codePoint: number): MusicGlyph {
      const known = cache.get(codePoint);
      if (known) return known;
      const glyph = font.glyphForCodePoint(codePoint);
      const next = { advanceWidth: glyph.advanceWidth || 0, path: glyph.path?.toSVG() ?? "" };
      cache.set(codePoint, next);
      return next;
    },
  };
}

export async function embedFonts(pdf: PDFDocument): Promise<PdfFonts> {
  const [
    helvetica,
    helveticaBold,
    helveticaOblique,
    helveticaBoldOblique,
    times,
    timesBold,
    timesItalic,
    timesBoldItalic,
  ] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
    pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    pdf.embedFont(StandardFonts.TimesRoman),
    pdf.embedFont(StandardFonts.TimesRomanBold),
    pdf.embedFont(StandardFonts.TimesRomanItalic),
    pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
  ]);
  return {
    music: null,
    helvetica,
    helveticaBold,
    helveticaOblique,
    helveticaBoldOblique,
    times,
    timesBold,
    timesItalic,
    timesBoldItalic,
  };
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f];
}

function numbers(source: string): number[] {
  return source
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
}

/** SVG transform lists apply rightmost-last, so each function is multiplied on the right. */
export function parseTransform(value: string): Matrix {
  let matrix = IDENTITY;
  for (const match of value.matchAll(/(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g)) {
    const kind = match[1];
    const args = numbers(match[2]);
    let next = IDENTITY;
    if (kind === "translate") next = { ...IDENTITY, e: args[0] || 0, f: args[1] || 0 };
    else if (kind === "scale") {
      const sx = args[0] || 1;
      next = { a: sx, b: 0, c: 0, d: args.length > 1 ? args[1] : sx, e: 0, f: 0 };
    } else if (kind === "rotate") {
      const angle = ((args[0] || 0) * Math.PI) / 180;
      const rot: Matrix = {
        a: Math.cos(angle),
        b: Math.sin(angle),
        c: -Math.sin(angle),
        d: Math.cos(angle),
        e: 0,
        f: 0,
      };
      next =
        args.length >= 3
          ? multiply(multiply({ ...IDENTITY, e: args[1], f: args[2] }, rot), {
              ...IDENTITY,
              e: -args[1],
              f: -args[2],
            })
          : rot;
    } else next = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    matrix = multiply(matrix, next);
  }
  return matrix;
}

interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
  text: string;
}

function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** alphaTab's SVG is a small, well-formed subset. A full XML library would dwarf it. */
export function parseSvg(source: string): SvgNode {
  let index = 0;
  const skipSpace = () => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  };
  const readName = () => {
    const start = index;
    while (index < source.length && /[A-Za-z0-9_:.-]/.test(source[index])) index += 1;
    return source.slice(start, index);
  };
  const skipComment = () => {
    const end = source.indexOf("-->", index);
    index = end < 0 ? source.length : end + 3;
  };
  const parseNodes = (): SvgNode[] => {
    const nodes: SvgNode[] = [];
    while (index < source.length && !source.startsWith("</", index)) {
      if (source.startsWith("<!--", index)) {
        skipComment();
        continue;
      }
      if (source.startsWith("<?", index) || source.startsWith("<!", index)) {
        const end = source.indexOf(">", index);
        index = end < 0 ? source.length : end + 1;
        continue;
      }
      if (source[index] === "<") {
        nodes.push(parseElement());
        continue;
      }
      const start = index;
      while (index < source.length && source[index] !== "<") index += 1;
      const text = decode(source.slice(start, index));
      if (text) nodes.push({ tag: "", attrs: {}, children: [], text });
    }
    return nodes;
  };
  const parseElement = (): SvgNode => {
    index += 1;
    const tag = readName();
    const attrs: Record<string, string> = {};
    while (index < source.length) {
      skipSpace();
      if (source[index] === ">" || source[index] === "/") break;
      const name = readName();
      skipSpace();
      if (source[index] === "=") {
        index += 1;
        skipSpace();
        const quote = source[index];
        index += 1;
        const start = index;
        while (index < source.length && source[index] !== quote) index += 1;
        attrs[name] = decode(source.slice(start, index));
        index += 1;
      }
    }
    if (source[index] === "/") {
      index += 2;
      return { tag, attrs, children: [], text: "" };
    }
    index += 1;
    const parsed = parseNodes();
    if (source.startsWith("</", index)) {
      index += 2;
      readName();
      skipSpace();
      if (source[index] === ">") index += 1;
    }
    return {
      tag,
      attrs,
      children: parsed.filter((node) => node.tag),
      text: parsed
        .filter((node) => !node.tag)
        .map((node) => node.text)
        .join(""),
    };
  };
  skipSpace();
  const root = parseNodes().find((node) => node.tag === "svg");
  if (!root) throw new Error("rendered score has no SVG");
  return root;
}

function parseStyle(value: string | undefined): Record<string, string> {
  const style: Record<string, string> = {};
  if (!value) return style;
  for (const part of value.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    style[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
  }
  return style;
}

function parseFont(value: string): {
  size?: number;
  weight?: "bold" | "normal";
  fontStyle?: "italic" | "normal";
  family?: string;
} {
  const parts = value.trim().split(/\s+/);
  let weight: "bold" | "normal" | undefined;
  let fontStyle: "italic" | "normal" | undefined;
  let size: number | undefined;
  let familyAt = parts.length;
  for (let cursor = 0; cursor < parts.length; cursor += 1) {
    const part = parts[cursor].toLowerCase();
    if (part === "bold" || part === "700") weight = "bold";
    else if (part === "italic" || part === "oblique") fontStyle = "italic";
    else if (part === "normal" || part === "400") continue;
    else if (/^[\d.]+px$/.test(part)) {
      size = Number.parseFloat(part);
      familyAt = cursor + 1;
      break;
    }
  }
  const family = parts.slice(familyAt).join(" ");
  return { size, weight, fontStyle, family: family || undefined };
}

function parseColor(value: string): RGB {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return rgb(0, 0, 0);
  let digits = match[1];
  if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join("");
  const color = Number.parseInt(digits, 16);
  return rgb(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
}

interface DrawContext {
  matrix: Matrix;
  music: boolean;
  fontSize: number;
  fill: RGB | null;
  weight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  family: string;
}

const characters = new WeakMap<PDFFont, Set<number>>();

/** Drop characters the font cannot encode, so a title in another script still produces a PDF. */
export function encodable(font: PDFFont, text: string): string {
  let known = characters.get(font);
  if (!known) {
    known = new Set(font.getCharacterSet());
    characters.set(font, known);
  }
  let out = "";
  for (const char of text) if (known.has(char.codePointAt(0) ?? 0)) out += char;
  return out;
}

function pickFont(fonts: PdfFonts, ctx: DrawContext): PDFFont {
  const serif = /georgia|times|serif/i.test(ctx.family);
  const bold = ctx.weight === "bold";
  const italic = ctx.fontStyle === "italic";
  if (serif && bold && italic) return fonts.timesBoldItalic;
  if (serif && bold) return fonts.timesBold;
  if (serif && italic) return fonts.timesItalic;
  if (serif) return fonts.times;
  if (bold && italic) return fonts.helveticaBoldOblique;
  if (bold) return fonts.helveticaBold;
  if (italic) return fonts.helveticaOblique;
  return fonts.helvetica;
}

function fontMetrics(font: PDFFont, size: number): { ascent: number; descent: number } {
  const ascent = font.heightAtSize(size, { descender: false });
  const full = font.heightAtSize(size, { descender: true });
  return { ascent, descent: Math.max(0, full - ascent) };
}

/** Move an alphabetic baseline so it matches the SVG `dominant-baseline` value. */
function alignBaseline(y: number, baseline: string, ascent: number, descent: number): number {
  if (baseline === "hanging" || baseline === "text-before-edge") return y + ascent;
  if (baseline === "middle" || baseline === "central") return y + (ascent - descent) / 2;
  if (baseline === "ideographic" || baseline === "text-after-edge") return y - descent;
  return y;
}

/** Rewrite a path into absolute coordinates in the parent user space. */
function transformPath(path: string, matrix: Matrix): string {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let index = 0;
  let command = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let control: [number, number] | null = null;
  const out: string[] = [];
  const take = () => Number.parseFloat(tokens[index++]);
  const emit = (name: string, coords: number[]) => {
    out.push(name, ...coords.map((coord) => String(Math.round(coord * 1000) / 1000)));
  };
  const point = (x: number, y: number): [number, number] => apply(matrix, x, y);
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === "Z") {
      emit("Z", []);
      cx = sx;
      cy = sy;
      control = null;
      continue;
    }
    if (upper === "H" || upper === "V") {
      const value = take();
      const x = upper === "H" ? (relative ? cx + value : value) : cx;
      const y = upper === "V" ? (relative ? cy + value : value) : cy;
      emit("L", point(x, y));
      cx = x;
      cy = y;
      control = null;
      continue;
    }
    if (upper === "M" || upper === "L" || upper === "T") {
      const x = take();
      const y = take();
      const ax = relative ? cx + x : x;
      const ay = relative ? cy + y : y;
      if (upper === "T") {
        const qx: number = control ? 2 * cx - control[0] : cx;
        const qy: number = control ? 2 * cy - control[1] : cy;
        emit("C", [
          ...point(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy)),
          ...point(ax + (2 / 3) * (qx - ax), ay + (2 / 3) * (qy - ay)),
          ...point(ax, ay),
        ]);
        control = [qx, qy];
      } else {
        emit(upper, point(ax, ay));
        control = null;
      }
      cx = ax;
      cy = ay;
      if (upper === "M") {
        sx = cx;
        sy = cy;
        command = relative ? "l" : "L";
      }
      continue;
    }
    if (upper === "C" || upper === "S" || upper === "Q") {
      let c1x = cx;
      let c1y = cy;
      let c2x = cx;
      let c2y = cy;
      if (upper === "C") {
        const x1 = take();
        const y1 = take();
        c1x = relative ? cx + x1 : x1;
        c1y = relative ? cy + y1 : y1;
      } else if (upper === "S") {
        c1x = control ? 2 * cx - control[0] : cx;
        c1y = control ? 2 * cy - control[1] : cy;
      }
      if (upper === "Q") {
        const x1 = take();
        const y1 = take();
        const qx = relative ? cx + x1 : x1;
        const qy = relative ? cy + y1 : y1;
        const x = take();
        const y = take();
        const ax = relative ? cx + x : x;
        const ay = relative ? cy + y : y;
        emit("C", [
          ...point(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy)),
          ...point(ax + (2 / 3) * (qx - ax), ay + (2 / 3) * (qy - ay)),
          ...point(ax, ay),
        ]);
        control = [qx, qy];
        cx = ax;
        cy = ay;
        continue;
      }
      const x2 = take();
      const y2 = take();
      const x = take();
      const y = take();
      c2x = relative ? cx + x2 : x2;
      c2y = relative ? cy + y2 : y2;
      const ax = relative ? cx + x : x;
      const ay = relative ? cy + y : y;
      emit("C", [...point(c1x, c1y), ...point(c2x, c2y), ...point(ax, ay)]);
      control = [c2x, c2y];
      cx = ax;
      cy = ay;
      continue;
    }
    if (upper === "A") {
      take();
      take();
      take();
      take();
      take();
      const x = take();
      const y = take();
      cx = relative ? cx + x : x;
      cy = relative ? cy + y : y;
      emit("L", point(cx, cy));
      control = null;
      continue;
    }
    throw new Error(`unsupported SVG path command ${command}`);
  }
  return out.join(" ");
}

function childContext(el: SvgNode, parent: DrawContext): DrawContext {
  const style = parseStyle(el.attrs.style);
  const next: DrawContext = {
    matrix: el.attrs.transform
      ? multiply(parent.matrix, parseTransform(el.attrs.transform))
      : parent.matrix,
    music: parent.music,
    fontSize: parent.fontSize,
    fill: parent.fill,
    weight: parent.weight,
    fontStyle: parent.fontStyle,
    family: parent.family,
  };
  if (!parent.music && (el.attrs.class ?? "").split(/\s+/).includes("at")) {
    next.music = true;
    next.fontSize = MUSIC_FONT_PX;
    next.family = "alphaTab";
  }
  if (style.font) {
    const parsed = parseFont(style.font);
    if (parsed.weight) next.weight = parsed.weight;
    if (parsed.fontStyle) next.fontStyle = parsed.fontStyle;
    if (parsed.size) next.fontSize = parsed.size;
    if (parsed.family) {
      next.family = parsed.family;
      next.music = /alphatab/i.test(parsed.family);
    }
  }
  if (style["font-size"]) {
    const raw = style["font-size"];
    // A percentage is relative to the size already chosen for this element (the `.at` music size).
    next.fontSize = raw.endsWith("%")
      ? next.fontSize * (Number.parseFloat(raw) / 100)
      : Number.parseFloat(raw);
  }
  const fill = style.fill ?? el.attrs.fill;
  if (fill !== undefined) next.fill = fill === "none" ? null : parseColor(fill);
  return next;
}

export interface SvgPlacement {
  /** PDF x of the SVG origin. */
  originX: number;
  /** PDF y of the SVG origin (the top edge; PDF y grows upward). */
  originTop: number;
  scale: number;
}

/**
 * Paint one alphaTab SVG chunk. `originTop` is the PDF y of the chunk's top edge.
 */
export function drawSvg(page: PDFPage, svg: string, fonts: PdfFonts, place: SvgPlacement): void {
  const root = parseSvg(svg);
  const rootContext: DrawContext = {
    matrix: IDENTITY,
    music: false,
    fontSize: 12,
    fill: rgb(0, 0, 0),
    weight: "normal",
    fontStyle: "normal",
    family: "Arial, sans-serif",
  };
  const visit = (el: SvgNode, parent: DrawContext) => {
    const ctx = childContext(el, parent);
    const style = parseStyle(el.attrs.style);
    if (el.tag === "rect" && ctx.fill) {
      const x = Number.parseFloat(el.attrs.x ?? "0");
      const y = Number.parseFloat(el.attrs.y ?? "0");
      const w = Number.parseFloat(el.attrs.width ?? "0");
      const h = Number.parseFloat(el.attrs.height ?? "0");
      if (w > 0 && h > 0) {
        const corners = [
          apply(ctx.matrix, x, y),
          apply(ctx.matrix, x + w, y),
          apply(ctx.matrix, x + w, y + h),
          apply(ctx.matrix, x, y + h),
        ];
        const xs = corners.map((corner) => corner[0]);
        const ys = corners.map((corner) => corner[1]);
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        const axis = Math.abs(ctx.matrix.b) < 1e-6 && Math.abs(ctx.matrix.c) < 1e-6;
        if (axis) {
          page.drawRectangle({
            x: place.originX + left * place.scale,
            y: place.originTop - bottom * place.scale,
            width: (right - left) * place.scale,
            height: (bottom - top) * place.scale,
            color: ctx.fill,
          });
        } else {
          page.drawSvgPath(
            transformPath(
              `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`,
              ctx.matrix,
            ),
            {
              x: place.originX,
              y: place.originTop,
              scale: place.scale,
              color: ctx.fill,
            },
          );
        }
      }
    } else if (el.tag === "path" && el.attrs.d) {
      const strokeRaw = style.stroke ?? el.attrs.stroke;
      const stroke = strokeRaw && strokeRaw !== "none" ? parseColor(strokeRaw) : null;
      const fill = ctx.fill;
      if (fill || stroke) {
        const width =
          Number.parseFloat(style["stroke-width"] ?? el.attrs["stroke-width"] ?? "1") || 1;
        page.drawSvgPath(transformPath(el.attrs.d, ctx.matrix), {
          x: place.originX,
          y: place.originTop,
          scale: place.scale,
          color: fill ?? undefined,
          borderColor: stroke ?? undefined,
          borderWidth: stroke ? width : 0,
        });
      }
    } else if ((el.tag === "text" || el.tag === "tspan") && el.text.trim() && ctx.fill) {
      const anchor = el.attrs["text-anchor"] ?? style["text-anchor"] ?? "start";
      const baseline = (
        style["dominant-baseline"] ??
        el.attrs["dominant-baseline"] ??
        "alphabetic"
      ).toLowerCase();
      let x = Number.parseFloat(el.attrs.x ?? "0") || 0;
      let y = Number.parseFloat(el.attrs.y ?? "0") || 0;
      const music = ctx.music ? fonts.music : null;
      if (music) {
        const em = ctx.fontSize / music.unitsPerEm;
        const glyphs = Array.from(el.text, (char) => music.glyph(char.codePointAt(0) ?? 0));
        const width = glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * em;
        if (anchor === "middle") x -= width / 2;
        else if (anchor === "end") x -= width;
        y = alignBaseline(y, baseline, music.ascent * em, Math.abs(music.descent) * em);
        let pen = x;
        for (const glyph of glyphs) {
          if (glyph.path.trim()) {
            const outline = transformPath(
              glyph.path,
              multiply(ctx.matrix, { a: em, b: 0, c: 0, d: -em, e: pen, f: y }),
            );
            if (outline) {
              page.drawSvgPath(outline, {
                x: place.originX,
                y: place.originTop,
                scale: place.scale,
                color: ctx.fill,
              });
            }
          }
          pen += glyph.advanceWidth * em;
        }
      } else if (!ctx.music) {
        const font = pickFont(fonts, ctx);
        const text = encodable(font, el.text);
        if (text) {
          const metrics = fontMetrics(font, ctx.fontSize);
          const width = font.widthOfTextAtSize(text, ctx.fontSize);
          if (anchor === "middle") x -= width / 2;
          else if (anchor === "end") x -= width;
          y = alignBaseline(y, baseline, metrics.ascent, metrics.descent);
          const [sx, sy] = apply(ctx.matrix, x, y);
          const rotation = (Math.atan2(ctx.matrix.b, ctx.matrix.a) * 180) / Math.PI;
          page.drawText(text, {
            x: place.originX + sx * place.scale,
            y: place.originTop - sy * place.scale,
            size: ctx.fontSize * place.scale,
            font,
            color: ctx.fill,
            rotate: Math.abs(rotation) > 0.05 ? degrees(-rotation) : undefined,
          });
        }
      }
    }
    for (const child of el.children) visit(child, ctx);
  };
  visit(root, rootContext);
}
