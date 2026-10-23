import { describe, expect, it } from "vitest";
import {
  classifyPaste,
  hasGuitarProHeader,
  isGuitarProFile,
  isGuitarProZip,
  isZip,
  MAX_ZIP_SNIFF_BYTES,
} from "./sniff";

const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("Guitar Pro detection", () => {
  it("recognises the Guitar Pro 3-5 and 6 headers", () => {
    expect(hasGuitarProHeader(bytes("\x18FICHIER GUITAR PRO v5.00"))).toBe(true);
    expect(hasGuitarProHeader(bytes("BCFZ\x00\x00"))).toBe(true);
    expect(hasGuitarProHeader(bytes("BCFS\x00\x00"))).toBe(true);
    expect(hasGuitarProHeader(bytes("<?xml version"))).toBe(false);
    expect(hasGuitarProHeader(bytes("MThd"))).toBe(false);
  });

  it("recognises a Guitar Pro 7/8 zip by its score entry, not any zip", () => {
    const gp = bytes("PK\x03\x04....Content/score.gpif....");
    expect(isZip(gp)).toBe(true);
    expect(isGuitarProZip(gp)).toBe(true);
    expect(isGuitarProZip(bytes("PK\x03\x04....META-INF/container.xml"))).toBe(false);
    expect(isGuitarProZip(bytes("Content/score.gpif"))).toBe(false);
  });

  it("looks at file content whatever the file is called", async () => {
    const gp5 = new File([bytes("\x18FICHIER GUITAR PRO v5.00 and more")], "notes.txt");
    const gp7 = new File([bytes("PK\x03\x04..Content/score.gpif..")], "song.zip");
    const mxl = new File([bytes("PK\x03\x04..META-INF/container.xml..")], "song.gp");
    const text = new File(["e|-0-|"], "tab.gp5");
    expect(await isGuitarProFile(gp5)).toBe(true);
    expect(await isGuitarProFile(gp7)).toBe(true);
    expect(await isGuitarProFile(mxl)).toBe(false);
    expect(await isGuitarProFile(text)).toBe(false);
  });

  it("does not read a huge zip whole", async () => {
    const big = new File([bytes("PK\x03\x04")], "huge.zip");
    Object.defineProperty(big, "size", { value: MAX_ZIP_SNIFF_BYTES + 1 });
    expect(await isGuitarProFile(big)).toBe(false);
  });
});

describe("classifyPaste", () => {
  it("treats a lone link as a link", () => {
    expect(classifyPaste("  https://example.com/tab?id=3 \n")).toEqual({
      url: "https://example.com/tab?id=3",
    });
  });

  it("treats anything else as text", () => {
    expect(classifyPaste("see https://example.com for the tab")).toEqual({
      text: "see https://example.com for the tab",
    });
    expect(classifyPaste("e|-0-|\nB|---|")).toEqual({ text: "e|-0-|\nB|---|" });
  });

  it("ignores blanks", () => {
    expect(classifyPaste("  \n ")).toBeNull();
  });
});
