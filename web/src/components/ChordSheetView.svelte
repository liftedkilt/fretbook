<script lang="ts">
  import { untrack } from "svelte";

  import CapoSuggestions from "./CapoSuggestions.svelte";
  import ChordSetupPicker from "./ChordSetupPicker.svelte";
  import ChordSheet from "./ChordSheet.svelte";
  import ChordStrip from "./ChordStrip.svelte";
  import ChordWait from "./ChordWait.svelte";
  import Cover from "./Cover.svelte";
  import Icon from "./Icon.svelte";
  import Menu from "./Menu.svelte";
  import OfflineToggle from "./OfflineToggle.svelte";
  import { parse } from "../lib/chordpro";
  import { loadChoice, saveChoice } from "../lib/chords/choice";
  import { buildEntries } from "../lib/chords/entries";
  import { resolveSetup } from "../lib/chords/instruments";
  import { playStrum, strumNotes } from "../lib/chords/strum";
  import { capoOf, chordsUsed } from "../lib/chords/used";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { SongDetail } from "../lib/types";

  let { song, initialTranspose = 0 }: { song: SongDetail; initialTranspose?: number } = $props();

  let transpose = $state(untrack(() => initialTranspose));
  const transposeLabel = $derived(transpose > 0 ? `+${transpose}` : String(transpose));
  let flats = $state(false);
  let size = $state(1);
  let exporting = $state(false);
  let error = $state("");
  let choice = $state(untrack(() => loadChoice(song.id)));

  const sheet = $derived(parse(song.chordpro ?? ""));
  const capo = $derived(capoOf(sheet));
  const setup = $derived(resolveSetup(choice.instrument, choice.tuning));
  const entries = $derived(
    buildEntries(
      chordsUsed(sheet, transpose, flats),
      setup.tuning.strings,
      setup.instrument.rootInBass,
      sheet.defines,
      choice.voicings,
    ),
  );

  function changeSetup(instrument: string, tuning: string) {
    const next = resolveSetup(instrument, tuning);
    choice = { ...choice, instrument: next.instrument.id, tuning: next.tuning.id };
    saveChoice(song.id, choice);
  }

  function pickVoicing(name: string, index: number) {
    const entry = entries.find((item) => item.name === name);
    const voicing = entry?.voicings[index];
    if (!voicing) return;
    choice = {
      ...choice,
      voicings: { ...choice.voicings, [name]: voicing.frets.map((fret) => fret ?? "x").join(".") },
    };
    saveChoice(song.id, choice);
  }

  let activeChord = $state<string | null>(null);

  // Keep the chord to play in view as the sheet moves on.
  $effect(() => {
    if (!activeChord) return;
    document
      .querySelector<HTMLElement>(".chord-active")
      ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  });

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
        diagrams: {
          strings: setup.tuning.strings.length,
          capoLabel: capo ? t("chordDiagrams.pdfCapo", { fret: capo }) : "",
          chords: entries.flatMap((entry) =>
            entry.voicing ? [{ name: entry.name, voicing: entry.voicing }] : [],
          ),
        },
      });
    } catch {
      error = t("player.exportPdfFailed");
    } finally {
      exporting = false;
    }
  }
</script>

<div class="song-page chords-page">
  <header class="song-header no-print">
    <a class="back-link" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}
      ><Icon name="back" size={18} />{t("app.back")}</a
    >
    <div class="song-hero">
      <Cover id={song.id} title={song.title} kind="chords" size="lg" />
      <div class="song-hero-text">
        <p class="eyebrow">{t("library.chordSheet")}</p>
        <h1 class="display song-heading" data-testid="song-heading">{song.title}</h1>
        {#if song.artist}<p class="song-byline">{song.artist}</p>{/if}
      </div>
      <div class="hero-actions">
        <OfflineToggle kind="song" id={song.id} title={song.title} compact />
        <a
          class="button"
          data-testid="song-edit-link"
          href={hrefFor(`/songs/${song.id}/edit`)}
          onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}
        >
          <Icon name="edit" size={18} /><span>{t("player.edit")}</span>
        </a>
        <Menu label={t("player.export")} icon="download" testid="export-menu">
          {#snippet children(close)}
            <button
              class="menu-item"
              data-testid="export-pdf"
              role="menuitem"
              disabled={exporting}
              onclick={() => {
                close();
                void exportPdf();
              }}
            >
              <Icon name="file" size={18} />{exporting
                ? t("player.exportingPdf")
                : t("player.exportPdf")}
            </button>
            <button
              class="menu-item"
              role="menuitem"
              onclick={() => {
                close();
                window.print();
              }}
            >
              <Icon name="print" size={18} />{t("chords.print")}
            </button>
            <a
              class="menu-item"
              data-testid="export-chordpro"
              role="menuitem"
              href={exportUrl("cho")}
              onclick={close}><Icon name="chords" size={18} />{t("chords.exportChordPro")}</a
            >
            <a class="menu-item" role="menuitem" href={exportUrl("json")} onclick={close}
              ><Icon name="download" size={18} />{t("player.exportJson")}</a
            >
          {/snippet}
        </Menu>
      </div>
    </div>
    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
  </header>

  {#if entries.length}
    <section
      class="chord-diagrams"
      data-testid="chord-diagrams"
      aria-label={t("chordDiagrams.heading")}
    >
      <div class="chord-diagrams-head no-print">
        <h2 class="chord-diagrams-title">{t("chordDiagrams.heading")}</h2>
        <ChordSetupPicker
          instrument={setup.instrument.id}
          tuning={setup.tuning.id}
          onchange={changeSetup}
        />
      </div>
      {#if capo}
        <p class="hint" data-testid="chord-capo">{t("chordDiagrams.capoNote", { fret: capo })}</p>
      {/if}
      <ChordStrip
        {entries}
        strings={setup.tuning.strings.length}
        onpick={pickVoicing}
        onplay={(entry) =>
          entry.voicing && playStrum(strumNotes(entry.voicing, setup.tuning.strings, capo))}
      />
    </section>
  {/if}

  <CapoSuggestions chords={chordsUsed(sheet, transpose, flats)} {capo} {flats} />

  <ChordWait
    text={song.chordpro ?? ""}
    {transpose}
    {flats}
    onactive={(key) => (activeChord = key)}
  />

  <div class="paper chord-paper" style="font-size:{size}rem">
    <ChordSheet text={song.chordpro ?? ""} {transpose} {flats} active={activeChord} />
  </div>

  <div class="float-dock no-print" role="toolbar" aria-label={t("chords.controls")}>
    <div class="float-group">
      <span class="float-label">{t("chords.transpose")}</span>
      <button
        class="icon-button ghost"
        data-testid="transpose-down"
        onclick={() => (transpose -= 1)}
        aria-label={t("chords.down")}><Icon name="minus" size={18} /></button
      >
      <button
        class="float-value"
        data-testid="transpose-value"
        onclick={() => (transpose = 0)}
        disabled={transpose === 0}
        aria-label={`${transposeLabel}: ${t("chords.reset")}`}
        title={t("chords.reset")}
      >
        {transposeLabel}
      </button>
      <button
        class="icon-button ghost"
        data-testid="transpose-up"
        onclick={() => (transpose += 1)}
        aria-label={t("chords.up")}><Icon name="plus" size={18} /></button
      >
    </div>
    <span class="float-divider" aria-hidden="true"></span>
    <button
      class="toggle"
      data-testid="chords-flats"
      aria-pressed={flats}
      onclick={() => (flats = !flats)}
      title={t("chords.flats")}
    >
      <span aria-hidden="true">{flats ? "♭" : "♯"}</span><span class="float-label"
        >{t("chords.flats")}</span
      >
    </button>
    <span class="float-divider" aria-hidden="true"></span>
    <div class="float-group">
      <button
        class="icon-button ghost"
        onclick={() => (size = Math.max(0.8, Math.round((size - 0.1) * 10) / 10))}
        aria-label={t("chords.smaller")}
      >
        <span class="text-size small" aria-hidden="true">A</span>
      </button>
      <span class="float-label">{t("chords.size")}</span>
      <button
        class="icon-button ghost"
        onclick={() => (size = Math.min(1.8, Math.round((size + 0.1) * 10) / 10))}
        aria-label={t("chords.larger")}
      >
        <span class="text-size" aria-hidden="true">A</span>
      </button>
    </div>
  </div>
</div>
