<script lang="ts">
  import { onMount } from "svelte";

  import {
    buildHighwayTimeline,
    computeHighwayLayout,
    drawHighway,
    resolveGemState,
    visibleWindow,
    xToTime,
    type GemState,
    type HighwayCanvasContext,
  } from "../lib/highway";
  import { t } from "../lib/i18n.svelte";
  import { measureAt } from "../lib/sync";
  import type { ScoreDocument, Track } from "../lib/types";

  let {
    document,
    track,
    hasAudio = false,
    currentTime = 0,
    playing = false,
    rate = 1,
    loopA = null,
    loopB = null,
    grades = undefined,
    waitingAt = null,
    onseek = undefined,
  }: {
    document: ScoreDocument;
    track: Track;
    hasAudio?: boolean;
    currentTime?: number;
    playing?: boolean;
    rate?: number;
    loopA?: number | null;
    loopB?: number | null;
    grades?: ReadonlyMap<string, GemState> | Record<string, GemState>;
    waitingAt?: { bar: number; position: number } | null;
    onseek?: (bar: number) => void;
  } = $props();

  let stageEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let width = $state(960);
  let height = $state(260);
  let displayTime = $state(0);

  let anchorTime = 0;
  let anchorWall = 0;
  let rafId = 0;

  const timeline = $derived(buildHighwayTimeline(document, track, hasAudio));
  const windowData = $derived(visibleWindow(timeline, displayTime));
  const activeBar = $derived(measureAt(timeline.starts, displayTime));
  const activeGems = $derived(
    windowData.gems.filter(
      (gem) =>
        (waitingAt !== null && waitingAt.bar === gem.bar && waitingAt.position === gem.position) ||
        (gem.time <= displayTime + 0.05 && Math.max(gem.endTime, gem.time + 0.12) >= displayTime),
    ),
  );
  const activeChord = $derived(
    windowData.chords.find(
      (chord) =>
        chord.time <= displayTime + 0.08 &&
        Math.max(chord.endTime, chord.time + 0.25) >= displayTime,
    ) ?? null,
  );
  const gradeCounts = $derived.by(() => {
    let hits = 0;
    let missed = 0;
    if (!grades) return { hits, missed };
    for (const gem of timeline.gems) {
      const state = resolveGemState(gem, grades, waitingAt);
      if (state === "hit") hits += 1;
      else if (state === "missed") missed += 1;
    }
    return { hits, missed };
  });
  const summary = $derived(
    activeGems.length > 0
      ? t("highway.now", {
          notes: activeGems
            .map((gem) => t("highway.noteAt", { string: gem.string + 1, fret: gem.fret }))
            .join(", "),
        })
      : t("highway.idle"),
  );

  function renderFrame(timeSeconds: number) {
    const canvas = canvasEl;
    if (!canvas) return;
    let rawCtx: CanvasRenderingContext2D | null = null;
    try {
      rawCtx = canvas.getContext("2d");
    } catch {
      rawCtx = null;
    }
    if (!rawCtx) return;
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    rawCtx.save();
    if (typeof rawCtx.setTransform === "function") {
      rawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    drawHighway(rawCtx as unknown as HighwayCanvasContext, {
      timeline,
      currentTime: timeSeconds,
      width,
      height,
      loopA,
      loopB,
      grades,
      waitingAt,
    });
    rawCtx.restore();
  }

  function stopLoop() {
    if (rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function tickLoop() {
    rafId = 0;
    if (!playing || waitingAt !== null) return;
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const delta = Math.min(0.12, Math.max(0, (now - anchorWall) / 1000)) * rate;
    displayTime = Math.min(timeline.totalDuration, Math.max(0, anchorTime + delta));
    renderFrame(displayTime);
    if (typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(tickLoop);
    }
  }

  $effect(() => {
    const nextTime = currentTime;
    anchorTime = nextTime;
    anchorWall = typeof performance !== "undefined" ? performance.now() : 0;
    displayTime = nextTime;
  });

  $effect(() => {
    void timeline;
    void width;
    void height;
    void loopA;
    void loopB;
    void grades;
    void waitingAt;
    renderFrame(displayTime);
  });

  $effect(() => {
    const isPlaying = playing && waitingAt === null;
    void rate;
    stopLoop();
    if (isPlaying && typeof requestAnimationFrame === "function") {
      anchorWall = typeof performance !== "undefined" ? performance.now() : 0;
      rafId = requestAnimationFrame(tickLoop);
    } else {
      renderFrame(displayTime);
    }
    return () => stopLoop();
  });

  onMount(() => {
    const element = stageEl;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      if (box.width > 0) width = Math.round(box.width);
      if (box.height > 0) height = Math.round(box.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  function handleCanvasClick(event: MouseEvent) {
    if (!onseek || !canvasEl || timeline.bars.length === 0) return;
    const rect = canvasEl.getBoundingClientRect();
    const clickX = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * width : 0;
    const layout = computeHighwayLayout(width, height, Math.max(1, timeline.tuning.length));
    const clickedTime = Math.max(0, xToTime(layout, clickX, displayTime));
    const bar = measureAt(timeline.starts, clickedTime);
    const clamped = Math.min(timeline.bars.length - 1, Math.max(0, bar < 0 ? 0 : bar));
    onseek(clamped);
  }
</script>

<figure
  class="highway"
  data-testid="highway"
  data-playing={playing}
  data-current-bar={activeBar}
  data-current-section={windowData.currentSection ?? undefined}
  data-upcoming-section={windowData.upcomingSection?.name ?? undefined}
  data-gem-count={timeline.gems.length}
  data-chord-count={timeline.chords.length}
  data-hit-count={gradeCounts.hits}
  data-missed-count={gradeCounts.missed}
>
  <div class="highway-stage" bind:this={stageEl}>
    <canvas
      bind:this={canvasEl}
      data-testid="highway-canvas"
      aria-label={t("highway.label", { strings: track.tuning_midi.length })}
      onclick={handleCanvasClick}
    ></canvas>
  </div>
  <figcaption class="highway-caption muted small">
    <div class="highway-badges">
      {#if windowData.currentSection}
        <span class="pill pill-accent" data-testid="highway-section"
          >{t("highway.sectionNow", { section: windowData.currentSection })}</span
        >
      {/if}
      {#if windowData.upcomingSection}
        <span class="pill" data-testid="highway-upcoming-section"
          >{t("highway.sectionNext", { section: windowData.upcomingSection.name })}</span
        >
      {/if}
      {#if activeChord}
        <span class="pill pill-accent" data-testid="highway-chord"
          >{t("highway.chordNow", { chord: activeChord.name })}</span
        >
      {/if}
    </div>
    <span class="visually-hidden" aria-live="polite" data-testid="highway-summary">{summary}</span>
  </figcaption>
</figure>

<style>
  .highway {
    margin: 0;
    display: grid;
    gap: 0.5rem;
    width: 100%;
  }

  .highway-stage {
    position: relative;
    z-index: 0;
    width: 100%;
    height: clamp(220px, 34dvh, 320px);
    border-radius: var(--r-lg);
    overflow: hidden;
    background: #121018;
    border: 1px solid var(--line-strong);
    box-shadow: var(--shadow-lg);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }

  /* The badges scroll sideways instead of wrapping, so a new chord pill never changes the
     height. The "Now" readout lives under the fretboard (one place only). */
  .highway-caption {
    display: flex;
    min-height: 2rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0 0.25rem;
  }

  .highway-badges {
    display: flex;
    flex-wrap: nowrap;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    gap: 0.4rem;
    align-items: center;
  }
</style>
