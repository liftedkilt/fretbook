<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    barAccuracy,
    starsFor,
    weakestSpan,
    type ScoreSummary,
    type SectionScore,
  } from "../lib/listen/scored";
  import type { ScoreRecord } from "../lib/scoreLog";

  // The results of one scored pass: overall, stars, sections, a heatmap of bars, and a way to loop the worst part.
  let {
    open,
    summary,
    sections,
    speed,
    loop,
    isBest,
    best,
    onclose,
    onagain,
    onpractise,
  }: {
    open: boolean;
    summary: ScoreSummary | null;
    sections: SectionScore[];
    speed: number;
    loop: { from: number; to: number } | null;
    isBest: boolean;
    best: ScoreRecord | null;
    onclose: () => void;
    onagain: () => void;
    onpractise: (from: number, to: number) => void;
  } = $props();

  const percent = (value: number) => Math.round(value * 100);
  const stars = $derived(summary ? starsFor(summary.accuracy, summary.graded) : 0);
  const weakest = $derived(summary ? weakestSpan(summary.bars) : null);

  /** A bar's colour runs from green (all notes) to red (none). */
  function heat(value: number | null): string {
    return value === null ? "transparent" : `hsl(${Math.round(value * 120)} 65% 42%)`;
  }
</script>

<Sheet
  {open}
  title={t("scored.results")}
  subtitle={`${loop ? t("scored.loopBars", { from: loop.from + 1, to: loop.to + 1 }) : t("scored.wholeSong")} · ${t("scored.speed", { percent: speed })}`}
  testid="score-results"
  {onclose}
>
  {#if summary}
    <div class="score-hero">
      <p class="score-percent" data-testid="score-overall">{percent(summary.accuracy)}%</p>
      <p class="score-stars" role="img" aria-label={t("scored.stars", { count: stars })}>
        {#each [1, 2, 3] as star (star)}<span class:lit={star <= stars} aria-hidden="true">★</span
          >{/each}
      </p>
      <p class="muted small">
        {t("scored.overall")} · {t("scored.bestStreak", { count: summary.bestStreak })}
      </p>
      {#if isBest}
        <p class="score-best" data-testid="score-new-best">{t("scored.newBest")}</p>
      {:else if best}
        <p class="muted small" data-testid="score-best">
          {t("scored.personalBest", { percent: percent(best.accuracy) })}
        </p>
      {/if}
    </div>

    <ul class="score-counts" data-testid="score-counts">
      {#each ["hit", "early", "late", "wrong", "missed"] as const as grade (grade)}
        <li>
          <strong>{summary.counts[grade]}</strong>
          <span class="muted small">{t(`scored.grade.${grade}`)}</span>
        </li>
      {/each}
      <li>
        <strong>{summary.extras}</strong>
        <span class="muted small">{t("scored.grade.extra")}</span>
      </li>
    </ul>

    {#if sections.length > 1}
      <h3>{t("scored.sections")}</h3>
      <ul class="score-sections" data-testid="score-sections">
        {#each sections as section (section.from)}
          <li>
            <span>
              {section.name ??
                t("scored.sectionBars", { from: section.from + 1, to: section.to + 1 })}
            </span>
            <strong>{percent(section.accuracy)}%</strong>
            <button
              class="button ghost small"
              data-testid={`score-practise-section-${section.from}`}
              onclick={() => onpractise(section.from, section.to)}>{t("scored.practise")}</button
            >
          </li>
        {/each}
      </ul>
    {/if}

    <h3>{t("scored.heatmap")}</h3>
    <p class="muted small">{t("scored.heatmapHint")}</p>
    <ol class="score-heatmap" data-testid="score-heatmap">
      {#each summary.bars as bar, index (index)}
        {@const value = barAccuracy(bar)}
        <li
          style:background={heat(value)}
          class:empty={value === null}
          aria-label={value === null
            ? t("scored.barEmpty", { bar: index + 1 })
            : t("scored.bar", { bar: index + 1, percent: percent(value) })}
          title={String(index + 1)}
        >
          {index + 1}
        </li>
      {/each}
    </ol>

    <div class="button-row">
      {#if weakest}
        <button
          class="button"
          data-testid="score-practise"
          onclick={() => onpractise(weakest.from, weakest.to)}>{t("scored.practise")}</button
        >
      {/if}
      <button class="button ghost" data-testid="score-again" onclick={onagain}
        >{t("scored.playAgain")}</button
      >
      <button class="button ghost" onclick={onclose}>{t("scored.close")}</button>
    </div>
  {/if}
</Sheet>

<style>
  .score-hero {
    text-align: center;
    margin-bottom: 12px;
  }
  .score-percent {
    font-size: 3rem;
    font-weight: 700;
    margin: 0;
  }
  .score-stars {
    font-size: 1.8rem;
    margin: 0;
    letter-spacing: 4px;
  }
  .score-stars span {
    color: var(--line-strong);
  }
  .score-stars span.lit {
    color: var(--warn);
  }
  .score-best {
    color: var(--success);
    font-weight: 600;
    margin: 4px 0 0;
  }
  .score-counts {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    padding: 0;
    margin: 0 0 12px;
  }
  .score-counts li {
    display: grid;
    text-align: center;
  }
  .score-sections {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
    display: grid;
    gap: 6px;
  }
  .score-sections li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 10px;
    align-items: center;
  }
  .score-heatmap {
    list-style: none;
    padding: 0;
    margin: 0 0 14px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(30px, 1fr));
    gap: 3px;
  }
  .score-heatmap li {
    text-align: center;
    font-size: 0.75rem;
    padding: 6px 0;
    border-radius: 4px;
    color: #fff;
  }
  .score-heatmap li.empty {
    border: 1px dashed var(--line-strong);
    color: var(--text);
    opacity: 0.5;
  }
</style>
