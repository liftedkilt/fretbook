<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { midiToName } from "../lib/tuning";
  import type { WaitState } from "../lib/waitMode";

  // What wait mode is waiting for, above the player dock. The hint adds where to play it.
  let { state, onskip }: { state: WaitState; onskip: () => void } = $props();

  const step = $derived(state.step);
  const note = $derived(
    step && step.pitches.length > 0
      ? midiToName(Math.min(...step.pitches))
      : step
        ? t("waitMode.deadNote")
        : "",
  );
</script>

<div class="wait-chip" data-testid="wait-status" data-phase={state.phase} data-hits={state.hits}>
  <Icon name="mic" size={16} />
  {#if state.phase === "done"}
    <span>{t("waitMode.done", { count: state.hits })}</span>
  {:else if step}
    <span class="wait-note"
      >{state.phase === "waiting"
        ? t("waitMode.waiting", { note })
        : t("waitMode.next", { note })}</span
    >
    {#if state.hint}
      <span class="wait-hint" data-testid="wait-hint"
        >{t("waitMode.hint", { string: step.string + 1, fret: step.fret })}</span
      >
    {/if}
    <button class="ghost small" data-testid="wait-skip" onclick={onskip}
      >{t("waitMode.skip")}</button
    >
  {:else}
    <span>{t("waitMode.listening")}</span>
  {/if}
</div>
