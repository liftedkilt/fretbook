<script lang="ts">
  import Icon from "./Icon.svelte";
  import { deleteCourse, getCourse, listCourses } from "../lib/api";
  import type { CourseDetail } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";
  import { coursePath, lessonPath, trackLabelKey } from "../lib/lessons";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";

  let { id }: { id: string } = $props();

  let course = $state<CourseDetail | null>(null);
  let canEdit = $state(false);
  let error = $state("");

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  $effect(() => {
    const wanted = id;
    course = null;
    error = "";
    getCourse(wanted)
      .then((found) => (course = found))
      .catch(fail);
    listCourses()
      .then((list) => (canEdit = list.can_edit))
      .catch(() => (canEdit = false));
  });

  async function remove() {
    if (!course || !confirm(t("lessons.confirmDeleteCourse", { name: course.title }))) return;
    try {
      await deleteCourse(course.id);
      navigate("/lessons");
    } catch (err) {
      fail(err);
    }
  }

  const percent = $derived(
    course && course.lesson_count
      ? Math.round((course.completed_count / course.lesson_count) * 100)
      : 0,
  );
</script>

<section class="course-page" data-testid="course-view">
  <a
    class="button ghost tool-back"
    href={hrefFor("/lessons")}
    onclick={(event) => followLink(event, "/lessons")}
  >
    <Icon name="back" size={18} /><span>{t("lessons.heading")}</span>
  </a>

  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

  {#if course}
    <header class="page-hero">
      <div>
        <p class="eyebrow">{t(trackLabelKey(course.track))}</p>
        <h1 class="display hero-title">{course.title}</h1>
        {#if course.summary}<p class="muted">{course.summary}</p>{/if}
      </div>
    </header>

    {#if course.locked}
      <p class="notice" role="status">
        <Icon name="lock" size={16} />
        {t("lessons.finishFirst", { courses: course.requires.join(", ") })}
      </p>
    {/if}

    <div class="course-summary">
      <progress
        max="100"
        value={percent}
        aria-label={t("lessons.progressLabel", { course: course.title })}
      ></progress>
      <small class="muted">
        {t("lessons.progress", { done: course.completed_count, total: course.lesson_count })}
      </small>
      {#if course.next_lesson_id}
        <a
          class="button primary"
          data-testid="course-continue"
          href={hrefFor(lessonPath(course.id, course.next_lesson_id))}
          onclick={(event) => followLink(event, lessonPath(course!.id, course!.next_lesson_id!))}
        >
          <Icon name="play" size={18} />
          <span>{course.completed_count ? t("lessons.continue") : t("lessons.start")}</span>
        </a>
      {/if}
    </div>

    {#if canEdit}
      <div class="lesson-admin" data-testid="course-admin">
        <a
          class="button"
          href={hrefFor(`${coursePath(course.id)}/new`)}
          onclick={(event) => followLink(event, `${coursePath(course!.id)}/new`)}
        >
          <Icon name="plus" size={18} /><span>{t("lessons.newLesson")}</span>
        </a>
        <a
          class="button ghost"
          href={hrefFor(`${coursePath(course.id)}/edit`)}
          onclick={(event) => followLink(event, `${coursePath(course!.id)}/edit`)}
        >
          <Icon name="edit" size={18} /><span>{t("lessons.editCourse")}</span>
        </a>
        {#if course.source === "user"}
          <button class="button ghost" data-testid="course-delete" onclick={remove}>
            <Icon name="trash" size={18} /><span>{t("lessons.deleteCourse")}</span>
          </button>
        {/if}
      </div>
    {/if}

    {#each course.levels as level (level.id)}
      <section aria-labelledby="level-{level.id}">
        {#if level.title}<h2 id="level-{level.id}" class="field-label">{level.title}</h2>{/if}
        <ol class="lesson-list">
          {#each level.lessons as lesson (lesson.id)}
            <li class="lesson-row {lesson.status}" data-testid="lesson-row-{lesson.id}">
              {#if lesson.status === "locked"}
                <span class="lesson-row-icon"><Icon name="lock" size={18} /></span>
                <span class="lesson-row-text">
                  <strong>{lesson.title}</strong>
                  <small class="muted">{t("lessons.lockedLesson")}</small>
                </span>
              {:else}
                <a
                  class="lesson-row-link"
                  href={hrefFor(lessonPath(course.id, lesson.id))}
                  onclick={(event) => followLink(event, lessonPath(course!.id, lesson.id))}
                >
                  <span class="lesson-row-icon">
                    {#if lesson.status === "completed"}<Icon name="check" size={18} />{/if}
                  </span>
                  <span class="lesson-row-text">
                    <strong>{lesson.title}</strong>
                    {#if lesson.summary}<small class="muted">{lesson.summary}</small>{/if}
                  </span>
                  <span class="visually-hidden">
                    {lesson.status === "completed" ? t("lessons.done") : t("lessons.open")}
                  </span>
                </a>
              {/if}
            </li>
          {/each}
        </ol>
      </section>
    {/each}
  {/if}
</section>
