<script lang="ts">
  import { hash, monogram, paletteFor } from "../lib/cover";

  let {
    id,
    title,
    kind = "tab",
    strings = 6,
    size = "md",
  }: { id: string; title: string; kind?: "tab" | "chords"; strings?: number; size?: "sm" | "md" | "lg" } = $props();

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
  const lines = $derived(Math.max(4, Math.min(strings, 7)));
</script>

<div
  class="cover cover-{size}"
  style="--c-from:{palette.from};--c-via:{palette.via};--c-to:{palette.to};--c-ink:{palette.ink}"
  aria-hidden="true"
>
  <svg class="cover-art" viewBox="0 0 100 100" preserveAspectRatio="none">
    {#if kind === "chords"}
      {#each [0, 1, 2, 3, 4] as row (row)}
        <line x1="14" x2={row % 2 ? 70 : 86} y1={56 + row * 8} y2={56 + row * 8} />
      {/each}
    {:else}
      {#each Array.from({ length: lines }, (_, index) => index) as row (row)}
        <line x1="0" x2="100" y1={52 + row * (40 / lines)} y2={52 + row * (40 / lines)} style="stroke-width:{0.5 + row * 0.18}" />
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
</div>
