<script lang="ts">
  import CheckDraw from "./CheckDraw.svelte";
  import Icon from "./Icon.svelte";
  import { getLesson, reportLessonProgress } from "../lib/api";
  import { markLessonPassed } from "../lib/celebrate";
  import type { LessonDetail } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";
  import { lessonResult, type LessonRef, type LessonRun } from "../lib/lessonRun";
  import { lessonPath } from "../lib/lessons";
  import { followLink, hrefFor } from "../lib/router.svelte";

  let { lesson: ref }: { lesson: LessonRef } = $props();

  let detail = $state<LessonDetail | null>(null);
  let failed = $state(false);
  let outcome = $state<"passed" | "missed" | "error" | null>(null);
  let justPassed = $state(false);
  let nextLesson = $state<string | null>(null);

  $effect(() => {
    const wanted = ref;
    detail = null;
    failed = false;
    outcome = null;
    justPassed = false;
    getLesson(wanted.course, wanted.lesson)
      .then((found) => (detail = found))
      .catch(() => (failed = true));
  });

  const condition = $derived(detail?.pass_condition ?? null);
  const back = $derived(lessonPath(ref.course, ref.lesson));

  /** A scored or wait-mode run just finished: post it to the lesson when it counts, and show the verdict. */
  export async function report(run: LessonRun): Promise<void> {
    const body = lessonResult(condition, run);
    if (!body) return;
    const wasCompleted = detail?.progress.completed ?? false;
    try {
      const result = await reportLessonProgress(ref.course, ref.lesson, body);
      outcome = result.passed ? "passed" : "missed";
      nextLesson = result.next_lesson_id;
      justPassed = result.passed && result.progress.completed && !wasCompleted;
      if (justPassed) markLessonPassed(ref.course, ref.lesson);
    } catch {
      outcome = "error";
    }
  }
</script>

<aside class="lesson-run" data-testid="lesson-run" data-outcome={outcome ?? ""} aria-live="polite">
  <a
    class="button ghost"
    data-testid="lesson-run-back"
    href={hrefFor(back)}
    onclick={(event) => followLink(event, back)}
  >
    <Icon name="back" size={18} /><span>{t("lessonRun.back", { title: detail?.title ?? "…" })}</span
    >
  </a>
  <div class="lesson-run-text">
    {#if failed}
      <p class="muted">{t("lessonRun.unavailable")}</p>
    {:else if outcome === "passed"}
      <p class="lesson-done" role="status" data-testid="lesson-run-passed">
        <CheckDraw draw={justPassed} size={18} />{t("lessonRun.passed")}
      </p>
    {:else if outcome === "missed"}
      <p role="status" data-testid="lesson-run-missed">{t("lessonRun.missed")}</p>
    {:else if outcome === "error"}
      <p role="alert" data-testid="lesson-run-error">{t("lessonRun.error")}</p>
    {:else if detail}
      {#if detail.progress.completed}
        <p class="lesson-done"><Icon name="check" size={18} />{t("lessons.completed")}</p>
      {/if}
      {#if !condition}
        <p class="muted">{t("lessonRun.noCondition")}</p>
      {:else if condition.song}
        <p class="muted">{t("lessonRun.songBound")}</p>
      {:else if condition.type === "wait"}
        <p>{t("lessonRun.askWait")}</p>
      {:else}
        <p>
          {condition.min_bpm
            ? t("lessonRun.askScoreBpm", {
                score: condition.min_score ?? 0,
                bpm: condition.min_bpm,
              })
            : t("lessonRun.askScore", { score: condition.min_score ?? 0 })}
        </p>
      {/if}
    {/if}
    {#if outcome === "passed"}
      <a
        class="button primary"
        class:arrive={justPassed}
        data-testid="lesson-run-next"
        data-arrive={justPassed ? "true" : undefined}
        href={hrefFor(nextLesson ? lessonPath(ref.course, nextLesson) : back)}
        onclick={(event) =>
          followLink(event, nextLesson ? lessonPath(ref.course, nextLesson) : back)}
      >
        <span>{nextLesson ? t("lessons.next") : t("lessons.backToCourse")}</span>
      </a>
    {/if}
  </div>
</aside>

<style>
  a.arrive {
    animation: next-arrive 1.2s var(--ease);
  }

  @keyframes next-arrive {
    from {
      opacity: 0;
      transform: translateY(var(--sp-2));
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    a.arrive {
      animation: none;
    }
  }
</style>
