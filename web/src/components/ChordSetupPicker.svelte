<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { CHORD_INSTRUMENTS, resolveSetup } from "../lib/chords/instruments";

  let {
    instrument,
    tuning,
    onchange,
  }: {
    instrument: string;
    tuning: string;
    onchange: (instrument: string, tuning: string) => void;
  } = $props();

  const setup = $derived(resolveSetup(instrument, tuning));
</script>

<div class="chord-setup">
  <label class="tool-field">
    <span>{t("tools.instrument")}</span>
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
  <label class="tool-field">
    <span>{t("tools.tuning")}</span>
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
