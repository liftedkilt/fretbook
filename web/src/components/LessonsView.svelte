<script lang="ts">
  import Icon from "./Icon.svelte";
  import { ApiError, importLessonPack, listCourses } from "../lib/api";
  import type { CourseList, CourseSummary } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";
  import { TRACKS, coursePath, lessonPath } from "../lib/lessons";
  import { followLink, hrefFor } from "../lib/router.svelte";

  let data = $state<CourseList | null>(null);
  let error = $state("");
  let notice = $state("");
  let importing = $state(false);

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  function load() {
    listCourses()
      .then((list) => (data = list))
      .catch(fail);
  }

  $effect(load);

  const byTrack = $derived(
    TRACKS.map((track) => ({
      track: track.id,
      labelKey: track.labelKey,
      courses: (data?.courses ?? []).filter((course) => course.track === track.id),
    })).filter((group) => group.courses.length > 0),
  );

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    importing = true;
    error = notice = "";
    try {
      const result = await importLessonPack(file);
      notice = t("lessons.imported", { courses: result.courses, lessons: result.lessons });
      load();
    } catch (err) {
      error = err instanceof ApiError || err instanceof Error ? err.message : t("error.generic");
    } finally {
      importing = false;
    }
  }

  function percent(course: CourseSummary): number {
    return course.lesson_count
      ? Math.round((course.completed_count / course.lesson_count) * 100)
      : 0;
  }
</script>

<section class="lessons-page" data-testid="lessons-view">
  <header class="page-hero">
    <div>
      <p class="eyebrow">{t("lessons.eyebrow")}</p>
      <h1 class="display hero-title">{t("lessons.heading")}</h1>
      <p class="muted">{t("lessons.subtitle")}</p>
    </div>
  </header>

  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}

  {#if data?.resume}
    <a
      class="lesson-resume"
      data-testid="lessons-continue"
      href={hrefFor(lessonPath(data.resume.course_id, data.resume.lesson_id))}
      onclick={(event) =>
        followLink(event, lessonPath(data!.resume!.course_id, data!.resume!.lesson_id))}
    >
      <Icon name="play" size={22} />
      <span>
        <small>{t("lessons.continue")}</small>
        <strong>{data.resume.lesson_title}</strong>
        <small>{data.resume.course_title}</small>
      </span>
    </a>
  {/if}

  {#if data?.can_edit}
    <div class="lesson-admin" data-testid="lessons-admin">
      <a
        class="button"
        href={hrefFor("/lessons/new")}
        onclick={(event) => followLink(event, "/lessons/new")}
      >
        <Icon name="plus" size={18} /><span>{t("lessons.newCourse")}</span>
      </a>
      <label class="button ghost" class:disabled={importing}>
        <Icon name="upload" size={18} /><span>{t("lessons.importPack")}</span>
        <input
          class="visually-hidden"
          type="file"
          accept=".zip,application/zip"
          data-testid="lessons-import"
          disabled={importing}
          onchange={pick}
        />
      </label>
    </div>
    {#if data.problems.length}
      <details class="lesson-problems" data-testid="lessons-problems">
        <summary>{t("lessons.problems", { count: data.problems.length })}</summary>
        <ul>
          {#each data.problems as problem (problem)}<li><code>{problem}</code></li>{/each}
        </ul>
      </details>
    {/if}
  {/if}

  {#if data && byTrack.length === 0}
    <p class="muted" data-testid="lessons-empty">{t("lessons.empty")}</p>
  {/if}

  {#each byTrack as group (group.track)}
    <section aria-labelledby="track-{group.track}">
      <h2 id="track-{group.track}" class="field-label">{t(group.labelKey)}</h2>
      <ul class="course-grid">
        {#each group.courses as course (course.id)}
          <li>
            <a
              class="course-card"
              class:locked={course.locked}
              data-testid="course-card-{course.id}"
              href={hrefFor(coursePath(course.id))}
              onclick={(event) => followLink(event, coursePath(course.id))}
            >
              <span class="course-card-title">
                {#if course.locked}<Icon name="lock" size={16} />{/if}
                <strong>{course.title}</strong>
              </span>
              {#if course.summary}<span class="muted">{course.summary}</span>{/if}
              {#if course.locked}
                <span class="course-card-lock">
                  {t("lessons.finishFirst", { courses: course.requires.join(", ") })}
                </span>
              {/if}
              <progress
                max="100"
                value={percent(course)}
                aria-label={t("lessons.progressLabel", { course: course.title })}
              ></progress>
              <small class="muted">
                {t("lessons.progress", {
                  done: course.completed_count,
                  total: course.lesson_count,
                })}
              </small>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</section>
