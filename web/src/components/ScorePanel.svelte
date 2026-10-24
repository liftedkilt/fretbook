<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { ScoreSummary } from "../lib/listen/scored";

  // Scored play-along switch and the live numbers. `ontoggle` opens or closes the microphone.
  let {
    on,
    summary,
    bleed,
    calibrated,
    error,
    ontoggle,
  }: {
    on: boolean;
    summary: ScoreSummary | null;
    bleed: boolean;
    calibrated: boolean;
    error: string;
    ontoggle: () => void;
  } = $props();
</script>

<div class="panel-group" data-testid="score-panel">
  <h3>{t("scored.title")}</h3>
  <p class="muted small">{t("scored.about")}</p>
  <div class="mix-row">
    <button class="button" data-testid="score-toggle" aria-pressed={on} onclick={ontoggle}
      ><Icon name="mic" size={16} />{on ? t("scored.stop") : t("scored.start")}</button
    >
  </div>
  {#if on && summary}
    <p class="muted small" data-testid="score-live" role="status">
      {#if summary.graded === 0}
        {t("scored.armed")}
      {:else}
        <strong>{t("scored.accuracy", { percent: Math.round(summary.accuracy * 100) })}</strong>
        · {t("scored.streak", { count: summary.streak })} ·
        {t("scored.progress", { graded: summary.graded, total: summary.total })}
      {/if}
    </p>
  {/if}
  {#if on && !calibrated}
    <p class="muted small" data-testid="score-no-calibration">{t("scored.noCalibration")}</p>
  {/if}
  {#if bleed}
    <p class="alert" role="alert" data-testid="score-bleed">
      <Icon name="alert" size={18} />{t("scored.bleed")}
    </p>
  {/if}
  {#if error}<p class="alert" role="alert" data-testid="score-error">
      <Icon name="alert" size={18} />{error}
    </p>{/if}
</div>
