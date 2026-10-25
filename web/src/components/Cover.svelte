<script lang="ts">
  import { hash, monogram, paletteFor, patternFor } from "../lib/cover";
  import Icon from "./Icon.svelte";

  let {
    id,
    title,
    kind = "tab",
    strings = 6,
    size = "md",
    src,
  }: {
    id: string;
    title: string;
    kind?: "tab" | "chords";
    strings?: number;
    size?: "sm" | "md" | "lg";
    /** Uploaded cover art. The generated cover shows when there is none or it does not load. */
    src?: string | null;
  } = $props();

  let failed = $state<string | null>(null);
  const image = $derived(src && failed !== src ? src : "");

  const palette = $derived(paletteFor(id));
  const letters = $derived(monogram(title));
  // A few fret-marker dots, placed from the id so every cover is a little different.
  const dots = $derived.by(() => {
    const seed = hash(`${id}:dots`);
    return [0, 1, 2].map((index) => ({
      x: 18 + ((seed >> (index * 5)) % 64),
      y: 1 + ((seed >> (index * 7 + 3)) % Math.max(1, Math.min(strings, 7) - 1)),
    }));
  });
  const pattern = $derived(patternFor(id));
  const lines = $derived(Math.max(4, Math.min(strings, 7)));
</script>

<div
  class="cover cover-{size}"
  class:has-image={!!image}
  style="--c-from:{palette.from};--c-via:{palette.via};--c-to:{palette.to};--c-ink:{palette.ink}"
  aria-hidden="true"
>
  {#if image}
    <img class="cover-image" {src} alt="" loading="lazy" onerror={() => (failed = src ?? null)} />
  {/if}
  {#if !image}
    <svg class="cover-pattern" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <g transform="rotate({pattern.angle} 50 50)">
        {#if pattern.shape === "stripes"}
          {#each Array.from({ length: 9 }, (_, index) => index) as row (row)}
            <rect x="-40" y={-40 + row * 16} width="180" height={pattern.weight} />
          {/each}
        {:else if pattern.shape === "dots"}
          {#each Array.from({ length: 49 }, (_, index) => index) as cell (cell)}
            <circle
              cx={(cell % 7) * 16 - 6}
              cy={Math.floor(cell / 7) * 16 - 6}
              r={pattern.weight / 2}
            />
          {/each}
        {:else if pattern.shape === "rings"}
          {#each [18, 34, 50, 66] as radius (radius)}
            <circle class="ring" cx={pattern.cx} cy={pattern.cy} r={radius} />
          {/each}
        {:else}
          {#each Array.from({ length: 9 }, (_, index) => index) as col (col)}
            <rect x={-40 + col * 16} y="-40" width={pattern.weight} height="180" />
          {/each}
        {/if}
      </g>
    </svg>
  {/if}
  <svg class="cover-art" viewBox="0 0 100 100" preserveAspectRatio="none">
    {#if kind === "chords"}
      {#each [0, 1, 2, 3, 4] as row (row)}
        <line x1="14" x2={row % 2 ? 70 : 86} y1={56 + row * 8} y2={56 + row * 8} />
      {/each}
    {:else}
      {#each Array.from({ length: lines }, (_, index) => index) as row (row)}
        <line
          x1="0"
          x2="100"
          y1={52 + row * (40 / lines)}
          y2={52 + row * (40 / lines)}
          style="stroke-width:{0.5 + row * 0.18}"
        />
      {/each}
      {#each [24, 48, 72, 96] as fret (fret)}
        <line class="fret" x1={fret} x2={fret} y1="50" y2="94" />
      {/each}
      {#each dots as dot, index (index)}
        <circle cx={dot.x} cy={52 + (dot.y + 0.5) * (40 / lines)} r="2.4" />
      {/each}
    {/if}
  </svg>
  <span class="cover-mono">{letters}</span>
  {#if !image}
    <span class="cover-kind"><Icon name={kind === "chords" ? "chords" : "tab"} size={18} /></span>
  {/if}
</div>

<style>
  .cover-pattern {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: currentColor;
    stroke: none;
    opacity: 0.16;
  }

  .cover-pattern .ring {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }

  /* The kind of song, as a glyph, so covers that look alike still tell tab from chord sheet. */
  .cover-kind {
    position: absolute;
    right: var(--sp-2);
    bottom: var(--sp-2);
    z-index: 1;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--c-ink) 18%, transparent);
    color: var(--c-ink);
  }

  .cover-sm .cover-kind {
    display: none;
  }
</style>
