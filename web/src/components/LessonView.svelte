<script lang="ts">
  import Icon from "./Icon.svelte";
  import LessonBlocks from "./LessonBlocks.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import {
    ApiError,
    checkLesson,
    getCourse,
    getLesson,
    listSongs,
    openLesson,
    reportLessonProgress,
  } from "../lib/api";
  import type { CourseDetail, LessonDetail, LessonProgressResult } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";
  import { lessonSongPath, recallLessonSong, rememberLessonSong } from "../lib/lessonRun";
  import { coursePath, lessonPath } from "../lib/lessons";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { SongSummary } from "../lib/types";
  import { openAddForLesson, ui } from "../lib/ui.svelte";

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
    picked = "";
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

  // Where this lesson sits in its course. Best effort: without it the page just has no stepper.
  let courseDetail = $state<CourseDetail | null>(null);

  $effect(() => {
    const wanted = course;
    courseDetail = null;
    getCourse(wanted)
      .then((found) => {
        if (wanted === course) courseDetail = found;
      })
      .catch(() => undefined);
  });

  const steps = $derived(
    (courseDetail?.levels ?? []).flatMap((level) =>
      level.lessons.map((item) => ({ id: item.id, level: level.title, status: item.status })),
    ),
  );
  const stepIndex = $derived(steps.findIndex((item) => item.id === lesson));
  const step = $derived(stepIndex >= 0 ? steps[stepIndex] : null);
  const previousId = $derived(stepIndex > 0 ? steps[stepIndex - 1].id : null);
  const followingId = $derived(
    stepIndex >= 0 && stepIndex < steps.length - 1 ? steps[stepIndex + 1].id : null,
  );
  const eyebrow = $derived(
    step
      ? t("lessons.stepper", { level: step.level, n: stepIndex + 1, total: steps.length })
      : detail
        ? t("lessons.nav")
        : "",
  );
  // The next lesson opens once this one is passed; the course list was read before that happened.
  const nextOpen = $derived(
    !!detail?.progress.completed ||
      (followingId !== null && steps[stepIndex + 1].status !== "locked"),
  );

  const condition = $derived(detail?.pass_condition ?? null);

  // A lesson that is not tied to a library song is played on a song the learner picks, and the player reports back.
  let songs = $state<SongSummary[]>([]);
  let picked = $state("");
  const playable = $derived(condition !== null && !condition.song);
  // What actually teaches: the lesson's own exercise, else the picked song. Reporting by hand is the fallback.
  const exercise = $derived(detail?.blocks.find((block) => block.kind === "exercise") ?? null);
  const playHref = $derived(
    !playable
      ? null
      : exercise
        ? `/tools/exercises?preset=${exercise.params.preset}`
        : picked
          ? lessonSongPath(picked, { course, lesson })
          : null,
  );

  $effect(() => {
    if (!playable) return;
    let current = true;
    listSongs({ sort: "opened", order: "desc", limit: 100 })
      .then((page) => {
        if (!current) return;
        songs = page.items.filter((item) => item.content_kind !== "chords");
        // Start on the song picked last time, if it is still in the library.
        const last = recallLessonSong(ui.me?.user_id, { course, lesson });
        if (!picked && songs.some((item) => item.id === last)) picked = last;
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  });

  // hrefFor keeps only the path, so the query is put back by hand.
  function withQuery(path: string): string {
    const [base, query] = path.split("?");
    return hrefFor(base) + (query ? `?${query}` : "");
  }

  function pick(event: Event) {
    rememberLessonSong(
      ui.me?.user_id,
      { course, lesson },
      (event.currentTarget as HTMLSelectElement).value,
    );
  }

  function report(event: SubmitEvent) {
    event.preventDefault();
    const body: { score?: number; bpm?: number } = {};
    if (score !== null) body.score = score;
    if (bpm !== null) body.bpm = bpm;
    void run(() => reportLessonProgress(course, lesson, body));
  }
</script>

<Page width="page">
  <article class="lesson-page" data-testid="lesson-view">
    <PageHeader
      title={detail?.title ?? t("lessons.heading")}
      titleSize="title"
      {eyebrow}
      subtitle={detail?.summary ?? ""}
      backHref={coursePath(course)}
      backLabel={detail?.course_title ?? t("lessons.heading")}
    >
      {#snippet actions()}
        {#if detail?.can_edit && !ui.demoMode}
          <a
            class="button ghost"
            data-testid="lesson-edit"
            href={hrefFor(`${lessonPath(course, lesson)}/edit`)}
            onclick={(event) => followLink(event, `${lessonPath(course, lesson)}/edit`)}
          >
            <Icon name="edit" size={18} /><span>{t("lessons.edit")}</span>
          </a>
        {/if}
      {/snippet}
    </PageHeader>

    {#if error}
      <p class="alert" role="alert" data-testid={locked ? "lesson-locked" : "lesson-error"}>
        <Icon name={locked ? "lock" : "alert"} size={18} />{error}
      </p>
    {/if}

    {#if detail}
      <div class="reading">
        <LessonBlocks blocks={detail.blocks} />
      </div>

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
              ? t("lessons.passScoreBpm", {
                  score: condition.min_score ?? 0,
                  bpm: condition.min_bpm,
                })
              : t("lessons.passScore", { score: condition.min_score ?? 0 })}
          </p>
        {:else if condition?.type === "wait"}
          <p>{t("lessons.passWait")}</p>
        {:else}
          <p class="muted">{t("lessons.passNone")}</p>
        {/if}

        {#if playHref && !detail.progress.completed}
          <a
            class="button primary"
            data-testid="lesson-play-link"
            href={withQuery(playHref)}
            onclick={(event) => followLink(event, playHref)}
          >
            <Icon name="play" size={18} /><span
              >{exercise ? t("lessons.playExercise") : t("lessons.playSong")}</span
            >
          </a>
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
            class={playHref ? "ghost" : "primary"}
            data-testid="lesson-report-wait"
            disabled={busy}
            onclick={() =>
              run(() => reportLessonProgress(course, lesson, { wait_completed: true }))}
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
              class={playHref ? "" : "primary"}
              type="submit"
              disabled={busy || score === null}
              data-testid="lesson-report"
            >
              <span>{t("lessons.report")}</span>
            </button>
          </form>
        {/if}

        {#if playable}
          <div class="lesson-report" data-testid="lesson-play">
            {#if songs.length}
              <label class="tool-field">
                <span>{t("lessonRun.pick")}</span>
                <select bind:value={picked} onchange={pick} data-testid="lesson-song-pick">
                  <option value="">{t("lessonRun.pickPlaceholder")}</option>
                  {#each songs as item (item.id)}
                    <option value={item.id}
                      >{item.artist ? `${item.title} · ${item.artist}` : item.title}</option
                    >
                  {/each}
                </select>
              </label>
            {/if}
            <button
              type="button"
              data-testid="lesson-import"
              onclick={() => openAddForLesson({ course, lesson })}
            >
              <Icon name="upload" size={18} /><span>{t("lessonRun.import")}</span>
            </button>
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

      {#if step}
        <nav class="lesson-steps" aria-label={t("lessons.stepperNav")}>
          {#if previousId}
            <a
              class="button ghost"
              data-testid="lesson-previous"
              href={hrefFor(lessonPath(course, previousId))}
              onclick={(event) => followLink(event, lessonPath(course, previousId))}
            >
              <Icon name="back" size={18} /><span>{t("lessons.previous")}</span>
            </a>
          {:else}
            <span></span>
          {/if}
          {#if followingId}
            {#if nextOpen}
              <a
                class="button"
                data-testid="lesson-step-next"
                href={hrefFor(lessonPath(course, followingId))}
                onclick={(event) => followLink(event, lessonPath(course, followingId))}
              >
                <span>{t("lessons.next")}</span><Icon name="forward" size={18} />
              </a>
            {:else}
              <div class="lesson-step-locked" data-testid="lesson-step-next">
                <button type="button" disabled aria-describedby="lesson-step-reason">
                  <Icon name="lock" size={18} /><span>{t("lessons.next")}</span>
                </button>
                <p id="lesson-step-reason" class="muted small">{t("lessons.nextLocked")}</p>
              </div>
            {/if}
          {/if}
        </nav>
      {/if}
    {/if}
  </article>
</Page>

<style>
  .reading {
    max-width: var(--page-narrow);
  }

  .lesson-steps {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-4);
    max-width: var(--page-narrow);
    margin-top: var(--sp-6);
  }

  .lesson-step-locked {
    display: grid;
    justify-items: end;
    gap: var(--sp-1);
    text-align: right;
  }

  .lesson-step-locked p {
    margin: 0;
  }
</style>
