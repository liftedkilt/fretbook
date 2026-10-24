<script lang="ts">
  import { FACTOR_NAME_KEYS, factorText, levelBand, levelOf, mainFactors } from "../lib/difficulty";
  import { t } from "../lib/i18n.svelte";
  import type { TrackDifficulty } from "../lib/types";

  let { tracks, preferredId }: { tracks: TrackDifficulty[]; preferredId: string } = $props();
</script>

{#if tracks.length}
  <details class="difficulty no-print" data-testid="song-difficulty-panel">
    <summary>
      {t("difficulty.heading")}
      {#each tracks.filter((item) => item.track_id === preferredId) as item (item.track_id)}
        <span class={`level ${levelBand(item.level)}`} data-testid="difficulty-summary"
          >{t("difficulty.levelOf", { level: levelOf(item.level) })}</span
        >
      {/each}
    </summary>
    <p class="muted">{t("difficulty.intro")}</p>
    <ul class="tracks">
      {#each tracks as track (track.track_id)}
        <li data-testid="difficulty-track">
          <strong>{track.name}</strong>
          <span class={`level ${levelBand(track.level)}`}
            >{t("difficulty.levelOf", { level: levelOf(track.level) })}</span
          >
          {#if mainFactors(track.factors).length}
            <ul class="why">
              {#each mainFactors(track.factors) as factor (factor.key)}
                {@const text = factorText(factor)}
                <li data-testid={`difficulty-factor-${factor.key}`}>
                  <span class="name">{t(FACTOR_NAME_KEYS[factor.key])}</span>
                  <span
                    class="bar"
                    role="img"
                    aria-label={t("difficulty.share", { percent: Math.round(factor.value * 100) })}
                  >
                    <span style={`width: ${Math.round(factor.value * 100)}%`}></span>
                  </span>
                  <span class="muted">{t(text.key, text.params)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t("difficulty.trivial")}</p>
          {/if}
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .difficulty {
    margin-top: 1rem;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  .level {
    margin-left: 0.5rem;
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    border: 1px solid var(--border, currentColor);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .tracks,
  .why {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    display: grid;
    gap: 0.5rem;
  }
  .why li {
    display: grid;
    grid-template-columns: 8rem 6rem 1fr;
    gap: 0.5rem;
    align-items: center;
  }
  .bar {
    display: block;
    height: 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 15%, transparent);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: currentColor;
  }
  @media (max-width: 520px) {
    .why li {
      grid-template-columns: 1fr;
    }
  }
</style>
