<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { describeFrets, diagramGeometry } from "../lib/chords/layout";
  import type { Voicing } from "../lib/chords/voicings";

  let { voicing, strings, name }: { voicing: Voicing; strings: number; name: string } = $props();

  const LEFT = 22;
  const RIGHT = 78;
  const TOP = 30;
  const ROW = 15;

  const geometry = $derived(diagramGeometry(voicing, strings));
  const gap = $derived(strings > 1 ? (RIGHT - LEFT) / (strings - 1) : 0);
  const x = (string: number) => LEFT + string * gap;
  const y = (row: number) => TOP + row * ROW + ROW / 2;
  const bottom = $derived(TOP + geometry.rows * ROW);
</script>

<svg
  class="chord-diagram"
  viewBox="0 0 100 112"
  role="img"
  aria-label={t("chordDiagrams.diagramLabel", { chord: name, frets: describeFrets(voicing) })}
>
  {#if geometry.baseFret === 1}
    <line class="nut" x1={LEFT} x2={RIGHT} y1={TOP} y2={TOP} />
  {:else}
    <text class="fret-number" x={LEFT - 6} y={y(0) + 3} text-anchor="end">{geometry.baseFret}</text>
    <line class="grid" x1={LEFT} x2={RIGHT} y1={TOP} y2={TOP} />
  {/if}
  {#each Array.from({ length: geometry.rows }, (_, row) => row + 1) as row (row)}
    <line class="grid" x1={LEFT} x2={RIGHT} y1={TOP + row * ROW} y2={TOP + row * ROW} />
  {/each}
  {#each Array.from({ length: strings }, (_, string) => string) as string (string)}
    <line class="grid" x1={x(string)} x2={x(string)} y1={TOP} y2={bottom} />
  {/each}
  {#each geometry.open as string (string)}
    <circle class="open" cx={x(string)} cy={TOP - 9} r="3.6" />
  {/each}
  {#each geometry.muted as string (string)}
    <path class="muted" d="M{x(string) - 3} {TOP - 12}l6 6M{x(string) + 3} {TOP - 12}l-6 6" />
  {/each}
  {#if geometry.barre}
    <rect
      class="barre"
      x={x(geometry.barre.from) - 4.5}
      y={y(geometry.barre.row) - 4.5}
      width={x(geometry.barre.to) - x(geometry.barre.from) + 9}
      height="9"
      rx="4.5"
    />
  {/if}
  {#each geometry.dots as dot (dot.string)}
    <circle class="dot" cx={x(dot.string)} cy={y(dot.row)} r="5" />
  {/each}
  {#if geometry.barre}
    {#each [geometry.barre.from, geometry.barre.to] as string (string)}
      <circle class="dot" cx={x(string)} cy={y(geometry.barre.row)} r="5" />
    {/each}
  {/if}
</svg>
