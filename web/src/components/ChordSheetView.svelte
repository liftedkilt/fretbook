<script lang="ts">
  import ChordSheet from "./ChordSheet.svelte";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { SongDetail } from "../lib/types";

  let { song }: { song: SongDetail } = $props();

  let transpose = $state(0);
  let flats = $state(false);
  let size = $state(1.05);
  let twoColumns = $state(false);
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

<div class="page-header no-print">
  <div class="page-title-group">
    <h2>{song.title}</h2>
    <div class="page-meta">
      {#if song.artist}<strong>{song.artist}</strong> ·{/if}
      <span class="badge brass">{t("library.chordSheet")}</span>
    </div>
  </div>
  <div class="actions">
    <a class="button sm" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>{t("app.back")}</a>
    <a class="button sm" href={hrefFor(`/songs/${song.id}/edit`)} onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}>
      {t("player.edit")}
    </a>
    <a class="button sm ghost" href={exportUrl("cho")}>{t("chords.exportChordPro")}</a>
    <a class="button sm ghost" href={exportUrl("json")}>{t("player.exportJson")}</a>
    <button class="sm ghost" disabled={exporting} onclick={() => void exportPdf()}>
      {exporting ? t("player.exportingPdf") : t("player.exportPdf")}
    </button>
  </div>
</div>

<section class="transport-dock no-print">
  <div class="transport-primary">
    <div class="transport-group">
      <span class="field" style="display:flex;align-items:center;gap:0.45rem">
        <span>{t("chords.transpose")}</span>
        <span class="row" style="align-items:center;gap:0.35rem">
          <button class="sm" onclick={() => (transpose -= 1)} aria-label={t("chords.down")}>−</button>
          <span class="status-readout" style="min-width:2.6rem;text-align:center">
            {transpose > 0 ? `+${transpose}` : transpose}
          </span>
          <button class="sm" onclick={() => (transpose += 1)} aria-label={t("chords.up")}>+</button>
          {#if transpose !== 0}
            <button class="sm ghost" onclick={() => (transpose = 0)}>{t("chords.reset")}</button>
          {/if}
        </span>
      </span>

      <label class="field-inline">
        <input type="checkbox" bind:checked={flats} />
        <span>{t("chords.flats")}</span>
      </label>
    </div>

    <div class="transport-group">
      <label class="field" style="display:flex;align-items:center;gap:0.5rem">
        <span>{t("chords.size")}</span>
        <input type="range" min="0.8" max="1.8" step="0.05" bind:value={size} />
      </label>

      <div class="segmented" role="group" aria-label={t("chords.columns")}>
        <button type="button" aria-pressed={!twoColumns} onclick={() => (twoColumns = false)}>
          {t("chords.singleColumn")}
        </button>
        <button type="button" aria-pressed={twoColumns} onclick={() => (twoColumns = true)}>
          {t("chords.multiColumn")}
        </button>
      </div>
    </div>
  </div>
</section>

<div class="paper chord-paper {twoColumns ? 'two-columns' : ''}" style="font-size:{size}rem">
  <ChordSheet text={song.chordpro ?? ""} {transpose} {flats} />
</div>
