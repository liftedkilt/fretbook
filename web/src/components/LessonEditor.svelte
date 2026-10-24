<script lang="ts">
  import Icon from "./Icon.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import LessonBlocks from "./LessonBlocks.svelte";
  import {
    ApiError,
    deleteLesson,
    getCourseSource,
    getLessonSource,
    previewLesson,
    saveCourseSource,
    saveLessonSource,
  } from "../lib/api";
  import type { LessonPreview } from "../lib/api-types";
  import { debounced } from "../lib/asciiTab";
  import { t } from "../lib/i18n.svelte";
  import { courseTemplate, coursePath, lessonPath, lessonTemplate, slugify } from "../lib/lessons";
  import { navigate } from "../lib/router.svelte";

  // `lesson` empty: a new lesson in `course`; `course` empty too: a new course. With `kind` "course" and a
  // `course`, the course's own course.md.
  let {
    kind,
    course = "",
    lesson = "",
  }: { kind: "lesson" | "course"; course?: string; lesson?: string } = $props();

  const SNIPPETS: { key: string; labelKey: string; text: string }[] = [
    { key: "chord", labelKey: "lessons.blocks.chord", text: "```fretbook:chord\nname: Am\n```\n" },
    {
      key: "fretboard",
      labelKey: "lessons.blocks.fretboard",
      text: "```fretbook:fretboard\nroot: A\nscale: minor-pentatonic\n```\n",
    },
    {
      key: "tab",
      labelKey: "lessons.blocks.tab",
      text: "```fretbook:tab\ne|-0-1-3-|\nB|-----1-|\nG|-------|\nD|-------|\nA|-------|\nE|-------|\n```\n",
    },
    {
      key: "exercise",
      labelKey: "lessons.blocks.exercise",
      text: "```fretbook:exercise\npreset: pentatonicBox\n```\n",
    },
    {
      key: "song",
      labelKey: "lessons.blocks.song",
      text: "```fretbook:song\nsong: \ntitle: \n```\n",
    },
    {
      key: "media",
      labelKey: "lessons.blocks.media",
      text: "```fretbook:media\ntype: video\nsrc: https://\ntitle: \n```\n",
    },
    {
      key: "pass",
      labelKey: "lessons.blocks.pass",
      text: "```fretbook:pass\ntype: score\nmin_score: 80\nmin_bpm: 90\n```\n",
    },
  ];

  const isNew = $derived(kind === "course" ? !course : !lesson);
  let id = $state("");
  let idEdited = $state(false);
  let text = $state("");
  let loaded = $state(false);
  let source = $state<"builtin" | "user">("user");
  let error = $state("");
  let saving = $state(false);
  let preview = $state<LessonPreview | null>(null);
  let previewError = $state("");
  let area = $state<HTMLTextAreaElement | null>(null);

  const titleOf = (value: string) => /^title:\s*(.*)$/m.exec(value)?.[1]?.trim() ?? "";

  $effect(() => {
    const [wantedKind, wantedCourse, wantedLesson] = [kind, course, lesson];
    loaded = false;
    error = "";
    preview = null;
    idEdited = false;
    id = wantedKind === "course" ? wantedCourse : wantedLesson;
    if (wantedKind === "course" && !wantedCourse) {
      text = courseTemplate();
      loaded = true;
    } else if (wantedKind === "lesson" && !wantedLesson) {
      text = lessonTemplate();
      loaded = true;
    } else {
      const read =
        wantedKind === "course"
          ? getCourseSource(wantedCourse)
          : getLessonSource(wantedCourse, wantedLesson);
      read
        .then((found) => {
          text = found.text;
          source = found.source;
          loaded = true;
        })
        .catch(fail);
    }
  });

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  const refresh = debounced((value: string) => {
    previewLesson(value)
      .then((found) => {
        preview = found;
        previewError = "";
      })
      .catch((err) => {
        preview = null;
        previewError = err instanceof Error ? err.message : t("error.generic");
      });
  }, 300);

  $effect(() => {
    const value = text;
    if (kind === "lesson" && loaded) refresh.call(value);
    return () => refresh.cancel();
  });

  function changed() {
    if (isNew && !idEdited) id = slugify(titleOf(text));
  }

  function insert(snippet: string) {
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    text = `${before}${lead}${snippet}\n${text.slice(end)}`;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    error = "";
    try {
      if (kind === "course") {
        await saveCourseSource(id, text);
        navigate(coursePath(id));
      } else {
        await saveLessonSource(course, id, text);
        navigate(lessonPath(course, id));
      }
    } catch (err) {
      error = err instanceof ApiError || err instanceof Error ? err.message : t("error.generic");
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!confirm(t("lessons.confirmDeleteLesson"))) return;
    try {
      await deleteLesson(course, lesson);
      navigate(coursePath(course));
    } catch (err) {
      fail(err);
    }
  }

  const back = $derived(
    kind === "course"
      ? course
        ? coursePath(course)
        : "/lessons"
      : lesson
        ? lessonPath(course, lesson)
        : coursePath(course),
  );
</script>

<Page width="narrow">
  <section class="lesson-editor" data-testid="lesson-editor">
    <PageHeader
      title={kind === "course"
        ? isNew
          ? t("lessons.newCourse")
          : t("lessons.editCourse")
        : isNew
          ? t("lessons.newLesson")
          : t("lessons.edit")}
      titleSize="title"
      eyebrow={t("lessons.nav")}
      backHref={back}
      backLabel={t("lessons.heading")}
    />
    <p class="muted">
      {kind === "course" ? t("lessons.courseEditorHelp") : t("lessons.editorHelp")}
      <a
        href="https://github.com/liftedkilt/fretbook/blob/main/docs/lessons.md"
        target="_blank"
        rel="noopener noreferrer">{t("lessons.formatDocs")}</a
      >
    </p>

    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

    {#if loaded}
      <form class="lesson-editor-form" onsubmit={save}>
        <label class="tool-field">
          <span>{t("lessons.id")}</span>
          <input
            type="text"
            data-testid="lesson-id"
            bind:value={id}
            readonly={!isNew}
            required
            pattern="[a-z0-9][a-z0-9\-]*"
            maxlength="64"
            autocomplete="off"
            spellcheck="false"
            oninput={() => (idEdited = true)}
          />
        </label>
        {#if kind === "lesson"}
          <div class="chip-row" role="group" aria-label={t("lessons.insert")}>
            {#each SNIPPETS as snippet (snippet.key)}
              <button
                class="chip"
                type="button"
                data-testid="lesson-insert-{snippet.key}"
                onclick={() => insert(snippet.text)}>{t(snippet.labelKey)}</button
              >
            {/each}
          </div>
        {/if}
        <div class="lesson-editor-panes" class:single={kind === "course"}>
          <label class="tool-field">
            <span>{t("lessons.markdown")}</span>
            <textarea
              class="lesson-source"
              data-testid="lesson-source"
              bind:this={area}
              bind:value={text}
              oninput={changed}
              rows="22"
              spellcheck="false"></textarea>
          </label>
          {#if kind === "lesson"}
            <div class="lesson-preview" data-testid="lesson-preview" aria-live="polite">
              <h2 class="field-label">{t("lessons.preview")}</h2>
              {#if previewError}
                <p class="alert" role="alert" data-testid="lesson-preview-error">
                  <Icon name="alert" size={18} />{previewError}
                </p>
              {:else if preview}
                <h3>{preview.title}</h3>
                <LessonBlocks blocks={preview.blocks} />
              {/if}
            </div>
          {/if}
        </div>
        <div class="lesson-admin">
          <button class="primary" type="submit" data-testid="lesson-save" disabled={saving || !id}>
            <Icon name="save" size={18} /><span>{t("lessons.save")}</span>
          </button>
          {#if kind === "lesson" && !isNew && source === "user"}
            <button class="ghost" type="button" data-testid="lesson-delete" onclick={remove}>
              <Icon name="trash" size={18} /><span>{t("lessons.delete")}</span>
            </button>
          {/if}
        </div>
        {#if source === "builtin" && !isNew}
          <p class="muted">{t("lessons.builtinNote")}</p>
        {/if}
      </form>
    {/if}
  </section>
</Page>
