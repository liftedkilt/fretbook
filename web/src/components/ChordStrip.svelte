<script lang="ts">
  import ChordDiagram from "./ChordDiagram.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { ChordEntry } from "../lib/chords/entries";

  let {
    entries,
    strings,
    onpick,
    onplay,
  }: {
    entries: ChordEntry[];
    strings: number;
    onpick: (name: string, index: number) => void;
    onplay: (entry: ChordEntry) => void;
  } = $props();

  function step(entry: ChordEntry, by: number) {
    const total = entry.voicings.length;
    onpick(entry.name, (entry.index + by + total) % total);
  }
</script>

<ul class="chord-strip" data-testid="chord-strip">
  {#each entries as entry (entry.name)}
    <li class="chord-card" data-testid="chord-card">
      <p class="chord-card-name" data-testid="strip-chord-name">{entry.name}</p>
      {#if entry.voicing}
        <ChordDiagram voicing={entry.voicing} {strings} name={entry.name} />
        {#if entry.voicing.source === "define"}
          <p class="chord-card-note">{t("chordDiagrams.fromSong")}</p>
        {/if}
        <div class="chord-card-controls no-print">
          <button
            class="icon-button ghost"
            data-testid="voicing-prev"
            aria-label={t("chordDiagrams.previousVoicing", { chord: entry.name })}
            disabled={entry.voicings.length < 2}
            onclick={() => step(entry, -1)}><Icon name="back" size={16} /></button
          >
          <span class="chord-card-count" data-testid="voicing-count"
            >{t("chordDiagrams.voicingOf", {
              n: entry.index + 1,
              total: entry.voicings.length,
            })}</span
          >
          <button
            class="icon-button ghost"
            data-testid="voicing-next"
            aria-label={t("chordDiagrams.nextVoicing", { chord: entry.name })}
            disabled={entry.voicings.length < 2}
            onclick={() => step(entry, 1)}><Icon name="forward" size={16} /></button
          >
          <button
            class="icon-button ghost"
            data-testid="voicing-play"
            aria-label={t("chordDiagrams.play", { chord: entry.name })}
            onclick={() => onplay(entry)}><Icon name="play" size={16} /></button
          >
        </div>
      {:else}
        <p class="chord-card-note">{t("chordDiagrams.noShape")}</p>
      {/if}
    </li>
  {/each}
</ul>
