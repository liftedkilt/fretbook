<script lang="ts">
  import { onMount, untrack } from "svelte";

  import CapoSuggestions from "./CapoSuggestions.svelte";
  import ChordSetupPicker from "./ChordSetupPicker.svelte";
  import ChordSheet from "./ChordSheet.svelte";
  import ChordStrip from "./ChordStrip.svelte";
  import ChordWait from "./ChordWait.svelte";
  import Icon from "./Icon.svelte";
  import SetlistPicker from "./SetlistPicker.svelte";
  import SongHeader from "./SongHeader.svelte";
  import { parse } from "../lib/chordpro";
  import { loadChoice, saveChoice } from "../lib/chords/choice";
  import { buildEntries } from "../lib/chords/entries";
  import { movedDefines } from "../lib/chords/voicings";
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
  import type { SongDetail } from "../lib/types";

  let {
    song,
    initialTranspose = 0,
    readOnly = false,
    shared = false,
  }: {
    song: SongDetail;
    initialTranspose?: number;
    readOnly?: boolean;
    shared?: boolean;
  } = $props();

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
      movedDefines(sheet.defines, shapeShift, flats),
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
  <SongHeader
    {song}
    {readOnly}
    {shared}
    eyebrow={t("library.chordSheet")}
    facts={capo > 0 ? [{ label: t("player.capo", { fret: capo }) }] : []}
    onsetlist={() => (pickerOpen = true)}
    exportItems={[
      {
        id: "pdf",
        label: exporting ? t("player.exportingPdf") : t("player.exportPdf"),
        icon: "file",
        testid: "export-pdf",
        disabled: exporting,
        onclick: () => void exportPdf(),
      },
      {
        id: "print",
        label: t("chords.print"),
        icon: "print",
        testid: "export-print",
        onclick: () => window.print(),
      },
      {
        id: "chordpro",
        label: t("chords.exportChordPro"),
        icon: "chords",
        testid: "export-chordpro",
        href: exportUrl("cho"),
      },
      {
        id: "json",
        label: t("player.exportJson"),
        icon: "download",
        testid: "export-json",
        href: exportUrl("json"),
      },
    ]}
  />
  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

  {#if entries.length}
    <section
      class="chord-diagrams"
      data-testid="chord-diagrams"
      aria-label={t("chordDiagrams.heading")}
    >
      <div class="chord-diagrams-head no-print">
        <ChordSetupPicker
          compact
          instrument={setup.instrument.id}
          tuning={setup.tuning.id}
          onchange={changeSetup}
        />
        {#if capo}
          <span class="capo-note" data-testid="chord-capo"
            >{t("chordDiagrams.capoNote", { fret: capo })}</span
          >
        {/if}
      </div>
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
    <ChordWait
      text={song.chordpro ?? ""}
      transpose={shapeShift}
      {flats}
      capo={appliedCapo ?? undefined}
      onactive={(key) => (activeChord = key)}
    />
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

<style>
  .chord-diagrams {
    margin: 0 0 var(--sp-3);
  }

  .chord-diagrams-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: var(--sp-1) var(--sp-3);
    margin-bottom: var(--sp-1);
  }

  /* A small cover: the sheet is the page, not the artwork. */
  .chords-page :global(.cover-lg) {
    width: clamp(56px, 7vw, 88px);
    border-radius: var(--r-md);
    box-shadow: none;
  }

  .chords-page :global(.cover-lg .cover-mono) {
    font-size: 1.6rem;
  }

  /* The labels would push the last controls off a narrow screen. */
  @media (max-width: 960px) {
    .float-dock :global(.float-label) {
      display: none;
    }
  }

  /* The header already names the song, so on a phone the sheet starts at its first line. */
  @media screen and (max-width: 560px) {
    .chord-paper :global(.chord-title),
    .chord-paper :global(.chord-artist) {
      display: none;
    }
  }

  /* Two rows on a phone, rather than a dock wider than the screen. */
  @media (max-width: 560px) {
    .float-dock {
      flex-wrap: wrap;
      justify-content: center;
      width: calc(100vw - 24px);
      border-radius: var(--r-lg);
    }
  }

  .capo-note {
    color: var(--text-3);
    font-size: 0.85rem;
  }

  /* The Details section after the sheet leaves room for the dock, so no gap sits above it. */
  .chords-page {
    padding-bottom: 0;
  }
</style>
