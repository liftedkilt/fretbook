<script lang="ts">
  import Icon from "./Icon.svelte";
  import LessonBlocks from "./LessonBlocks.svelte";
  import {
    ApiError,
    checkLesson,
    getLesson,
    listSongs,
    openLesson,
    reportLessonProgress,
  } from "../lib/api";
  import type { LessonDetail, LessonProgressResult } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";
  import { lessonQuery, lessonSongPath } from "../lib/lessonRun";
  import { coursePath, lessonPath } from "../lib/lessons";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { SongSummary } from "../lib/types";

  let { course, lesson }: { course: string; lesson: string } = $props();

  let detail = $state<LessonDetail | null>(null);
  let error = $state("");
  let locked = $state(false);
  let busy = $state(false);
  let outcome = $state<"passed" | "missed" | null>(null);
  // A number input binds to a number, or null while it is empty.
  let score = $state<number | null>(null);
  let bpm = $state<number | null>(null);

  $effect(() => {
    const [wantedCourse, wantedLesson] = [course, lesson];
    detail = null;
    error = "";
    locked = false;
    outcome = null;
    score = bpm = null;
    getLesson(wantedCourse, wantedLesson)
      .then((found) => {
        detail = found;
        // Best effort: not being able to note the visit must not get in the way of reading.
        openLesson(wantedCourse, wantedLesson).catch(() => undefined);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.key === "lesson.locked") locked = true;
        error = err instanceof Error ? err.message : t("error.generic");
      });
  });

  function absorb(result: LessonProgressResult) {
    if (!detail) return;
    detail = {
      ...detail,
      status: result.progress.completed ? "completed" : detail.status,
      progress: result.progress,
      next_lesson_id: result.next_lesson_id,
    };
    outcome = result.passed ? "passed" : "missed";
  }

  async function run(action: () => Promise<LessonProgressResult>) {
    busy = true;
    error = "";
    try {
      absorb(await action());
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }

  const condition = $derived(detail?.pass_condition ?? null);

  // A lesson that is not tied to a library song is played on a song the learner picks, and the player reports back.
  let songs = $state<SongSummary[]>([]);
  let picked = $state("");
  const playable = $derived(condition !== null && !condition.song);

  $effect(() => {
    if (!playable) return;
    let current = true;
    listSongs({ sort: "opened", order: "desc", limit: 100 })
      .then((page) => {
        if (current) songs = page.items.filter((item) => item.content_kind !== "chords");
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  });

  function report(event: SubmitEvent) {
    event.preventDefault();
    const body: { score?: number; bpm?: number } = {};
    if (score !== null) body.score = score;
    if (bpm !== null) body.bpm = bpm;
    void run(() => reportLessonProgress(course, lesson, body));
  }
</script>

<article class="lesson-page" data-testid="lesson-view">
  <a
    class="button ghost tool-back"
    href={hrefFor(coursePath(course))}
    onclick={(event) => followLink(event, coursePath(course))}
  >
    <Icon name="back" size={18} /><span>{detail?.course_title ?? t("lessons.heading")}</span>
  </a>

  {#if error}
    <p class="alert" role="alert" data-testid={locked ? "lesson-locked" : "lesson-error"}>
      <Icon name={locked ? "lock" : "alert"} size={18} />{error}
    </p>
  {/if}

  {#if detail}
    <header class="page-hero">
      <div>
        <h1 class="display hero-title">{detail.title}</h1>
        {#if detail.summary}<p class="muted">{detail.summary}</p>{/if}
      </div>
      {#if detail.can_edit}
        <a
          class="button ghost"
          data-testid="lesson-edit"
          href={hrefFor(`${lessonPath(course, lesson)}/edit`)}
          onclick={(event) => followLink(event, `${lessonPath(course, lesson)}/edit`)}
        >
          <Icon name="edit" size={18} /><span>{t("lessons.edit")}</span>
        </a>
      {/if}
    </header>

    <LessonBlocks blocks={detail.blocks} />

    <section class="lesson-pass" aria-labelledby="lesson-pass-heading" data-testid="lesson-pass">
      <h2 id="lesson-pass-heading" class="field-label">{t("lessons.passHeading")}</h2>

      {#if detail.progress.completed}
        <p class="lesson-done" role="status" data-testid="lesson-done">
          <Icon name="check" size={18} />
          {t("lessons.completed")}
          {#if detail.progress.best_score !== null}
            · {t("lessons.bestScore", { score: Math.round(detail.progress.best_score) })}
          {/if}
        </p>
      {/if}

      {#if condition?.type === "score"}
        <p>
          {condition.min_bpm
            ? t("lessons.passScoreBpm", { score: condition.min_score ?? 0, bpm: condition.min_bpm })
            : t("lessons.passScore", { score: condition.min_score ?? 0 })}
        </p>
      {:else if condition?.type === "wait"}
        <p>{t("lessons.passWait")}</p>
      {:else}
        <p class="muted">{t("lessons.passNone")}</p>
      {/if}

      {#if !condition}
        {#if !detail.progress.completed}
          <button
            class="primary"
            data-testid="lesson-complete"
            disabled={busy}
            onclick={() => run(() => reportLessonProgress(course, lesson, { completed: true }))}
          >
            <Icon name="check" size={18} /><span>{t("lessons.markDone")}</span>
          </button>
        {/if}
      {:else if condition.song}
        <p class="muted">{t("lessons.checkHelp")}</p>
        <button
          class="primary"
          data-testid="lesson-check"
          disabled={busy}
          onclick={() => run(() => checkLesson(course, lesson))}
        >
          <Icon name="refresh" size={18} /><span>{t("lessons.check")}</span>
        </button>
      {:else if condition.type === "wait"}
        <button
          class="primary"
          data-testid="lesson-report-wait"
          disabled={busy}
          onclick={() => run(() => reportLessonProgress(course, lesson, { wait_completed: true }))}
        >
          <Icon name="check" size={18} /><span>{t("lessons.reportWait")}</span>
        </button>
      {:else}
        <form class="lesson-report" onsubmit={report}>
          <label class="tool-field">
            <span>{t("lessons.reportScore")}</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              bind:value={score}
              data-testid="lesson-score"
            />
          </label>
          {#if condition.min_bpm}
            <label class="tool-field">
              <span>{t("lessons.reportBpm")}</span>
              <input
                type="number"
                min="1"
                max="400"
                step="1"
                bind:value={bpm}
                data-testid="lesson-bpm"
              />
            </label>
          {/if}
          <button
            class="primary"
            type="submit"
            disabled={busy || score === null}
            data-testid="lesson-report"
          >
            <span>{t("lessons.report")}</span>
          </button>
        </form>
      {/if}

      {#if playable && songs.length}
        <div class="lesson-report" data-testid="lesson-play">
          <label class="tool-field">
            <span>{t("lessonRun.pick")}</span>
            <select bind:value={picked} data-testid="lesson-song-pick">
              <option value="">{t("lessonRun.pickPlaceholder")}</option>
              {#each songs as item (item.id)}
                <option value={item.id}
                  >{item.artist ? `${item.title} · ${item.artist}` : item.title}</option
                >
              {/each}
            </select>
          </label>
          {#if picked}
            <a
              class="button"
              data-testid="lesson-play-link"
              href={hrefFor(`/songs/${encodeURIComponent(picked)}`) +
                lessonQuery({ course, lesson })}
              onclick={(event) => followLink(event, lessonSongPath(picked, { course, lesson }))}
            >
              <Icon name="play" size={18} /><span>{t("lessonRun.play")}</span>
            </a>
          {/if}
        </div>
      {/if}

      {#if outcome === "missed"}
        <p class="notice" role="status" data-testid="lesson-missed">{t("lessons.notYet")}</p>
      {/if}
      {#if outcome === "passed"}
        <p class="notice" role="status" data-testid="lesson-passed">{t("lessons.passed")}</p>
      {/if}
    </section>

    {#if detail.progress.completed}
      <nav class="lesson-next">
        {#if detail.next_lesson_id}
          <a
            class="button primary"
            data-testid="lesson-next"
            href={hrefFor(lessonPath(course, detail.next_lesson_id))}
            onclick={(event) => followLink(event, lessonPath(course, detail!.next_lesson_id!))}
          >
            <span>{t("lessons.next")}</span><Icon name="forward" size={18} />
          </a>
        {:else}
          <a
            class="button"
            href={hrefFor(coursePath(course))}
            onclick={(event) => followLink(event, coursePath(course))}
          >
            <span>{t("lessons.backToCourse")}</span>
          </a>
        {/if}
      </nav>
    {/if}
  {/if}
</article>
