<script lang="ts">
  import { parse, transposeChord } from "../lib/chordpro";
  import { t } from "../lib/i18n.svelte";

  let { text, transpose = 0, flats = false }: { text: string; transpose?: number; flats?: boolean } = $props();

  const sheet = $derived(parse(text));
</script>

<article class="chord-sheet">
  {#if sheet.meta.title}<h3 class="chord-title">{sheet.meta.title}</h3>{/if}
  {#if sheet.meta.artist}<p class="hint chord-artist">{sheet.meta.artist}</p>{/if}
  {#each sheet.blocks as block, blockIndex (blockIndex)}
    <section class="chord-block chord-block-{block.kind || 'plain'}">
      {#if block.label}<p class="chord-label">{block.label}</p>{/if}
      {#each block.lines as line, lineIndex (lineIndex)}
        {#if line.kind === "lyrics"}
          <div class="chord-line">
            {#each line.segments as segment, segmentIndex (segmentIndex)}
              <span class="chord-segment">
                <span class="chord-name" data-testid="chord-name">{segment.chord ? transposeChord(segment.chord, transpose, flats) : " "}</span>
                <span class="chord-lyric">{segment.text || " "}</span>
              </span>
            {/each}
          </div>
        {:else if line.kind === "comment"}
          <p class="chord-comment">{line.text}</p>
        {:else if line.kind === "section"}
          <p class="chord-label">{line.label || t("chords.chorus")}</p>
        {:else if line.kind === "tab"}
          <pre class="chord-tab">{line.text}</pre>
        {:else}
          <div class="chord-gap"></div>
        {/if}
      {/each}
    </section>
  {/each}
</article>
