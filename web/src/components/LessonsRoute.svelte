<script lang="ts">
  import CourseView from "./CourseView.svelte";
  import LessonEditor from "./LessonEditor.svelte";
  import LessonsView from "./LessonsView.svelte";
  import LessonView from "./LessonView.svelte";
  import { t } from "../lib/i18n.svelte";

  // Everything under /lessons. Ids are never "new" or "edit" (the server refuses them), so those words
  // can be addresses of their own.
  let { path }: { path: string } = $props();

  const route = $derived.by(() => {
    const parts = path.replace(/\/+$/, "").split("/").slice(2);
    const [course = "", second = "", third = ""] = parts;
    if (parts.length === 0) return { page: "lessons" } as const;
    if (parts.length === 1) {
      return course === "new"
        ? ({ page: "newCourse" } as const)
        : ({ page: "course", course } as const);
    }
    if (parts.length === 2) {
      if (second === "edit") return { page: "editCourse", course } as const;
      if (second === "new") return { page: "newLesson", course } as const;
      return { page: "lesson", course, lesson: second } as const;
    }
    if (parts.length === 3 && third === "edit") {
      return { page: "editLesson", course, lesson: second } as const;
    }
    return { page: "missing" } as const;
  });
</script>

{#if route.page === "lessons"}
  <LessonsView />
{:else if route.page === "newCourse"}
  <LessonEditor kind="course" />
{:else if route.page === "editCourse"}
  <LessonEditor kind="course" course={route.course} />
{:else if route.page === "newLesson"}
  <LessonEditor kind="lesson" course={route.course} />
{:else if route.page === "editLesson"}
  <LessonEditor kind="lesson" course={route.course} lesson={route.lesson} />
{:else if route.page === "lesson"}
  <LessonView course={route.course} lesson={route.lesson} />
{:else if route.page === "course"}
  <CourseView id={route.course} />
{:else}
  <p class="muted">{t("app.notFound")}</p>
{/if}
