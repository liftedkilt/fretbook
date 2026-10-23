import * as alphaTab from "@coderline/alphatab";

import { t } from "../i18n.svelte";
import { choosePreferred, scoreToDocument as convert } from "./convert";

export { choosePreferred };

const labels = () => ({
  untitled: t("library.untitled"),
  untitledTrack: (number: number) => t("editor.untitledTrack", { number }),
  noFrettedTracks: t("import.noFrettedTracks"),
});

export function scoreToDocument(score: alphaTab.model.Score) {
  return convert(score, labels());
}

export function documentFromGuitarPro(data: Uint8Array, family: "bass" | "guitar" | null = null) {
  const parsed = scoreToDocument(alphaTab.importer.ScoreLoader.loadScoreFromBytes(data));
  choosePreferred(parsed.document, family);
  return parsed;
}
