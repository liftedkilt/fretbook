/**
 * Paginated PDF export for tabs and chord sheets.
 *
 * Tabs are engraved by alphaTab (the same renderer as the player) to SVG, one
 * chunk per staff system, then placed on A4 pages. The page header carries the
 * title, artist, tuning, and track name. `paginate` refuses to cut a system
 * across a page; a system taller than the page is scaled onto a page of its own.
 * Chord sheets use the same page size and header, flowed as lines of text.
 */

import * as alphaTab from "@coderline/alphatab";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";

import { preferredTrack, trackToAlphaTex } from "../alphatex";
import { parse, transposeChord } from "../chordpro";
import type { ScoreDocument } from "../types";
import { tuningLabel } from "../tuning";
import { type Box, paginate } from "./layout";
import { drawSvg, embedFonts, encodable, openMusicFont, type PdfFonts } from "./svg";

export const PDF_PAGE = {
  width: 595.28,
  height: 841.89,
  marginX: 42,
  marginTop: 32,
  marginBottom: 34,
  headerHeight: 40,
} as const;

export function contentWidth(): number {
  return PDF_PAGE.width - PDF_PAGE.marginX * 2;
}

export function contentHeight(): number {
  return PDF_PAGE.height - PDF_PAGE.marginTop - PDF_PAGE.headerHeight - PDF_PAGE.marginBottom;
}

const INK = rgb(0.1, 0.08, 0.05);
const DIM = rgb(0.32, 0.26, 0.18);
const RULE = rgb(0.55, 0.45, 0.32);
const CHORD = rgb(0.45, 0.24, 0.06);

export interface TrackPdfInput {
  document: ScoreDocument;
  trackId: string;
  title: string;
  artist: string;
  /** Already translated, for example "Capo 3". Empty when there is no capo. */
  capoLabel?: string;
  bravura: Uint8Array;
}

export interface TrackPdf {
  bytes: Uint8Array;
  pageCount: number;
  /** Vertical span of each page in the engraved score. A staff system lies in exactly one. */
  pages: { top: number; bottom: number; scale: number }[];
  systems: Box[];
  /** Tuning alphaTab actually engraved, highest string first. */
  tuning: number[];
}

interface StaffChunk extends Box {
  svg: string;
  x: number;
}

function fittedSize(font: PDFFont, text: string, width: number, size: number): number {
  let next = size;
  while (next > 8 && font.widthOfTextAtSize(text, next) > width) next -= 0.5;
  return next;
}

function drawHeader(page: PDFPage, fonts: PdfFonts, title: string, detail: string, pageNumber: number): void {
  const titleFont = fonts.timesBold;
  const detailFont = fonts.times;
  const label = encodable(detailFont, String(pageNumber));
  const labelWidth = detailFont.widthOfTextAtSize(label, 9);
  const titleText = encodable(titleFont, title.trim() || "Untitled");
  const titleSize = fittedSize(titleFont, titleText, contentWidth() - labelWidth - 16, 14);
  const titleBaseline = PDF_PAGE.height - PDF_PAGE.marginTop - 13;
  page.drawText(titleText, { x: PDF_PAGE.marginX, y: titleBaseline, size: titleSize, font: titleFont, color: INK });
  page.drawText(label, {
    x: PDF_PAGE.width - PDF_PAGE.marginX - labelWidth,
    y: titleBaseline,
    size: 9,
    font: detailFont,
    color: DIM,
  });
  const detailText = encodable(detailFont, detail.trim());
  if (detailText) {
    const detailSize = fittedSize(detailFont, detailText, contentWidth(), 10);
    page.drawText(detailText, {
      x: PDF_PAGE.marginX,
      y: titleBaseline - 15,
      size: detailSize,
      font: detailFont,
      color: DIM,
    });
  }
  const rule = PDF_PAGE.height - PDF_PAGE.marginTop - PDF_PAGE.headerHeight + 6;
  page.drawLine({
    start: { x: PDF_PAGE.marginX, y: rule },
    end: { x: PDF_PAGE.width - PDF_PAGE.marginX, y: rule },
    thickness: 0.6,
    color: RULE,
  });
}

function engrave(tex: string, width: number): { chunks: StaffChunk[]; systems: Box[]; tuning: number[] } {
  const settings = new alphaTab.Settings();
  settings.core.engine = "svg";
  settings.core.enableLazyLoading = false;
  settings.core.logLevel = alphaTab.LogLevel.None;
  settings.display.staveProfile = alphaTab.StaveProfile.ScoreTab;
  settings.display.layoutMode = alphaTab.LayoutMode.Page;
  settings.display.barsPerRow = 4;
  // The page header repeats the title, artist, track, and the song's tuning.
  // alphaTab's own caption would only name a preset ("Bass Standard Tuning").
  for (const element of [
    alphaTab.NotationElement.ScoreTitle,
    alphaTab.NotationElement.ScoreSubTitle,
    alphaTab.NotationElement.ScoreArtist,
    alphaTab.NotationElement.ScoreAlbum,
    alphaTab.NotationElement.ScoreWords,
    alphaTab.NotationElement.ScoreMusic,
    alphaTab.NotationElement.ScoreWordsAndMusic,
    alphaTab.NotationElement.ScoreCopyright,
    alphaTab.NotationElement.TrackNames,
    alphaTab.NotationElement.GuitarTuning,
  ]) {
    settings.notation.elements.set(element, false);
  }
  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = width;
  const chunks: StaffChunk[] = [];
  let failure: unknown;
  renderer.error.on((error: unknown) => {
    failure = error;
  });
  renderer.partialLayoutFinished.on((part) => {
    renderer.renderResult(part.id);
  });
  renderer.partialRenderFinished.on((part) => {
    if (typeof part.renderResult !== "string" || part.height <= 0) return;
    chunks.push({ svg: part.renderResult, x: part.x, y: part.y, height: part.height });
  });
  try {
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex);
    renderer.renderScore(score, [0]);
    if (failure) throw failure instanceof Error ? failure : new Error("could not engrave the score");
    const systems = (renderer.boundsLookup?.staffSystems ?? [])
      .map((system) => ({ y: system.realBounds.y, height: system.realBounds.h }))
      .filter((system) => system.height > 1);
    const tuning = [...(score.tracks[0]?.staves[0]?.tuning ?? [])];
    if (!chunks.length || !systems.length) throw new Error("the score produced no staves");
    return { chunks, systems, tuning };
  } finally {
    renderer.destroy();
  }
}

export async function renderTrackPdf(input: TrackPdfInput): Promise<TrackPdf> {
  const track = input.document.tracks.find((item) => item.id === input.trackId) ?? preferredTrack(input.document);
  const tex = trackToAlphaTex(input.document, track.id, input.title, input.artist);
  const engraved = engrave(tex, contentWidth());
  const placed = paginate(engraved.chunks, engraved.systems, contentHeight());
  const detail = [input.artist, track.name, tuningLabel(track.tuning_midi), input.capoLabel ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");

  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title || track.name);
  pdf.setAuthor(input.artist);
  pdf.setCreator("Fretbook");
  const fonts = await embedFonts(pdf);
  fonts.music = openMusicFont(input.bravura);
  const contentTop = PDF_PAGE.height - PDF_PAGE.marginTop - PDF_PAGE.headerHeight;
  placed.forEach((placedPage, index) => {
    const page = pdf.addPage([PDF_PAGE.width, PDF_PAGE.height]);
    drawHeader(page, fonts, input.title, detail, index + 1);
    for (const chunk of placedPage.items) {
      const local = (chunk.y - placedPage.top) * placedPage.scale;
      drawSvg(page, chunk.svg, fonts, {
        originX: PDF_PAGE.marginX + chunk.x * placedPage.scale,
        originTop: contentTop - local,
        scale: placedPage.scale,
      });
    }
  });
  const bytes = await pdf.save({ useObjectStreams: false });
  return {
    bytes,
    pageCount: placed.length,
    pages: placed.map((page) => ({ top: page.top, bottom: page.bottom, scale: page.scale })),
    systems: engraved.systems,
    tuning: engraved.tuning,
  };
}

export interface ChordPdfInput {
  chordpro: string;
  title: string;
  artist: string;
  transpose?: number;
  flats?: boolean;
}

interface FlowLine extends Box {
  paint: (page: PDFPage, originTop: number) => void;
}

function wrapWords(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(encodable(font, next), size) > width) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export async function renderChordSheetPdf(input: ChordPdfInput): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const sheet = parse(input.chordpro);
  const transpose = input.transpose ?? 0;
  const flats = input.flats ?? false;
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setAuthor(input.artist);
  pdf.setCreator("Fretbook");
  const body = await pdf.embedFont(StandardFonts.TimesRoman);
  const bodyBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const bodyItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const chordFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const lyricFont = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const fonts: PdfFonts = {
    music: null,
    helvetica: lyricFont,
    helveticaBold: chordFont,
    helveticaOblique: lyricFont,
    helveticaBoldOblique: chordFont,
    times: body,
    timesBold: bodyBold,
    timesItalic: bodyItalic,
    timesBoldItalic: bodyBold,
  };
  const width = contentWidth();
  const lines: FlowLine[] = [];
  let cursor = 0;
  const add = (height: number, paint: FlowLine["paint"]) => {
    lines.push({ y: cursor, height, paint });
    cursor += height;
  };
  const shifted = (chord: string | null) => (chord ? transposeChord(chord, transpose, flats) : "");
  for (const block of sheet.blocks) {
    if (block.label) {
      add(18, (page, originTop) => {
        const text = encodable(bodyBold, block.label);
        if (text) page.drawText(text, { x: PDF_PAGE.marginX, y: originTop - 12, size: 12, font: bodyBold, color: INK });
      });
    }
    for (const line of block.lines) {
      if (line.kind === "empty") {
        add(8, () => undefined);
      } else if (line.kind === "comment" || line.kind === "section") {
        const font = line.kind === "section" ? bodyBold : bodyItalic;
        const source = line.kind === "section" ? line.label : line.text;
        for (const row of wrapWords(source, font, 11, width)) {
          add(16, (page, originTop) => {
            const text = encodable(font, row);
            if (text) page.drawText(text, { x: PDF_PAGE.marginX, y: originTop - 11, size: 11, font, color: DIM });
          });
        }
      } else if (line.kind === "tab") {
        let size = 8;
        const text = encodable(mono, line.text);
        while (size > 5 && mono.widthOfTextAtSize(text, size) > width) size -= 0.5;
        add(size + 4, (page, originTop) => {
          if (text) page.drawText(text, { x: PDF_PAGE.marginX, y: originTop - size, size, font: mono, color: INK });
        });
      } else {
        const segments = line.segments.map((segment) => ({ chord: shifted(segment.chord), text: segment.text }));
        let row: typeof segments = [];
        let used = 0;
        const widthOf = (segment: { chord: string; text: string }) =>
          Math.max(
            segment.chord ? chordFont.widthOfTextAtSize(encodable(chordFont, segment.chord), 9) + 6 : 0,
            lyricFont.widthOfTextAtSize(encodable(lyricFont, segment.text || " "), 11),
          );
        const flush = () => {
          const painted = row;
          row = [];
          used = 0;
          if (!painted.length) return;
          add(26, (page, originTop) => {
            let x = PDF_PAGE.marginX;
            for (const segment of painted) {
              if (segment.chord) {
                page.drawText(encodable(chordFont, segment.chord), {
                  x,
                  y: originTop - 9,
                  size: 9,
                  font: chordFont,
                  color: CHORD,
                });
              }
              const lyric = encodable(lyricFont, segment.text);
              if (lyric) {
                page.drawText(lyric, { x, y: originTop - 22, size: 11, font: lyricFont, color: INK });
              }
              x += widthOf(segment);
            }
          });
        };
        for (const segment of segments) {
          const segmentWidth = widthOf(segment);
          if (row.length && used + segmentWidth > width) flush();
          row.push(segment);
          used += segmentWidth;
        }
        flush();
      }
    }
  }
  const placed = paginate(
    lines,
    lines.map((line) => ({ y: line.y, height: line.height })),
    contentHeight(),
  );
  const pages = placed.length ? placed : [{ top: 0, bottom: 0, scale: 1, items: [] as FlowLine[] }];
  const contentTop = PDF_PAGE.height - PDF_PAGE.marginTop - PDF_PAGE.headerHeight;
  pages.forEach((placedPage, index) => {
    const page = pdf.addPage([PDF_PAGE.width, PDF_PAGE.height]);
    drawHeader(page, fonts, input.title, input.artist, index + 1);
    for (const line of placedPage.items) {
      const local = (line.y - placedPage.top) * placedPage.scale;
      line.paint(page, contentTop - local);
    }
  });
  return { bytes: await pdf.save({ useObjectStreams: false }), pageCount: pages.length };
}

export function pdfFileName(title: string, track?: string): string {
  const raw = [title, track ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" - ");
  const cleaned = raw
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned || "Untitled"}.pdf`;
}

export function savePdf(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy.buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadTrackPdf(input: Omit<TrackPdfInput, "bravura">): Promise<void> {
  const response = await fetch(new URL("font/Bravura.otf", document.baseURI));
  if (!response.ok) throw new Error("Bravura font");
  const rendered = await renderTrackPdf({ ...input, bravura: new Uint8Array(await response.arrayBuffer()) });
  const track = input.document.tracks.find((item) => item.id === input.trackId) ?? preferredTrack(input.document);
  savePdf(rendered.bytes, pdfFileName(input.title, track.name));
}

export async function downloadChordSheetPdf(input: ChordPdfInput): Promise<void> {
  const rendered = await renderChordSheetPdf(input);
  savePdf(rendered.bytes, pdfFileName(input.title));
}
