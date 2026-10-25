<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { CHORD_INSTRUMENTS, resolveSetup } from "../lib/chords/instruments";

  let {
    instrument,
    tuning,
    onchange,
    compact = false,
  }: {
    instrument: string;
    tuning: string;
    onchange: (instrument: string, tuning: string) => void;
    /** A small "Guitar · Standard" control: two borderless selects with their labels hidden. */
    compact?: boolean;
  } = $props();

  const setup = $derived(resolveSetup(instrument, tuning));
</script>

<div class="chord-setup" class:compact>
  <label class="tool-field">
    <span class:visually-hidden={compact}>{t("tools.instrument")}</span>
    <select
      data-testid="chord-instrument"
      value={setup.instrument.id}
      onchange={(event) => onchange(event.currentTarget.value, "")}
    >
      {#each CHORD_INSTRUMENTS as item (item.id)}
        <option value={item.id}>{t(item.labelKey)}</option>
      {/each}
    </select>
  </label>
  {#if compact}<span class="dot" aria-hidden="true">·</span>{/if}
  <label class="tool-field">
    <span class:visually-hidden={compact}>{t("tools.tuning")}</span>
    <select
      data-testid="chord-tuning"
      value={setup.tuning.id}
      onchange={(event) => onchange(setup.instrument.id, event.currentTarget.value)}
    >
      {#each setup.instrument.tunings as item (item.id)}
        <option value={item.id}>{t(item.labelKey)}</option>
      {/each}
    </select>
  </label>
</div>

<style>
  .compact {
    align-items: center;
    gap: var(--sp-1);
  }

  .compact .dot {
    color: var(--text-3);
  }

  .compact select {
    width: auto;
    padding: var(--sp-1) var(--sp-2);
    border-color: transparent;
    background-color: transparent;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .compact select:hover,
  .compact select:focus-visible {
    border-color: var(--line-strong);
  }
</style>
