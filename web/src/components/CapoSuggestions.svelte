<script lang="ts">
  import { suggestCapos } from "../lib/capo";
  import { transposeChord } from "../lib/chordpro";
  import { t } from "../lib/i18n.svelte";

  // `chords` are the shapes as displayed; a capo already on the sheet sounds that many frets higher.
  let { chords, capo, flats }: { chords: string[]; capo: number; flats: boolean } = $props();

  const options = $derived(
    suggestCapos(
      chords.map((chord) => transposeChord(chord, capo, flats)),
      flats,
      3,
      capo,
    ),
  );
</script>

{#if chords.length}
  <section class="capo-suggestions no-print" data-testid="capo-suggestions">
    <h2 class="chord-diagrams-title">{t("retune.capoHeading")}</h2>
    {#if options.length}
      <p class="hint">{t("retune.capoHint")}</p>
      <ul>
        {#each options as option (option.capo)}
          <li data-testid={`capo-option-${option.capo}`}>
            {t("retune.capoOption", { capo: option.capo, shapes: option.shapes.join(", ") })}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint" data-testid="capo-none">{t("retune.capoNone")}</p>
    {/if}
  </section>
{/if}

<style>
  .capo-suggestions {
    margin: 1rem 0;
  }
  ul {
    margin: 0.3rem 0 0;
    padding-left: 1.2rem;
  }
</style>
