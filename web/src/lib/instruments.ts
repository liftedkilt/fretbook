import { t } from "./i18n.svelte";

/** Which library filter a stored instrument name belongs in. */

export type InstrumentFilter = "bass" | "electric" | "acoustic";

export function instrumentFamily(instrument: string): InstrumentFilter | "other" {
  const text = instrument.toLowerCase();
  if (text.includes("bass")) return "bass";
  if (text.includes("acoustic")) return "acoustic";
  if (text.includes("guitar")) return "electric";
  return "other";
}

/** A short name for the song page and the library. Unknown instruments stay as stored. */
export function instrumentLabel(instrument: string): string {
  const family = instrumentFamily(instrument);
  if (family === "bass") return t("instrument.bass");
  if (family === "acoustic") return t("instrument.acoustic");
  if (family === "electric") return t("instrument.electric");
  return instrument;
}
