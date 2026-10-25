<script lang="ts">
  import Icon from "./Icon.svelte";
  import GoalChip from "./practice/GoalChip.svelte";
  import Heatmap from "./practice/Heatmap.svelte";
  import PracticeRow from "./practice/PracticeRow.svelte";
  import Recommendations from "./Recommendations.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import { getPracticeStats, savePracticeGoal } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { agoDays, goalProgress, localDay, minutesOf, ringOffset } from "../lib/practiceLog";
  import { formatDuration } from "../lib/practiceText";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { KIND_NAMES } from "../lib/trainer/store";
  import { PATTERNS } from "../lib/rhythm/patterns";
  import type { PracticeRhythmRun, PracticeSongStats, PracticeStats } from "../lib/types";

  const RADIUS = 52;

  let stats = $state<PracticeStats | null>(null);
  let error = $state("");

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  $effect(() => {
    getPracticeStats(localDay(new Date()))
      .then((loaded) => {
        stats = loaded;
      })
      .catch(fail);
  });

  const progress = $derived(
    stats ? goalProgress(stats.today_seconds, stats.goal.daily_minutes) : 0,
  );
  const empty = $derived(
    stats !== null && stats.songs_practised === 0 && stats.exercises.length === 0,
  );

  /** Goal changes apply as soon as they are made; a failed save puts the old goal back. */
  async function saveGoal(goal: { daily_minutes: number; weekly_summary: boolean }) {
    if (!stats) return;
    error = "";
    try {
      const saved = await savePracticeGoal(goal);
      if (stats) stats = { ...stats, goal: saved };
    } catch (err) {
      fail(err);
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

  const songPath = (id: string) => `/songs/${id}`;

  const greeting = $derived.by(() => {
    const hour = new Date().getHours();
    return t(
      hour < 5 || hour >= 18
        ? "practiceHome.greetingEvening"
        : hour < 12
          ? "practiceHome.greetingMorning"
          : "practiceHome.greetingAfternoon",
    );
  });

  const subtitle = $derived.by(() => {
    if (!stats) return "";
    if (empty) return t("practiceHome.subtitleEmpty");
    const goal = stats.goal.daily_minutes;
    if (goal <= 0) {
      return stats.today_seconds > 0
        ? t("practiceHome.playedMinutes", { minutes: minutesOf(stats.today_seconds) })
        : t("practiceHome.nothingYet");
    }
    return progress >= 1
      ? t("practiceHome.goalMet")
      : t("practiceHome.toGoal", { minutes: Math.max(1, goal - minutesOf(stats.today_seconds)) });
  });

  /** The song to carry on with: whatever was practised last. */
  const resume = $derived(stats?.recent[0] ?? null);
  const playedToday = $derived(
    stats ? stats.recent.filter((s) => s.last_day === stats!.today) : [],
  );
  const bestScore = $derived(
    stats
      ? stats.best_scores.reduce<number | null>(
          (best, song) =>
            song.best_score !== null && (best === null || song.best_score > best)
              ? song.best_score
              : best,
          null,
        )
      : null,
  );
  const weekDelta = $derived(stats ? change(stats.week.seconds, stats.week.previous_seconds) : "");

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

  const exerciseName = (kind: keyof typeof KIND_NAMES | "rhythm") =>
    kind === "rhythm" ? t("rhythm.toolTitle") : t(KIND_NAMES[kind].labelKey);
  const exercisePath = (kind: string) => (kind === "rhythm" ? "/tools/rhythm" : "/tools/trainer");

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
    <PageHeader
      title={greeting}
      eyebrow={t("practiceLog.nav")}
      {subtitle}
      subtitleTestId="practice-subtitle"
    >
      {#snippet actions()}
        {#if stats}
          {#if resume}
            <a
              class="button primary"
              data-testid="practice-continue"
              href={hrefFor(songPath(resume.song_id))}
              onclick={(event) => followLink(event, songPath(resume!.song_id))}
            >
              <Icon name="play" size={16} />{t("practiceHome.continue")}
            </a>
          {:else}
            <a
              class="button primary"
              data-testid="practice-start"
              href={hrefFor("/")}
              onclick={(event) => followLink(event, "/")}
            >
              <Icon name="library" size={16} />{t("practiceHome.start")}
            </a>
          {/if}
        {/if}
      {/snippet}
    </PageHeader>

    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

    {#if !stats}
      {#if !error}<p class="muted" role="status">{t("app.loading")}</p>{/if}
    {:else if empty}
      <div class="empty-state compact" data-testid="practice-empty">
        <span class="empty-art"><Icon name="target" size={30} /></span>
        <p class="muted">{t("practiceLog.empty")}</p>
      </div>
      <Recommendations />
    {:else}
      <div class="today card" data-testid="practice-goal-card">
        {#if stats.goal.daily_minutes > 0}
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
                {t("practiceLog.ofGoal", { minutes: stats.goal.daily_minutes })}
              </span>
            </div>
          </div>
        {:else}
          <div class="plain-today">
            <strong data-testid="practice-today">{minutesOf(stats.today_seconds)}</strong>
            <span class="muted">{t("practiceLog.minutesToday")}</span>
          </div>
        {/if}
        <div class="today-body">
          <h2>{t("practiceHome.today")}</h2>
          {#if playedToday.length}
            <p class="played" data-testid="practice-played-today">
              {t("practiceHome.playedToday", {
                songs: playedToday.map((song) => song.title).join(", "),
              })}
            </p>
          {:else}
            <p class="muted">{t("practiceHome.nothingYet")}</p>
          {/if}
          <GoalChip
            minutes={stats.goal.daily_minutes}
            weekly={stats.goal.weekly_summary}
            onchange={saveGoal}
          />
        </div>
      </div>

      <div class="tiles">
        <div class="tile streak" data-testid="practice-streak">
          <span class="tile-icon"><Icon name="flame" size={20} /></span>
          <span class="tile-value">{stats.current_streak}</span>
          <span class="tile-label"
            >{t("practiceLog.dayStreak", { count: stats.current_streak })}</span
          >
          <span class="tile-note muted">
            {#if stats.current_streak === 0 && stats.longest_streak > 0}
              {t("practiceHome.streakPaused")}
            {:else}
              {t("practiceLog.longestStreak")}
              <span data-testid="practice-longest">{stats.longest_streak}</span>
            {/if}
          </span>
        </div>
        {#if stats.goal.weekly_summary}
          <div class="tile" data-testid="practice-week">
            <span class="tile-icon"><Icon name="calendar" size={20} /></span>
            <span class="tile-value">{formatDuration(stats.week.seconds)}</span>
            <span class="tile-label">{t("practiceLog.thisWeek")}</span>
            <span class="tile-note muted">
              {weekDelta || t("practiceLog.weekDays", { count: stats.week.days_practised })}
            </span>
          </div>
        {/if}
        <div class="tile">
          <span class="tile-icon"><Icon name="tab" size={20} /></span>
          <span class="tile-value" data-testid="practice-songs">{stats.songs_practised}</span>
          <span class="tile-label">{t("practiceLog.songsPractised")}</span>
          <span class="tile-note muted"
            >{formatDuration(stats.total_seconds)} {t("practiceLog.totalTime")}</span
          >
        </div>
        <div class="tile">
          <span class="tile-icon"><Icon name="star" size={20} /></span>
          <span class="tile-value" data-testid="practice-best">
            {bestScore !== null ? `${Math.round(bestScore)}%` : "–"}
          </span>
          <span class="tile-label">{t("practiceHome.bestScore")}</span>
        </div>
      </div>

      <Recommendations />

      <div class="card">
        <h2>{t("practiceLog.heatmap")}</h2>
        <Heatmap days={stats.heatmap} today={stats.today} goalMinutes={stats.goal.daily_minutes} />
      </div>

      <div class="lists">
        {#each [{ id: "recent", labelKey: "practiceLog.recent", rows: stats.recent }, { id: "scores", labelKey: "practiceLog.bestScores", rows: stats.best_scores }, { id: "stale", labelKey: "practiceLog.stale", rows: stats.stale }] as list (list.id)}
          {#if list.rows.length}
            <div class="card" data-testid={`practice-list-${list.id}`}>
              <h2>{t(list.labelKey)}</h2>
              <ul class="song-list">
                {#each list.rows as song (song.song_id)}
                  <PracticeRow
                    path={songPath(song.song_id)}
                    title={song.title}
                    subtitle={song.artist}
                    cover={{ id: song.song_id, kind: song.content_kind }}
                    value={list.id === "scores" && song.best_score !== null
                      ? `${Math.round(song.best_score)}%`
                      : list.id === "recent"
                        ? `${formatDuration(song.total_seconds)} · ${ago(song)}`
                        : ago(song)}
                  />
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
                <PracticeRow
                  path={exercisePath(exercise.kind)}
                  title={exerciseName(exercise.kind)}
                  icon={exercise.kind === "rhythm" ? "drum" : "ear"}
                  value={`${formatDuration(exercise.total_seconds)}${exercise.best_score !== null ? ` · ${Math.round(exercise.best_score)}%` : ""}`}
                />
              {/each}
            </ul>
          </div>
        {/if}
        {#if stats.rhythm_runs?.length}
          <div class="card" data-testid="practice-list-rhythm-runs">
            <h2>{t("practiceLog.rhythmRuns.heading")}</h2>
            <ul class="song-list">
              {#each stats.rhythm_runs as run, index (index)}
                <PracticeRow
                  path={run.song_id ? songPath(run.song_id) : ""}
                  title={runName(run)}
                  subtitle={runDetail(run)}
                  icon="drum"
                />
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
    gap: var(--sp-5);
    min-width: 0;
  }
  .practice-page > * {
    min-width: 0;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: var(--sp-4) var(--sp-5);
    min-width: 0;
  }
  h2 {
    font-size: var(--fs-h3);
    margin: 0 0 var(--sp-3);
    color: var(--text-2);
  }
  .today {
    display: flex;
    gap: var(--sp-5);
    align-items: center;
    flex-wrap: wrap;
  }
  .today-body {
    display: grid;
    gap: var(--sp-2);
    justify-items: start;
    flex: 1 1 14rem;
    min-width: 0;
  }
  .today-body h2,
  .today-body p {
    margin: 0;
  }
  .played {
    overflow-wrap: anywhere;
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
    transition: stroke-dashoffset 0.4s var(--ease);
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
  .ring-text strong,
  .plain-today strong {
    font-size: var(--fs-title);
    line-height: 1;
  }
  .ring-text span {
    font-size: var(--fs-xs);
  }
  .plain-today {
    display: grid;
    gap: var(--sp-1);
    flex: none;
  }
  .tiles {
    display: grid;
    gap: var(--sp-3);
    grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr));
  }
  .tile {
    display: grid;
    gap: var(--sp-1);
    align-content: start;
    padding: var(--sp-4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
    min-width: 0;
  }
  .tile-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-bottom: var(--sp-1);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--text-2);
  }
  .streak .tile-icon {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .tile-value {
    font-size: var(--fs-title);
    font-weight: 650;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .streak .tile-value {
    color: var(--accent-text);
  }
  .tile-label {
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .tile-note {
    font-size: var(--fs-xs);
  }
  .lists {
    display: grid;
    gap: var(--sp-4);
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr));
  }
  .song-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-1);
  }
</style>
