/**
 * Guitar Pro is the one format the browser reads itself (alphaTab), so the Add box has to
 * recognise it before anything is uploaded. Everything else is identified by the server.
 */

const OLD_HEADER = "\x18FICHIER GUITAR PRO"; // Guitar Pro 3 to 5: a length byte, then the text
const GPX_HEADERS = ["BCFZ", "BCFS"]; // Guitar Pro 6
const ZIP_HEADER = "PK\x03\x04";
const GP7_SCORE = "Content/score.gpif"; // Guitar Pro 7 and 8: a zip with this entry

/** A Guitar Pro 7/8 file is small; a bigger zip is not worth reading whole just to look for the entry. */
export const MAX_ZIP_SNIFF_BYTES = 32 * 1024 * 1024;
/** Enough to see every header above. */
export const HEAD_BYTES = 24;

function ascii(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** True when the first bytes are a Guitar Pro 3-6 header. A Guitar Pro 7/8 zip needs {@link isGuitarProZip}. */
export function hasGuitarProHeader(head: Uint8Array): boolean {
  const text = ascii(head.subarray(0, HEAD_BYTES));
  return text.startsWith(OLD_HEADER) || GPX_HEADERS.some((header) => text.startsWith(header));
}

export function isZip(head: Uint8Array): boolean {
  return ascii(head.subarray(0, 4)) === ZIP_HEADER;
}

/** True when a whole zip file holds a Guitar Pro 7/8 score entry (entry names are stored plainly in the zip). */
export function isGuitarProZip(bytes: Uint8Array): boolean {
  return isZip(bytes) && ascii(bytes).includes(GP7_SCORE);
}

export async function isGuitarProFile(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  if (hasGuitarProHeader(head)) return true;
  if (!isZip(head) || file.size > MAX_ZIP_SNIFF_BYTES) return false;
  return isGuitarProZip(new Uint8Array(await file.arrayBuffer()));
}

/** What the Add box sends for pasted text: a lone link is a link, anything else is text. */
export function classifyPaste(value: string): { url: string } | { text: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return { url: trimmed };
  return { text: value };
}

const AUDIO_SUFFIXES = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus"];

export function isAudioFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_SUFFIXES.some((ext) => lower.endsWith(ext));
}
