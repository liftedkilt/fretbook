<script lang="ts">
  import ChordSheet from "./ChordSheet.svelte";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { SongDetail } from "../lib/types";

  let { song }: { song: SongDetail } = $props();

  let transpose = $state(0);
  let flats = $state(false);
  let size = $state(1);
  let exporting = $state(false);
  let error = $state("");

  function exportUrl(kind: string): string {
    return new URL(`api/songs/${song.id}/export.${kind}`, document.baseURI).toString();
  }

  async function exportPdf() {
    exporting = true;
    error = "";
    try {
      const { downloadChordSheetPdf } = await import("../lib/export/pdf");
      await downloadChordSheetPdf({
        chordpro: song.chordpro ?? "",
        title: song.title,
        artist: song.artist,
        transpose,
        flats,
      });
    } catch {
      error = t("player.exportPdfFailed");
    } finally {
      exporting = false;
    }
  }
</script>

{#if error}<p class="error">{error}</p>{/if}
<div class="row no-print" style="justify-content:space-between">
  <div>
    <h2 style="margin:0">{song.title}</h2>
    {#if song.artist}<p class="hint" style="margin:0.2rem 0 0">{song.artist}</p>{/if}
  </div>
  <div class="actions">
    <a class="button" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>{t("app.back")}</a>
    <a class="button" href={hrefFor(`/songs/${song.id}/edit`)} onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}>{t("player.edit")}</a>
    <a class="button" href={exportUrl("cho")}>{t("chords.exportChordPro")}</a>
    <a class="button" href={exportUrl("json")}>{t("player.exportJson")}</a>
    <button disabled={exporting} onclick={() => void exportPdf()}>{exporting ? t("player.exportingPdf") : t("player.exportPdf")}</button>
  </div>
</div>

<div class="transport no-print">
  <span class="field" style="align-items:center">
    {t("chords.transpose")}
    <span class="row">
      <button onclick={() => (transpose -= 1)} aria-label={t("chords.down")}>−</button>
      <strong>{transpose > 0 ? `+${transpose}` : transpose}</strong>
      <button onclick={() => (transpose += 1)} aria-label={t("chords.up")}>+</button>
      {#if transpose !== 0}<button onclick={() => (transpose = 0)}>{t("chords.reset")}</button>{/if}
    </span>
  </span>
  <label class="field" style="align-items:center">
    <span>{t("chords.flats")}</span>
    <input type="checkbox" bind:checked={flats} />
  </label>
  <label class="field">
    {t("chords.size")}
    <input type="range" min="0.8" max="1.8" step="0.1" bind:value={size} />
  </label>
</div>

<div class="paper chord-paper" style="font-size:{size}rem">
  <ChordSheet text={song.chordpro ?? ""} {transpose} {flats} />
</div>
