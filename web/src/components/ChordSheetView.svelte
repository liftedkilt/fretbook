<script lang="ts">
  import { onMount, untrack } from "svelte";

  import CapoSuggestions from "./CapoSuggestions.svelte";
  import ChordSetupPicker from "./ChordSetupPicker.svelte";
  import ChordSheet from "./ChordSheet.svelte";
  import ChordStrip from "./ChordStrip.svelte";
  import ChordWait from "./ChordWait.svelte";
  import Cover from "./Cover.svelte";
  import Icon from "./Icon.svelte";
  import Menu from "./Menu.svelte";
  import OfflineToggle from "./OfflineToggle.svelte";
  import SetlistPicker from "./SetlistPicker.svelte";
  import { parse } from "../lib/chordpro";
  import { loadChoice, saveChoice } from "../lib/chords/choice";
  import { buildEntries } from "../lib/chords/entries";
  import { resolveSetup } from "../lib/chords/instruments";
  import { playStrum, strumNotes } from "../lib/chords/strum";
  import { capoOf, chordsUsed } from "../lib/chords/used";
  import {
    autoScrollSpeed,
    handsFree,
    isTyping,
    pageDelta,
    parseDuration,
    pedalAction,
    setStage,
    stepScrollFactor,
  } from "../lib/handsFree.svelte";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { SongDetail } from "../lib/types";
  import { ui } from "../lib/ui.svelte";

  let { song, initialTranspose = 0 }: { song: SongDetail; initialTranspose?: number } = $props();

  let pickerOpen = $state(false);
  let transpose = $state(untrack(() => initialTranspose));
  const transposeLabel = $derived(transpose > 0 ? `+${transpose}` : String(transpose));
  let flats = $state(false);
  let size = $state(1);
  let exporting = $state(false);
  let error = $state("");
  let choice = $state(untrack(() => loadChoice(song.id)));

  const sheet = $derived(parse(song.chordpro ?? ""));
  const sheetCapo = $derived(capoOf(sheet));
  // A capo suggestion the reader applied: a view setting, the saved ChordPro is untouched. The
  // sound stays the same, so the shapes shift by the difference from the sheet's own capo.
  let appliedCapo = $state<number | null>(null);
  const capo = $derived(appliedCapo ?? sheetCapo);
  const shapeShift = $derived(transpose + (appliedCapo === null ? 0 : sheetCapo - appliedCapo));
  const setup = $derived(resolveSetup(choice.instrument, choice.tuning));
  const entries = $derived(
    buildEntries(
      chordsUsed(sheet, shapeShift, flats),
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

  // Hands-free: a pedal key turns the page or starts the auto-scroll, which reaches the end of the
  // sheet as the song ends (from `{duration:}`, else the tempo and line count, else a typical song).
  let scrolling = $state(false);
  const stage = $derived(handsFree.stage);
  const scrollSpeed = $derived(
    autoScrollSpeed({
      distance: 1,
      duration: parseDuration(sheet.meta.duration),
      bpm: Number.parseFloat(sheet.meta.tempo ?? "") || null,
      lines: sheet.blocks.reduce((total, block) => total + block.lines.length, 0),
      factor: handsFree.scrollFactor,
    }),
  );

  function scrollRoom(): number {
    const root = document.documentElement;
    return Math.max(0, root.scrollHeight - window.innerHeight - window.scrollY);
  }

  function pageBy(direction: 1 | -1) {
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({
      top: pageDelta(window.innerHeight, direction),
      behavior: calm ? "auto" : "smooth",
    });
  }

  $effect(() => {
    if (!scrolling) return;
    // The speed is per pixel of the whole page, so it is taken at the start and on a speed change.
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const pixelsPerSecond = scrollSpeed * Math.max(0, total);
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    const run = (now: number) => {
      carry += ((now - last) / 1000) * pixelsPerSecond;
      last = now;
      const whole = Math.floor(carry);
      if (whole > 0) {
        carry -= whole;
        window.scrollBy(0, whole);
      }
      if (scrollRoom() <= 0) scrolling = false;
      else frame = requestAnimationFrame(run);
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  });

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const action = pedalAction(event);
      if (action === "nextPage" || action === "previousPage") {
        event.preventDefault();
        pageBy(action === "nextPage" ? 1 : -1);
      } else if (action === "toggle") {
        event.preventDefault();
        scrolling = !scrolling;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

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
        transpose: shapeShift,
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

<div class="song-page chords-page" class:stage data-stage={stage}>
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
        {#if !ui.demoMode}
          <a
            class="button"
            data-testid="song-edit-link"
            href={hrefFor(`/songs/${song.id}/edit`)}
            onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}
          >
            <Icon name="edit" size={18} /><span>{t("player.edit")}</span>
          </a>
        {/if}
        <Menu label={t("player.export")} icon="download" testid="export-menu">
          {#snippet children(close)}
            {#if !ui.demoMode}
              <button
                class="menu-item"
                data-testid="song-add-to-setlist"
                role="menuitem"
                onclick={() => {
                  close();
                  pickerOpen = true;
                }}
              >
                <Icon name="list" size={18} />
                {t("setlists.addToSetlist")}
              </button>
            {/if}
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

  <CapoSuggestions
    chords={chordsUsed(sheet, shapeShift, flats)}
    {capo}
    {flats}
    applied={appliedCapo !== null}
    onapply={(fret) => (appliedCapo = fret)}
    onundo={() => (appliedCapo = null)}
  />

  <ChordWait
    text={song.chordpro ?? ""}
    transpose={shapeShift}
    {flats}
    capo={appliedCapo ?? undefined}
    onactive={(key) => (activeChord = key)}
  />

  <div class="paper chord-paper" style="font-size:{stage ? Math.max(size, 1.8) : size}rem">
    <ChordSheet text={song.chordpro ?? ""} transpose={shapeShift} {flats} active={activeChord} />
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
        class="toggle"
        data-testid="autoscroll"
        aria-pressed={scrolling}
        onclick={() => (scrolling = !scrolling)}
        title={t("handsFree.autoScroll")}
      >
        <Icon name={scrolling ? "pause" : "play"} size={16} /><span class="float-label"
          >{t("handsFree.autoScroll")}</span
        >
      </button>
      <button
        class="icon-button ghost"
        data-testid="autoscroll-slower"
        onclick={() => stepScrollFactor(-1)}
        aria-label={t("handsFree.scrollSlower")}><Icon name="minus" size={18} /></button
      >
      <span class="float-value" data-testid="autoscroll-speed">{handsFree.scrollFactor}×</span>
      <button
        class="icon-button ghost"
        data-testid="autoscroll-faster"
        onclick={() => stepScrollFactor(1)}
        aria-label={t("handsFree.scrollFaster")}><Icon name="plus" size={18} /></button
      >
    </div>
    <span class="float-divider" aria-hidden="true"></span>
    <button
      class="toggle"
      data-testid="stage-toggle"
      aria-pressed={stage}
      onclick={() => setStage(!stage)}
      title={t("handsFree.stage")}
    >
      <Icon name="monitor" size={16} /><span class="float-label">{t("handsFree.stage")}</span>
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
  <SetlistPicker
    song={pickerOpen ? { id: song.id, title: song.title } : null}
    onclose={() => (pickerOpen = false)}
  />
</div>
