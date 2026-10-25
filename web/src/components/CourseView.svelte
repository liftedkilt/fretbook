<script lang="ts">
  import CoursePathArt from "./CoursePathArt.svelte";
  import Icon from "./Icon.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import OverflowMenu from "./ui/OverflowMenu.svelte";
  import type { OverflowItem } from "./ui/OverflowMenu.svelte";
  import { ApiError, deleteCourse, getCourse, importLessonPack, listCourses } from "../lib/api";
  import type { CourseDetail } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";
  import { coursePath, formatMinutes, lessonPath, passText, trackLabelKey } from "../lib/lessons";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import { ui } from "../lib/ui.svelte";

  let { id }: { id: string } = $props();

  let course = $state<CourseDetail | null>(null);
  let canEdit = $state(false);
  let error = $state("");
  let notice = $state("");
  let fileInput = $state<HTMLInputElement | null>(null);

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  function load(wanted: string) {
    getCourse(wanted)
      .then((found) => (course = found))
      .catch(fail);
  }

  $effect(() => {
    const wanted = id;
    course = null;
    error = notice = "";
    load(wanted);
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

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    error = notice = "";
    try {
      const result = await importLessonPack(file);
      notice = t("lessons.imported", { courses: result.courses, lessons: result.lessons });
      load(id);
    } catch (err) {
      error = err instanceof ApiError || err instanceof Error ? err.message : t("error.generic");
    }
  }

  const percent = $derived(
    course && course.lesson_count
      ? Math.round((course.completed_count / course.lesson_count) * 100)
      : 0,
  );

  const finished = $derived(
    !!course && course.lesson_count > 0 && course.completed_count === course.lesson_count,
  );

  const nextTitle = $derived.by(() => {
    if (!course?.next_lesson_id) return "";
    for (const level of course.levels) {
      const found = level.lessons.find((lesson) => lesson.id === course!.next_lesson_id);
      if (found) return found.title;
    }
    return "";
  });

  const menuItems = $derived.by((): OverflowItem[] => {
    if (!course || !canEdit || ui.demoMode) return [];
    const base = coursePath(course.id);
    const items: OverflowItem[] = [
      {
        id: "edit",
        label: t("lessons.editCourse"),
        icon: "edit",
        testid: "course-edit",
        onclick: () => navigate(`${base}/edit`),
      },
      {
        id: "new",
        label: t("lessons.newLesson"),
        icon: "plus",
        testid: "course-new-lesson",
        onclick: () => navigate(`${base}/new`),
      },
      {
        id: "import",
        label: t("lessons.importPack"),
        icon: "upload",
        testid: "course-import-item",
        onclick: () => fileInput?.click(),
      },
    ];
    if (course.source === "user") {
      items.push({
        id: "delete",
        label: t("lessons.deleteCourse"),
        icon: "trash",
        danger: true,
        testid: "course-delete",
        onclick: () => void remove(),
      });
    }
    return items;
  });

  function starsLabel(stars: number): string {
    return t("coursePath.starsLabel", { stars, max: 3 });
  }
</script>

<Page width="page">
  <section class="course-page" data-testid="course-view">
    {#if !course}
      <PageHeader
        title={t("lessons.heading")}
        titleSize="title"
        backHref="/lessons"
        backLabel={t("lessons.heading")}
      />
    {/if}
    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}

    {#if course}
      {@const current = course}
      <PageHeader
        title={current.title}
        titleSize="title"
        eyebrow={t("lessons.nav")}
        subtitle={[t(trackLabelKey(current.track)), current.summary].filter(Boolean).join(" · ")}
        backHref="/lessons"
        backLabel={t("lessons.heading")}
      >
        {#snippet actions()}
          {#if current.next_lesson_id}
            <a
              class="button primary"
              data-testid="course-continue"
              href={hrefFor(lessonPath(current.id, current.next_lesson_id))}
              onclick={(event) =>
                followLink(event, lessonPath(current.id, current.next_lesson_id!))}
            >
              <Icon name="play" size={18} />
              <span>
                {current.completed_count
                  ? t("coursePath.continueLesson", { lesson: nextTitle })
                  : t("lessons.start")}
              </span>
            </a>
          {/if}
          {#if menuItems.length}
            <OverflowMenu label={t("primitives.more")} testid="course-admin" items={menuItems} />
            <input
              bind:this={fileInput}
              class="visually-hidden"
              type="file"
              tabindex="-1"
              accept=".zip,application/zip"
              aria-label={t("lessons.importPack")}
              data-testid="course-import"
              onchange={pick}
            />
          {/if}
        {/snippet}
      </PageHeader>

      {#if current.locked}
        <p class="notice" role="status">
          <Icon name="lock" size={16} />
          {t("lessons.finishFirst", { courses: current.requires.join(", ") })}
        </p>
      {/if}

      <div class="layout">
        <aside class="side" data-testid="course-side">
          <CoursePathArt id={current.id} title={current.title} track={current.track} />
          <progress
            max="100"
            value={percent}
            aria-label={t("lessons.progressLabel", { course: current.title })}
          ></progress>
          <dl>
            <div>
              <dt>{t("coursePath.progress")}</dt>
              <dd>
                {t("lessons.progress", {
                  done: current.completed_count,
                  total: current.lesson_count,
                })}
              </dd>
            </div>
            <div>
              <dt>{t("coursePath.timeLeft")}</dt>
              <dd>
                {finished ? t("coursePath.finished") : `≈ ${formatMinutes(current.minutes_left)}`}
              </dd>
            </div>
            <div>
              <dt>{t("coursePath.stars")}</dt>
              <dd class="stars-total" data-testid="course-stars">
                <Icon name="starFilled" size={16} />
                {t("coursePath.starsTotal", { stars: current.stars, max: current.max_stars })}
              </dd>
            </div>
          </dl>
        </aside>

        <div class="path">
          {#each current.levels as level (level.id)}
            <section aria-labelledby="level-{level.id}">
              {#if level.title}<h2 id="level-{level.id}" class="level">{level.title}</h2>{/if}
              <ol class="rail">
                {#each level.lessons as lesson (lesson.id)}
                  {@const isNext =
                    lesson.status === "available" && lesson.id === current.next_lesson_id}
                  <li
                    class="step {lesson.status}"
                    class:next={isNext}
                    data-testid="lesson-row-{lesson.id}"
                  >
                    <span
                      class="node"
                      role={lesson.status === "locked" ? "img" : undefined}
                      aria-label={lesson.status === "locked"
                        ? t("coursePath.lockedLabel", { lesson: lesson.title })
                        : undefined}
                    >
                      {#if lesson.status === "completed"}
                        <Icon name="check" size={16} />
                      {:else if lesson.status === "locked"}
                        <Icon name="lock" size={14} />
                      {:else}
                        <Icon name="play" size={14} />
                      {/if}
                    </span>
                    {#if lesson.status === "locked"}
                      <div class="card">
                        <strong>{lesson.title}</strong>
                        {#if lesson.summary}<small class="muted">{lesson.summary}</small>{/if}
                        <small class="muted meta">
                          <Icon name="clock" size={14} />{formatMinutes(lesson.minutes)}
                        </small>
                      </div>
                    {:else}
                      <a
                        class="card link"
                        href={hrefFor(lessonPath(current.id, lesson.id))}
                        onclick={(event) => followLink(event, lessonPath(current.id, lesson.id))}
                      >
                        {#if isNext}
                          <small class="up-next">{t("coursePath.upNext")}</small>
                        {/if}
                        <strong>{lesson.title}</strong>
                        {#if lesson.summary}<small class="muted">{lesson.summary}</small>{/if}
                        {#if isNext}
                          <small class="pass">
                            <strong>{t("lessons.passHeading")}.</strong>
                            {passText(lesson.pass_condition)}
                          </small>
                        {/if}
                        <small class="muted meta">
                          <Icon name="clock" size={14} />{formatMinutes(lesson.minutes)}
                          {#if lesson.status === "completed"}
                            <span class="stars" role="img" aria-label={starsLabel(lesson.stars)}>
                              {#each [1, 2, 3] as n (n)}
                                <Icon name={n <= lesson.stars ? "starFilled" : "star"} size={14} />
                              {/each}
                            </span>
                          {/if}
                        </small>
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
        </div>
      </div>
    {/if}
  </section>
</Page>

<style>
  .course-page {
    display: grid;
    gap: var(--sp-5);
    align-content: start;
  }

  .layout {
    display: grid;
    gap: var(--sp-5);
    align-items: start;
  }

  .side {
    display: grid;
    gap: var(--sp-3);
    padding: var(--sp-3);
    border-radius: var(--r-lg);
    border: 1px solid var(--line-strong);
    background: var(--surface);
  }

  .side progress {
    width: 100%;
  }

  dl {
    display: grid;
    gap: var(--sp-2);
    margin: 0;
    padding: 0 var(--sp-2) var(--sp-2);
  }

  dl div {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
    font-size: var(--fs-sm);
  }

  dt {
    color: var(--text-2);
  }

  dd {
    margin: 0;
    font-weight: 600;
  }

  .stars-total {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    color: var(--warn);
  }

  .path {
    display: grid;
    gap: var(--sp-5);
    min-width: 0;
  }

  .level {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-h2);
  }

  .rail {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-3);
  }

  .step {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: var(--sp-3);
  }

  /* The vertical rail runs through the node column, from one lesson to the next. */
  .step::before {
    content: "";
    position: absolute;
    left: 15px;
    top: 32px;
    bottom: calc(var(--sp-3) * -1);
    width: 2px;
    background: var(--line-strong);
  }

  .step:last-child::before {
    display: none;
  }

  .node {
    z-index: 1;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-pill);
    border: 2px solid var(--line-strong);
    background: var(--bg);
    color: var(--text-2);
  }

  .step.completed .node {
    border-color: transparent;
    background: var(--success);
    color: var(--bg);
  }

  .step.completed::before {
    background: var(--success);
  }

  .step.next .node {
    border-color: transparent;
    background: var(--grad);
    color: var(--accent-ink);
    box-shadow: var(--glow);
  }

  .card {
    display: grid;
    gap: var(--sp-1);
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-md);
    border: 1px solid var(--line-strong);
    background: var(--surface);
    color: inherit;
    text-decoration: none;
  }

  a.card:hover {
    border-color: var(--accent-ring);
  }

  .step.next .card {
    border-color: var(--accent-ring);
    background: var(--accent-soft);
  }

  .step.locked .card {
    border-style: dashed;
    background: transparent;
  }

  /* Dimmed with colour, not opacity, so the text keeps its contrast. */
  .step.locked .card strong {
    color: var(--text-2);
  }

  .up-next {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: var(--fs-eyebrow);
    font-weight: 600;
    color: var(--accent-text);
  }

  .pass {
    color: var(--text);
  }

  .meta {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-1);
  }

  .stars {
    display: inline-flex;
    margin-inline-start: var(--sp-2);
    color: var(--warn);
  }

  @media (min-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 20rem;
    }

    .side {
      order: 2;
      position: sticky;
      top: var(--sp-5);
    }
  }
</style>
