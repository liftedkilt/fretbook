<script lang="ts">
  import Icon from "./Icon.svelte";
  import { suggestCapos } from "../lib/capo";
  import { transposeChord } from "../lib/chordpro";
  import { t } from "../lib/i18n.svelte";

  // `chords` are the shapes as displayed; a capo already on the sheet sounds that many frets higher.
  // `applied` is set while a suggestion is in effect; `onapply` puts one on, `onundo` goes back to the sheet's capo.
  // Only the best suggestion is shown, as one line above the sheet that can be dismissed.
  let {
    chords,
    capo,
    flats,
    applied = false,
    onapply,
    onundo,
  }: {
    chords: string[];
    capo: number;
    flats: boolean;
    applied?: boolean;
    onapply?: (capo: number) => void;
    onundo?: () => void;
  } = $props();

  let dismissed = $state(false);

  const best = $derived(
    suggestCapos(
      chords.map((chord) => transposeChord(chord, capo, flats)),
      flats,
      3,
      capo,
    )[0],
  );
</script>

{#if chords.length && (applied || (best && !dismissed))}
  <div class="capo-line no-print" data-testid="capo-suggestions" role="status">
    {#if applied}
      <span class="text" data-testid="capo-applied">{t("retune.capoApplied", { capo })}</span>
      <button class="button" data-testid="capo-undo" onclick={() => onundo?.()}>
        {t("retune.capoUndo")}
      </button>
    {:else if best}
      <span class="text" data-testid={`capo-option-${best.capo}`}
        >{t("retune.capoOption", { capo: best.capo, shapes: best.shapes.join(", ") })}</span
      >
      {#if onapply}
        <button
          class="button"
          data-testid={`capo-apply-${best.capo}`}
          onclick={() => onapply(best.capo)}>{t("chordPage.useCapo", { capo: best.capo })}</button
        >
      {/if}
      <button
        class="icon-button ghost"
        data-testid="capo-dismiss"
        aria-label={t("chordPage.dismissCapo")}
        onclick={() => (dismissed = true)}><Icon name="close" size={16} /></button
      >
    {/if}
  </div>
{/if}

<style>
  .capo-line {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3);
    margin-bottom: var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--text-2);
    font-size: 0.9rem;
  }

  .text {
    flex: 1 1 0;
    min-width: 0;
  }

  .capo-line .button {
    min-height: 36px;
    padding-inline: var(--sp-3);
    white-space: nowrap;
  }
</style>
