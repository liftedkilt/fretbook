<script lang="ts">
  import Icon from "./Icon.svelte";
  import Recommendations from "./Recommendations.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import { getPracticeStats, savePracticeGoal } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import {
    agoDays,
    goalProgress,
    heatmapWeeks,
    localDay,
    minutesOf,
    ringOffset,
  } from "../lib/practiceLog";
  import { formatDuration } from "../lib/practiceText";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { KIND_NAMES } from "../lib/trainer/store";
  import { PATTERNS } from "../lib/rhythm/patterns";
  import type { PracticeRhythmRun, PracticeSongStats, PracticeStats } from "../lib/types";

  const RADIUS = 52;

  let stats = $state<PracticeStats | null>(null);
  let error = $state("");
  let goalDraft = $state(15);
  let weekly = $state(true);
  let saving = $state(false);

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  $effect(() => {
    getPracticeStats(localDay(new Date()))
      .then((loaded) => {
        stats = loaded;
        goalDraft = loaded.goal.daily_minutes;
        weekly = loaded.goal.weekly_summary;
      })
      .catch(fail);
  });

  const progress = $derived(
    stats ? goalProgress(stats.today_seconds, stats.goal.daily_minutes) : 0,
  );
  const weeks = $derived(
    stats ? heatmapWeeks(stats.heatmap, stats.today, stats.goal.daily_minutes) : [],
  );
  const empty = $derived(
    stats !== null && stats.songs_practised === 0 && stats.exercises.length === 0,
  );

  async function saveGoal(event: SubmitEvent) {
    event.preventDefault();
    if (!stats) return;
    saving = true;
    error = "";
    try {
      const goal = await savePracticeGoal({
        daily_minutes: Math.max(0, Math.min(720, Math.round(Number(goalDraft) || 0))),
        weekly_summary: weekly,
      });
      stats = { ...stats, goal };
      goalDraft = goal.daily_minutes;
    } catch (err) {
      fail(err);
    } finally {
      saving = false;
    }
  }

  function ago(song: PracticeSongStats): string {
    if (!stats) return "";
    const days = agoDays(song.last_day, stats.today);
    return days === 0
      ? t("practiceLog.today")
      : days === 1
        ? t("practiceLog.yesterday")
        : t("practiceLog.daysAgo", { count: days });
  }

  function change(now: number, before: number): string {
    if (before === 0) return now === 0 ? "" : t("practiceLog.firstWeek");
    const percent = Math.round(((now - before) / before) * 100);
    return t("practiceLog.vsLastWeek", { percent: `${percent > 0 ? "+" : ""}${percent}` });
  }

  /** Start the heatmap at the right edge, where today is. */
  function showLatest(node: HTMLElement) {
    node.scrollLeft = node.scrollWidth;
  }

  const songPath = (id: string) => `/songs/${id}`;

  function runName(run: PracticeRhythmRun): string {
    const builtIn = PATTERNS.find((pattern) => pattern.id === run.pattern);
    if (builtIn) return t(builtIn.labelKey);
    if (run.bar != null) {
      return run.song_title
        ? t("practiceLog.rhythmRuns.songBar", { title: run.song_title, bar: run.bar })
        : t("practiceLog.rhythmRuns.songGone", { bar: run.bar });
    }
    return t("rhythm.toolTitle");
  }

  function runDetail(run: PracticeRhythmRun): string {
    const parts = [
      t("practiceLog.rhythmRuns.hitRate", {
        percent: run.rounds ? Math.round((run.correct / run.rounds) * 100) : 0,
      }),
    ];
    if (run.bpm != null) parts.push(t("practiceLog.rhythmRuns.tempo", { bpm: run.bpm }));
    if (run.mean_error_ms != null) {
      const ms = Math.round(Math.abs(run.mean_error_ms));
      parts.push(
        ms === 0
          ? t("practiceLog.rhythmRuns.meanError", { ms })
          : `${t("practiceLog.rhythmRuns.meanError", { ms })} ${t(run.mean_error_ms > 0 ? "practiceLog.rhythmRuns.late" : "practiceLog.rhythmRuns.early")}`,
      );
    }
    return parts.join(" · ");
  }
</script>

<Page width="page">
  <section class="practice-page" data-testid="practice-view">
    <PageHeader title={t("practiceLog.heading")} eyebrow={t("practiceLog.nav")} />

    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

    {#if !stats}
      {#if !error}<p class="muted" role="status">{t("app.loading")}</p>{/if}
    {:else}
      <div class="top">
        <div class="card ring-card" data-testid="practice-goal-card">
          <div class="ring" data-testid="practice-ring" data-progress={progress.toFixed(2)}>
            <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
              <circle class="track" cx="60" cy="60" r={RADIUS} />
              <circle
                class="arc"
                class:done={progress >= 1}
                cx="60"
                cy="60"
                r={RADIUS}
                stroke-dasharray={2 * Math.PI * RADIUS}
                stroke-dashoffset={ringOffset(progress, RADIUS)}
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div class="ring-text">
              <strong data-testid="practice-today">{minutesOf(stats.today_seconds)}</strong>
              <span class="muted">
                {stats.goal.daily_minutes > 0
                  ? t("practiceLog.ofGoal", { minutes: stats.goal.daily_minutes })
                  : t("practiceLog.minutesToday")}
              </span>
            </div>
          </div>
          <form class="goal-form" onsubmit={saveGoal}>
            <label for="practice-goal">{t("practiceLog.dailyGoal")}</label>
            <div class="goal-row">
              <input
                id="practice-goal"
                data-testid="practice-goal-input"
                type="number"
                min="0"
                max="720"
                bind:value={goalDraft}
              />
              <span class="muted">{t("practiceLog.minutes")}</span>
            </div>
            <label class="check">
              <input type="checkbox" data-testid="practice-weekly-toggle" bind:checked={weekly} />
              {t("practiceLog.weeklySummary")}
            </label>
            <button class="button" type="submit" data-testid="practice-goal-save" disabled={saving}>
              {t("practiceLog.saveGoal")}
            </button>
          </form>
        </div>

        <div class="card stats-card">
          <div class="stat" data-testid="practice-streak">
            <span class="stat-value">{stats.current_streak}</span>
            <span class="muted">{t("practiceLog.dayStreak", { count: stats.current_streak })}</span>
          </div>
          <div class="stat">
            <span class="stat-value" data-testid="practice-longest">{stats.longest_streak}</span>
            <span class="muted">{t("practiceLog.longestStreak")}</span>
          </div>
          <div class="stat">
            <span class="stat-value" data-testid="practice-songs">{stats.songs_practised}</span>
            <span class="muted">{t("practiceLog.songsPractised")}</span>
          </div>
          <div class="stat">
            <span class="stat-value">{formatDuration(stats.total_seconds)}</span>
            <span class="muted">{t("practiceLog.totalTime")}</span>
          </div>
        </div>
      </div>

      {#if stats.goal.weekly_summary}
        <div class="card week" data-testid="practice-week">
          <h2>{t("practiceLog.thisWeek")}</h2>
          <p>
            <strong>{formatDuration(stats.week.seconds)}</strong>
            <span class="muted">
              {t("practiceLog.weekDays", { count: stats.week.days_practised })}
              {#if stats.goal.daily_minutes > 0}
                · {t("practiceLog.weekGoalDays", { count: stats.week.goal_days })}
              {/if}
              {#if change(stats.week.seconds, stats.week.previous_seconds)}
                · {change(stats.week.seconds, stats.week.previous_seconds)}
              {/if}
            </span>
          </p>
        </div>
      {/if}

      {#if empty}
        <div class="empty-state compact" data-testid="practice-empty">
          <span class="empty-art"><Icon name="target" size={30} /></span>
          <p class="muted">{t("practiceLog.empty")}</p>
        </div>
      {/if}

      <div class="card">
        <h2>{t("practiceLog.heatmap")}</h2>
        <div
          class="heatmap"
          role="img"
          aria-label={t("practiceLog.heatmapLabel")}
          data-testid="practice-heatmap"
          use:showLatest
        >
          {#each weeks as week, index (index)}
            <div class="week-col">
              {#each week as cell (cell.day)}
                <span
                  class="cell level-{cell.level}"
                  class:future={cell.future}
                  data-testid={cell.level > 0 ? "practice-heat-day" : undefined}
                  data-day={cell.day}
                  title={cell.future ? undefined : `${cell.day}: ${formatDuration(cell.seconds)}`}
                ></span>
              {/each}
            </div>
          {/each}
        </div>
      </div>

      <Recommendations />

      <div class="lists">
        {#each [{ id: "recent", labelKey: "practiceLog.recent", rows: stats.recent }, { id: "scores", labelKey: "practiceLog.bestScores", rows: stats.best_scores }, { id: "stale", labelKey: "practiceLog.stale", rows: stats.stale }] as list (list.id)}
          {#if list.rows.length}
            <div class="card" data-testid={`practice-list-${list.id}`}>
              <h2>{t(list.labelKey)}</h2>
              <ul class="song-list">
                {#each list.rows as song (song.song_id)}
                  <li>
                    <a
                      href={hrefFor(songPath(song.song_id))}
                      onclick={(event) => followLink(event, songPath(song.song_id))}
                    >
                      <strong>{song.title}</strong>
                      {#if song.artist}<span class="muted">{song.artist}</span>{/if}
                    </a>
                    <span class="muted meta">
                      {#if list.id === "scores" && song.best_score !== null}
                        {Math.round(song.best_score)}%
                      {:else if list.id === "recent"}
                        {formatDuration(song.total_seconds)} · {ago(song)}
                      {:else}
                        {ago(song)}
                      {/if}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        {/each}
        {#if stats.exercises.length}
          <div class="card" data-testid="practice-list-exercises">
            <h2>{t("practiceLog.exercises")}</h2>
            <ul class="song-list">
              {#each stats.exercises as exercise (exercise.kind)}
                <li>
                  <a
                    href={hrefFor(exercise.kind === "rhythm" ? "/tools/rhythm" : "/tools/trainer")}
                    onclick={(event) =>
                      followLink(
                        event,
                        exercise.kind === "rhythm" ? "/tools/rhythm" : "/tools/trainer",
                      )}
                  >
                    <strong
                      >{exercise.kind === "rhythm"
                        ? t("rhythm.toolTitle")
                        : t(KIND_NAMES[exercise.kind].labelKey)}</strong
                    >
                  </a>
                  <span class="muted meta">
                    {formatDuration(exercise.total_seconds)}
                    {#if exercise.best_score !== null}· {Math.round(exercise.best_score)}%{/if}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if stats.rhythm_runs?.length}
          <div class="card" data-testid="practice-list-rhythm-runs">
            <h2>{t("practiceLog.rhythmRuns.heading")}</h2>
            <ul class="song-list">
              {#each stats.rhythm_runs as run, index (index)}
                <li>
                  {#if run.song_id}
                    <a
                      href={hrefFor(songPath(run.song_id))}
                      onclick={(e) => followLink(e, songPath(run.song_id!))}
                      ><strong>{runName(run)}</strong></a
                    >
                  {:else}
                    <strong>{runName(run)}</strong>
                  {/if}
                  <span class="muted meta">{runDetail(run)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </section>
</Page>

<style>
  .practice-page {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }
  .practice-page > * {
    min-width: 0;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 1rem 1.15rem;
    min-width: 0;
  }
  h2 {
    font-size: 0.95rem;
    margin: 0 0 0.6rem;
    color: var(--text-2);
  }
  .top {
    display: grid;
    gap: 1rem;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
  }
  .ring-card {
    display: flex;
    gap: 1.25rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .ring {
    position: relative;
    width: 132px;
    height: 132px;
    flex: none;
  }
  .ring svg {
    display: block;
  }
  .ring circle {
    fill: none;
    stroke-width: 10;
  }
  .track {
    stroke: var(--surface-3);
  }
  .arc {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dashoffset 0.4s ease;
  }
  .arc.done {
    stroke: var(--success);
  }
  .ring-text {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
  }
  .ring-text strong {
    font-size: 2rem;
    line-height: 1;
  }
  .ring-text span {
    font-size: 0.78rem;
  }
  .goal-form {
    display: grid;
    gap: 0.5rem;
    flex: 1 1 10rem;
  }
  .goal-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .goal-row input {
    width: 6rem;
  }
  .check {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    min-height: 44px;
    font-size: 0.9rem;
  }
  .stats-card {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    align-content: center;
  }
  .stat {
    display: grid;
    gap: 0.15rem;
  }
  .stat-value {
    font-size: 1.9rem;
    font-weight: 650;
    line-height: 1.1;
  }
  .week p {
    margin: 0;
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .heatmap {
    display: flex;
    gap: 3px;
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }
  .week-col {
    display: grid;
    gap: 3px;
    flex: none;
  }
  .cell {
    width: 11px;
    height: 11px;
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
  .lists {
    display: grid;
    gap: 1rem;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
  }
  .song-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .song-list li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: center;
    min-height: 44px;
  }
  .song-list a {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    min-width: 0;
    min-height: 44px;
    color: inherit;
    text-decoration: none;
  }
  .song-list strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    flex: none;
    font-size: 0.85rem;
  }
</style>
