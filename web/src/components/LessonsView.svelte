<script lang="ts">
  import CoursePathArt from "./CoursePathArt.svelte";
  import Icon from "./Icon.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import OverflowMenu from "./ui/OverflowMenu.svelte";
  import { ApiError, importLessonPack, listCourses } from "../lib/api";
  import type { CourseList, CourseSummary } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";
  import {
    TRACKS,
    coursePath,
    formatMinutes,
    lessonPath,
    startHere,
    trackLabelKey,
  } from "../lib/lessons";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import { defaultFamily, ui } from "../lib/ui.svelte";

  let data = $state<CourseList | null>(null);
  let error = $state("");
  let notice = $state("");
  let importing = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

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

  const suggested = $derived(startHere(data?.courses ?? [], defaultFamily()));
  const canEdit = $derived(!!data?.can_edit && !ui.demoMode);

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

  const finished = (course: CourseSummary) =>
    course.lesson_count > 0 && course.completed_count === course.lesson_count;

  function action(course: CourseSummary): string {
    if (finished(course)) return t("coursePath.review");
    return course.completed_count ? t("coursePath.continue") : t("lessons.start");
  }
</script>

<Page width="page">
  <section class="lessons-page" data-testid="lessons-view">
    <PageHeader
      title={t("lessons.heading")}
      eyebrow={t("lessons.nav")}
      subtitle={t("lessons.subtitle")}
    >
      {#snippet actions()}
        {#if canEdit}
          <OverflowMenu
            label={t("primitives.more")}
            testid="lessons-admin"
            items={[
              {
                id: "new",
                label: t("lessons.newCourse"),
                icon: "plus",
                testid: "lessons-new-course",
                onclick: () => navigate("/lessons/new"),
              },
              {
                id: "import",
                label: t("lessons.importPack"),
                icon: "upload",
                disabled: importing,
                testid: "lessons-import-item",
                onclick: () => fileInput?.click(),
              },
            ]}
          />
          <input
            bind:this={fileInput}
            class="visually-hidden"
            type="file"
            tabindex="-1"
            accept=".zip,application/zip"
            aria-label={t("lessons.importPack")}
            data-testid="lessons-import"
            disabled={importing}
            onchange={pick}
          />
        {/if}
      {/snippet}
    </PageHeader>

    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}

    {#if data?.resume}
      {@const resume = data.resume}
      <a
        class="hero"
        data-testid="lessons-continue"
        href={hrefFor(lessonPath(resume.course_id, resume.lesson_id))}
        onclick={(event) => followLink(event, lessonPath(resume.course_id, resume.lesson_id))}
      >
        <span class="hero-icon"><Icon name="play" size={22} /></span>
        <span class="hero-text">
          <small class="eyebrow">{t("lessons.continue")}</small>
          <strong>{resume.lesson_title}</strong>
          <small class="muted">{resume.course_title}</small>
        </span>
      </a>
    {:else if suggested}
      <a
        class="hero"
        data-testid="lessons-start-here"
        href={hrefFor(coursePath(suggested.id))}
        onclick={(event) => followLink(event, coursePath(suggested.id))}
      >
        <span class="hero-icon"><Icon name="graduation" size={22} /></span>
        <span class="hero-text">
          <small class="eyebrow">{t("coursePath.startHere")}</small>
          <strong>{suggested.title}</strong>
          <small class="muted">
            {t(trackLabelKey(suggested.track))} · {t("coursePath.lessonCount", {
              count: suggested.lesson_count,
            })} · ≈ {formatMinutes(suggested.minutes_left)}
          </small>
        </span>
      </a>
    {/if}

    {#if data && data.problems.length}
      <details class="lesson-problems" data-testid="lessons-problems">
        <summary>{t("lessons.problems", { count: data.problems.length })}</summary>
        <ul>
          {#each data.problems as problem (problem)}<li><code>{problem}</code></li>{/each}
        </ul>
      </details>
    {/if}

    {#if data && byTrack.length === 0}
      <p class="muted" data-testid="lessons-empty">{t("lessons.empty")}</p>
    {/if}

    {#each byTrack as group (group.track)}
      <section aria-labelledby="track-{group.track}">
        <h2 id="track-{group.track}" class="section-title">{t(group.labelKey)}</h2>
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
                <CoursePathArt id={course.id} title={course.title} track={course.track} />
                <span class="body">
                  <span class="title">
                    {#if course.locked}<Icon name="lock" size={16} />{/if}
                    <strong>{course.title}</strong>
                  </span>
                  {#if course.summary}<span class="muted summary">{course.summary}</span>{/if}
                  {#if course.locked}
                    <span class="lock-note">
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
                    {#if !finished(course)}
                      · ≈ {formatMinutes(course.minutes_left)} {t("coursePath.left")}
                    {/if}
                  </small>
                  {#if !course.locked}
                    <span class="go">
                      {action(course)}<Icon name="forward" size={16} />
                    </span>
                  {/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </section>
</Page>

<style>
  .lessons-page {
    display: grid;
    gap: var(--sp-5);
    align-content: start;
  }

  .hero {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-4) var(--sp-5);
    border-radius: var(--r-lg);
    border: 1px solid var(--accent-ring);
    background: var(--accent-soft);
    color: inherit;
    text-decoration: none;
  }

  .hero-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: var(--r-pill);
    background: var(--grad);
    color: var(--accent-ink);
  }

  .hero-text {
    display: grid;
    gap: var(--sp-1);
    min-width: 0;
  }

  .hero-text strong {
    font-size: var(--fs-h3);
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: var(--fs-eyebrow);
    color: var(--accent-text);
  }

  .section-title {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-h2);
  }

  .course-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-4);
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
  }

  .course-card {
    display: grid;
    align-content: start;
    gap: var(--sp-3);
    height: 100%;
    padding: var(--sp-3);
    border-radius: var(--r-lg);
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: inherit;
    text-decoration: none;
  }

  .course-card:hover {
    border-color: var(--accent-ring);
  }

  .course-card.locked {
    border-style: dashed;
  }

  .course-card.locked :global(.art) {
    opacity: 0.55;
  }

  .body {
    display: grid;
    gap: var(--sp-2);
    padding: var(--sp-1) var(--sp-2) var(--sp-2);
  }

  .title {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-h3);
  }

  .summary {
    font-size: var(--fs-sm);
  }

  .lock-note {
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  progress {
    width: 100%;
  }

  .go {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    justify-self: start;
    font-weight: 600;
    font-size: var(--fs-sm);
    color: var(--accent-text);
  }

  .lesson-problems code {
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
