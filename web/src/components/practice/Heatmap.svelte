<script lang="ts">
  import { currentLocale, t } from "../../lib/i18n.svelte";
  import { heatmapWeeks, parseDay } from "../../lib/practiceLog";
  import { formatDuration } from "../../lib/practiceText";

  let {
    days,
    today,
    goalMinutes,
  }: {
    days: readonly { day: string; seconds: number }[];
    today: string;
    goalMinutes: number;
  } = $props();

  const weeks = $derived(heatmapWeeks(days, today, goalMinutes));

  // A month name above the first full column of each month; weekday names on three rows.
  const months = $derived.by(() => {
    const format = new Intl.DateTimeFormat(currentLocale(), { month: "short" });
    let previous = -1;
    return weeks.map((week) => {
      const month = parseDay(week[0].day).getMonth();
      const label = month !== previous ? format.format(parseDay(week[0].day)) : "";
      previous = month;
      return label;
    });
  });
  const weekdays = $derived.by(() => {
    const format = new Intl.DateTimeFormat(currentLocale(), { weekday: "short" });
    // 2023-01-01 was a Sunday, and the columns start on Sunday.
    return [1, 3, 5].map((index) => ({
      row: index + 1,
      label: format.format(new Date(2023, 0, 1 + index)),
    }));
  });

  /** Start at the right edge, where today is, when the grid is wider than the card. */
  function showLatest(node: HTMLElement) {
    node.scrollLeft = node.scrollWidth;
  }
</script>

<div class="heat">
  <!-- Focusable so the keyboard can scroll the grid when it is wider than the card. -->
  <div
    class="scroller"
    role="region"
    aria-label={t("practiceLog.heatmap")}
    tabindex="0"
    use:showLatest
  >
    <div
      class="grid"
      role="img"
      aria-label={t("practiceLog.heatmapLabel")}
      data-testid="practice-heatmap"
      style="--weeks:{weeks.length}"
    >
      {#each months as label, index (index)}
        {#if label}<span class="month" style="grid-column:{index + 2}">{label}</span>{/if}
      {/each}
      {#each weekdays as weekday (weekday.row)}
        <span class="weekday" style="grid-row:{weekday.row + 1}">{weekday.label}</span>
      {/each}
      {#each weeks as week, column (column)}
        {#each week as cell, row (cell.day)}
          <span
            class="cell level-{cell.level}"
            class:future={cell.future}
            style="grid-column:{column + 2};grid-row:{row + 2}"
            data-testid={cell.level > 0 ? "practice-heat-day" : undefined}
            data-day={cell.day}
            title={cell.future ? undefined : `${cell.day}: ${formatDuration(cell.seconds)}`}
          ></span>
        {/each}
      {/each}
    </div>
  </div>
  <div class="legend" aria-hidden="true">
    <span>{t("practiceHome.less")}</span>
    {#each [0, 1, 2, 3, 4] as level (level)}<span class="cell level-{level}"></span>{/each}
    <span>{t("practiceHome.more")}</span>
  </div>
</div>

<style>
  .heat {
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
  }

  .scroller {
    min-width: 0;
    overflow-x: auto;
    padding-bottom: var(--sp-1);
  }

  .grid {
    display: grid;
    grid-template-columns: auto repeat(var(--weeks), minmax(11px, 1fr));
    grid-template-rows: auto repeat(7, 14px);
    gap: 3px;
    min-width: max-content;
    width: 100%;
  }

  .month,
  .weekday {
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: 1;
    white-space: nowrap;
  }

  .month {
    grid-row: 1;
    padding-bottom: var(--sp-1);
    overflow: visible;
  }

  .weekday {
    grid-column: 1;
    display: flex;
    align-items: center;
    padding-right: var(--sp-2);
  }

  .cell {
    border-radius: var(--r-xs);
    background: var(--heat-0);
  }

  .cell.future {
    background: transparent;
  }

  .level-1 {
    background: var(--heat-1);
  }

  .level-2 {
    background: var(--heat-2);
  }

  .level-3 {
    background: var(--heat-3);
  }

  .level-4 {
    background: var(--heat-4);
  }

  .legend {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 3px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .legend .cell {
    width: 14px;
    height: 14px;
  }

  .legend span:first-child {
    margin-right: var(--sp-1);
  }

  .legend span:last-child {
    margin-left: var(--sp-1);
  }
</style>
