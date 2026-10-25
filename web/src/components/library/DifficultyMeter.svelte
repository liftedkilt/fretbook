<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { levelOf } from "../../lib/difficulty";

  // Difficulty as a small 5-step meter: two levels of the 1 to 10 scale per step.
  let { difficulty, testid }: { difficulty: number; testid?: string } = $props();

  const level = $derived(levelOf(difficulty));
  const steps = $derived(Math.ceil(level / 2));
</script>

<span class="meter" role="img" aria-label={t("difficulty.level", { level })} data-testid={testid}>
  <span class="steps" aria-hidden="true">
    {#each [1, 2, 3, 4, 5] as step (step)}<span class="step" class:on={step <= steps}></span>{/each}
  </span>
  <span aria-hidden="true">{level}</span>
</span>

<style>
  .meter {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 24px;
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-xs);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .steps {
    display: inline-flex;
    gap: 2px;
  }

  .step {
    width: 4px;
    height: 12px;
    border-radius: 1px;
    background: var(--line-strong);
  }

  .step.on {
    background: var(--accent);
  }
</style>
