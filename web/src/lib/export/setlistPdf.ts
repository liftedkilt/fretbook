/**
 * One PDF for a whole setlist: a contents page (running order, notes, transposes), then each song
 * rendered by the single-song exporters in `./pdf` and appended in order.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { preferredTrack } from "../alphatex";
import type { SongDetail } from "../types";
import { PDF_PAGE, pdfFileName, renderChordSheetPdf, renderTrackPdf, savePdf } from "./pdf";
import { encodable } from "./svg";

export interface SetlistPdfEntry {
  song: SongDetail;
  note: string;
  /** Semitones, applied to chord sheets only. */
  transpose: number;
}

export interface SetlistPdfInput {
  name: string;
  entries: SetlistPdfEntry[];
  /** The music font, needed only when the setlist has a tab. */
  bravura?: Uint8Array;
  /** Already-translated words for the contents page. */
  labels: { contents: string; transpose: (semitones: number) => string };
  capoLabel: (capo: number) => string;
  notation?: boolean;
}

const INK = rgb(0.1, 0.08, 0.05);
const DIM = rgb(0.32, 0.26, 0.18);
const ROW = 22;

async function renderEntry(entry: SetlistPdfEntry, input: SetlistPdfInput): Promise<Uint8Array> {
  const { song } = entry;
  if (song.content_kind === "chords" || !song.document) {
    return (
      await renderChordSheetPdf({
        chordpro: song.chordpro ?? "",
        title: song.title,
        artist: song.artist,
        transpose: entry.transpose,
      })
    ).bytes;
  }
  if (!input.bravura) throw new Error("Bravura font");
  const track = preferredTrack(song.document);
  return (
    await renderTrackPdf({
      document: song.document,
      trackId: track.id,
      title: song.title,
      artist: song.artist,
      capoLabel: track.capo > 0 ? input.capoLabel(track.capo) : "",
      notation: input.notation,
      bravura: input.bravura,
    })
  ).bytes;
}

async function addContents(pdf: PDFDocument, input: SetlistPdfInput, firstPages: number[]) {
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);
  const left = PDF_PAGE.marginX;
  const right = PDF_PAGE.width - PDF_PAGE.marginX;
  let page = pdf.insertPage(0, [PDF_PAGE.width, PDF_PAGE.height]);
  let at = 1;
  let y = PDF_PAGE.height - PDF_PAGE.marginTop - 24;
  page.drawText(encodable(bold, input.name.trim() || "Untitled"), {
    x: left,
    y,
    size: 22,
    font: bold,
    color: INK,
  });
  y -= 18;
  page.drawText(encodable(plain, input.labels.contents), {
    x: left,
    y,
    size: 10,
    font: plain,
    color: DIM,
  });
  y -= 14;
  input.entries.forEach((entry, index) => {
    const lines = [entry.note.trim()];
    if (entry.transpose && entry.song.content_kind === "chords")
      lines.push(input.labels.transpose(entry.transpose));
    const detail = lines.filter(Boolean).join(" · ");
    const height = ROW + (detail ? 12 : 0);
    if (y - height < PDF_PAGE.marginBottom) {
      page = pdf.insertPage(at, [PDF_PAGE.width, PDF_PAGE.height]);
      at += 1;
      y = PDF_PAGE.height - PDF_PAGE.marginTop - 8;
    }
    y -= ROW;
    const title = [entry.song.title, entry.song.artist].filter(Boolean).join(" – ");
    page.drawText(encodable(bold, `${index + 1}.`), {
      x: left,
      y,
      size: 12,
      font: bold,
      color: INK,
    });
    page.drawText(encodable(plain, title), { x: left + 24, y, size: 12, font: plain, color: INK });
    const where = encodable(plain, String(firstPages[index]));
    page.drawText(where, {
      x: right - plain.widthOfTextAtSize(where, 10),
      y,
      size: 10,
      font: plain,
      color: DIM,
    });
    if (detail) {
      y -= 12;
      page.drawText(encodable(plain, detail), {
        x: left + 24,
        y,
        size: 9,
        font: plain,
        color: DIM,
      });
    }
  });
}

/** The combined PDF. `pageCount` includes the contents page(s). */
export async function renderSetlistPdf(
  input: SetlistPdfInput,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.name);
  pdf.setCreator("Fretbook");
  const firstPages: number[] = [];
  for (const entry of input.entries) {
    const part = await PDFDocument.load(await renderEntry(entry, input));
    firstPages.push(pdf.getPageCount() + 1);
    for (const page of await pdf.copyPages(part, part.getPageIndices())) pdf.addPage(page);
  }
  // The contents go in front, so the page numbers it lists must move by however many pages it takes.
  const probe = await PDFDocument.create();
  const before = pdf.getPageCount();
  await addContents(probe, input, firstPages);
  const contentsPages = probe.getPageCount();
  await addContents(
    pdf,
    input,
    firstPages.map((page) => page + contentsPages),
  );
  return {
    bytes: await pdf.save({ useObjectStreams: false }),
    pageCount: before + contentsPages,
  };
}

export async function downloadSetlistPdf(input: Omit<SetlistPdfInput, "bravura">): Promise<void> {
  let bravura: Uint8Array | undefined;
  if (input.entries.some((entry) => entry.song.content_kind === "tab")) {
    const response = await fetch(new URL("font/Bravura.otf", document.baseURI));
    if (!response.ok) throw new Error("Bravura font");
    bravura = new Uint8Array(await response.arrayBuffer());
  }
  const rendered = await renderSetlistPdf({ ...input, bravura });
  savePdf(rendered.bytes, pdfFileName(input.name));
}
